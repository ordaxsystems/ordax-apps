export const infillPatternOptions = Object.freeze([
  { value: "rectilinear", label: "Retilíneo" },
  { value: "alignedrectilinear", label: "Retilíneo alinhado" },
  { value: "zigzag", label: "Zigue-zague" },
  { value: "crosszag", label: "Zigue-zague cruzado" },
  { value: "lockedzag", label: "Zigue-zague bloqueado" },
  { value: "line", label: "Linhas" },
  { value: "grid", label: "Grade" },
  { value: "triangles", label: "Triângulos" },
  { value: "tri-hexagon", label: "Tri-hexagonal" },
  { value: "cubic", label: "Cúbico" },
  { value: "adaptivecubic", label: "Cúbico adaptativo" },
  { value: "quartercubic", label: "Cúbico de quarto" },
  { value: "supportcubic", label: "Cúbico de suporte" },
  { value: "lightning", label: "Relâmpago · economia de material" },
  { value: "honeycomb", label: "Colmeia" },
  { value: "3dhoneycomb", label: "Colmeia 3D" },
  { value: "lateral-honeycomb", label: "Colmeia lateral" },
  { value: "lateral-lattice", label: "Treliça lateral" },
  { value: "crosshatch", label: "Hachura cruzada" },
  { value: "tpmsd", label: "TPMS-D" },
  { value: "tpmsfk", label: "TPMS-FK" },
  { value: "gyroid", label: "Giroide" },
  { value: "concentric", label: "Concêntrico" },
  { value: "hilbertcurve", label: "Curva de Hilbert" },
  { value: "archimedeanchords", label: "Cordas de Arquimedes" },
  { value: "octagramspiral", label: "Espiral octagrama" },
]);

const infillPatternValues = new Set(infillPatternOptions.map(option => option.value));

export function isSupportedInfillPattern(value) {
  return typeof value === "string" && infillPatternValues.has(value);
}

export function infillPatternLabel(value) {
  return infillPatternOptions.find(option => option.value === value)?.label || String(value || "");
}
