import assert from "node:assert/strict";
import test from "node:test";
import { createTechnicalJobsService, summarizeTechnicalJobCost, technicalJobInputFromSlicerResult } from "../apps/ordax-3d/src/application/technical-jobs-service.mjs";
import { localPreviewJobs } from "../apps/ordax-3d/src/domain/technical-print-job-fixtures.mjs";
import { technicalJobRepositorySchema } from "../apps/ordax-3d/src/ports/technical-job-repository.mjs";
import { calculateManufacturingCost } from "../apps/ordax-3d/src/domain/manufacturing-cost.mjs";

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

test("a prévia local inclui snapshot fictício de custo por peça e origem local", () => {
  const job = localPreviewJobs.find(item => item.id === "preview-job-1");

  assert.ok(job);
  assert.equal(job.origin, "local-preview");
  assert.equal(job.costEstimate.scope, "piece");
  assert.equal(job.costEstimate.source, "manual");
  assert.equal(job.costEstimate.complete, false);
});

test("jobs técnicos rejeitam estados fora do domínio", () => {
  const service = createTechnicalJobsService(memoryRepository([]));
  const job = service.add({ name: "Teste", model: "teste.3mf" });
  assert.equal(job.estimatedMinutes, null);
  assert.equal(job.estimatedGrams, null);
  assert.throws(() => service.setStatus(job.id, "paid"), /Estado de trabalho técnico inválido/);
});

test("estatísticas ausentes do slicer continuam desconhecidas ao criar um job técnico", () => {
  const input = technicalJobInputFromSlicerResult({
    result: { engine: "OrcaSlicer", engineVersion: "2.3.1", stats: { timeSeconds: null, filamentGrams: null } },
    modelName: "suporte.stl",
    printer: "A definir",
    material: "PLA",
  });
  const job = createTechnicalJobsService(memoryRepository([])).add(input);

  assert.equal(job.estimatedMinutes, null);
  assert.equal(job.estimatedGrams, null);
  assert.equal(job.origin, "local-slice");
  assert.equal(job.name, "suporte");
});

test("estatísticas válidas do slicer mantêm gramas e arredondam a duração para cima", () => {
  const input = technicalJobInputFromSlicerResult({
    result: { stats: { timeSeconds: "61", filamentGrams: "2.5" } },
    modelName: "suporte.3mf",
    printer: "FDM A1",
    material: "PLA",
  });

  assert.equal(input.estimatedMinutes, 2);
  assert.equal(input.estimatedGrams, 2.5);
});

test("estatísticas inválidas não viram estimativas nulas", () => {
  const input = technicalJobInputFromSlicerResult({
    result: { stats: { timeSeconds: "", filamentGrams: -4 } },
    modelName: "suporte.stl",
  });

  assert.equal(input.estimatedMinutes, null);
  assert.equal(input.estimatedGrams, null);
});

test("job técnico preserva o snapshot de custo do fatiamento sem criar pedido comercial", () => {
  const costEstimate = calculateManufacturingCost({ name: "Suporte", material: "PLA", printer: "A1", grams: 20, hours: 1 });
  const job = createTechnicalJobsService(memoryRepository([])).add({
    ...technicalJobInputFromSlicerResult({
      result: { stats: { timeSeconds: 3600, filamentGrams: 20 } },
      modelName: "suporte.stl",
      printer: "A1",
      material: "PLA",
      costEstimate,
    }),
  });

  assert.equal(job.costEstimate.totalCost, costEstimate.totalCost);
  assert.equal(job.costEstimate.suggestedPriceTotal, costEstimate.suggestedPriceTotal);
  assert.equal(job.costEstimate.estimatedProfitPerUnit, costEstimate.estimatedProfitPerUnit);
  assert.equal(job.costEstimate.estimatedProfitTotal, costEstimate.estimatedProfitTotal);
  assert.equal(Object.hasOwn(job, "commercialOrderId"), false);
  assert.equal(Object.hasOwn(job, "paymentId"), false);
});

test("resumo de custo preserva escopo, completude, lucro estimado e totais do orçamento", () => {
  const piece = summarizeTechnicalJobCost({ scope: "piece", quantity: 3, costPerUnit: 4.5, suggestedPricePerUnit: 6.25, totalCost: 13.5, suggestedPriceTotal: 18.75, complete: true });
  const plate = summarizeTechnicalJobCost({ scope: "plate", quantity: 1, costPerUnit: 12, suggestedPricePerUnit: 16.2, totalCost: 12, suggestedPriceTotal: 16.2 });

  assert.deepEqual(piece, { scope: "piece", quantity: 3, complete: true, costPerUnit: 4.5, suggestedPricePerUnit: 6.25, estimatedProfitPerUnit: null, totalCost: 13.5, suggestedPriceTotal: 18.75, estimatedProfitTotal: null });
  assert.equal(plate.scope, "plate");
  assert.equal(plate.complete, false);
  assert.equal(plate.estimatedProfitTotal, null);
  const profitable = summarizeTechnicalJobCost({ scope: "piece", quantity: 2, costPerUnit: 4, suggestedPricePerUnit: 6, estimatedProfitPerUnit: 1.5, totalCost: 8, suggestedPriceTotal: 12, estimatedProfitTotal: 3 });
  assert.equal(profitable.estimatedProfitPerUnit, 1.5);
  assert.equal(profitable.estimatedProfitTotal, 3);
  assert.equal(summarizeTechnicalJobCost(null), null);
  assert.equal(summarizeTechnicalJobCost({ scope: "piece", costPerUnit: -1, suggestedPricePerUnit: 2, totalCost: 1, suggestedPriceTotal: 2 }), null);
});
