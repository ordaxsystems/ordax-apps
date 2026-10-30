const BED_TYPES = Object.freeze([
  { value: "Cool Plate", label: "Smooth Cool Plate", enum: 1, temperature: "cool_plate_temp", firstLayer: "cool_plate_temp_initial_layer" },
  { value: "Engineering Plate", label: "Engineering Plate", enum: 2, temperature: "eng_plate_temp", firstLayer: "eng_plate_temp_initial_layer" },
  { value: "High Temp Plate", label: "Smooth High Temp Plate", enum: 3, temperature: "hot_plate_temp", firstLayer: "hot_plate_temp_initial_layer" },
  { value: "Textured PEI Plate", label: "Textured PEI Plate", enum: 4, temperature: "textured_plate_temp", firstLayer: "textured_plate_temp_initial_layer" },
  { value: "Textured Cool Plate", label: "Textured Cool Plate", enum: 5, temperature: "textured_cool_plate_temp", firstLayer: "textured_cool_plate_temp_initial_layer" },
  { value: "Supertack Plate", label: "Cool Plate (SuperTack)", enum: 6, temperature: "supertack_plate_temp", firstLayer: "supertack_plate_temp_initial_layer" },
]);

const byValue = new Map(BED_TYPES.map(item => [item.value, item]));
const byName = new Map(BED_TYPES.flatMap(item => [[item.value.toLowerCase(), item.value], [item.label.toLowerCase(), item.value]]));
const enumToValue = new Map(BED_TYPES.map(item => [item.enum, item.value]));

export const supportedBedTypes = BED_TYPES;

export function isSupportedBedType(value) {
  return typeof value === "string" && byValue.has(value);
}

export function normalizeBedType(value) {
  if (typeof value === "number" && Number.isInteger(value)) return enumToValue.get(value) || null;
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/^['\"]|['\"]$/g, "").toLowerCase();
  if (normalized === "" || normalized === "default plate" || normalized === "0") return null;
  const named = byName.get(normalized);
  if (named) return named;
  if (/^[1-6]$/.test(normalized)) return enumToValue.get(Number(normalized)) || null;
  return null;
}

export function bedTypeLabel(value) {
  return byValue.get(value)?.label || value || "Do perfil";
}

function profileNumber(profile, key) {
  const raw = Array.isArray(profile?.[key]) ? profile[key][0] : profile?.[key];
  const number = Number(raw);
  return Number.isFinite(number) && number > 0 && number <= 150 ? number : null;
}

export function bedTemperaturesByType(profile) {
  return Object.fromEntries(BED_TYPES.flatMap(({ value, temperature, firstLayer }) => {
    const otherLayerC = profileNumber(profile, temperature);
    const initialLayerC = profileNumber(profile, firstLayer);
    return otherLayerC !== null && initialLayerC !== null
      ? [[value, { otherLayerC, initialLayerC }]]
      : [];
  }));
}

function unsupportedSet(machine) {
  const raw = machine?.unsupportedBedTypes;
  const values = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[;,]/) : [];
  return new Set(values.map(normalizeBedType).filter(Boolean));
}

export function availableBedTypes(machine, filament) {
  if (machine?.supportMultiBedTypes !== true) return [];
  const temperatures = filament?.bedTemperaturesByType || bedTemperaturesByType(filament);
  const unsupported = unsupportedSet(machine);
  return BED_TYPES.filter(({ value }) => !unsupported.has(value) && temperatures[value])
    .map(({ value, label }) => ({ value, label, ...temperatures[value] }));
}

export function validateBedTypeSelection(value, machine, filament) {
  if (value === null || value === undefined || value === "") return { valid: true, reason: "" };
  if (!isSupportedBedType(value)) return { valid: false, reason: "A mesa selecionada não é reconhecida pelo OrcaSlicer." };
  if (machine?.supportMultiBedTypes !== true) return { valid: false, reason: "O perfil selecionado não declara suporte a múltiplas mesas." };
  if (unsupportedSet(machine).has(value)) return { valid: false, reason: `A impressora não permite a mesa ${bedTypeLabel(value)}.` };
  const temperature = availableBedTypes(machine, filament).find(item => item.value === value);
  if (!temperature) return { valid: false, reason: `O perfil de filamento não define temperaturas válidas para ${bedTypeLabel(value)}.` };
  return { valid: true, reason: "" };
}
