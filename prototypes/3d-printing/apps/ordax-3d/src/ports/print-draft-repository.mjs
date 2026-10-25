export function assertPrintDraftRepository(repository) {
  if (typeof repository?.read !== "function" || typeof repository?.write !== "function") {
    throw new TypeError("Print preparation requires a print-draft repository");
  }
  return repository;
}
