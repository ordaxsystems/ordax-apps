const measuredFields = new Set(["gramsPerUnit", "hoursPerUnit"]);

export function updateEstimateOriginForEdit(current = {}, field) {
  const next = {
    source: current.source === "slicer" ? "slicer" : "manual",
    scope: current.scope === "plate" ? "plate" : "piece",
    engine: String(current.engine ?? ""),
    engineVersion: String(current.engineVersion ?? ""),
  };

  if (measuredFields.has(field)) {
    next.source = "manual";
    next.engine = "";
    next.engineVersion = "";
  }

  return Object.freeze(next);
}
