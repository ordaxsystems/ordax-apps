import assert from "node:assert/strict";
import test from "node:test";
import { createTechnicalJobsService } from "../apps/ordax-3d/src/application/technical-jobs-service.mjs";
import { technicalJobRepositorySchema } from "../apps/ordax-3d/src/ports/technical-job-repository.mjs";

function memoryRepository(initial = null) {
  let value = initial;
  return {
    schema: technicalJobRepositorySchema,
    load: () => value,
    save: next => { value = structuredClone(next); },
    value: () => value,
  };
}

test("jobs de preview são fictícios e explícitos; mutations compartilham uma única lista", () => {
  const repository = memoryRepository();
  const service = createTechnicalJobsService(repository);
  assert.ok(service.list().every(job => job.origin === "local-preview"));
  const snapshots = [];
  const unsubscribe = service.subscribe(() => snapshots.push(service.list()));
  const job = service.add({ name: "Suporte", model: "suporte.stl", printer: "A definir", material: "PLA", estimatedMinutes: 90, estimatedGrams: 20, origin: "local-slice", engine: "OrcaSlicer", engineVersion: "2.3.1" });
  assert.equal(service.list()[0].id, job.id);
  assert.equal(repository.value()[0].id, job.id);
  assert.equal(Object.hasOwn(job, "spoolId"), false);
  assert.equal(Object.hasOwn(job, "commercialOrderId"), false);
  assert.equal(Object.hasOwn(job, "stockRemaining"), false);
  service.setStatus(job.id, "ready");
  assert.equal(service.list()[0].status, "ready");
  assert.equal(snapshots.length, 2);
  unsubscribe();
});

test("jobs técnicos rejeitam estados fora do domínio", () => {
  const service = createTechnicalJobsService(memoryRepository([]));
  const job = service.add({ name: "Teste", model: "teste.3mf" });
  assert.throws(() => service.setStatus(job.id, "paid"), /Estado de trabalho técnico inválido/);
});
