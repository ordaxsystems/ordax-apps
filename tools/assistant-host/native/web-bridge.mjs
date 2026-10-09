import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import dom from './web-dom.cjs';
import { ChatDeletion } from './chat-deletion.mjs';
import { beginActivity, transitionActivity, observedActivity } from './activity.mjs';
import { validHistory, validProjectBinding, projectDraftKey } from './history.mjs';
import { DraftStore } from './drafts.mjs';
import { composeTextMessage } from '../../../apps/studio/conversation/src/message.mjs';
import { normalizePreviewURL } from '../../../apps/studio/conversation/src/preview-url.mjs';

const normalize = text => text.replace(/\s+/g, ' ').trim();
const fingerprint = text => createHash('sha256').update(normalize(text)).digest('hex');
const webChatURL = id => `https://chatgpt.com/c/${encodeURIComponent(id)}`;
async function pageOperation(operation) {
  let timer;
  try { return await Promise.race([operation, new Promise((_, reject) => { timer = setTimeout(() => reject(new BridgeError('A área Web não respondeu a tempo. Confira a página antes de continuar.')), 10000); })]); }
  finally { clearTimeout(timer); }
}
export class BridgeError extends Error {
  constructor(message, status = 409) { super(message); this.status = status; }
}

// A single, visible ChatGPT session is authoritative. Local records mirror observed turns.
// No inference calls, quota switching, authentication automation or automatic resubmission.
export class WebBridge {
  constructor({ surface, storage, setupActive = () => false, openLogin = async () => ({ embedded: true }), now = Date.now, interval = 350, startAtHome = true }) {
    Object.assign(this, { surface, storage, setupActive, openLogin, now, interval });
    this.drafts = new DraftStore(storage); this.chatDeletion = new ChatDeletion({storage, contents: surface.webContents});
    this.chats = []; this.projects = []; this.activeProjectId = null; this.activeId = null; this.page = null; this.run = null;
    this.navigating = false; this.disposed = false; this.reading = false; this.sending = false;
    this.dirty = false; this.lastPersist = 0; this.version = 0;
    this.settle = new Map(); this.ignored = new Set();
    this.transport = { state: 'loading', detail: '' }; this.lastObservedAt = null;
    this.startAtHome = startAtHome; this.home = startAtHome; this.selectionIdle = startAtHome;
    this.observeFreshNavigation = (_event, url, inPlace, mainFrame) => {
      if (mainFrame && !inPlace) { try { const destination = new URL(url); this.pendingChatMode = destination.origin === 'https://chatgpt.com' && destination.pathname === '/'; } catch { this.pendingChatMode = false; } }
    };
    surface.webContents.on?.('did-start-navigation', this.observeFreshNavigation);
  }
  async init() {
    const data = await this.storage.read('web-chats', { chats: [], ignored: [] }, { validate: validHistory });
    this.chats = data.chats; this.ignored = new Set(data.ignored || []);
    this.projects = data.projects || []; this.activeProjectId = data.activeProjectId || null;
    this.activeId = this.chats.some(c => c.id === data.activeId) ? data.activeId : null;
    if (this.activeId) this.activeProjectId = this.findChat(this.activeId).projectId || null;
    if (this.startAtHome) { this.activeId = null; this.activeProjectId = null; }
    await this.chatDeletion.init();
    await this.drafts.init(); await this.drafts.prune(this.draftKeys());
    for (const chat of this.chats) if (chat.delivery?.userId) await this.drafts.consume(chat.delivery);
    for (const chat of this.chats) if (['prepared','submitted','accepted'].includes(chat.delivery?.status)) { chat.delivery.status = 'uncertain'; this.dirty = true; }
    for (const c of this.chats) for (const m of c.messages) if (m.status === 'streaming') { m.status = 'interrupted'; this.dirty = true; }
    for (const c of this.chats) {
      if (c.activity?.endedAt === null) { transitionActivity(c.activity, { kind: 'interrupted', label: 'Acompanhamento interrompido ao fechar o app', source: 'bridge' }, this.now()); this.dirty = true; }
      for (const m of c.messages) if (m.activity?.endedAt === null) { transitionActivity(m.activity, { kind: 'interrupted', label: 'Acompanhamento interrompido ao fechar o app', source: 'bridge' }, this.now()); this.dirty = true; }
    }
    this.timer = setInterval(() => this.refresh().catch(() => this.setTransportStatus('error', 'Não foi possível acompanhar a página. Recarregue a área Web.')), this.interval);
  }
  touch() { this.dirty = true; this.version++; }
  async persist({ required = false } = {}) {
    if (!this.dirty) return;
    const version = this.version;
    try {
      await this.storage.write('web-chats', { schemaVersion: 3, projects: structuredClone(this.projects), activeProjectId: this.activeProjectId, chats: structuredClone(this.chats), ignored: [...this.ignored], activeId: this.activeId });
      if (version === this.version) this.dirty = false;
      this.storageIssue = ''; this.lastPersist = this.now();
    } catch {
      this.dirty = true; this.storageIssue = 'Não foi possível salvar o histórico. Verifique o espaço e as permissões do dispositivo.';
      if (required) throw new BridgeError(this.storageIssue, 503);
    }
  }
  findChat(id) {
    const chat = this.chats.find(c => c.id === id);
    if (!chat) throw new BridgeError('Conversa não encontrada.', 404);
    return chat;
  }
  newRecord(projectId = null) {
    if (this.chats.length >= 100) throw new BridgeError('Limite local de 100 conversas. Exporte e remova conversas antigas.');
    if (projectId !== null) this.findProject(projectId);
    const chat = { id: randomUUID(), projectId, title: 'Nova conversa', model: 'chatgpt-web', createdAt: new Date().toISOString(), messages: [], webId: null };
    this.chats.unshift(chat); this.activeId = chat.id; this.activeProjectId = projectId; this.touch(); return chat;
  }
  publicState() {
    const ready = Boolean(this.page?.ready);
    return { mode: 'chatgpt-web', active: ready ? 'web-profile' : null,
      accounts: ready ? [{ id: 'web-profile', label: 'ChatGPT Web', connected: true, planEnabled: true, registration: 'Sessão local' }] : [] };
  }
  state({ since } = {}) {
    return { capabilities: { deleteOnWeb: !this.chatDeletion.recoveryRequired, deletionRecoveryRequired: Boolean(this.chatDeletion.recoveryRequired) }, connection: this.publicState(), home: this.home, ...(since === this.version ? {} : { chats: this.chats, projects: this.projects }), activeProjectId: this.activeProjectId, activeId: this.activeId, version: this.version,
      web: { ready: Boolean(this.page?.ready), busy: Boolean(this.page?.busy || this.run || this.sending),
        conversationMode: this.page?.conversationMode || 'unknown', effort: this.page?.effort || '', controls: this.page?.controls || {},
        chatModeRequired: true, automatedSendAllowed: this.page?.ready === true && this.page?.conversationMode === 'chat',
        audio: this.page?.audio || {}, model: this.page?.model || '', progress: this.page?.progress || '', ordaxSelected: Boolean(this.page?.ordaxSelected), transport: this.transport, observedAt: this.lastObservedAt,
        issue: this.storageIssue || this.issue || this.page?.identityError || this.page?.alert || this.storage.warnings?.at(-1) || '',
        loginRequired: Boolean(this.page?.loginRequired), url: this.page?.conversationId ? webChatURL(this.page.conversationId) : 'https://chatgpt.com/' } };
  }
  models() { return this.page?.ready ? [{ id: 'chatgpt-web', name: this.page.model || 'Modelo selecionado no Web' }] : []; }
  async connect() { return await this.openLogin(); }
  resumeURL() { const chat = this.chats.find(c => c.id === this.activeId); return chat?.webId ? webChatURL(chat.webId) : 'https://chatgpt.com/'; }
  async reviewDelivery(id) {
    const chat = this.findChat(id);
    await this.refresh();
    if (this.run || this.sending || this.page?.busy || !this.page?.ready || this.activeId !== id || chat.delivery?.status !== 'uncertain') throw new BridgeError('Abra a conversa correspondente e aguarde a resposta antes de revisar o envio.');
    chat.delivery.status = 'reviewed'; this.touch();
    try { await this.persist({ required: true }); } catch (error) { chat.delivery.status = 'uncertain'; this.touch(); throw error; }
    return chat;
  }
  setTransportStatus(state, detail = '') {
    this.transport = { state, detail };
    if (['loading', 'error'].includes(state) && this.page) this.page.ready = false;
    if (state === 'error') { this.issue = detail; this.failRun(detail || 'A área Web foi interrompida.'); }
  }
  async readPage() {
    const contents = this.surface.webContents;
    if (contents.isDestroyed() || contents.isLoadingMainFrame()) return null;
    if (this.setupActive()) return { ready: false, busy: false, loginRequired: false, turns: [], baseline: [] };
    if (new URL(contents.getURL() || 'about:blank').origin === 'https://chatgpt.com' && /^\/plugins(?:\/|$)/.test(new URL(contents.getURL()).pathname)) return { ready: false, busy: false, loginRequired: false, turns: [], baseline: [] };
    if (new URL(contents.getURL() || 'about:blank').origin !== 'https://chatgpt.com') return { ready: false, loginRequired: true, url: contents.getURL(), turns: [], baseline: [] };
    return pageOperation(contents.executeJavaScript(dom.scriptFor('inspect'), false));
  }
  async refresh() {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.refreshOnce().finally(() => { this.refreshPromise = null; }); return this.refreshPromise;
  }
  async refreshOnce() {
    if (this.disposed || this.navigating || this.reading) return;
    this.reading = true;
    try {
      const page = await this.readPage();
      if (!page) {
        if (this.page) this.page.ready = false;
        if (this.run && this.now() - this.run.startedAt > 10 * 60 * 1000) this.failRun('A página não voltou a responder. Confira o Web antes de continuar.');
        return;
      }
      this.page = page; this.lastObservedAt = this.now(); this.transport = { state: 'ready', detail: '' }; this.issue = '';
      if (this.pendingChatMode && page.ready && !page.busy && !page.draft && !page.conversationId && !page.turns.length) {
        this.pendingChatMode = false;
        // Only a fresh composer is eligible. Observe again after a public control
        // selection; a successful click alone does not authorize an automated send.
        await this.selectFreshChatMode().catch(() => {});
        this.page = await this.readPage() || page;
        Object.assign(page, this.page);
      }
      if (page.identityError) { this.issue = page.identityError; this.failRun(page.identityError); return; }
      if (!page.ready) { if (this.run) this.failRun('A sessão do ChatGPT Web foi interrompida. Confira a área à direita.'); return; }
      // Read connection status, but never adopt a Web conversation while the user
      // is on Home or a project overview. Entering a conversation is explicit.
      if (this.selectionIdle) { if (this.dirty) await this.persist(); return; }
      if (this.preparing && !this.run) return;
      const previousActiveId = this.activeId;
      let chat = this.chats.find(c => c.id === this.activeId);
      if (this.run && !this.run.finished) {
        const run = this.run;
        if ((run.webId && page.conversationId !== run.webId) || (!run.webId && page.conversationId && this.chats.some(c => c.webId === page.conversationId && c.id !== run.chatId))) {
          this.failRun('A conversa Web mudou durante a resposta. O app não reenviou a mensagem.'); return;
        }
        chat = this.findChat(run.chatId);
      } else if (page.conversationId) {
        chat = this.chats.find(c => c.webId === page.conversationId);
        const pending = this.chats.find(c => c.id === this.activeId && !c.webId && c.delivery?.status === 'uncertain');
        if (!chat && pending && page.turns.filter(t => t.role === 'user' && !pending.delivery.baseline.includes(t.id) && fingerprint(t.text) === pending.delivery.fingerprint).length === 1) chat = pending;
        if (!chat && page.turns.length && !this.ignored.has(page.conversationId)) chat = this.newRecord();
        this.activeId = chat?.id || null;
      } else if (chat?.webId || (!chat && page.turns.length)) {
        chat = page.turns.length ? this.newRecord() : null; this.activeId = chat?.id || null;
      }
      if (!chat && page.turns.length && !this.ignored.has(page.conversationId)) chat = this.newRecord();
      if (previousActiveId !== this.activeId) { if (chat) this.activeProjectId = chat.projectId || null; this.touch(); }
      if (chat) {
        if (page.conversationId && chat.webId !== page.conversationId) { chat.webId = page.conversationId; this.touch(); }
        const version = this.version;
        const changed = this.mergeTurns(chat, page);
        await this.reconcileDelivery(chat, page);
        this.trackActivity(chat, page);
        if (!chat.renamed && page.title && !/^ChatGPT$/i.test(page.title) && chat.messages.length && chat.title !== page.title) { chat.title = page.title; this.touch(); }
        if (changed) this.touch();
        if (version !== this.version) this.run?.emit({ type: 'sync', chat });
      }
      await this.advanceRun(page, chat);
      if (this.dirty && this.now() - this.lastPersist > 2000) await this.persist();
    } finally { this.reading = false; }
  }
  async reconcileDelivery(chat, page) {
    const delivery = chat.delivery;
    if (!delivery || this.run || delivery.status !== 'uncertain' || !chat.webId || chat.webId !== page.conversationId) return;
    const users = page.turns.filter(t => t.role === 'user' && (delivery.userId ? t.id === delivery.userId : !(delivery.baseline || []).includes(t.id)) && fingerprint(t.text) === delivery.fingerprint);
    if (users.length !== 1) return;
    delivery.userId = users[0].id;
    await this.drafts.consume(delivery);
    const next = page.turns[page.turns.findIndex(t => t.id === users[0].id) + 1];
    const answer = next?.role === 'assistant' && chat.messages.find(m => m.id === next.id);
    if (answer?.status === 'completed') {
      delivery.status = 'completed';
      if (chat.activity?.current?.kind !== 'completed') { chat.activity = beginActivity(users[0].id, this.now()); transitionActivity(chat.activity, { kind: 'completed', label: 'Resposta recuperada do Web', source: 'bridge' }, this.now()); answer.activity = structuredClone(chat.activity); }
      this.touch();
    }
  }
  activityStep(chat, step) {
    if (!chat.activity || !transitionActivity(chat.activity, step, this.now())) return;
    const answer = this.run?.accepted && chat.messages.at(-1)?.role === 'assistant' ? chat.messages.at(-1) : null;
    this.touch(); this.run?.emit({ type: 'activity', chatId: chat.id, messageId: answer?.id, activity: structuredClone(chat.activity) });
  }
  trackActivity(chat, page) {
    if (this.run && !this.run.accepted) return;
    const user = [...chat.messages].reverse().find(m => m.role === 'user');
    const answer = chat.messages.at(-1)?.role === 'assistant' ? chat.messages.at(-1) : null;
    if (page.busy && user && (!chat.activity || chat.activity.turnId !== user.id || chat.activity.endedAt !== null)) chat.activity = beginActivity(user.id, this.now());
    if (!chat.activity || chat.activity.endedAt !== null) return;
    this.activityStep(chat, observedActivity(page, answer));
    if (answer) answer.activity = structuredClone(chat.activity);
  }
  mergeTurns(chat, page) {
    let revised = false;
    for (const [index, turn] of page.turns.entries()) {
      let message = chat.messages.find(m => m.id === turn.id);
      if (!message) {
        if (chat.messages.length >= 200) throw new BridgeError('Limite local de mensagens atingido. Inicie uma nova conversa.');
        message = { id: turn.id, role: turn.role, text: '', attachments: [], model: 'chatgpt-web', createdAt: new Date().toISOString(), status: 'completed' };
        chat.messages.push(message);
        revised = true;
      }
      const changed = message.text !== turn.text, previousStatus = message.status; message.text = turn.text; revised ||= changed;
      if (message.role === 'assistant') {
        const latest = index === page.turns.length - 1;
        if (changed && latest && page.busy) { message.status = 'streaming'; delete message.error; }
        const signature = turn.text + '|' + page.busy + '|' + turn.completedControl;
        let stable = this.settle.get(turn.id);
        if (!stable || stable.signature !== signature) { stable = { signature, at: this.now() }; this.settle.set(turn.id, stable); }
        if (message.status !== 'cancelled' && !(message.status === 'error' && page.alert)) {
          message.status = !latest || (!page.busy && turn.completedControl && turn.text && this.now() - stable.at >= 1500) ? 'completed' : 'streaming';
          if (message.status === 'completed') delete message.error;
        }
        revised ||= previousStatus !== message.status;
      }
    }
    if (chat.title === 'Nova conversa') { const title = chat.messages.find(m => m.role === 'user')?.text.slice(0, 65) || chat.title; revised ||= title !== chat.title; chat.title = title; }
    return revised;
  }
  async advanceRun(page, chat) {
    const run = this.run; if (!run || run.finished || !chat) return;
    const users = page.turns.filter(t => t.role === 'user' && !run.baseline.includes(t.id));
    if (!run.accepted && users.length) {
      if (users.length !== 1 || normalize(users[0].text) !== normalize(run.text)) return this.failRun('Não foi possível confirmar qual mensagem foi aceita. Confira o Web; o app não repetirá o envio.');
      run.accepted = true; run.userId = users[0].id;
      chat.delivery.status = 'accepted'; chat.delivery.userId = run.userId;
      try { await this.drafts.consume(chat.delivery); } catch { this.storageIssue = 'O envio foi aceito, mas o rascunho não pôde ser removido do dispositivo.'; }
      if (run.finished) return;
      chat.activity.turnId = run.userId;
      const message = chat.messages.find(m => m.id === run.userId);
      if (message) message.attachments = run.attachments;
      if (page.conversationId) run.webId = page.conversationId;
      run.emit({ type: 'start', chat }); this.touch();
    }
    if (run.accepted) {
      const added = page.turns.filter(t => t.role === 'assistant' && !run.baseline.includes(t.id));
      if (added.length > 1) return this.failRun('Mais de uma resposta nova apareceu. Confira a conversa Web.');
      const answer = added[0] && chat.messages.find(m => m.id === added[0].id);
      if (page.alert) return this.failRun(page.alert);
      if (answer?.status === 'completed') { chat.delivery.status = 'completed'; run.finished = true; run.emit({ type: 'done', chat }); this.touch(); run.resolve(); return; }
      this.trackActivity(chat, page);
    }
    if (page.alert) return this.failRun(page.alert);
    if (!run.accepted && this.now() - run.startedAt > 20000) this.failRun('O envio não pôde ser confirmado. Confira o Web antes de enviar outra mensagem.');
    else if (this.now() - run.startedAt > 10 * 60 * 1000) this.failRun('A resposta ultrapassou o tempo de acompanhamento. Confira o Web; o app não reenviou a mensagem.');
  }
  failRun(message, { cancelled = false } = {}) {
    const run = this.run; if (!run || run.finished) return;
    run.finished = true;
    const chat = this.findChat(run.chatId), answer = chat.messages.at(-1);
    if (chat.delivery) chat.delivery.status = cancelled && run.accepted ? 'interrupted' : 'uncertain';
    this.touch();
    this.activityStep(chat, { kind: 'error', label: message, source: 'bridge' });
    if (answer?.role === 'assistant' && answer.status === 'streaming') { answer.status = 'error'; answer.error = message; this.touch(); }
    if (answer?.role === 'assistant' && chat.activity) answer.activity = structuredClone(chat.activity);
    run.emit({ type: 'error', message, chat }); run.reject(new BridgeError(message));
  }
  async createChat({ projectId = this.activeProjectId } = {}) {
    if (this.run || this.sending || this.navigating || this.page?.busy) throw new BridgeError('Pare ou aguarde a resposta atual.');
    if (projectId !== null) this.findProject(projectId);
    this.navigating = true;
    let chat;
    try {
      await this.refreshPromise;
      await this.surface.webContents.loadURL('https://chatgpt.com/');
      chat = this.newRecord(projectId); this.home = false; this.selectionIdle = false; this.pendingChatMode = true; this.page = null; await this.persist({ required: true });
    } finally { this.navigating = false; }
    // A timer may have requested an observation while navigation was paused.
    // Drain it, then read the loaded page before returning the new composer.
    await this.refreshPromise; await this.refresh();
    return chat;
  }
  async selectFreshChatMode() {
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await pageOperation(this.surface.webContents.executeJavaScript(dom.scriptFor('chatMode'), true));
      if (result.selected) return;
      for (let observation = 0; observation < 10; observation++) {
        await delay(100);
        const page = await this.readPage();
        if (page?.conversationMode === 'chat') return;
        if (page?.busy || page?.draft || page?.conversationId || page?.turns?.length) throw new BridgeError('O compositor mudou durante a seleção de Chat.');
        if (result.opened) break;
      }
    }
    throw new BridgeError('Não foi possível confirmar Chat. Selecione o modo na interface Web.');
  }
  async selectChat(id) {
    if (this.run || this.sending || this.navigating || this.page?.busy) throw new BridgeError('Pare ou aguarde a resposta atual.');
    const chat = this.findChat(id);
    if (id === this.activeId) return chat;
    if (!chat.webId && chat.messages.length) throw new BridgeError('Este chat sem URL não pode ser reaberto. Consulte o histórico local ou crie uma nova conversa.');
    this.navigating = true;
    try { await this.surface.webContents.loadURL(chat.webId ? webChatURL(chat.webId) : 'https://chatgpt.com/'); this.activeId = id; this.activeProjectId = chat.projectId || null; this.home = false; this.selectionIdle = false; this.pendingChatMode = !chat.webId && !chat.messages.length; this.page = null; this.touch(); await this.persist(); return chat; }
    finally { this.navigating = false; }
  }
  async renameChat(id, title) {
    if (typeof title !== 'string' || !title.trim() || title.length > 100) throw new BridgeError('Nome inválido.', 400);
    return this.organize(() => { const chat = this.findChat(id); chat.title = title.trim(); chat.renamed = true; return chat; });
  }
  async audioOperation(chatId, action) {
    if (this.run || this.sending || this.navigating || this.setupActive() || this.activeId !== chatId) throw new BridgeError('A conversa mudou. O ditado permanece no Web.');
    this.navigating = true;
    try {
      await this.refreshPromise;
      const chat = this.findChat(chatId), page = await this.readPage();
      if (['prepared','submitted','uncertain'].includes(chat.delivery?.status)) throw new BridgeError('Confira o envio pendente antes de usar áudio.');
      if (!page?.ready || page.busy || page.identityError || (chat.webId || null) !== (page.conversationId || null)) throw new BridgeError('Conclua o ditado na conversa correspondente do ChatGPT antes de trazer o texto.');
      return await action(page, this.drafts.state()[chatId]);
    } finally { this.navigating = false; }
  }
  async prepareAudioDraft({ chatId, revision }) {
    return this.audioOperation(chatId, async (page, saved) => {
      if (page.conversationMode !== 'chat') throw new BridgeError('Confirme o modo Chat antes de iniciar áudio pelo Studio.');
      if (!saved || saved.revision !== revision) throw new BridgeError('O rascunho mudou.');
      if (page.draft) throw new BridgeError('Há um rascunho no ChatGPT. Revise-o antes de iniciar o ditado.');
      if (saved.text) await pageOperation(this.surface.webContents.executeJavaScript(dom.scriptFor('prepare', saved.text, { url: page.url, baseline: page.baseline }), true));
      return { prepared: true };
    });
  }
  async webDraft(chatId) {
    return this.audioOperation(chatId, page => {
      if (page.draft.length > 16000) throw new BridgeError('O ditado excedeu o limite do compositor. Revise no Web.');
      return { chatId, text: page.draft };
    });
  }
  async consumeWebDraft({ chatId, revision, text }) {
    return this.audioOperation(chatId, (page, saved) => {
      if (typeof text !== 'string' || !saved || saved.revision !== revision || saved.text !== text || page.draft !== text) throw new BridgeError('Salve o ditado no Studio antes de limpar o compositor Web.');
      return pageOperation(this.surface.webContents.executeJavaScript(dom.scriptFor('consumeAudio', { url: page.url, text }), true));
    });
  }
  async deleteChat(id, { scope = 'local' } = {}) {
    if (!['local','web'].includes(scope)) throw new BridgeError('Alcance de exclusão inválido.', 400);
    if (this.run || this.sending || this.navigating || this.page?.busy) throw new BridgeError('Pare ou aguarde a resposta atual.');
    const chat = this.findChat(id);
    if (['prepared','submitted','uncertain'].includes(chat.delivery?.status)) throw new BridgeError('Confira o envio pendente antes de excluir esta conversa.');
    if (scope === 'web') {
      if (this.setupActive() || !chat.webId) throw new BridgeError('Esta conversa ainda não tem identidade confirmada no ChatGPT.');
      if (!this.chatDeletion.isConfirmed(chat.webId)) {
        if (this.activeId !== id) await this.selectChat(id);
        this.navigating = true;
        try {
          await this.refreshPromise;
          const page = await this.readPage();
          if (!page?.ready || page.busy || page.conversationId !== chat.webId) throw new BridgeError('Abra a conversa correspondente no ChatGPT antes de excluir.');
          await this.chatDeletion.remove({ webId: chat.webId, title: page.title });
        } finally { this.navigating = false; }
      }
    }
    await this.organize(() => {
      if (chat.webId) this.ignored.add(chat.webId);
      this.chats = this.chats.filter(c => c.id !== id);
      if (id === this.activeId) { this.activeId = null; this.selectionIdle = true; }
    });
    // History is committed first. A cleanup failure must not resurrect a deleted chat.
    await this.drafts.prune(this.draftKeys()).catch(() => {});
    return { deleted: true, scope };
  }
  draftKeys() { return [...this.chats.map(chat => chat.id), ...this.projects.map(project => projectDraftKey(project.id))]; }
  findProject(id) { const project = this.projects.find(project => project.id === id); if (!project) throw new BridgeError('Projeto de conversas não encontrado.', 404); return project; }
  async organize(mutate) {
    if (this.run || this.sending || this.navigating || this.page?.busy) throw new BridgeError('Pare ou aguarde a resposta antes de reorganizar conversas.');
    this.navigating = true;
    let before;
    try {
      await this.refreshPromise;
      if (this.page?.busy || this.run || this.sending) throw new BridgeError('Aguarde a resposta antes de reorganizar conversas.');
      before = { projects: structuredClone(this.projects), chats: structuredClone(this.chats), activeId: this.activeId, activeProjectId: this.activeProjectId, home: this.home, selectionIdle: this.selectionIdle, ignored: new Set(this.ignored) };
      const result = await mutate(); this.touch(); await this.persist({ required: true }); return structuredClone(result);
    }
    catch (error) { if (before) { Object.assign(this, before); this.touch(); } throw error; }
    finally { this.navigating = false; }
  }
  async createProject({ name, binding = null, previewUrl = null, instructions = '' } = {}) {
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 80 || /[\x00-\x1f]/.test(name) || !validProjectBinding(binding)) throw new BridgeError('Informe um nome de projeto de até 80 caracteres.', 400);
    try { previewUrl = normalizePreviewURL(previewUrl); } catch (error) { throw new BridgeError(error.message, 400); }
    if (typeof instructions !== 'string' || instructions.length > 4000 || instructions.includes('\0')) throw new BridgeError('Contexto do projeto inválido.', 400);
    return this.organize(() => {
      if (this.projects.length >= 50) throw new BridgeError('Limite local de 50 projetos.');
      const project = { id: randomUUID(), name: name.trim(), previewUrl, instructions, binding: binding ? structuredClone(binding) : null, createdAt: new Date().toISOString() };
      this.projects.push(project); return project;
    });
  }
  async renameProject(id, name) {
    return this.updateProject(id, { name });
  }
  async updateProject(id, changes) {
    if (!changes || Object.keys(changes).length === 0 || Object.keys(changes).some(key => !['name','previewUrl','instructions'].includes(key))) throw new BridgeError('Alteração de projeto inválida.', 400);
    const value = {};
    if (Object.hasOwn(changes, 'instructions')) {
      if (typeof changes.instructions !== 'string' || changes.instructions.length > 4000 || changes.instructions.includes('\0')) throw new BridgeError('Contexto do projeto inválido.', 400);
      value.instructions = changes.instructions;
    }
    if (Object.hasOwn(changes, 'name')) {
      if (typeof changes.name !== 'string' || !changes.name.trim() || changes.name.trim().length > 80 || /[\x00-\x1f]/.test(changes.name)) throw new BridgeError('Nome do projeto inválido.', 400);
      value.name = changes.name.trim();
    }
    if (Object.hasOwn(changes, 'previewUrl')) { try { value.previewUrl = normalizePreviewURL(changes.previewUrl); } catch (error) { throw new BridgeError(error.message, 400); } }
    return this.organize(() => Object.assign(this.findProject(id), value));
  }
  async removeProject(id) {
    return this.organize(async () => {
      this.findProject(id); await this.drafts.queue;
      const draft = this.drafts.state()[projectDraftKey(id)];
      if (draft?.text.trim() || draft?.attachments.length) throw new BridgeError('Salve o rascunho em uma conversa ou descarte-o antes de remover este projeto.');
      for (const chat of this.chats) if (chat.projectId === id) chat.projectId = null;
      this.projects = this.projects.filter(project => project.id !== id);
      if (this.activeProjectId === id) this.activeProjectId = null;
      return { removed: true, activeProjectId: this.activeProjectId };
    });
  }
  async moveChat(id, projectId) {
    return this.organize(() => {
      if (projectId !== null) this.findProject(projectId);
      const chat = this.findChat(id); chat.projectId = projectId;
      if (this.activeId === id) this.activeProjectId = projectId;
      return chat;
    });
  }
  async selectConversationProject(projectId) {
    if (projectId !== null) this.findProject(projectId);
    if (this.run || this.sending || this.navigating || this.page?.busy) throw new BridgeError('Pare ou aguarde a resposta antes de trocar de projeto.');
    await this.organize(() => { this.activeId = null; this.activeProjectId = projectId; this.home = false; this.selectionIdle = true; });
    return this.state();
  }
  async openHome() {
    await this.organize(() => { this.activeId = null; this.activeProjectId = null; this.home = true; this.selectionIdle = true; });
    return this.state();
  }
  async respond(data, emit, signal) {
    if (this.sending) throw new BridgeError('Um envio está sendo preparado.');
    this.sending = true;
    try { return await this.respondOnce(data, emit, signal); }
    catch (error) {
      const chat = this.chats.find(c => c.id === data?.chatId);
      if (this.preparing && chat) {
        if (chat.activity?.endedAt === null) this.activityStep(chat, { kind: 'error', label: error.message, source: 'bridge' });
        if (chat.delivery?.status === 'prepared') { chat.delivery.status = this.attemptingSubmit ? 'uncertain' : 'not-sent'; this.touch(); }
        await this.persist();
      }
      throw error;
    } finally { this.sending = false; this.preparing = false; this.attemptingSubmit = false; }
  }
  async respondOnce(data, emit, signal) {
    if (!data || typeof data !== 'object') throw new BridgeError('Mensagem inválida.', 400);
    if (data.retry) throw new BridgeError('Use Regenerar no ChatGPT Web à direita. O app espelhará a nova resposta.');
    if (this.run) throw new BridgeError('Já existe uma resposta em andamento.');
    if (this.navigating) throw new BridgeError('Aguarde a conversa carregar.');
    await this.refresh();
    const chat = this.findChat(data.chatId), page = this.page;
    if (['prepared','submitted','uncertain'].includes(chat.delivery?.status)) throw new BridgeError('Existe um envio sem confirmação. Confira a conversa Web e libere o envio após revisar.');
    if (chat.id !== this.activeId || !page?.ready || page.busy || page.identityError) throw new BridgeError(page?.identityError || 'Abra e conecte a conversa correspondente no ChatGPT Web.');
    if (page.conversationMode !== 'chat') throw new BridgeError('Envio bloqueado: selecione Chat no ChatGPT. Work usa a cota compartilhada com Codex; modo desconhecido não autoriza envio.');
    if (chat.webId && chat.webId !== page.conversationId) throw new BridgeError('A conversa Web mudou. Aguarde a sincronização antes de enviar.');
    if (data.model !== 'chatgpt-web') throw new BridgeError('Selecione o modelo na área do ChatGPT Web.');
    const { text, attachments } = composeTextMessage(data.message);
    if (data.draftKey !== undefined) {
      if (data.draftKey !== chat.id) throw new BridgeError('O rascunho pertence a outra conversa.');
      await this.drafts.validateSubmission(data.draftKey, data.draftRevision, text);
    }
    if (signal.aborted) throw new BridgeError('Envio cancelado.');
    if (page.draft) throw new BridgeError('Há um rascunho no ChatGPT Web. Envie ou limpe o rascunho à direita.');
    this.preparing = true;
    chat.delivery = { id: randomUUID(), status: 'prepared', fingerprint: fingerprint(text), baseline: page.baseline, startedAt: this.now(), ...(data.draftKey !== undefined ? { draftKey: data.draftKey, draftRevision: data.draftRevision } : {}) };
    this.touch(); await this.persist({ required: true });
    chat.activity = beginActivity('pending', this.now());
    transitionActivity(chat.activity, { kind: 'sending', label: 'Enviando ao ChatGPT Web', source: 'bridge' }, this.now());
    emit({ type: 'activity', chatId: chat.id, activity: structuredClone(chat.activity) }); this.touch();
    const prepared = await pageOperation(this.surface.webContents.executeJavaScript(dom.scriptFor('prepare', text, page), true));
    let sent = false;
    for (let attempts = 0; attempts < 30 && !sent; attempts++) {
      if (signal.aborted) throw new BridgeError('Envio cancelado. Confira o rascunho no Web.');
      await delay(200);
      if (signal.aborted) throw new BridgeError('Envio cancelado. Confira o rascunho no Web.');
      this.attemptingSubmit = true;
      sent = (await pageOperation(this.surface.webContents.executeJavaScript(dom.scriptFor('submit', text, page, prepared?.draft ?? text.trim()), true))).sent;
      if (!sent) this.attemptingSubmit = false;
    }
    if (!sent) throw new BridgeError('O botão de envio não ficou disponível. Confira o rascunho no Web.');
    chat.delivery.status = 'submitted'; this.touch();
    transitionActivity(chat.activity, { kind: 'waiting', label: 'Aguardando confirmação do Web', source: 'bridge' }, this.now());
    emit({ type: 'activity', chatId: chat.id, activity: structuredClone(chat.activity) });
    // Once clicked, NEVER click again or replay history to repair an uncertain result.
    const finished = new Promise((resolve, reject) => {
      this.run = { chatId: chat.id, webId: chat.webId, baseline: page.baseline, text, attachments, startedAt: this.now(), accepted: false, finished: false, emit, resolve, reject };
    });
    const abort = () => this.stop(chat.id).catch(() => this.failRun('Acompanhamento interrompido. Confira o Web.'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    try { await finished; } finally { signal.removeEventListener('abort', abort); this.run = null; await this.persist(); }
  }
  async stop(id) {
    if (!id || id !== this.activeId) throw new BridgeError('A conversa ativa mudou.');
    if (this.preparing && !this.run) return { stopped: true };
    if (this.page?.ready) await pageOperation(this.surface.webContents.executeJavaScript(dom.scriptFor('stop'), true));
    const chat = this.chats.find(c => c.id === this.activeId), answer = chat?.messages.at(-1);
    if (chat?.activity?.endedAt === null) this.activityStep(chat, { kind: 'cancelled', label: 'Resposta interrompida por você', source: 'bridge' });
    if (answer?.role === 'assistant' && answer.status === 'streaming') { answer.status = 'cancelled'; answer.error = 'Resposta interrompida.'; this.touch(); }
    this.failRun('Resposta interrompida.', { cancelled: true }); await this.persist(); return { stopped: true };
  }
  async close() { this.disposed = true; clearInterval(this.timer); this.surface.webContents.removeListener?.('did-start-navigation', this.observeFreshNavigation); this.failRun('O app foi fechado.'); await this.refreshPromise?.catch(() => {}); await this.persist(); await this.drafts.close(); }
}
