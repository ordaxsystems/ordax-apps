import { assertPrintDraftRepository } from "../ports/print-draft-repository.mjs";

const COLLECTION = "fatiamento-3d-draft";

export function createAppDataPrintDraftRepository(appData) {
  if (typeof appData?.read !== "function" || typeof appData?.write !== "function") {
    throw new TypeError("Fatiamento 3D requires the public App Data port");
  }
  return assertPrintDraftRepository(Object.freeze({
    read(fallback) { return appData.read(COLLECTION, fallback); },
    write(value) { return appData.write(COLLECTION, value); },
  }));
}
