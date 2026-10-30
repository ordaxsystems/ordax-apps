export const seamPositionOptions = Object.freeze([
  Object.freeze({ value: "nearest", label: "Mais próximo" }),
  Object.freeze({ value: "aligned", label: "Alinhada" }),
  Object.freeze({ value: "aligned_back", label: "Alinhada atrás" }),
  Object.freeze({ value: "back", label: "Atrás" }),
  Object.freeze({ value: "random", label: "Aleatória" }),
]);

const seamPositionValues = new Set(seamPositionOptions.map(option => option.value));
const seamPositionLabels = new Map(seamPositionOptions.map(option => [option.value, option.label]));

export function isSupportedSeamPosition(value) {
  return typeof value === "string" && seamPositionValues.has(value);
}

export function seamPositionLabel(value) {
  return seamPositionLabels.get(value) || String(value ?? "");
}
