import { manufacturingCostRepositorySchema } from "../ports/manufacturing-cost-repository.mjs";

export function createAppDataManufacturingCostRepository(appData) {
  if (typeof appData?.read !== "function" || typeof appData?.write !== "function") throw new TypeError("A porta App Data não foi fornecida.");
  return Object.freeze({
    schema: manufacturingCostRepositorySchema,
    loadSettings: () => appData.read("manufacturing-cost-settings", null),
    saveSettings: settings => appData.write("manufacturing-cost-settings", settings),
    loadEstimates: () => {
      const value = appData.read("manufacturing-estimates", []);
      if (!Array.isArray(value)) return [];
      return value.map(({ spoolId, stockRemaining, stockRequired, ...estimate }) => estimate);
    },
    saveEstimates: estimates => appData.write("manufacturing-estimates", estimates),
  });
}
