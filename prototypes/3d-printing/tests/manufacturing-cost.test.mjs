import assert from "node:assert/strict";
import test from "node:test";
import { calculateManufacturingCost, defaultManufacturingCostSettings, normalizeManufacturingCostSettings } from "../apps/ordax-3d/src/domain/manufacturing-cost.mjs";
import { createManufacturingCostService } from "../apps/ordax-3d/src/application/manufacturing-cost-service.mjs";
import { manufacturingCostRepositorySchema } from "../apps/ordax-3d/src/ports/manufacturing-cost-repository.mjs";

function memoryRepository(settings = null, estimates = []) {
  return {
    schema: manufacturingCostRepositorySchema,
    loadSettings: () => settings,
    saveSettings: value => { settings = structuredClone(value); },
    loadEstimates: () => estimates,
    saveEstimates: value => { estimates = structuredClone(value); },
    state: () => ({ settings, estimates }),
  };
}

function closeTo(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `esperava ${expected}, recebeu ${actual}`);
}

test("calcula material, energia, depreciação, manutenção, mão de obra e lote", () => {
  const result = calculateManufacturingCost({ gramsPerUnit: 100, hoursPerUnit: 2, quantity: 2 }, {
    ...defaultManufacturingCostSettings,
    materialPricePerKg: 100,
    materialWastePercent: 10,
    printerPowerWatts: 1000,
    energyPricePerKwh: 0.5,
    printerPurchasePrice: 1500,
    printerResidualValue: 500,
    printerUsefulHours: 1000,
    maintenancePerHour: 2,
    machineOverheadPerHour: 1,
    laborPricePerHour: 20,
    setupMinutesPerBatch: 60,
    finishingMinutesPerUnit: 30,
    packagingPerUnit: 3,
    otherCostPerUnit: 4,
    pricingMode: "markup",
    pricingPercent: 25,
  });

  assert.equal(result.complete, true);
  closeTo(result.components.material, 11);
  closeTo(result.components.energy, 1);
  closeTo(result.components.depreciation, 2);
  closeTo(result.components.maintenance, 4);
  closeTo(result.components.machineOverhead, 2);
  closeTo(result.components.labor, 60);
  closeTo(result.costPerUnit, 87);
  closeTo(result.totalCost, 174);
  closeTo(result.suggestedPricePerUnit, 108.75);
  closeTo(result.suggestedPriceTotal, 217.5);
});

test("margem alvo divide pelo preço final e depreciação não configurada marca o custo parcial", () => {
  const result = calculateManufacturingCost({ grams: 10, hours: 1 }, {
    ...defaultManufacturingCostSettings,
    materialPricePerKg: 100,
    materialWastePercent: 0,
    printerPowerWatts: 0,
    energyPricePerKwh: 0,
    laborPricePerHour: 0,
    printerPurchasePrice: 0,
    pricingMode: "margin",
    pricingPercent: 25,
  });

  assert.equal(result.complete, false);
  assert.equal(result.components.depreciationPerHour, null);
  closeTo(result.costPerUnit, 1);
  closeTo(result.suggestedPricePerUnit, 4 / 3);
  assert.deepEqual(result.missingAssumptions, ["depreciacao"]);
});

test("inclui tributos, taxas percentuais, taxa fixa e frete absorvido no preço de referência", () => {
  const result = calculateManufacturingCost({ grams: 100, hours: 1, quantity: 2 }, {
    ...defaultManufacturingCostSettings,
    materialPricePerKg: 100,
    materialWastePercent: 0,
    printerPowerWatts: 0,
    energyPricePerKwh: 0,
    laborPricePerHour: 0,
    taxPercent: 10,
    salesFeePercent: 5,
    fixedSaleFeePerOrder: 3,
    shippingAbsorbedPerOrder: 7,
    pricingPercent: 20,
  });

  closeTo(result.costPerUnit, 10);
  closeTo(result.suggestedPricePerUnit, 15 * 1.2 / 0.85);
  closeTo(result.suggestedPriceTotal, 2 * 15 * 1.2 / 0.85);
  closeTo(result.components.fixedSaleFee, 1.5);
  closeTo(result.components.absorbedShipping, 3.5);
  closeTo(result.estimatedProfitTotal, 6);
});

test("bloqueia preços quando margem mais taxas alcançam 100% e não aceita dados de fatiamento iguais a zero", () => {
  const result = calculateManufacturingCost({ grams: 20, hours: 1 }, {
    ...defaultManufacturingCostSettings,
    pricingMode: "margin",
    pricingPercent: 40,
    taxPercent: 40,
    salesFeePercent: 30,
  });
  assert.equal(result.available, true);
  assert.equal(result.pricingValid, false);
  assert.equal(result.suggestedPriceTotal, null);

  const noWeight = calculateManufacturingCost({ grams: 0, hours: 1 });
  assert.equal(noWeight.available, false);
  assert.deepEqual(noWeight.missingInputs, ["peso"]);
  const noDuration = calculateManufacturingCost({ grams: 20, hours: 0 });
  assert.equal(noDuration.available, false);
  assert.deepEqual(noDuration.missingInputs, ["tempo"]);
});

test("limita valor residual ao valor de aquisição da impressora", () => {
  const settings = normalizeManufacturingCostSettings({ printerPurchasePrice: 1000, printerResidualValue: 1400 });
  assert.equal(settings.printerResidualValue, 1000);
});

test("usa uma referência de preço local para cada material sem substituir o Inventory", () => {
  const result = calculateManufacturingCost({ material: "PÉTG", grams: 100, hours: 1 }, {
    ...defaultManufacturingCostSettings,
    materialPricePerKg: 100,
    materialPricesPerKg: { petg: 200 },
    materialWastePercent: 0,
    printerPowerWatts: 0,
    laborPricePerHour: 0,
  });
  assert.equal(result.materialPricePerKg, 200);
  closeTo(result.components.material, 20);
});

test("estatísticas ausentes do motor não viram custo zero disponível", () => {
  const service = createManufacturingCostService(memoryRepository());
  const estimate = service.calculateFromSlice({ grams: null, timeSeconds: 3600 });
  assert.equal(estimate.available, false);
  assert.deepEqual(estimate.missingInputs, ["peso"]);
});

test("serviço não salva orçamento com preço inviável e descarta peso/tempo zero do slicer", () => {
  const service = createManufacturingCostService(memoryRepository());
  service.updateSettings({ pricingMode: "margin", pricingPercent: 40, taxPercent: 40, salesFeePercent: 30 });
  assert.throws(() => service.saveEstimate({ name: "Peça", grams: 20, hours: 1 }), /inferior a 100%/);
  assert.equal(service.listEstimates().length, 0);
  service.setLatestSlice({ name: "Peça", grams: 0, timeSeconds: 0 });
  assert.equal(service.latestSlice().grams, null);
  assert.equal(service.latestSlice().timeSeconds, null);
  assert.equal(service.calculateFromSlice().available, false);
});

test("serviço persiste parâmetros e histórico, e compartilha o resultado recente do fatiador", () => {
  const repository = memoryRepository();
  const service = createManufacturingCostService(repository);
  const revisions = [];
  const unsubscribe = service.subscribe(() => revisions.push(service.latestSlice()));

  service.updateSettings({ printerPurchasePrice: 2000, printerResidualValue: 500, printerUsefulHours: 5000 });
  service.setLatestSlice({ name: "Suporte.stl", material: "PLA", printer: "Bambu A1", grams: 20, timeSeconds: 3600, engine: "OrcaSlicer", engineVersion: "2.3.1" });
  const latestEstimate = service.calculateFromSlice();
  assert.equal(latestEstimate.source, "slicer");
  assert.equal(latestEstimate.gramsPerUnit, 20);
  assert.equal(latestEstimate.hoursPerUnit, 1);
  assert.equal(latestEstimate.complete, true);
  closeTo(latestEstimate.components.depreciation, 0.3);

  const saved = service.saveEstimate({ name: "Suporte.stl", material: "PLA", printer: "Bambu A1", grams: 20, hours: 1, source: "slicer" });
  assert.equal(service.listEstimates()[0].id, saved.id);
  assert.equal(repository.state().estimates[0].suggestedPriceTotal, saved.suggestedPriceTotal);
  assert.equal(repository.state().settings.printerPurchasePrice, 2000);
  assert.equal(revisions.length, 3);
  unsubscribe();
});

test("mantém o escopo e a quantidade de objetos do resultado do prato sem ratear custos", () => {
  const service = createManufacturingCostService(memoryRepository());
  service.setLatestSlice({ name: "Prato.3mf", material: "PLA", printer: "Bambu A1", grams: 80, timeSeconds: 14400, scope: "plate", objectCount: 4 });
  assert.deepEqual(service.latestSlice(), {
    name: "Prato.3mf", material: "PLA", printer: "Bambu A1", engine: "", engineVersion: "",
    grams: 80, timeSeconds: 14400, scope: "plate", objectCount: 4,
  });
  const estimate = service.calculateFromSlice();
  assert.equal(estimate.scope, "plate");
  assert.equal(estimate.gramsPerUnit, 80);
  assert.equal(estimate.hoursPerUnit, 4);
});

test("serviço guarda preço por material em premissas locais", () => {
  const repository = memoryRepository();
  const service = createManufacturingCostService(repository);
  service.updateMaterialPrice("PETG azul", 189.5);
  assert.equal(service.materialPriceFor("petg AZUL"), 189.5);
  assert.equal(service.materialPriceFor("PLA"), defaultManufacturingCostSettings.materialPricePerKg);
  assert.equal(repository.state().settings.materialPricesPerKg["petg azul"], 189.5);
});

test("mantém custos de máquina separados por impressora e reaplica o perfil em novos cálculos", () => {
  const repository = memoryRepository({
    ...defaultManufacturingCostSettings,
    materialPricePerKg: 0,
    materialWastePercent: 0,
    energyPricePerKwh: 1,
    laborPricePerHour: 0,
  });
  const costs = createManufacturingCostService(repository);
  costs.updatePrinterCostProfile("Bambu Lab A1", {
    printerPowerWatts: 100,
    printerPurchasePrice: 2000,
    printerResidualValue: 0,
    printerUsefulHours: 1000,
    maintenancePerHour: 0.5,
    machineOverheadPerHour: 0.2,
  });
  costs.updatePrinterCostProfile("Ender 3 V3", {
    printerPowerWatts: 300,
    printerPurchasePrice: 1000,
    printerResidualValue: 0,
    printerUsefulHours: 1000,
    maintenancePerHour: 1,
    machineOverheadPerHour: 0.4,
  });

  const bambu = costs.calculate({ printer: "bambu  lab a1", grams: 100, hours: 2 });
  const ender = costs.calculate({ printer: "Ender 3 V3", grams: 100, hours: 2 });
  closeTo(bambu.components.energy, 0.2);
  closeTo(bambu.components.depreciation, 4);
  closeTo(bambu.components.maintenance, 1);
  closeTo(bambu.components.machineOverhead, 0.4);
  closeTo(bambu.costPerUnit, 5.6);
  closeTo(ender.components.energy, 0.6);
  closeTo(ender.components.depreciation, 2);
  closeTo(ender.components.maintenance, 2);
  closeTo(ender.components.machineOverhead, 0.8);
  closeTo(ender.costPerUnit, 5.4);

  assert.deepEqual(costs.listPrinterCostProfiles().map(profile => profile.name), ["Bambu Lab A1", "Ender 3 V3"]);
  assert.equal(costs.hasPrinterCostProfile("BAMBU LAB A1"), true);
  assert.equal(repository.state().settings.printerCostProfiles["bambu lab a1"].printerPurchasePrice, 2000);
  assert.equal(createManufacturingCostService(repository).settingsForPrinter("Ender 3 V3").printerPowerWatts, 300);
});

test("perfil de impressora sem configuração usa os valores da oficina e limita o residual ao preço de aquisição", () => {
  const costs = createManufacturingCostService(memoryRepository({
    ...defaultManufacturingCostSettings,
    printerPowerWatts: 180,
    printerPurchasePrice: 800,
    printerResidualValue: 100,
  }));
  assert.equal(costs.settingsForPrinter("Impressora nova").printerPowerWatts, 180);
  assert.equal(costs.hasPrinterCostProfile("Impressora nova"), false);
  const profile = costs.updatePrinterCostProfile("Impressora nova", { printerPurchasePrice: 500, printerResidualValue: 900 });
  assert.equal(profile.printerPowerWatts, 180);
  assert.equal(profile.printerPurchasePrice, 500);
  assert.equal(profile.printerResidualValue, 500);
});
