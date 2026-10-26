import { assertManufacturingCostRepository } from "../ports/manufacturing-cost-repository.mjs";
import { calculateManufacturingCost, defaultManufacturingCostSettings, getMaterialPricePerKg, normalizeManufacturingCostSettings, normalizeMaterialName } from "../domain/manufacturing-cost.mjs";

function optionalNonNegative(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function optionalPositive(value) {
  const parsed = optionalNonNegative(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

export function createManufacturingCostService(repository) {
  assertManufacturingCostRepository(repository);
  let settings = normalizeManufacturingCostSettings(repository.loadSettings() ?? defaultManufacturingCostSettings);
  let estimates = repository.loadEstimates().slice(0, 500);
  let latestSlice = null;
  const listeners = new Set();
  const notify = () => { for (const listener of listeners) listener(); };

  function calculate(input) {
    return calculateManufacturingCost(input, settings);
  }

  function calculateFromSlice(slice = latestSlice) {
    if (!slice) return calculate({});
    return calculate({
      ...slice,
      source: "slicer",
      gramsPerUnit: slice.grams,
      hoursPerUnit: slice.timeSeconds === null ? null : slice.timeSeconds / 3600,
    });
  }

  return Object.freeze({
    settings: () => settings,
    materialPriceFor: material => getMaterialPricePerKg(material, settings),
    updateSettings(patch = {}) {
      settings = normalizeManufacturingCostSettings({ ...settings, ...(patch && typeof patch === "object" ? patch : {}) });
      repository.saveSettings(settings);
      notify();
      return settings;
    },
    updateMaterialPrice(material, price) {
      const key = normalizeMaterialName(material);
      const parsed = Number(price);
      if (!key || !Number.isFinite(parsed) || parsed < 0) throw new TypeError("Informe um material e um preço por kg válido.");
      settings = normalizeManufacturingCostSettings({
        ...settings,
        materialPricesPerKg: { ...settings.materialPricesPerKg, [key]: parsed },
      });
      repository.saveSettings(settings);
      notify();
      return getMaterialPricePerKg(key, settings);
    },
    calculate,
    calculateFromSlice,
    listEstimates: () => estimates,
    saveEstimate(input) {
      const result = calculate(input);
      if (!result.available) throw new TypeError("Informe peso e tempo para calcular a estimativa.");
      if (!result.pricingValid) throw new TypeError(result.pricingError);
      const estimate = Object.freeze({
        ...result,
        id: `estimate-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`,
        savedAt: new Date().toISOString(),
        origin: "local-preview",
      });
      estimates = [estimate, ...estimates].slice(0, 30);
      repository.saveEstimates(estimates);
      notify();
      return estimate;
    },
    latestSlice: () => latestSlice,
    setLatestSlice(value) {
      if (value === null || value === undefined) latestSlice = null;
      else {
        latestSlice = Object.freeze({
          name: String(value.name ?? "Trabalho fatiado").trim().slice(0, 140) || "Trabalho fatiado",
          material: String(value.material ?? "Material não informado").trim().slice(0, 100) || "Material não informado",
          printer: String(value.printer ?? "Impressora não informada").trim().slice(0, 120) || "Impressora não informada",
          engine: String(value.engine ?? "").trim().slice(0, 48),
          engineVersion: String(value.engineVersion ?? "").trim().slice(0, 48),
          grams: optionalPositive(value.grams),
          timeSeconds: optionalPositive(value.timeSeconds),
          scope: value.scope === "plate" ? "plate" : "piece",
        });
      }
      notify();
      return latestSlice;
    },
    subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("O listener de custos precisa ser uma função.");
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
}
