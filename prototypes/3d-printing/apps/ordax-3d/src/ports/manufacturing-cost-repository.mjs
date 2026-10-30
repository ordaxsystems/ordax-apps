export const manufacturingCostRepositorySchema = "ordax.3d-manufacturing-cost-repository/1";

export function assertManufacturingCostRepository(repository) {
  if (repository?.schema !== manufacturingCostRepositorySchema
    || typeof repository.loadSettings !== "function"
    || typeof repository.saveSettings !== "function"
    || typeof repository.loadEstimates !== "function"
    || typeof repository.saveEstimates !== "function") {
    throw new TypeError("O OrdaX 3D precisa de um repositório local de custos compatível.");
  }
  return repository;
}
