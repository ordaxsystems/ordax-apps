export const technicalJobRepositorySchema = "ordax.3d-technical-job-repository/1";

export function assertTechnicalJobRepository(repository) {
  if (repository?.schema !== technicalJobRepositorySchema || typeof repository.load !== "function" || typeof repository.save !== "function") {
    throw new TypeError("O app 3D precisa de um repositório de jobs técnicos compatível.");
  }
  return repository;
}
