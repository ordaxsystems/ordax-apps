import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../apps/studio/conversation');
const MIME = { '.html': 'text/html', '.css': 'text/css', '.mjs': 'text/javascript', '.svg': 'image/svg+xml' };
const error = (message, status = 400) => Object.assign(new Error(message), { status });

// Local UI transport only. Inference is performed by the visible ChatGPT page.
export async function createWebServer({ bridge, runtime, port = 0 }) {
  const packageInfo = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
  const sessions = new Set(); let origin, active;
  const json = (res, data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
  async function body(req) {
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw error('Use uma mensagem JSON.', 415);
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 700000) throw error('Mensagem muito extensa.', 413); chunks.push(chunk); }
    let value;
    try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw error('JSON inválido.'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw error('Mensagem JSON inválida.');
    return value;
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      if (req.headers.host !== new URL(origin).host) throw error('Host inválido.', 403);
      const url = new URL(req.url, origin), document = req.method === 'GET' && ['/', '/src/index.html'].includes(url.pathname);
      if (req.method === 'GET' && url.pathname === '/') { res.writeHead(302, { Location: '/src/index.html' }); res.end(); return; }
      let key = /(?:^|;\s*)ordax_assistant_web=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
      if (document && !sessions.has(key)) {
        if (sessions.size >= 32) sessions.delete(sessions.values().next().value);
        key = randomBytes(32).toString('hex'); sessions.add(key);
        res.setHeader('Set-Cookie', `ordax_assistant_web=${key}; HttpOnly; SameSite=Strict; Path=/`);
      }
      if (url.pathname.startsWith('/api/')) {
        if (!sessions.has(key)) throw error('Abra o app para iniciar a sessão.', 401);
        if (req.method !== 'GET' && req.headers.origin !== origin) throw error('Origem inválida.', 403);
      }
      const route = `${req.method} ${url.pathname}`;
      if (route === 'GET /api/state') { const since = /^\d+$/.test(url.searchParams.get('since') || '') ? Number(url.searchParams.get('since')) : undefined; json(res, bridge.state({ since })); return; }
      if (route === 'GET /api/models') { json(res, bridge.models()); return; }
      if (route === 'POST /api/home') { const data = await body(req); if (Object.keys(data).length) throw error('Seleção inválida.'); json(res, await bridge.openHome()); return; }
      if (route === 'POST /api/projects') {
        const data = await body(req);
        if (Object.keys(data).some(key => !['name','binding','previewUrl','instructions'].includes(key))) throw error('Campo de projeto não suportado.');
        if (data.binding != null) {
          const state = runtime?.state();
          const granted = state?.connected && state.targets.some(target => target.deviceId === data.binding.deviceId) && state.operations?.some(operation => operation.kind === 'projects' && operation.status === 'succeeded' && operation.deviceId === data.binding.deviceId && Array.isArray(operation.result?.data?.projects) && operation.result.data.projects.some(project => project.slug === data.binding.project));
          if (!granted) throw error('Selecione um projeto disponível no Runtime antes de vinculá-lo.', 403);
        }
        json(res, await bridge.createProject(data), 201); return;
      }
      const projectRoute = /^\/api\/projects\/([a-f0-9-]+|unassigned)(\/select)?$/.exec(url.pathname);
      if (projectRoute) {
        const id = projectRoute[1] === 'unassigned' ? null : projectRoute[1];
        if (projectRoute[2] && req.method === 'POST') { const data = await body(req); if (Object.keys(data).length) throw error('Seleção de projeto inválida.'); json(res, await bridge.selectConversationProject(id)); return; }
        if (id === null || projectRoute[2]) throw error('Operação de projeto inválida.');
        if (req.method === 'PATCH') { const data = await body(req); json(res, await bridge.updateProject(id, data)); return; }
        if (req.method === 'DELETE') { json(res, await bridge.removeProject(id)); return; }
      }
      if (route === 'GET /api/runtime') { const since = /^\d+$/.test(url.searchParams.get('since') || '') ? Number(url.searchParams.get('since')) : undefined; json(res, runtime?.state({ since }) || { configured: false, connected: false, targets: [], operations: [] }); return; }
      if (route === 'POST /api/runtime/connect') { if (!runtime) throw error('Runtime indisponível neste host.', 503); json(res, await runtime.connect()); return; }
      if (route === 'POST /api/runtime/operations') { if (!runtime) throw error('Runtime indisponível neste host.', 503); json(res, await runtime.submit(await body(req)), 202); return; }
      if (route === 'POST /api/runtime/review') { if (!runtime) throw error('Runtime indisponível neste host.', 503); json(res, await runtime.review((await body(req)).id)); return; }
      if (route === 'GET /api/drafts') { json(res, bridge.drafts?.state() || {}); return; }
      if (route === 'PUT /api/drafts') {
        const data = await body(req);
        if (!bridge.drafts) throw error('Este host não oferece rascunhos persistentes.', 503);
        if (bridge.navigating) throw error('Aguarde a organização das conversas antes de salvar o rascunho.', 409);
        if (data.key !== 'new' && !bridge.chats.some(c => c.id === data.key) && !bridge.projects?.some(project => data.key === `project:${project.id}`)) throw error('Conversa ou projeto do rascunho não encontrado.', 404);
        json(res, await bridge.drafts.save(data.key, data.entry)); return;
      }
      if (route === 'GET /api/diagnostics') {
        const state = bridge.state();
        const product = runtime?.state() || {};
        json(res, { app: 'ORDAX Studio', version: packageInfo.version, generatedAt: new Date().toISOString(), runtime: { platform: process.platform, arch: process.arch, electron: process.versions.electron || null, chrome: process.versions.chrome || null }, connection: { ready: Boolean(state.web?.ready), busy: Boolean(state.web?.busy), transport: state.web?.transport?.state || 'unknown', lastObservedAt: state.web?.observedAt || null }, recovery: { runtimeJournal: Boolean(product.recoveryRequired), webDeletionJournal: Boolean(state.capabilities?.deletionRecoveryRequired), pendingOperations: (product.operations || []).filter(operation => ['prepared','submitting','queued','running','uncertain'].includes(operation.status)).length }, local: { conversations: state.chats?.length || 0, messages: (state.chats || []).reduce((n, c) => n + c.messages.length, 0), uncertainDeliveries: (state.chats || []).filter(c => c.delivery?.status === 'uncertain').length } }); return;
      }
      if (route === 'POST /api/audio/prepare') { const data = await body(req); if (Object.keys(data).some(key => !['chatId','revision'].includes(key))) throw error('Preparação de áudio inválida.'); json(res, await bridge.prepareAudioDraft(data)); return; }
      if (route === 'POST /api/audio/consume') { const data = await body(req); if (Object.keys(data).some(key => !['chatId','revision','text'].includes(key))) throw error('Ditado inválido.'); json(res, await bridge.consumeWebDraft(data)); return; }
      const audioDraftRoute = /^\/api\/chats\/([a-f0-9-]+)\/web-draft$/.exec(url.pathname);
      if (req.method === 'GET' && audioDraftRoute) { json(res, await bridge.webDraft(audioDraftRoute[1])); return; }
      if (route === 'POST /api/connect') { json(res, await bridge.connect()); return; }
      if (route === 'POST /api/account' || route === 'POST /api/disconnect') throw error('Gerencie o login diretamente no ChatGPT Web à direita.', 409);
      if (route === 'POST /api/chats') { if (active) throw error('Aguarde a resposta atual.', 409); const data = await body(req); if (Object.keys(data).some(key => key !== 'projectId')) throw error('Campo de conversa não suportado.'); json(res, await bridge.createChat(data), 201); return; }
      const review = /^\/api\/chats\/([a-f0-9-]+)\/review$/.exec(url.pathname);
      if (route.startsWith('POST ') && review) { json(res, await bridge.reviewDelivery(review[1])); return; }
      const match = /^\/api\/chats\/([a-f0-9-]+)(\/select)?$/.exec(url.pathname);
      if (match) {
        if (active) throw error('Aguarde ou pare a resposta atual.', 409);
        if (match[2] && req.method === 'POST') { json(res, await bridge.selectChat(match[1])); return; }
        if (req.method === 'DELETE') { const data = req.headers['content-type'] || Number(req.headers['content-length']) > 0 || req.headers['transfer-encoding'] ? await body(req) : {}; if (Object.keys(data).some(key => key !== 'scope')) throw error('Exclusão inválida.'); json(res, await bridge.deleteChat(match[1], data)); return; }
        if (req.method === 'PATCH') { const data = await body(req); const keys = Object.keys(data); if (keys.length !== 1 || !['title','projectId'].includes(keys[0])) throw error('Alteração de conversa inválida.'); json(res, Object.hasOwn(data, 'projectId') ? await bridge.moveChat(match[1], data.projectId) : await bridge.renameChat(match[1], data.title)); return; }
      }
      if (route === 'POST /api/respond') {
        if (active) throw error('Já existe uma resposta em andamento.', 409);
        const data = await body(req), controller = new AbortController(); active = controller;
        const timeout = setTimeout(() => controller.abort(), 11 * 60 * 1000);
        const heartbeat = setInterval(() => { if (res.headersSent && !res.destroyed) res.write(': keepalive\n\n'); }, 15000);
        // Closing a UI stream detaches the viewer; the paid Web generation keeps running.
        const revisions = new Map(); let terminal = false;
        const frame = event => {
          if (res.destroyed) return;
          if (res.writableLength > 4 * 1024 * 1024) { res.destroy(); return; }
          if (!res.headersSent) res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'X-Accel-Buffering': 'no' });
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        };
        const emit = event => {
          if (['done','error'].includes(event.type)) terminal = true;
          if (!event.chat) { frame(event); return; }
          const { messages = [], ...metadata } = event.chat;
          frame({ type: 'chat-meta', chat: metadata });
          // Bound each SSE frame; long histories never become a giant response frame.
          for (const message of messages) {
            const revision = [message.text, message.status, message.error, message.model, message.attachments, message.activity?.turnId, message.activity?.current?.at, message.activity?.current?.kind, message.activity?.current?.label, message.activity?.endedAt];
            const previous = revisions.get(message.id);
            if (!previous || revision.some((value, index) => value !== previous[index])) { revisions.set(message.id, revision); frame({ type: 'message', chatId: metadata.id, message }); }
          }
          const { chat, ...rest } = event; frame({ ...rest, chatId: chat.id });
        };
        try { await bridge.respond(data, emit, controller.signal); res.end(); }
        catch (failure) {
          if (res.headersSent) { if (!terminal) frame({ type: 'error', message: failure.message }); res.end(); }
          else json(res, { error: failure.message }, failure.status || 502);
        } finally { clearTimeout(timeout); clearInterval(heartbeat); active = null; }
        return;
      }
      if (route === 'POST /api/stop') { const data = await body(req); if (!data || typeof data.chatId !== 'string') throw error('Conversa inválida.'); const result = await bridge.stop(data.chatId); active?.abort(); json(res, result); return; }
      if (req.method === 'GET' && (document || /^\/(src|assets)\/[a-z0-9_.-]+$/.test(url.pathname))) {
        const file = document ? path.join(appRoot, 'src/index.html') : path.join(appRoot, url.pathname.slice(1));
        const content = await readFile(file); res.writeHead(200, { 'Content-Type': `${MIME[path.extname(file)] || 'application/octet-stream'}; charset=utf-8` }); res.end(content); return;
      }
      json(res, { error: 'Rota não encontrada.' }, 404);
    } catch (failure) { if (!res.headersSent) json(res, { error: failure.code === 'ENOENT' ? 'Arquivo não encontrado.' : failure.message }, failure.status || (failure.code === 'ENOENT' ? 404 : 500)); else res.end(); }
  });
  server.requestTimeout = 20000; server.headersTimeout = 15000; server.keepAliveTimeout = 5000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, server, close: async () => { active?.abort(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
