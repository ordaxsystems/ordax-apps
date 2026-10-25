const allowedStatuses = new Set(["queued", "ready", "printing", "done", "blocked"]);
export const technicalPrintJobSchema = "ordax.3d-print-job/1";

function text(value, fallback, limit = 180) {
  const normalized = String(value ?? "").trim().slice(0, limit);
  return normalized || fallback;
}

function finiteNumber(value, fallback = null, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

export function normalizeTechnicalPrintJob(value, index = 0) {
  if (!value || typeof value !== "object") return null;
  const id = text(value.id, `job-${index + 1}`, 96);
  if (value.schema && value.schema !== technicalPrintJobSchema) return null;
  if (!/^[a-z0-9][a-z0-9_-]{0,95}$/i.test(id)) return null;
  const status = allowedStatuses.has(value.status) ? value.status : "queued";
  const grams = finiteNumber(value.estimatedGrams ?? value.grams, null, 0, 100_000);
  const minutes = finiteNumber(value.estimatedMinutes, null, 0, 100_000);
  return Object.freeze({
    schema: technicalPrintJobSchema,
    id,
    name: text(value.name, "Trabalho técnico", 140),
    model: text(value.model ?? value.filename, "Modelo sem nome", 180),
    printer: text(value.printer, "A definir", 120),
    material: text(value.material, "A definir", 100),
    estimatedMinutes: minutes ?? legacyMinutes(value.time),
    estimatedGrams: grams,
    status,
    due: text(value.due, "Sem prazo", 80),
    createdAt: text(value.createdAt, "", 40),
    origin: text(value.origin, "local-preview", 32),
    engine: text(value.engine, "", 48),
    engineVersion: text(value.engineVersion, "", 48),
    notes: text(value.notes, "", 240),
  });
}

function legacyMinutes(value) {
  const raw = String(value ?? "").trim().toLowerCase().replace(",", ".");
  const hours = raw.match(/([\d.]+)\s*h/);
  const minutes = raw.match(/([\d.]+)\s*m/);
  if (hours || minutes) return Math.round(Number(hours?.[1] || 0) * 60 + Number(minutes?.[1] || 0));
  const decimalHours = Number(raw.replace(/h$/, ""));
  return Number.isFinite(decimalHours) && decimalHours >= 0 ? Math.round(decimalHours * 60) : null;
}

export function createTechnicalPrintJob(input, { id = `job-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`, now = new Date().toISOString() } = {}) {
  const job = normalizeTechnicalPrintJob({ ...input, id, createdAt: now, status: input?.status ?? "queued" });
  if (!job || job.name === "Trabalho técnico" || job.model === "Modelo sem nome") throw new TypeError("Um trabalho técnico precisa de nome e modelo válidos.");
  return job;
}

export function normalizeTechnicalPrintJobs(value) {
  const ids = new Set();
  return Object.freeze((Array.isArray(value) ? value : []).slice(0, 2_000).flatMap((job, index) => {
    const normalized = normalizeTechnicalPrintJob(job, index);
    if (!normalized || ids.has(normalized.id)) return [];
    ids.add(normalized.id);
    return [normalized];
  }));
}

export function isTechnicalPrintJobStatus(value) {
  return allowedStatuses.has(value);
}
