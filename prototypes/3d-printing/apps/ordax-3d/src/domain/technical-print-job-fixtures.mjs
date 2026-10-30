import { normalizeTechnicalPrintJobs } from "./technical-print-job.mjs";
import { calculateManufacturingCost, defaultManufacturingCostSettings } from "./manufacturing-cost.mjs";

// These records exist only to make the local development preview usable.
const previewCost = calculateManufacturingCost({
  name: "Suporte articulado",
  material: "PLA",
  printer: "Bambu Lab A1",
  gramsPerUnit: 28.6,
  hoursPerUnit: 154 / 60,
  quantity: 1,
  source: "manual",
  scope: "piece",
}, defaultManufacturingCostSettings);

export const localPreviewJobs = normalizeTechnicalPrintJobs([
  { id: "preview-job-1", name: "Suporte articulado", model: "suporte_articulado.3mf", printer: "Bambu Lab A1", material: "PLA · cinza", time: "2h 34m", grams: 28.6, costEstimate: previewCost, status: "queued", due: "Hoje · 15:00", origin: "local-preview" },
  { id: "preview-job-2", name: "Organizador modular", model: "organizador_modular.3mf", printer: "Prusa MK4", material: "PETG · preto", time: "4h 12m", grams: 76, status: "ready", due: "Hoje · 18:00", origin: "local-preview" },
  { id: "preview-job-3", name: "Peça de reposição A7", model: "reposicao_a7.stl", printer: "Ender 3 V3", material: "PLA · branco", time: "1h 08m", grams: 18, status: "queued", due: "Amanhã · 10:00", origin: "local-preview" },
]);
