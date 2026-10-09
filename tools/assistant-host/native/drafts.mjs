import { createHash } from 'node:crypto';

const keyOK = key => key === 'new' || /^(?:project:)?[a-f0-9-]{1,128}$/.test(key);
const revisionOK = revision => Number.isSafeInteger(revision) && revision >= 0 && revision < 1e9;
const entryOK = entry => entry && revisionOK(entry.revision) && typeof entry.text === 'string' && entry.text.length <= 100000 && Array.isArray(entry.attachments) && entry.attachments.length <= 4 && entry.attachments.every(a => a?.kind === 'text' && typeof a.name === 'string' && a.name.length <= 240 && typeof a.text === 'string' && a.text.length <= 100000);
export const validDrafts = data => data?.schemaVersion === 1 && data.entries && typeof data.entries === 'object' && !Array.isArray(data.entries) && Object.keys(data.entries).length <= 151 && Object.entries(data.entries).every(([key, value]) => keyOK(key) && entryOK(value)) && JSON.stringify(data).length <= 8000000;
const fingerprint = text => createHash('sha256').update(text.replace(/\s+/g, ' ').trim()).digest('hex');

// App-owned drafts only. Revisions also serve as durable tombstones after sending.
export class DraftStore {
  constructor(storage) { this.storage = storage; this.entries = {}; this.queue = Promise.resolve(); }
  async init() { const data = await this.storage.read('drafts', { schemaVersion: 1, entries: {} }, { validate: validDrafts }); this.entries = validDrafts(data) ? data.entries : {}; }
  state() { return structuredClone(this.entries); }
  mutate(operation) {
    const next = this.queue.then(async () => {
      const entries = structuredClone(this.entries), result = operation(entries);
      if (result.changed) {
        const data = { schemaVersion: 1, entries };
        if (!validDrafts(data)) throw Object.assign(new Error('O limite local de rascunhos foi atingido. Remova anexos ou rascunhos antigos.'), { status: 413 });
        await this.storage.write('drafts', data); this.entries = entries;
      }
      return structuredClone(entries[result.key] || null);
    });
    this.queue = next.catch(() => {}); return next;
  }
  save(key, entry) {
    if (!keyOK(key) || !entryOK(entry)) throw Object.assign(new Error('Rascunho inválido.'), { status: 400 });
    return this.mutate(entries => {
      if ((entries[key]?.revision ?? -1) >= entry.revision) return { key, changed: false };
      entries[key] = { revision: entry.revision, text: entry.text, attachments: structuredClone(entry.attachments) };
      return { key, changed: true };
    });
  }
  consume(delivery) {
    const key = delivery?.draftKey, revision = delivery?.draftRevision;
    if (!keyOK(key) || !revisionOK(revision)) return Promise.resolve(null);
    return this.mutate(entries => {
      if ((entries[key]?.revision ?? 0) > revision) return { key, changed: false };
      entries[key] = { revision: revision + 1, text: '', attachments: [] };
      return { key, changed: true };
    });
  }
  async validateSubmission(key, revision, text) {
    if (!keyOK(key) || !revisionOK(revision)) throw Object.assign(new Error('Salve o rascunho antes de enviar.'), { status: 409 });
    await this.queue;
    const entry = this.entries[key];
    const { composeTextMessage } = await import('../../../apps/studio/conversation/src/message.mjs');
    if (!entry || entry.revision !== revision || fingerprint(composeTextMessage(entry).text) !== fingerprint(text)) throw Object.assign(new Error('O rascunho mudou. Confira a mensagem antes de enviar.'), { status: 409 });
  }
  async prune(keys) {
    return this.mutate(entries => { let changed = false; for (const key of Object.keys(entries)) if (key !== 'new' && !keys.includes(key)) { delete entries[key]; changed = true; } return { key: 'new', changed }; });
  }
  async close() { await this.queue; }
}
