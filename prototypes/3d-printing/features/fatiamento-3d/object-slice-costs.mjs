export function shouldCalculateIndividualCosts(slice) {
  return slice?.scope === "plate"
    && Number.isInteger(Number(slice.objectCount))
    && Number(slice.objectCount) > 1;
}

export function refreshObjectSliceCostEstimates(results, calculateFromSlice) {
  if (!Array.isArray(results)) return [];
  if (typeof calculateFromSlice !== "function") return results;
  return Object.freeze(results.map(item => {
    if (!item?.slice) return item;
    try {
      const estimate = calculateFromSlice(item.slice);
      return Object.freeze({
        ...item,
        estimate,
        error: estimate?.available ? "" : "O motor não retornou peso e tempo válidos para esta peça.",
      });
    } catch {
      return Object.freeze({ ...item, estimate: null, error: "Não foi possível atualizar o custo desta peça." });
    }
  }));
}

export function selectObjectsForIndependentSlice(model, draft, objectIds) {
  if (!model || !Array.isArray(model.objects) || !Array.isArray(objectIds) || !objectIds.length) {
    throw new TypeError("Selecione ao menos uma peça para calcular os custos individualmente.");
  }
  const requested = new Set(objectIds);
  if (requested.size !== objectIds.length) throw new TypeError("A lista de peças para cálculo contém IDs duplicados.");
  const objects = model.objects.filter(object => requested.has(object.id));
  if (objects.length !== requested.size) throw new TypeError("Uma peça selecionada não pertence ao projeto atual.");

  const owners = new Map();
  for (const process of Array.isArray(draft?.processes) ? draft.processes : []) {
    for (const objectId of process.objectIds ?? []) {
      if (!requested.has(objectId)) continue;
      if (owners.has(objectId)) throw new TypeError("Uma peça está atribuída a mais de um processo.");
      owners.set(objectId, process.id);
    }
  }
  if ([...requested].some(objectId => !owners.has(objectId))) {
    throw new TypeError("Atribua cada peça a um processo antes do cálculo individual.");
  }

  const processes = draft.processes.flatMap(process => {
    const selectedObjectIds = (process.objectIds ?? []).filter(objectId => requested.has(objectId));
    return selectedObjectIds.length ? [{ ...process, objectIds: selectedObjectIds }] : [];
  });
  return Object.freeze({
    model: Object.freeze({ ...model, objects: Object.freeze(objects) }),
    objects: Object.freeze(objects),
    processes: Object.freeze(processes),
  });
}
