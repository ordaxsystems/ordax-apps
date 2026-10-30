import assert from "node:assert/strict";
import test from "node:test";
import { refreshObjectSliceCostEstimates, selectObjectsForIndependentSlice, shouldCalculateIndividualCosts } from "../features/fatiamento-3d/object-slice-costs.mjs";
import { createManufacturingCostService } from "../apps/ordax-3d/src/application/manufacturing-cost-service.mjs";
import { manufacturingCostRepositorySchema } from "../apps/ordax-3d/src/ports/manufacturing-cost-repository.mjs";

const model = {
  name: "Prato.3mf",
  bounds: { min: [0, 0, 0], max: [220, 220, 100] },
  objects: [
    { id: "part-a", name: "Suporte", triangleCount: 12 },
    { id: "part-b", name: "Tampa", triangleCount: 18 },
  ],
};
const draft = {
  objectTransforms: { "part-a": { x: 10 }, "part-b": { x: 80 } },
  processes: [
    { id: "process-a", name: "Peças estruturais", objectIds: ["part-a"], settings: { infill: 35 } },
    { id: "process-b", name: "Acabamento fino", objectIds: ["part-b"], settings: { infill: 15 } },
  ],
};

test("ativa cálculo por peça automaticamente somente para pratos com várias peças", () => {
  assert.equal(shouldCalculateIndividualCosts({ scope: "plate", objectCount: 2 }), true);
  assert.equal(shouldCalculateIndividualCosts({ scope: "plate", objectCount: 1 }), false);
  assert.equal(shouldCalculateIndividualCosts({ scope: "piece", objectCount: 4 }), false);
  assert.equal(shouldCalculateIndividualCosts({ scope: "plate", objectCount: "2" }), true);
  assert.equal(shouldCalculateIndividualCosts({ scope: "plate", objectCount: "invalid" }), false);
  assert.equal(shouldCalculateIndividualCosts(null), false);
});

test("prepara somente a peça escolhida e preserva bounds e processo originais", () => {
  const selected = selectObjectsForIndependentSlice(model, draft, ["part-b"]);
  assert.deepEqual(selected.model.bounds, model.bounds);
  assert.deepEqual(selected.objects.map(object => object.id), ["part-b"]);
  assert.deepEqual(selected.processes.map(process => ({ id: process.id, objectIds: process.objectIds, infill: process.settings.infill })), [
    { id: "process-b", objectIds: ["part-b"], infill: 15 },
  ]);
  assert.equal(selected.model.objects.length, 1);
  assert.equal(model.objects.length, 2);
});

test("recusa IDs repetidos, objetos de outro projeto e peças sem processo", () => {
  assert.throws(() => selectObjectsForIndependentSlice(model, draft, ["part-a", "part-a"]), /duplicados/);
  assert.throws(() => selectObjectsForIndependentSlice(model, draft, ["other"]), /não pertence/);
  assert.throws(() => selectObjectsForIndependentSlice(model, { processes: [] }, ["part-a"]), /Atribua cada peça/);
});

test("recusa peça atribuída a mais de um processo", () => {
  const duplicatedAssignment = {
    processes: [
      { id: "process-a", objectIds: ["part-a"] },
      { id: "process-b", objectIds: ["part-a"] },
    ],
  };
  assert.throws(() => selectObjectsForIndependentSlice(model, duplicatedAssignment, ["part-a"]), /mais de um processo/);
});


test("recalcula custo e preço por peça quando as premissas compartilhadas mudam", () => {
  const repository = {
    schema: manufacturingCostRepositorySchema,
    loadSettings: () => null,
    saveSettings() {},
    loadEstimates: () => [],
    saveEstimates() {},
  };
  const costs = createManufacturingCostService(repository);
  const slice = { name: "Suporte", material: "PLA", printer: "A1", grams: 100, timeSeconds: 3600, scope: "piece", objectCount: 1 };
  const stored = [{ objectId: "part-a", name: "Suporte", slice, estimate: costs.calculateFromSlice(slice) }];
  const originalEstimate = stored[0].estimate;
  const originalPrice = originalEstimate.suggestedPricePerUnit;

  costs.updateMaterialPrice("PLA", 250);
  costs.updateSettings({ pricingPercent: 50 });
  const refreshed = refreshObjectSliceCostEstimates(stored, item => costs.calculateFromSlice(item));

  assert.notEqual(refreshed[0].estimate.costPerUnit, originalEstimate.costPerUnit);
  assert.notEqual(refreshed[0].estimate.suggestedPricePerUnit, originalPrice);
  assert.equal(stored[0].estimate, originalEstimate, "a estimativa armazenada não deve ser mutada");
  assert.equal(refreshed[0].estimate.source, "slicer");
});
