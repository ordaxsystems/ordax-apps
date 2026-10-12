import dom from './chat-delete.cjs';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export const validDeletions = value => Array.isArray(value) && value.length <= 500 && new Set(value.map(item => item?.webId)).size === value.length && value.every(item => item && typeof item.webId === 'string' && /^[a-zA-Z0-9_-]{1,256}$/.test(item.webId) && ['prepared','uncertain','confirmed'].includes(item.status));
export class ChatDeletion {
  constructor({ storage, contents, sleep = pause, attempts = 30 }) { Object.assign(this, { storage, contents, sleep, attempts }); this.records = []; }
  async init() {
    try { this.records = await this.storage.read('chat-deletions', [], { validate: validDeletions, requireRecovery: true }); if (!validDeletions(this.records)) throw new Error('O registro local requer recuperação.'); }
    catch (error) { this.recoveryRequired = true; this.issue = error.message; }
  }
  isConfirmed(webId) { return this.records.some(item => item.webId === webId && item.status === 'confirmed'); }
  async save(record) {
    if (this.recoveryRequired) throw new Error(this.issue);
    const next = this.records.filter(item => item.webId !== record.webId).concat(record);
    if (next.length > 500) throw new Error('Limite de registros de exclusão atingido.');
    await this.storage.write('chat-deletions', next); this.records = next;
  }
  async execute(script, gesture = false) {
    let timer;
    try {
      return await Promise.race([this.contents.executeJavaScript(script, gesture), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('O ChatGPT não respondeu. Confira a conversa no Web.')), 10000); })]);
    } finally { clearTimeout(timer); }
  }
  async remove({ webId, title }) {
    if (this.recoveryRequired) throw new Error(this.issue);
    if (!/^[a-zA-Z0-9_-]{1,256}$/.test(webId || '') || !title?.trim()) throw new Error('A identidade da conversa Web não foi confirmada.');
    const previous = this.records.find(item => item.webId === webId);
    if (previous?.status === 'confirmed') return;
    if (previous) throw new Error('Existe uma exclusão sem confirmação. Confira esta conversa no ChatGPT; o clique não será repetido.');
    const expected = { url: `https://chatgpt.com/c/${webId}`, title };
    await this.save({ webId, status: 'prepared' });
    let dispatched = false;
    try {
      await this.execute(dom.deleteScript(expected, 'menu'), true);
      for (const phase of ['dialog', 'confirm']) {
        let ready = false;
        for (let i = 0; i < this.attempts; i++) {
          // Persist uncertainty BEFORE the irreversible click (including crash recovery).
          if (phase === 'confirm' && !dispatched) { await this.save({ webId, status: 'uncertain' }); dispatched = true; }
          const result = await this.execute(dom.deleteScript(expected, phase), true);
          if (!result.waiting) { ready = true; break; }
          await this.sleep(100);
        }
        if (!ready) throw new Error('Confira a confirmação de exclusão no ChatGPT Web.');
      }
      for (let i = 0; i < this.attempts; i++) {
        if (this.contents.isDestroyed()) break;
        const url = new URL(this.contents.getURL());
        // A different provider/auth URL is never proof of deletion.
        if (url.origin === 'https://chatgpt.com' && url.pathname === '/' && await this.execute(dom.confirmationScript(expected))) { await this.save({ webId, status: 'confirmed' }); return; }
        await this.sleep(100);
      }
      throw new Error('A exclusão no ChatGPT não foi confirmada. O histórico local foi preservado.');
    } catch (error) {
      if (!dispatched) { const next = this.records.filter(item => item.webId !== webId); await this.storage.write('chat-deletions', next); this.records = next; }
      throw error;
    }
  }
}
