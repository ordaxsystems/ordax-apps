import { isSupportedInfillPattern } from "../../../../shared/infill-patterns.mjs";
import { isSupportedSeamPosition } from "../../../../shared/seam-positions.mjs";
import { nozzleTemperatureBoundsC } from "../../../../shared/nozzle-temperatures.mjs";
import { isSupportedBedType } from "../../../../shared/bed-types.mjs";

export const defaultDraft = Object.freeze({
  printer: "generic", filament: "pla", printerProfileId: "", processProfileId: "", filamentProfileId: "", bedType: null, quality: "standard", layerHeight: 0.2, walls: 3, topShellLayers: 3, bottomShellLayers: 3, topShellThickness: 0, bottomShellThickness: 0, brimType: null, brimWidth: null, brimGap: null, infill: 15, infillPattern: "gyroid", seamPosition: null, nozzleTemperatureC: null, nozzleTemperatureInitialLayerC: null, fanMin: 80, fanMax: 80,
  supports: false, supportType: "normal(auto)", supportThresholdAngle: 0, supportOnBuildPlateOnly: false, rotation: 0, scale: 1, stlUnit: "mm", objectTransforms: {}, selectedTab: "prepare",
});

export const printers = Object.freeze({
  generic: { name: "FDM genérica · referência", bed: [256, 256, 256], reference: true },
  a1: { name: "Bambu Lab A1 · referência", bed: [256, 256, 256], reference: true },
  mk4: { name: "Original Prusa MK4 · referência", bed: [250, 210, 220], reference: true },
  ender: { name: "Creality Ender 3 V3 · referência", bed: [220, 220, 250], reference: true },
});
export const materials = Object.freeze({
  pla: { name: "PLA", nozzle: "190–220 °C", bed: "45–65 °C" },
  petg: { name: "PETG", nozzle: "225–250 °C", bed: "70–85 °C" },
  abs: { name: "ABS", nozzle: "240–265 °C", bed: "90–110 °C" },
});
export const unitScales = Object.freeze({ mm: 1, cm: 10, in: 25.4 });

export function safeDraft(value) {
  const next = { ...defaultDraft, ...(value && typeof value === "object" ? value : {}) };
  const legacyFan = Number(value?.fan);
  if (Number.isFinite(legacyFan) && (!Number.isFinite(Number(value?.fanMin)) || !Number.isFinite(Number(value?.fanMax)))) {
    next.fanMin = legacyFan;
    next.fanMax = legacyFan;
  }
  delete next.fan;
  if (!printers[next.printer]) next.printer = defaultDraft.printer;
  if (!materials[next.filament]) next.filament = defaultDraft.filament;
  for (const [kind, key] of [["machine", "printerProfileId"], ["process", "processProfileId"], ["filament", "filamentProfileId"]]) {
    if (typeof next[key] !== "string" || (next[key] && !new RegExp(`^orca-${kind}-[a-f0-9]{24}$`).test(next[key]))) next[key] = "";
  }
  if (!unitScales[next.stlUnit]) next.stlUnit = defaultDraft.stlUnit;
  next.layerHeight = Math.max(0.08, Math.min(0.4, Number(next.layerHeight) || defaultDraft.layerHeight));
  next.walls = Math.max(1, Math.min(8, Math.round(Number(next.walls) || defaultDraft.walls)));
  next.infill = Math.max(0, Math.min(100, Number(next.infill) || 0));
  next.fanMin = Math.max(0, Math.min(100, Math.round(Number(next.fanMin) || 0)));
  next.fanMax = Math.max(next.fanMin, Math.min(100, Math.round(Number(next.fanMax) || 0)));
  next.rotation = ((Math.round(Number(next.rotation) || 0) % 360) + 360) % 360;
  next.scale = Math.max(0.1, Math.min(3, Number(next.scale) || 1));
  next.supports = Boolean(next.supports);
  next.selectedTab = next.selectedTab === "preview" ? "preview" : "prepare";
  const validQuality = quality => ["standard", "fine", "draft", "profile", "custom"].includes(quality) ? quality : "standard";
  const validSupportType = supportType => ["normal(auto)", "tree(auto)"].includes(supportType) ? supportType : "normal(auto)";
  const validSeamPosition = value => value === null || value === undefined || value === "" ? null : isSupportedSeamPosition(value) ? value : null;
  const validBrimType = brimType => ["outer_only", "inner_only", "outer_and_inner", "no_brim"].includes(brimType) ? brimType : null;
  const optionalBrimWidth = brimWidth => {
    if (brimWidth === null || brimWidth === undefined || brimWidth === "") return null;
    const parsed = Number(brimWidth);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 20 ? parsed : null;
  };
  const optionalBrimGap = brimGap => {
    if (brimGap === null || brimGap === undefined || brimGap === "") return null;
    const parsed = Number(brimGap);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 10 ? parsed : null;
  };
  next.brimType = validBrimType(next.brimType);
  next.brimWidth = optionalBrimWidth(next.brimWidth);
  next.brimGap = optionalBrimGap(next.brimGap);
  const optionalNozzleTemperature = value => {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= nozzleTemperatureBoundsC.min && parsed <= nozzleTemperatureBoundsC.max ? parsed : null;
  };
  next.nozzleTemperatureC = optionalNozzleTemperature(next.nozzleTemperatureC);
  next.nozzleTemperatureInitialLayerC = optionalNozzleTemperature(next.nozzleTemperatureInitialLayerC);
  if (next.bedType !== null && !isSupportedBedType(next.bedType)) next.bedType = null;
  const normalizeProcessSettings = (source, fallback = next) => ({
    quality: validQuality(source?.quality ?? fallback.quality),
    layerHeight: Math.max(0.08, Math.min(0.4, Number(source?.layerHeight ?? fallback.layerHeight) || 0.2)),
    walls: Math.max(1, Math.min(8, Math.round(Number(source?.walls ?? fallback.walls) || 3))),
    topShellLayers: Math.max(0, Math.min(20, Math.round(Number(source?.topShellLayers ?? fallback.topShellLayers) || 0))),
    bottomShellLayers: Math.max(0, Math.min(20, Math.round(Number(source?.bottomShellLayers ?? fallback.bottomShellLayers) || 0))),
    topShellThickness: Math.max(0, Math.min(10, Number(source?.topShellThickness ?? fallback.topShellThickness) || 0)),
    bottomShellThickness: Math.max(0, Math.min(10, Number(source?.bottomShellThickness ?? fallback.bottomShellThickness) || 0)),
    brimType: validBrimType(Object.hasOwn(source || {}, "brimType") ? source.brimType : fallback.brimType),
    brimWidth: optionalBrimWidth(Object.hasOwn(source || {}, "brimWidth") ? source.brimWidth : fallback.brimWidth),
    brimGap: optionalBrimGap(Object.hasOwn(source || {}, "brimGap") ? source.brimGap : fallback.brimGap),
    infill: Math.max(0, Math.min(100, Number(source?.infill ?? fallback.infill) || 0)),
    infillPattern: isSupportedInfillPattern(source?.infillPattern ?? fallback.infillPattern) ? source?.infillPattern ?? fallback.infillPattern : defaultDraft.infillPattern,
    seamPosition: validSeamPosition(Object.hasOwn(source || {}, "seamPosition") ? source.seamPosition : fallback.seamPosition),
    supports: Boolean(source?.supports ?? fallback.supports),
    supportType: validSupportType(source?.supportType ?? fallback.supportType),
    supportThresholdAngle: Math.max(0, Math.min(90, Math.round(Number(source?.supportThresholdAngle ?? fallback.supportThresholdAngle) || 0))),
    supportOnBuildPlateOnly: Boolean(source?.supportOnBuildPlateOnly ?? fallback.supportOnBuildPlateOnly),
    fanMin: Math.max(0, Math.min(100, Math.round(Number(source?.fanMin ?? source?.fan ?? fallback.fanMin) || 0))),
    fanMax: Math.max(
      Math.max(0, Math.min(100, Math.round(Number(source?.fanMin ?? source?.fan ?? fallback.fanMin) || 0))),
      Math.max(0, Math.min(100, Math.round(Number(source?.fanMax ?? source?.fan ?? fallback.fanMax) || 0))),
    ),
  });
  next.quality = validQuality(next.quality);
  const seenProcessIds = new Set();
  const seenObjectIds = new Set();
  const sourceProcesses = Array.isArray(next.processes) ? next.processes.slice(0, 100) : [];
  next.processes = sourceProcesses.flatMap((process, index) => {
    if (!process || typeof process !== "object") return [];
    const id = String(process.id || `process-${index + 1}`).slice(0, 64);
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(id) || seenProcessIds.has(id)) return [];
    seenProcessIds.add(id);
    const objectIds = [...new Set((Array.isArray(process.objectIds) ? process.objectIds : [])
      .filter(item => typeof item === "string" && item.length > 0 && item.length <= 128 && !seenObjectIds.has(item)))].slice(0, 10_000);
    for (const objectId of objectIds) seenObjectIds.add(objectId);
    return [{ id, name: String(process.name || `Processo ${index + 1}`).slice(0, 80), objectIds, settings: normalizeProcessSettings(process.settings) }];
  });
  if (!next.processes.length) {
    next.processes = [{ id: "process-1", name: "Processo 1", objectIds: [], settings: normalizeProcessSettings(next) }];
  }
  next.selectedProcessId = next.processes.some(process => process.id === next.selectedProcessId) ? next.selectedProcessId : next.processes[0].id;
  const active = next.processes.find(process => process.id === next.selectedProcessId);
  Object.assign(next, active.settings);
  const transformEntries = Object.entries(next.objectTransforms && typeof next.objectTransforms === "object" ? next.objectTransforms : {}).slice(0, 500);
  next.objectTransforms = Object.fromEntries(transformEntries.flatMap(([id, transform]) => {
    if (!/^[a-z0-9_-]{1,128}$/i.test(id) || !transform || typeof transform !== "object") return [];
    const boundedNumber = (key, fallback, min, max, whole = false) => {
      const parsed = Number(transform[key]);
      const value = Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
      return whole ? Math.round(value) : value;
    };
    return [[id, {
      x: boundedNumber("x", 0, -500, 500), y: boundedNumber("y", 0, -500, 500), z: boundedNumber("z", 0, -500, 500),
      rotationX: ((boundedNumber("rotationX", 0, -3600, 3600, true) % 360) + 360) % 360,
      rotationY: ((boundedNumber("rotationY", 0, -3600, 3600, true) % 360) + 360) % 360,
      rotationZ: ((boundedNumber("rotationZ", 0, -3600, 3600, true) % 360) + 360) % 360,
      scale: boundedNumber("scale", 1, 0.1, 3),
    }]];
  }));
  return next;
}
