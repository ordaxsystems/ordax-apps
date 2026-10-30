import { technicalJobRepositorySchema } from "../ports/technical-job-repository.mjs";

export function createAppDataTechnicalJobRepository(appData) {
  if (typeof appData?.read !== "function" || typeof appData?.write !== "function") throw new TypeError("A porta App Data não foi fornecida.");
  return Object.freeze({
    schema: technicalJobRepositorySchema,
    load: () => appData.read("technical-print-jobs", null),
    save: jobs => appData.write("technical-print-jobs", jobs),
  });
}
