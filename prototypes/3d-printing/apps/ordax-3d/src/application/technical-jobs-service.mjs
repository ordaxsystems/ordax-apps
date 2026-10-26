import { createTechnicalPrintJob, isTechnicalPrintJobStatus, normalizeTechnicalPrintJobs } from "../domain/technical-print-job.mjs";
import { localPreviewJobs } from "../domain/technical-print-job-fixtures.mjs";
import { assertTechnicalJobRepository } from "../ports/technical-job-repository.mjs";

function optionalNonNegativeNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function summarizeTechnicalJobCost(estimate) {
  if (!estimate || typeof estimate !== "object") return null;
  const values = {
    costPerUnit: optionalNonNegativeNumber(estimate.costPerUnit),
    suggestedPricePerUnit: optionalNonNegativeNumber(estimate.suggestedPricePerUnit),
    totalCost: optionalNonNegativeNumber(estimate.totalCost),
    suggestedPriceTotal: optionalNonNegativeNumber(estimate.suggestedPriceTotal),
  };
  if (Object.values(values).some(value => value === null)) return null;
  return Object.freeze({
    scope: estimate.scope === "plate" ? "plate" : "piece",
    quantity: Math.max(1, Math.round(Number(estimate.quantity) || 1)),
    complete: estimate.complete === true,
    ...values,
  });
}

export function technicalJobInputFromSlicerResult({ result, modelName, printer, material, costEstimate } = {}) {
  const seconds = optionalNonNegativeNumber(result?.stats?.timeSeconds);
  const grams = optionalNonNegativeNumber(result?.stats?.filamentGrams);
  const model = String(modelName ?? "").trim();
  const name = model.replace(/\.(stl|3mf)$/i, "") || model;

  return {
    name,
    model,
    printer,
    material,
    estimatedMinutes: seconds === null ? null : Math.ceil(seconds / 60),
    estimatedGrams: grams,
    costEstimate,
    status: "queued",
    origin: "local-slice",
    engine: result?.engine,
    engineVersion: result?.engineVersion,
    notes: "Criado a partir do resultado do motor de fatiamento; o G-code permanece como arquivo exportável separado.",
  };
}

export function createTechnicalJobsService(repository) {
  assertTechnicalJobRepository(repository);
  const loaded = repository.load();
  let jobs = normalizeTechnicalPrintJobs(Array.isArray(loaded) ? loaded : localPreviewJobs);
  const listeners = new Set();
  const notify = () => { for (const listener of listeners) listener(); };
  const persist = () => { repository.save(jobs); notify(); };

  return Object.freeze({
    list: () => jobs,
    subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("O listener de trabalhos técnicos precisa ser uma função.");
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    add(input) {
      const job = createTechnicalPrintJob(input);
      jobs = normalizeTechnicalPrintJobs([job, ...jobs]);
      persist();
      return job;
    },
    setStatus(id, status) {
      if (!isTechnicalPrintJobStatus(status)) throw new TypeError("Estado de trabalho técnico inválido.");
      const index = jobs.findIndex(job => job.id === id);
      if (index < 0) return null;
      jobs = normalizeTechnicalPrintJobs(jobs.map(job => job.id === id ? { ...job, status } : job));
      persist();
      return jobs.find(job => job.id === id) ?? null;
    },
    move(id, direction) {
      const index = jobs.findIndex(job => job.id === id);
      const target = index + (direction === "up" ? -1 : 1);
      if (index < 0 || !["up", "down"].includes(direction) || target < 0 || target >= jobs.length) return false;
      const next = [...jobs];
      [next[index], next[target]] = [next[target], next[index]];
      jobs = normalizeTechnicalPrintJobs(next);
      persist();
      return true;
    },
  });
}
