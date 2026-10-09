import { randomUUID, createHash } from 'node:crypto';
import { runtimeTargets } from '../../../apps/studio/conversation/src/runtime-targets.mjs';

const fail = (message, status = 409) => Object.assign(new Error(message), { status });
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && /^[a-zA-Z0-9:_-]+$/.test(value);
const relative = value => typeof value === 'string' && value.length > 0 && value.length <= 1024 && !/[\x00-\x1f:*?"<>|]/.test(value) && !/^[\\/]/.test(value) && !value.replaceAll('\\', '/').split('/').includes('..');
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const names = { projects: 'projects.list', projectCreate: 'workspace.project_create', projectImport: 'workspace.bind_project', directory: 'workspace.directory_list', read: 'workspace.text_read', write: 'workspace.text_write', terminal: 'terminal.exec', gitStatus: 'git.status', gitDiff: 'git.diff', search: 'project.search_text', briefing: 'agent.project_briefing', preview: 'project.preview_status', continuity: 'continuity.get', continuitySave: 'continuity.update' };
const statuses = ['prepared','submitting','queued','running','succeeded','failed','cancelled','uncertain','not-sent','reviewed'];
export const validOperations = data => data?.schemaVersion === 1 && Array.isArray(data.operations) && data.operations.length <= 40 && new Set(data.operations.map(o => o?.id)).size === data.operations.length && data.operations.every(o => o && identifier(o.id) && Object.hasOwn(names, o.kind) && statuses.includes(o.status) && identifier(o.deviceId) && (o.project == null || identifier(o.project)) && (o.path == null || relative(o.path)) && (o.requestId == null || identifier(o.requestId)) && typeof o.createdAt === 'string' && typeof o.label === 'string' && o.label.length <= 1200) && JSON.stringify(data).length <= 8000000;

// Thin client for the canonical Product REST contract. ControlPlane supplies identity,
// grants and audit; only this fixed set of project capabilities is exposed to the UI.
export class ProductRuntime {
  #token;
  constructor({ storage, env = process.env, fetcher = fetch, interval = 1000 }) {
    this.storage = storage; this.fetcher = fetcher; this.interval = interval; this.operations = []; this.tasks = new Set(); this.observations = new Set(); this.unpersisted = new Set(); this.polling = new Map(); this.targets = []; this.version = 0;
    this.#token = env.ORDAX_PRODUCT_ACCESS_TOKEN?.trim() || '';
    this.spaceId = env.ORDAX_PRODUCT_SPACE_ID?.trim() || null;
    this.base = env.ORDAX_PRODUCT_CONTROL_PLANE_URL?.trim() || 'https://ordax-control-plane-v3.ordax-ac1ca1b50d09.workers.dev';
    this.configured = false;
    this.catalogAvailable = false; this.targetsCheckedAt = null; this.targetIssue = ''; this.targetsPending = null; this.connectPending = null; this.nextTargetsAt = 0;
    try {
      const url = new URL(this.base);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error();
      this.base = url.origin; this.configured = Boolean(this.#token) && this.#token.length <= 16000 && !/[\r\n]/.test(this.#token) && (!this.spaceId || identifier(this.spaceId));
    } catch { this.issue = 'A conexão do Runtime requer a origem HTTPS do ControlPlane.'; }
  }
  async init() {
    let saved;
    try { saved = await this.storage.read('runtime-operations', { schemaVersion: 1, operations: [] }, { validate: validOperations, requireRecovery: true }); if (!validOperations(saved)) throw new Error('O registro local requer recuperação.'); }
    catch (error) { this.recoveryRequired = true; this.issue = error.message; return; }
    this.operations = validOperations(saved) ? saved.operations : [];
    for (const operation of this.operations) {
      if (['prepared','submitting'].includes(operation.status)) operation.status = 'uncertain';
    }
    this.timer = setInterval(() => {
      if (this.connected && Date.now() >= this.nextTargetsAt) this.track(() => this.refreshTargets());
      for (const op of this.operations) if (this.configured && op.requestId && ['queued','running'].includes(op.status)) this.track(() => this.observe(op, { background: true }));
    }, this.interval);
  }
  state({ since } = {}) { return { version: this.version, configured: this.configured, connected: this.connected || false, catalogAvailable: this.catalogAvailable, targetsCheckedAt: this.targetsCheckedAt, targetIssue: this.targetIssue, recoveryRequired: Boolean(this.recoveryRequired), issue: this.issue || '', targets: structuredClone(this.targets), ...(since === this.version ? {} : { operations: structuredClone(this.operations) }) }; }
  async persist(operations = this.operations) { if (this.recoveryRequired) throw fail(this.issue, 503); await this.storage.write('runtime-operations', { schemaVersion: 1, operations: structuredClone(operations) }); this.version++; }
  async commitOperation(operation, next) {
    await this.persist(this.operations.map(item => item === operation ? next : item));
    Object.assign(operation, next);
    this.unpersisted.delete(operation.id);
  }
  async request(route, method = 'GET', body) {
    if (!this.configured) throw fail('O host ainda não recebeu a sessão autorizada do OrdaX Runtime.', 503);
    let response;
    try { response = await this.fetcher(this.base + route, { method, redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${this.#token}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); }
    catch { throw fail('A conexão com o OrdaX Runtime foi interrompida. Confira o estado da operação antes de repetir.', 502); }
    const chunks = []; let size = 0;
    for await (const chunk of response.body || []) { size += chunk.byteLength; if (size > 4 * 1024 * 1024) throw fail('O Runtime retornou dados demais para esta operação.', 502); chunks.push(Buffer.from(chunk)); }
    let result; try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fail('Resposta inválida do OrdaX Runtime.', 502); }
    if (!response.ok || result?.ok !== true) {
      const code = /^[a-zA-Z0-9_-]{1,100}$/.test(result?.error || '') ? result.error : 'product_remote_error';
      throw Object.assign(fail(`O OrdaX Runtime recusou a operação (${code}). Confira a sessão e as permissões do projeto.`, response.status === 401 || response.status === 403 ? response.status : 502), { rejected: [400,401,403,404,413,422].includes(response.status) });
    }
    return result;
  }
  async refreshTargets() {
    if (this.targetsPending) return this.targetsPending;
    this.targetsPending = (async () => {
      try {
        const data = await this.request('/v3/product/targets' + (this.spaceId ? '?space_id=' + encodeURIComponent(this.spaceId) : ''));
        this.targets = runtimeTargets(data.targets); this.catalogAvailable = true; this.targetIssue = '';
        this.targetsCheckedAt = new Date().toISOString(); this.version++;
        return this.state();
      } catch (error) {
        if (error.status === 401 || error.status === 403) { this.connected = false; this.targets = []; }
        this.catalogAvailable = false; this.targetIssue = error.message; this.version++;
        throw error;
      } finally { this.nextTargetsAt = Date.now() + 30000; }
    })().finally(() => { this.targetsPending = null; });
    return this.targetsPending;
  }
  async connect() {
    if (this.recoveryRequired) throw fail(this.issue, 503);
    if (this.connectPending) return this.connectPending;
    this.connectPending = (async () => {
      try {
        await this.request('/v3/product/session'); await this.refreshTargets();
        this.connected = true; this.issue = ''; return this.state();
      } catch (error) { this.connected = false; this.catalogAvailable = false; this.targets = []; this.issue = error.message; throw error; }
    })().finally(() => { this.connectPending = null; });
    return this.connectPending;
  }
  input(data) {
    if (!data || !Object.hasOwn(names, data.kind) || !identifier(data.deviceId) || !this.targets.some(t => t.deviceId === data.deviceId)) throw fail('Selecione um dispositivo autorizado.', 400);
    if (!this.catalogAvailable) throw fail('Atualize a disponibilidade dos dispositivos antes de executar.', 503);
    if (this.targets.find(t => t.deviceId === data.deviceId).online === false) throw fail('O dispositivo foi informado offline. Ligue-o ou selecione outro dispositivo autorizado. Nada foi enviado.', 409);
    const fields = { projects: [], projectCreate: ['slug','name'], projectImport: ['slug','relativePath'], directory: ['path'], read: ['path'], write: ['path','content','expectedSha256'], terminal: ['argv','cwd'], gitStatus: [], gitDiff: [], search: ['query'], briefing: ['query'], preview: [], continuity: [], continuitySave: ['summary','nextAction','completed','blockers','changedPaths'] };
    if (Object.keys(data).some(key => !['kind','deviceId','project',...fields[data.kind]].includes(key))) throw fail('Campo não suportado pela operação.', 400);
    const globalProjectAction = ['projectCreate','projectImport'].includes(data.kind);
    if (!['projects','projectCreate','projectImport'].includes(data.kind) && !identifier(data.project)) throw fail('Selecione um projeto.', 400);
    if (globalProjectAction && data.project != null && data.project !== '') throw fail('Criação e importação não aceitam um projeto ativo.', 400);
    if (data.project !== undefined && data.project !== '' && !identifier(data.project)) throw fail('Projeto inválido.', 400);
    const arguments_ = {}; let label = data.kind;
    if (globalProjectAction) {
      if (typeof data.slug !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(data.slug)) throw fail('Use um identificador de até 64 letras minúsculas, números, hífen ou sublinhado.', 400);
      Object.assign(arguments_, { slug: data.slug, apps: [], set_default: false });
      if (data.kind === 'projectCreate') {
        if (typeof data.name !== 'string' || !data.name.trim() || data.name.length > 80 || /[\x00-\x1f]/.test(data.name)) throw fail('Nome do projeto inválido.', 400);
        Object.assign(arguments_, { name: data.name.trim(), git_init: false, readme: true }); label = `Criar projeto ${data.slug}`;
      } else {
        if (!relative(data.relativePath) || data.relativePath === '.') throw fail('Informe uma pasta relativa dentro do workspace ORDAX.', 400);
        arguments_.relative_path = data.relativePath; label = `Registrar pasta ${data.relativePath}`;
      }
    }
    if (['search','briefing'].includes(data.kind)) {
      const limit = data.kind === 'search' ? 200 : 500;
      if (typeof data.query !== 'string' || data.query.length > limit || (data.kind === 'search' && !data.query.trim()) || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(data.query)) throw fail(`Informe uma busca de até ${limit} caracteres.`, 400);
      Object.assign(arguments_, { query: data.query, ...(data.kind === 'search' ? { max_results: 50, max_files: 1000, case_sensitive: false } : { recall_limit: 10 }) }); label = data.query || 'Contexto do projeto';
    }
    if (data.kind === 'continuitySave') {
      if (typeof data.summary !== 'string' || !data.summary.trim() || data.summary.length > 4000 || typeof data.nextAction !== 'string' || data.nextAction.length > 2000 || /\0/.test(data.summary + data.nextAction)) throw fail('Informe o resumo e o próximo passo dentro dos limites.', 400);
      for (const key of ['completed','blockers','changedPaths']) if (!Array.isArray(data[key]) || data[key].length > 100 || data[key].some(item => typeof item !== 'string' || item.length > 4000 || item.includes('\0'))) throw fail('Consulte a continuidade para preservar os itens concluídos, pendências e arquivos alterados.', 400);
      Object.assign(arguments_, { summary: data.summary, next_action: data.nextAction, completed: data.completed, blockers: data.blockers, changed_paths: data.changedPaths }); label = 'Salvar continuidade do projeto';
    }
    if (data.kind === 'directory') { if (!relative(data.path)) throw fail('Diretório inválido.', 400); Object.assign(arguments_, { path: data.path, max_depth: 2, max_entries: 300, include_hidden: false }); label = data.path; }
    if (['read','write'].includes(data.kind)) { if (!relative(data.path) || data.path === '.') throw fail('Arquivo inválido.', 400); arguments_.path = data.path; label = data.path; }
    if (data.kind === 'read') arguments_.start_line = 1;
    if (data.kind === 'write') {
      if (!sha(data.expectedSha256) || typeof data.content !== 'string' || Buffer.byteLength(data.content) > 500000) throw fail('A alteração requer o conteúdo e o SHA-256 do arquivo lido.', 400);
      Object.assign(arguments_, { content: data.content, expected_sha256: data.expectedSha256, create: false });
    }
    if (data.kind === 'terminal') {
      if (!Array.isArray(data.argv) || data.argv.length < 1 || data.argv.length > 128 || data.argv.some(a => typeof a !== 'string' || !a || a.length > 8192 || a.includes('\0')) || !relative(data.cwd)) throw fail('Comando inválido. Informe um vetor de argumentos JSON e um diretório relativo.', 400);
      Object.assign(arguments_, { argv: data.argv, shell: false, cwd: data.cwd, timeout_seconds: 120 }); label = data.argv.join(' ').slice(0, 1200);
    }
    return { device_id: data.deviceId, action: names[data.kind], arguments: arguments_, ...(data.project ? { project: data.project } : {}), ...(this.spaceId ? { space_id: this.spaceId } : {}), label };
  }
  async submit(data) {
    if (this.recoveryRequired) throw fail(this.issue, 503);
    if (!this.connected) throw fail('Conecte o OrdaX Runtime para consultar o projeto.');
    if (this.submitting || this.operations.some(o => ['prepared','submitting','queued','running','uncertain'].includes(o.status))) throw fail('Confira ou aguarde a operação em andamento antes de iniciar outra.');
    const { label, ...payload } = this.input(data);
    if (Buffer.byteLength(JSON.stringify(payload)) > 56000) throw fail('O conteúdo da operação excedeu o limite do ControlPlane. Reduza o tamanho da alteração ou dos argumentos.', 413);
    const operation = { id: randomUUID(), kind: data.kind, deviceId: data.deviceId, project: data.project || null, path: data.path || null, ...(data.slug ? { slug: data.slug } : {}), label, status: 'prepared', requestId: null, createdAt: new Date().toISOString(), ...(data.kind === 'write' ? { expectedSha256: data.expectedSha256, proposedSha256: createHash('sha256').update(data.content).digest('hex') } : {}) };
    this.submitting = true;
    try {
      await this.refreshTargets();
      this.input(data);
      const previous = this.operations; this.operations = [...this.operations.slice(-39), operation];
      try { await this.persist(); } catch { this.operations = previous; throw fail('Não foi possível registrar a operação no dispositivo. Nada foi enviado.', 503); }
      this.track(() => this.dispatch(operation, payload)); return structuredClone(operation);
    } finally { this.submitting = false; }
  }
  track(task) { const pending = Promise.resolve().then(task).catch(error => { this.issue = error.message; }); this.tasks.add(pending); pending.finally(() => this.tasks.delete(pending)); }
  async dispatch(operation, payload) {
    operation.status = 'submitting';
    try { await this.persist(); } catch { operation.status = 'not-sent'; this.issue = 'A operação não foi enviada: falha ao salvar o registro local.'; return; }
    const next = structuredClone(operation);
    try {
      const result = await this.request('/v3/product/actions', 'POST', payload);
      if (!identifier(result.request_id)) throw fail('O Runtime não confirmou o identificador da operação.');
      next.requestId = result.request_id; next.status = 'queued'; this.issue = '';
    } catch (error) { next.status = error.rejected ? 'failed' : 'uncertain'; next.error = error.message; this.issue = error.message; }
    try { await this.commitOperation(operation, next); }
    catch { operation.requestId = next.requestId; operation.status = next.requestId ? 'queued' : 'uncertain'; this.unpersisted.add(operation.id); this.issue = 'Não foi possível salvar a confirmação do Runtime. O envio não será repetido; confira o registro antes de continuar.'; }
  }
  async observe(operation, { background = false } = {}) {
    if (background && Date.now() < (this.polling.get(operation.id)?.nextAt || 0)) return;
    if (this.observations.has(operation.id) || !operation.requestId) return;
    this.observations.add(operation.id);
    const next = structuredClone(operation);
    try {
      const data = await this.request('/v3/product/actions/' + encodeURIComponent(operation.requestId));
      const remote = data.action;
      if (!remote || !['queued','running','succeeded','failed','cancelled'].includes(remote.status) || remote.request_id !== operation.requestId || remote.action !== names[operation.kind] || (remote.project ?? null) !== (operation.project ?? null)) throw fail('O resultado do Runtime não corresponde ao registro e ao projeto desta operação.');
      if (remote.status === operation.status && ['queued','running'].includes(remote.status) && !this.unpersisted.has(operation.id)) { this.polling.delete(operation.id); this.issue = ''; return; }
      next.status = remote.status; next.error = remote.error_code ? String(remote.error_code).slice(0, 200) : '';
      if (['succeeded','failed','cancelled'].includes(remote.status)) {
        if (JSON.stringify(remote.result ?? null).length > 120000) { next.status = 'failed'; next.error = 'Resultado muito extenso. Solicite um arquivo menor.'; }
        else next.result = remote.result;
        if (remote.result?.ok === false) { next.status = 'failed'; next.error = String(remote.result.summary || 'O Runtime recusou a operação.').slice(0, 500); }
        next.finishedAt = new Date().toISOString();
      }
      await this.commitOperation(operation, next); this.polling.delete(operation.id); this.issue = '';
    } catch (error) {
      const failures = Math.min(6, (this.polling.get(operation.id)?.failures || 0) + 1);
      this.polling.set(operation.id, { failures, nextAt: Date.now() + Math.min(30000, 1000 * 2 ** failures) });
      this.issue = error.message;
    } finally { this.observations.delete(operation.id); }
  }
  async review(id) {
    if (this.recoveryRequired) throw fail(this.issue, 503);
    const operation = this.operations.find(o => o.id === id);
    if (!operation || operation.status !== 'uncertain') throw fail('A operação não requer revisão.');
    await this.commitOperation(operation, { ...operation, status: 'reviewed' });
    return this.state();
  }
  async close() { clearInterval(this.timer); await Promise.allSettled([...this.tasks]); if (!this.recoveryRequired) await this.persist(); }
}
