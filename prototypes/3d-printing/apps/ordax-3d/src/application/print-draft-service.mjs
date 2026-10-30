import { defaultDraft, safeDraft } from "../domain/print-draft.mjs";
import { assertPrintDraftRepository } from "../ports/print-draft-repository.mjs";

export function createPrintDraftService(repository) {
  const store = assertPrintDraftRepository(repository);
  return Object.freeze({
    load() {
      const saved = store.read(defaultDraft);
      const record = saved && typeof saved === "object" ? saved : {};
      return Object.freeze({
        draft: safeDraft(record),
        sourceName: typeof record.sourceName === "string" ? record.sourceName : null,
        sourceFingerprint: typeof record.sourceFingerprint === "string" ? record.sourceFingerprint : null,
      });
    },
    save(draft, metadata = {}) {
      const record = {
        ...safeDraft(draft),
        sourceName: typeof metadata.sourceName === "string" ? metadata.sourceName : null,
        sourceFingerprint: typeof metadata.sourceFingerprint === "string" ? metadata.sourceFingerprint : null,
        savedAt: new Date().toISOString(),
      };
      store.write(record);
      return record;
    },
  });
}
