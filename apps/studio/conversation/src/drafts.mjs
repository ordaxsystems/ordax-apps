export class DraftController {
  constructor(host, onError = () => {}) { this.host = host; this.onError = onError; this.entries = new Map(); this.pending = new Map(); this.queue = Promise.resolve(); }
  async init() { if (this.host.drafts) for (const [key, value] of Object.entries(await this.host.drafts())) this.entries.set(key, value); }
  get(key) { return this.entries.get(key); }
  set(key, value) {
    const old = this.entries.get(key);
    if (old && old.text === value.text && JSON.stringify(old.attachments) === JSON.stringify(value.attachments)) return old;
    const entry = { ...structuredClone(value), revision: (old?.revision || 0) + 1 };
    this.entries.set(key, entry); this.pending.set(key, entry);
    clearTimeout(this.timer); this.timer = setTimeout(() => this.flush().catch(this.onError), 250);
    return entry;
  }
  consume(delivery) {
    const key = delivery?.draftKey, revision = delivery?.draftRevision, current = this.entries.get(key);
    if (!key || !Number.isSafeInteger(revision) || (current?.revision || 0) > revision) return false;
    this.entries.set(key, { text: '', attachments: [], revision: revision + 1 }); this.pending.delete(key);
    return true;
  }
  flush() {
    clearTimeout(this.timer);
    const entries = [...this.pending]; this.pending.clear();
    const next = this.queue.catch(() => {}).then(async () => {
      for (let index = 0; index < entries.length; index++) {
        const [key, value] = entries[index];
        try {
          const saved = this.host.saveDraft ? await this.host.saveDraft(key, value) : value;
          const current = this.entries.get(key);
          if (saved?.revision > (current?.revision ?? 0)) { this.entries.set(key, saved); this.pending.delete(key); }
        } catch (error) {
          for (const [failedKey, failedValue] of entries.slice(index)) if (!this.pending.has(failedKey)) this.pending.set(failedKey, failedValue);
          throw error;
        }
      }
    });
    this.queue = next; return next;
  }
  delete(key) { this.entries.delete(key); this.pending.delete(key); }
}
