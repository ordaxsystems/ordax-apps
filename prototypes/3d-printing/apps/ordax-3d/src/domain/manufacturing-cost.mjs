export const manufacturingCostSettingsSchema = "ordax.3d-manufacturing-cost-settings/1";
export const manufacturingCostEstimateSchema = "ordax.3d-manufacturing-cost-estimate/1";

export const printerCostProfileFields = Object.freeze([
  "printerPowerWatts",
  "printerPurchasePrice",
  "printerResidualValue",
  "printerUsefulHours",
  "maintenancePerHour",
  "machineOverheadPerHour",
]);

export const defaultManufacturingCostSettings = Object.freeze({
  schema: manufacturingCostSettingsSchema,
  materialPricePerKg: 119.9,
  materialPricesPerKg: Object.freeze({}),
  printerCostProfiles: Object.freeze({}),
  materialWastePercent: 8,
  printerPowerWatts: 120,
  energyPricePerKwh: 0.95,
  laborPricePerHour: 25,
  printerPurchasePrice: 0,
  printerResidualValue: 0,
  printerUsefulHours: 10000,
  maintenancePerHour: 0,
  machineOverheadPerHour: 0,
  laborAttentionPercent: 100,
  setupMinutesPerBatch: 0,
  finishingMinutesPerUnit: 0,
  packagingPerUnit: 0,
  otherCostPerUnit: 0,
  taxPercent: 0,
  salesFeePercent: 0,
  fixedSaleFeePerOrder: 0,
  shippingAbsorbedPerOrder: 0,
  pricingMode: "markup",
  pricingPercent: 35,
});

function bounded(value, fallback, min, max) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function optionalNonNegative(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function optionalPositive(value) {
  const parsed = optionalNonNegative(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function label(value, fallback, limit = 140) {
  const result = String(value ?? "").trim().replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, limit);
  return result || fallback;
}

export function normalizeMaterialName(value) {
  return String(value ?? "").trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").replace(/\s+/g, " ").slice(0, 100);
}

function normalizePrinterCostProfiles(value, fallback) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return Object.freeze({});
  const profiles = {};
  for (const [profileKey, source] of Object.entries(value).slice(0, 100)) {
    if (!source || typeof source !== "object" || Array.isArray(source)) continue;
    const name = label(source.name ?? profileKey, "", 120);
    const key = normalizeMaterialName(name);
    if (!key || profiles[key]) continue;
    const printerPurchasePrice = bounded(source.printerPurchasePrice, fallback.printerPurchasePrice, 0, 1_000_000_000);
    profiles[key] = Object.freeze({
      name,
      printerPowerWatts: bounded(source.printerPowerWatts, fallback.printerPowerWatts, 0, 50_000),
      printerPurchasePrice,
      printerResidualValue: Math.min(bounded(source.printerResidualValue, fallback.printerResidualValue, 0, 1_000_000_000), printerPurchasePrice),
      printerUsefulHours: bounded(source.printerUsefulHours, fallback.printerUsefulHours, 0, 1_000_000),
      maintenancePerHour: bounded(source.maintenancePerHour, fallback.maintenancePerHour, 0, 1_000_000),
      machineOverheadPerHour: bounded(source.machineOverheadPerHour, fallback.machineOverheadPerHour, 0, 1_000_000),
    });
  }
  return Object.freeze(profiles);
}

export function normalizeManufacturingCostSettings(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const printerPurchasePrice = bounded(source.printerPurchasePrice, defaultManufacturingCostSettings.printerPurchasePrice, 0, 1_000_000_000);
  const materialPricesPerKg = {};
  const rawMaterialPrices = source.materialPricesPerKg && typeof source.materialPricesPerKg === "object" && !Array.isArray(source.materialPricesPerKg) ? source.materialPricesPerKg : {};
  for (const [material, price] of Object.entries(rawMaterialPrices).slice(0, 100)) {
    const key = normalizeMaterialName(material);
    const parsed = Number(price);
    if (key && Number.isFinite(parsed) && parsed >= 0) materialPricesPerKg[key] = Math.min(1_000_000, parsed);
  }
  const printerPowerWatts = bounded(source.printerPowerWatts, defaultManufacturingCostSettings.printerPowerWatts, 0, 50_000);
  const printerUsefulHours = bounded(source.printerUsefulHours, defaultManufacturingCostSettings.printerUsefulHours, 0, 1_000_000);
  const maintenancePerHour = bounded(source.maintenancePerHour, defaultManufacturingCostSettings.maintenancePerHour, 0, 1_000_000);
  const machineOverheadPerHour = bounded(source.machineOverheadPerHour, defaultManufacturingCostSettings.machineOverheadPerHour, 0, 1_000_000);
  const printerCostProfileFallback = {
    printerPowerWatts,
    printerPurchasePrice,
    printerResidualValue: Math.min(bounded(source.printerResidualValue, defaultManufacturingCostSettings.printerResidualValue, 0, 1_000_000_000), printerPurchasePrice),
    printerUsefulHours,
    maintenancePerHour,
    machineOverheadPerHour,
  };
  return Object.freeze({
    schema: manufacturingCostSettingsSchema,
    materialPricePerKg: bounded(source.materialPricePerKg, defaultManufacturingCostSettings.materialPricePerKg, 0, 1_000_000),
    materialPricesPerKg: Object.freeze(materialPricesPerKg),
    printerCostProfiles: normalizePrinterCostProfiles(source.printerCostProfiles, printerCostProfileFallback),
    materialWastePercent: bounded(source.materialWastePercent, defaultManufacturingCostSettings.materialWastePercent, 0, 100),
    printerPowerWatts,
    energyPricePerKwh: bounded(source.energyPricePerKwh, defaultManufacturingCostSettings.energyPricePerKwh, 0, 10_000),
    laborPricePerHour: bounded(source.laborPricePerHour, defaultManufacturingCostSettings.laborPricePerHour, 0, 1_000_000),
    printerPurchasePrice,
    printerResidualValue: Math.min(bounded(source.printerResidualValue, defaultManufacturingCostSettings.printerResidualValue, 0, 1_000_000_000), printerPurchasePrice),
    printerUsefulHours,
    maintenancePerHour,
    machineOverheadPerHour,
    laborAttentionPercent: bounded(source.laborAttentionPercent, defaultManufacturingCostSettings.laborAttentionPercent, 0, 100),
    setupMinutesPerBatch: bounded(source.setupMinutesPerBatch, defaultManufacturingCostSettings.setupMinutesPerBatch, 0, 100_000),
    finishingMinutesPerUnit: bounded(source.finishingMinutesPerUnit, defaultManufacturingCostSettings.finishingMinutesPerUnit, 0, 100_000),
    packagingPerUnit: bounded(source.packagingPerUnit, defaultManufacturingCostSettings.packagingPerUnit, 0, 1_000_000),
    otherCostPerUnit: bounded(source.otherCostPerUnit, defaultManufacturingCostSettings.otherCostPerUnit, 0, 1_000_000),
    taxPercent: bounded(source.taxPercent, defaultManufacturingCostSettings.taxPercent, 0, 50),
    salesFeePercent: bounded(source.salesFeePercent, defaultManufacturingCostSettings.salesFeePercent, 0, 50),
    fixedSaleFeePerOrder: bounded(source.fixedSaleFeePerOrder, defaultManufacturingCostSettings.fixedSaleFeePerOrder, 0, 1_000_000),
    shippingAbsorbedPerOrder: bounded(source.shippingAbsorbedPerOrder, defaultManufacturingCostSettings.shippingAbsorbedPerOrder, 0, 1_000_000),
    pricingMode: source.pricingMode === "margin" ? "margin" : "markup",
    pricingPercent: bounded(source.pricingPercent, defaultManufacturingCostSettings.pricingPercent, 0, source.pricingMode === "margin" ? 95 : 1000),
  });
}

export function getMaterialPricePerKg(material, sourceSettings = defaultManufacturingCostSettings) {
  const settings = normalizeManufacturingCostSettings(sourceSettings);
  const key = normalizeMaterialName(material);
  return key && Object.hasOwn(settings.materialPricesPerKg, key)
    ? settings.materialPricesPerKg[key]
    : settings.materialPricePerKg;
}

export function getPrinterCostSettings(printer, sourceSettings = defaultManufacturingCostSettings) {
  const settings = normalizeManufacturingCostSettings(sourceSettings);
  const key = normalizeMaterialName(printer);
  const profile = key ? settings.printerCostProfiles[key] : null;
  if (!profile) return settings;
  return normalizeManufacturingCostSettings({ ...settings, ...profile });
}

export function calculateManufacturingCost(input = {}, sourceSettings = defaultManufacturingCostSettings) {
  const settings = normalizeManufacturingCostSettings(sourceSettings);
  const gramsPerUnit = optionalPositive(input.gramsPerUnit ?? input.grams);
  const hoursPerUnit = optionalPositive(input.hoursPerUnit ?? input.hours);
  const quantity = Math.round(bounded(input.quantity, 1, 1, 100_000));
  const missingInputs = [];
  if (gramsPerUnit === null) missingInputs.push("peso");
  if (hoursPerUnit === null) missingInputs.push("tempo");
  if (missingInputs.length) {
    return Object.freeze({
      schema: manufacturingCostEstimateSchema,
      available: false,
      complete: false,
      missingInputs: Object.freeze(missingInputs),
      missingAssumptions: Object.freeze([]),
    });
  }

  const materialPricePerKg = getMaterialPricePerKg(input.material, settings);
  const materialCostPerUnit = gramsPerUnit * (1 + settings.materialWastePercent / 100) * materialPricePerKg / 1000;
  const energyCostPerUnit = hoursPerUnit * settings.printerPowerWatts / 1000 * settings.energyPricePerKwh;
  const depreciationPerHour = settings.printerPurchasePrice > 0 && settings.printerUsefulHours > 0
    ? Math.max(0, settings.printerPurchasePrice - settings.printerResidualValue) / settings.printerUsefulHours
    : null;
  const missingAssumptions = depreciationPerHour === null ? ["depreciacao"] : [];
  const depreciationCostPerUnit = depreciationPerHour === null ? 0 : depreciationPerHour * hoursPerUnit;
  const maintenanceCostPerUnit = settings.maintenancePerHour * hoursPerUnit;
  const machineOverheadCostPerUnit = settings.machineOverheadPerHour * hoursPerUnit;
  const attendedHoursPerUnit = hoursPerUnit * settings.laborAttentionPercent / 100;
  const laborCostPerUnit = settings.laborPricePerHour * (attendedHoursPerUnit + settings.finishingMinutesPerUnit / 60 + settings.setupMinutesPerBatch / 60 / quantity);
  const packagingCostPerUnit = settings.packagingPerUnit;
  const otherCostPerUnit = settings.otherCostPerUnit;
  const costPerUnit = materialCostPerUnit + energyCostPerUnit + depreciationCostPerUnit + maintenanceCostPerUnit + machineOverheadCostPerUnit + laborCostPerUnit + packagingCostPerUnit + otherCostPerUnit;
  const totalCost = costPerUnit * quantity;
  const rate = settings.pricingPercent / 100;
  const variableSalesRate = (settings.taxPercent + settings.salesFeePercent) / 100;
  const fixedSaleFeePerUnit = settings.fixedSaleFeePerOrder / quantity;
  const absorbedShippingPerUnit = settings.shippingAbsorbedPerOrder / quantity;
  const priceBasisCostPerUnit = costPerUnit + fixedSaleFeePerUnit + absorbedShippingPerUnit;
  const pricingDenominator = settings.pricingMode === "margin" ? 1 - rate - variableSalesRate : 1 - variableSalesRate;
  const pricingValid = pricingDenominator > 0;
  const suggestedPricePerUnit = pricingValid
    ? settings.pricingMode === "margin" ? priceBasisCostPerUnit / pricingDenominator : priceBasisCostPerUnit * (1 + rate) / pricingDenominator
    : null;
  const suggestedPriceTotal = suggestedPricePerUnit === null ? null : suggestedPricePerUnit * quantity;
  const taxesPerUnit = suggestedPricePerUnit === null ? null : suggestedPricePerUnit * settings.taxPercent / 100;
  const salesFeePerUnit = suggestedPricePerUnit === null ? null : suggestedPricePerUnit * settings.salesFeePercent / 100;
  const salesExpensesPerUnit = suggestedPricePerUnit === null ? null : taxesPerUnit + salesFeePerUnit + fixedSaleFeePerUnit + absorbedShippingPerUnit;

  return Object.freeze({
    schema: manufacturingCostEstimateSchema,
    available: true,
    pricingValid,
    pricingError: pricingValid ? null : "A soma de taxas variáveis e margem desejada precisa ser inferior a 100%.",
    complete: missingAssumptions.length === 0,
    missingInputs: Object.freeze([]),
    missingAssumptions: Object.freeze(missingAssumptions),
    source: input.source === "slicer" ? "slicer" : "manual",
    scope: input.scope === "plate" ? "plate" : "piece",
    name: label(input.name, "Trabalho sem nome"),
    material: label(input.material, "Material não informado", 100),
    printer: label(input.printer, "Impressora não informada", 120),
    engine: label(input.engine, "", 48),
    engineVersion: label(input.engineVersion, "", 48),
    quantity,
    gramsPerUnit,
    hoursPerUnit,
    materialPricePerKg,
    settings,
    components: Object.freeze({
      material: materialCostPerUnit,
      energy: energyCostPerUnit,
      depreciation: depreciationCostPerUnit,
      depreciationPerHour,
      maintenance: maintenanceCostPerUnit,
      machineOverhead: machineOverheadCostPerUnit,
      labor: laborCostPerUnit,
      packaging: packagingCostPerUnit,
      other: otherCostPerUnit,
      taxes: taxesPerUnit,
      salesFee: salesFeePerUnit,
      fixedSaleFee: fixedSaleFeePerUnit,
      absorbedShipping: absorbedShippingPerUnit,
      salesExpenses: salesExpensesPerUnit,
    }),
    costPerUnit,
    totalCost,
    priceBasisCostPerUnit,
    totalPriceBasisCost: priceBasisCostPerUnit * quantity,
    suggestedPricePerUnit,
    suggestedPriceTotal,
    estimatedProfitPerUnit: suggestedPricePerUnit === null ? null : suggestedPricePerUnit - costPerUnit - salesExpensesPerUnit,
    estimatedProfitTotal: suggestedPriceTotal === null ? null : suggestedPriceTotal - totalCost - salesExpensesPerUnit * quantity,
    pricingMode: settings.pricingMode,
    pricingPercent: settings.pricingPercent,
    currency: "BRL",
  });
}

export function normalizeManufacturingCostEstimate(value) {
  if (!value || typeof value !== "object" || value.schema !== manufacturingCostEstimateSchema || value.available !== true) return null;
  const costPerUnit = optionalNonNegative(value.costPerUnit);
  const totalCost = optionalNonNegative(value.totalCost);
  const suggestedPricePerUnit = optionalNonNegative(value.suggestedPricePerUnit);
  const suggestedPriceTotal = optionalNonNegative(value.suggestedPriceTotal);
  if (value.pricingValid !== true || [costPerUnit, totalCost, suggestedPricePerUnit, suggestedPriceTotal].some(item => item === null)) return null;
  const components = {};
  for (const key of ["material", "energy", "depreciation", "maintenance", "machineOverhead", "labor", "packaging", "other", "taxes", "salesFee", "fixedSaleFee", "absorbedShipping", "salesExpenses"]) {
    components[key] = optionalNonNegative(value.components?.[key]) ?? 0;
  }
  return Object.freeze({
    schema: manufacturingCostEstimateSchema,
    source: value.source === "slicer" ? "slicer" : "manual",
    scope: value.scope === "plate" ? "plate" : "piece",
    material: label(value.material, "Material não informado", 100),
    printer: label(value.printer, "Impressora não informada", 120),
    quantity: Math.round(bounded(value.quantity, 1, 1, 100_000)),
    gramsPerUnit: optionalNonNegative(value.gramsPerUnit) ?? 0,
    hoursPerUnit: optionalNonNegative(value.hoursPerUnit) ?? 0,
    materialPricePerKg: optionalNonNegative(value.materialPricePerKg) ?? 0,
    components: Object.freeze(components),
    costPerUnit,
    totalCost,
    suggestedPricePerUnit,
    suggestedPriceTotal,
    complete: value.complete === true,
    pricingMode: value.pricingMode === "margin" ? "margin" : "markup",
    pricingPercent: bounded(value.pricingPercent, 0, 0, 1000),
    currency: "BRL",
  });
}
