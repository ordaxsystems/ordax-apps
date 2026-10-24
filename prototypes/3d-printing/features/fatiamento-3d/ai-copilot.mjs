import { assessSlicerProfileCompatibility, PROFILE_COMPATIBILITY_SCHEMA } from "./profile-compatibility.mjs";

const PORT_SCHEMA = "ordax.intelligence/1";
const RESPONSE_SCHEMA = "ordax.intelligence-response/1";
const SUGGESTION_SCHEMA = "ordax.slicer-assistant-suggestion/7";
const ASSISTANT_RESPONSE_SCHEMA = "ordax.slicer-assistant-response/1";
export const assistantEvidenceIds = Object.freeze([
  "settings",
  "model.dimensionsMm",
  "model.printableSpaceFit",
  "model.triangleCount",
  "geometryDiagnostics.degenerateTriangleCount",
  "geometryDiagnostics.boundaryEdgeCount",
  "geometryDiagnostics.nonManifoldEdgeCount",
  "geometryDiagnostics.nonManifoldVertexCount",
  "geometryDiagnostics.objectSummary",
  "geometryDiagnostics.inconsistentWindingEdgeCount",
  "geometryDiagnostics.surfaceAreaMm2",
  "selectedObject.sourceDimensionsMm",
  "selectedObject.surfaceAreaMm2",
  "selectedObject.transform",
  "printerProfile.bedMm",
  "materialProfile.nozzleRange",
  "materialProfile.bedRange",
  "latestSlice.stats.timeSeconds",
  "latestSlice.stats.filamentGrams",
  "latestSlice.stats.filamentMeters",
  "latestSlice.stats.featureBreakdown",
  "slicer.configuredProfiles",
]);
const assistantEvidenceIdSet = new Set(assistantEvidenceIds);
const MAX_CONTEXT_ITEMS = 16;
const MAX_CONTEXT_ITEM_CHARS = 8192;
const MAX_CONTEXT_TOTAL_CHARS = 65536;
const MAX_PROFILE_CONTEXT_CHARS = 7800;
export const assistantProfileOptionLimit = 24;
export const assistantMeshObjectLimit = 12;

const nullable = schema => ({ anyOf: [schema, { type: "null" }] });
const nullableInteger = (minimum, maximum) => nullable({ type: "integer", minimum, maximum });

function profileNumber(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  return Number(Number(value).toFixed(2));
}

function profileCompatibilityValues(profile) {
  const compatibility = profile?.compatibility;
  if (compatibility?.schema !== PROFILE_COMPATIBILITY_SCHEMA) return { verifiedMetadata: false };
  const list = entry => {
    if (!entry || typeof entry.present !== "boolean") return { verified: false };
    if (!entry.present) return { present: false, names: [] };
    if (!Array.isArray(entry.names)) return { present: true, verified: false };
    return { present: true, names: entry.names.slice(0, 3).map(name => String(name).slice(0, 100)), omitted: Math.max(0, entry.names.length - 3) };
  };
  const expressionPresent = entry => {
    if (!entry || typeof entry !== "object" || typeof entry.present !== "boolean") return true;
    if (!entry.present) return false;
    return !Array.isArray(entry.values) || entry.values.some(value => typeof value !== "string" || value.trim());
  };
  const printerCondition = compatibility.compatiblePrintersCondition;
  const processCondition = compatibility.compatiblePrintsCondition;
  return {
    schema: compatibility.schema,
    inheritedFrom: compatibility.parentName || null,
    machinePresetSource: compatibility.isSystem === true ? "system" : compatibility.isSystem === false ? "user" : "unknown",
    compatiblePrinters: list(compatibility.compatiblePrinters),
    printerConditionRequiresEvaluation: !printerCondition || typeof printerCondition.present !== "boolean"
      || (printerCondition.present && typeof printerCondition.value !== "string")
      || Boolean(printerCondition.value?.trim()),
    compatiblePrints: list(compatibility.compatiblePrints),
    processConditionRequiresEvaluation: !processCondition || typeof processCondition.present !== "boolean"
      || (processCondition.present && typeof processCondition.value !== "string")
      || Boolean(processCondition.value?.trim()),
    machineExpressionGroupRequiresEvaluation: expressionPresent(compatibility.compatibleMachineExpressionGroup),
    processExpressionGroupRequiresEvaluation: expressionPresent(compatibility.compatibleProcessExpressionGroup),
  };
}

function profileValues(kind, profile) {
  const common = {
    id: profile.id,
    name: String(profile.name || profile.id).slice(0, 80),
    compatibility: profileCompatibilityValues(profile),
    inheritance: profile.inheritance?.status === "unresolved"
      ? { status: "unresolved", parentName: String(profile.inheritance.parentName || "").slice(0, 120) }
      : { status: profile.inheritance?.status === "resolved" ? "resolved" : "not-required", parents: Array.isArray(profile.inheritance?.parents) ? profile.inheritance.parents.slice(0, 8).map(name => String(name).slice(0, 100)) : [] },
  };
  if (kind === "machine") return {
    ...common,
    bedSizeMm: Array.isArray(profile.bedSizeMm) ? profile.bedSizeMm.slice(0, 2).map(profileNumber) : null,
    heightMm: profileNumber(profile.heightMm),
    nozzleDiameterMm: profileNumber(profile.nozzleDiameterMm),
  };
  if (kind === "process") return {
    ...common,
    layerHeightMm: profileNumber(profile.layerHeightMm),
    wallLoops: profileNumber(profile.wallLoops),
    processSettings: profile.processSettings && typeof profile.processSettings === "object" ? {
      layerHeightMm: profileNumber(profile.processSettings.layerHeightMm),
      wallLoops: profileNumber(profile.processSettings.wallLoops),
      sparseInfillDensityPercent: profileNumber(profile.processSettings.sparseInfillDensityPercent),
      supports: typeof profile.processSettings.supports === "boolean" ? profile.processSettings.supports : null,
      supportType: typeof profile.processSettings.supportType === "string" ? profile.processSettings.supportType.slice(0, 32) : null,
      supportThresholdAngle: profileNumber(profile.processSettings.supportThresholdAngle),
      supportOnBuildPlateOnly: typeof profile.processSettings.supportOnBuildPlateOnly === "boolean" ? profile.processSettings.supportOnBuildPlateOnly : null,
      fanMinSpeedPercent: profileNumber(profile.processSettings.fanMinSpeedPercent),
      fanMaxSpeedPercent: profileNumber(profile.processSettings.fanMaxSpeedPercent),
    } : null,
  };
  return {
    ...common,
    type: String(profile.type || "").slice(0, 40) || null,
    nozzleTemperatureC: Array.isArray(profile.nozzleTemperatureC) ? profile.nozzleTemperatureC.slice(0, 4).map(profileNumber) : null,
    bedTemperatureC: Array.isArray(profile.bedTemperatureC) ? profile.bedTemperatureC.slice(0, 4).map(profileNumber) : null,
  };
}

export function buildAssistantProfileContext(catalogs = {}, selectedIds = {}) {
  const names = { machine: "machines", process: "processes", filament: "filaments" };
  const context = [];
  const allowedProfiles = {};
  const visibleProfiles = {};
  const selectedProfileIds = {};
  for (const kind of Object.keys(names)) {
    const catalog = Array.isArray(catalogs?.[kind]?.catalog) ? catalogs[kind].catalog : [];
    const selected = catalog.find(profile => profile.id === selectedIds?.[kind]);
    const ordered = [...(selected ? [selected] : []), ...catalog.filter(profile => profile !== selected)];
    const profiles = [];
    const validationProfiles = [];
    const seen = new Set();
    for (const profile of ordered) {
      if (!profile || typeof profile.id !== "string" || !new RegExp(`^orca-${kind}-[a-f0-9]{24}$`).test(profile.id) || seen.has(profile.id)) continue;
      const summary = profileValues(kind, profile);
      const next = [...profiles, summary];
      const text = JSON.stringify({ slicer: { configuredProfiles: { catalogs: { [names[kind]]: next } } } });
      if (profiles.length >= assistantProfileOptionLimit || text.length > MAX_PROFILE_CONTEXT_CHARS) break;
      profiles.push(summary);
      validationProfiles.push(Object.freeze({ id: profile.id, name: String(profile.name || profile.id), compatibility: profile.compatibility, inheritance: profile.inheritance }));
      seen.add(profile.id);
    }
    allowedProfiles[kind] = profiles.map(profile => profile.id);
    visibleProfiles[kind] = validationProfiles;
    selectedProfileIds[kind] = selected?.id && allowedProfiles[kind].includes(selected.id) ? selected.id : null;
    if (profiles.length) {
      context.push(Object.freeze({
        id: `slicer-profile-catalog-${kind}`,
        scope: "document",
        text: JSON.stringify({ slicer: { configuredProfiles: { catalogs: { [names[kind]]: profiles } } } }),
        provenance: "ordax-apps:3d-printing:fatiamento-3d:local-profile-catalog",
      }));
    }
  }
  return Object.freeze({
    context: Object.freeze(context),
    allowedProfiles: Object.freeze(allowedProfiles),
    visibleProfiles: Object.freeze(visibleProfiles),
    selectedProfileIds: Object.freeze(selectedProfileIds),
  });
}

export function buildAssistantMeshSummary({ objects, geometryDiagnostics, selectedObjectId, getSurfaceAreaMm2 } = {}) {
  if (!Array.isArray(objects) || !geometryDiagnostics) return null;
  const areas = new Map((geometryDiagnostics.surfaceAreaByObject || []).map(item => [item.objectId, item]));
  const edges = new Map((geometryDiagnostics.edgeIncidenceByObject || []).map(item => [item.objectId, item]));
  const links = new Map((geometryDiagnostics.vertexLinksByObject || []).map(item => [item.objectId, item]));
  const candidates = objects.map((object, index) => {
    const area = areas.get(object.id), edge = edges.get(object.id), vertexLinks = links.get(object.id);
    const edgeCounts = edge?.checked ? {
      checked: true,
      boundaryEdgeCount: edge.boundaryEdgeCount,
      nonManifoldEdgeCount: edge.nonManifoldEdgeCount,
      inconsistentWindingEdgeCount: edge.inconsistentWindingEdgeCount,
    } : { checked: false, boundaryEdgeCount: null, nonManifoldEdgeCount: null, inconsistentWindingEdgeCount: null };
    const vertexCounts = vertexLinks?.checked ? {
      checked: true,
      checkedVertexCount: vertexLinks.checkedVertexCount,
      boundaryVertexCount: vertexLinks.boundaryVertexCount,
      interiorVertexCount: vertexLinks.interiorVertexCount,
      nonManifoldVertexCount: vertexLinks.nonManifoldVertexCount,
    } : { checked: false, checkedVertexCount: null, boundaryVertexCount: null, interiorVertexCount: null, nonManifoldVertexCount: null };
    const degenerateTriangleCount = Number.isInteger(area?.degenerateTriangleCount) ? area.degenerateTriangleCount : null;
    const triangleCount = Number.isInteger(area?.triangleCount) ? area.triangleCount : Math.floor((object.positions?.length || 0) / 9);
    const areaMm2 = typeof getSurfaceAreaMm2 === "function" ? getSurfaceAreaMm2(object.id) : null;
    const selected = object.id === selectedObjectId;
    const issueScore = (degenerateTriangleCount || 0) * 8
      + (edgeCounts.nonManifoldEdgeCount || 0) * 5
      + (vertexCounts.nonManifoldVertexCount || 0) * 5
      + (edgeCounts.inconsistentWindingEdgeCount || 0) * 3
      + (edgeCounts.boundaryEdgeCount || 0) * 0.25;
    return {
      item: index + 1,
      selected,
      triangleCount,
      degenerateTriangleCount,
      surfaceAreaMm2: Number.isFinite(areaMm2) && areaMm2 >= 0 ? Number(areaMm2.toFixed(2)) : null,
      edgeIncidence: edgeCounts,
      vertexLinks: vertexCounts,
      issueScore,
    };
  });
  candidates.sort((a, b) => Number(b.selected) - Number(a.selected) || b.issueScore - a.issueScore || a.item - b.item);
  const items = candidates.slice(0, assistantMeshObjectLimit).map(({ issueScore, ...item }) => Object.freeze(item));
  return Object.freeze({
    method: "local-per-object-mesh-summary/1",
    itemOrder: "selected-then-review-signals; item-is-original-index",
    totalObjectCount: objects.length,
    includedObjectCount: items.length,
    omittedObjectCount: Math.max(0, objects.length - items.length),
    items: Object.freeze(items),
  });
}

export const assistantStructuredOutput = Object.freeze({
  name: "ordax_slicer_assistant_response",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      schema: { type: "string", enum: [ASSISTANT_RESPONSE_SCHEMA] },
      answer: { type: "string" },
      suggestion: nullable({
        type: "object",
        additionalProperties: false,
        properties: {
          schema: { type: "string", enum: [SUGGESTION_SCHEMA] },
          summary: { type: "string" },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
          evidence: { type: "array", items: { type: "string", enum: [...assistantEvidenceIds] } },
          settings: nullable({
            type: "object",
            additionalProperties: false,
            properties: {
              quality: nullable({ type: "string", enum: ["standard", "fine", "draft"] }),
              layerHeight: nullable({ type: "number", minimum: 0.08, maximum: 0.4 }),
              walls: nullableInteger(1, 8),
              infill: nullableInteger(0, 100),
              supports: nullable({ type: "boolean" }),
              supportType: nullable({ type: "string", enum: ["normal(auto)", "tree(auto)"] }),
              supportThresholdAngle: nullableInteger(0, 90),
              supportOnBuildPlateOnly: nullable({ type: "boolean" }),
              fanMinSpeedPercent: nullableInteger(0, 100),
              fanMaxSpeedPercent: nullableInteger(0, 100),
            },
            required: ["quality", "layerHeight", "walls", "infill", "supports", "supportType", "supportThresholdAngle", "supportOnBuildPlateOnly", "fanMinSpeedPercent", "fanMaxSpeedPercent"],
          }),
          transform: nullable({
            type: "object",
            additionalProperties: false,
            properties: {
              x: nullableInteger(-500, 500),
              y: nullableInteger(-500, 500),
              z: nullableInteger(-500, 500),
              rotationX: nullableInteger(0, 359),
              rotationY: nullableInteger(0, 359),
              rotationZ: nullableInteger(0, 359),
              scalePercent: nullableInteger(10, 300),
            },
            required: ["x", "y", "z", "rotationX", "rotationY", "rotationZ", "scalePercent"],
          }),
          profiles: nullable({
            type: "object",
            additionalProperties: false,
            properties: {
              machine: nullable({ type: "string", maxLength: 64 }),
              process: nullable({ type: "string", maxLength: 64 }),
              filament: nullable({ type: "string", maxLength: 64 }),
            },
            required: ["machine", "process", "filament"],
          }),
        },
          required: ["schema", "summary", "confidence", "evidence", "settings", "transform", "profiles"],
      }),
    },
    required: ["schema", "answer", "suggestion"],
  },
});

function setupHint(port) {
  try {
    const hint = port?.getSetupHint?.();
    return typeof hint === "string" && hint.trim() ? hint.trim().slice(0, 500) : "";
  } catch { return ""; }
}

function boundedText(value, label, max) {
  if (typeof value !== "string" || value.includes("\0")) throw new TypeError(`${label} precisa ser texto válido.`);
  const text = value.trim();
  if (!text || text.length > max) throw new TypeError(`${label} excede o limite permitido.`);
  return text;
}

export function intelligenceState(port) {
  if (!port || port.schema !== PORT_SCHEMA || typeof port.getSnapshot !== "function" || typeof port.subscribe !== "function" || typeof port.respond !== "function") {
    return { available: false, label: "Não conectado", reason: "Este host ainda não forneceu a porta pública OrdaX Intelligence." };
  }
  try {
    const snapshot = port.getSnapshot();
    if (!snapshot || snapshot.schema !== PORT_SCHEMA || snapshot.authority !== "none" || snapshot.toolExecution !== false) {
      return { available: false, label: "Contrato incompatível", reason: "A porta não corresponde ao contrato consultivo do OrdaX Intelligence." };
    }
    if (!["degraded", "ready", "busy", "error"].includes(snapshot.state)) {
      return { available: false, label: "Contrato incompatível", reason: "O Intelligence informou um estado que este app não reconhece." };
    }
    if (snapshot.state !== "ready" || snapshot.inferenceAvailable !== true) {
      const state = snapshot.state === "busy" ? "ocupado" : snapshot.state === "error" ? "com erro" : snapshot.state === "degraded" ? "indisponível no momento" : "sem inferência disponível";
      return { available: false, label: snapshot.state === "busy" ? "Ocupado" : "Indisponível", reason: setupHint(port) || `OrdaX Intelligence está ${state}.` };
    }
    if (typeof snapshot.engineId !== "string" || typeof snapshot.modelId !== "string") {
      return { available: false, label: "Contrato incompleto", reason: "A porta não informou o provedor e o modelo ativos." };
    }
    return { available: true, label: `${snapshot.engineId} · ${snapshot.modelId}`, reason: "" };
  } catch (error) {
    return { available: false, label: "Falha de conexão", reason: error?.message || "Não foi possível consultar o serviço de IA." };
  }
}

function validateContext(context) {
  if (!Array.isArray(context) || context.length > MAX_CONTEXT_ITEMS) throw new TypeError("O contexto da IA excede os limites do contrato.");
  let total = 0;
  return context.map(item => {
    if (!item || !["user", "workspace", "system", "document"].includes(item.scope)) throw new TypeError("O escopo de contexto da IA é inválido.");
    const id = boundedText(item.id, "Identificador de contexto", 160);
    const text = boundedText(item.text, "Contexto da IA", MAX_CONTEXT_ITEM_CHARS);
    const provenance = boundedText(item.provenance, "Origem do contexto", 512);
    total += text.length;
    if (total > MAX_CONTEXT_TOTAL_CHARS) throw new TypeError("O contexto total da IA excede o limite do contrato.");
    return Object.freeze({ id, scope: item.scope, text, provenance });
  });
}

export async function askSliceIntelligence(port, { prompt, context, signal }) {
  const state = intelligenceState(port);
  if (!state.available) throw new Error(state.reason);
  const request = {
    intent: "diagnose",
    prompt: boundedText(prompt, "Pergunta", 12000),
    context: validateContext(context),
    maxTokens: 768,
  };
  const response = await port.respond(request, { signal });
  if (!response || response.schema !== RESPONSE_SCHEMA || response.authority !== "none") {
    throw new Error("A resposta não corresponde ao contrato consultivo do OrdaX Intelligence.");
  }
  return Object.freeze({
    text: boundedText(response.text, "Resposta da IA", 16000),
    engineId: boundedText(response.engineId, "Provedor da IA", 80),
    modelId: boundedText(response.modelId, "Modelo de IA", 160),
  });
}

function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const source = fenced || text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  if (!source || source === text && !text.includes("{")) return null;
  try { return JSON.parse(source); } catch { return null; }
}

function validateSuggestion(value, { allowedEvidence = null, allowedProfiles = null } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some(key => !["schema", "summary", "confidence", "evidence", "settings", "transform", "profiles"].includes(key))
    || !Object.hasOwn(value, "profiles")
    || value.schema !== SUGGESTION_SCHEMA || typeof value.summary !== "string" || !value.summary.trim()
    || !["low", "medium", "high"].includes(value.confidence)) return null;
  if (!Array.isArray(value.evidence) || value.evidence.length < 1 || value.evidence.length > 5
    || new Set(value.evidence).size !== value.evidence.length
    || value.evidence.some(id => !assistantEvidenceIdSet.has(id) || (allowedEvidence && !allowedEvidence.has(id)))) return null;
  const source = value.settings ?? {};
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const settings = {};
  const validators = {
    quality: item => ["standard", "fine", "draft"].includes(item),
    layerHeight: item => Number.isFinite(item) && item >= 0.08 && item <= 0.4,
    walls: item => Number.isInteger(item) && item >= 1 && item <= 8,
    infill: item => Number.isInteger(item) && item >= 0 && item <= 100,
    supports: item => typeof item === "boolean",
    supportType: item => ["normal(auto)", "tree(auto)"].includes(item),
    supportThresholdAngle: item => Number.isInteger(item) && item >= 0 && item <= 90,
    supportOnBuildPlateOnly: item => typeof item === "boolean",
    fanMinSpeedPercent: item => Number.isInteger(item) && item >= 0 && item <= 100,
    fanMaxSpeedPercent: item => Number.isInteger(item) && item >= 0 && item <= 100,
  };
  for (const [key, item] of Object.entries(source)) {
    if (!Object.hasOwn(validators, key)) return null;
    if (item === null) continue;
    if (!validators[key] || !validators[key](item)) return null;
    const settingKey = key === "fanMinSpeedPercent" ? "fanMin" : key === "fanMaxSpeedPercent" ? "fanMax" : key;
    settings[settingKey] = item;
  }
  if (settings.fanMin !== undefined && settings.fanMax !== undefined && settings.fanMin > settings.fanMax) return null;
  const transformSource = value.transform ?? null;
  if (transformSource !== null && (!transformSource || typeof transformSource !== "object" || Array.isArray(transformSource))) return null;
  const transform = {};
  const transformValidators = {
    x: item => Number.isInteger(item) && item >= -500 && item <= 500,
    y: item => Number.isInteger(item) && item >= -500 && item <= 500,
    z: item => Number.isInteger(item) && item >= -500 && item <= 500,
    rotationX: item => Number.isInteger(item) && item >= 0 && item <= 359,
    rotationY: item => Number.isInteger(item) && item >= 0 && item <= 359,
    rotationZ: item => Number.isInteger(item) && item >= 0 && item <= 359,
    scalePercent: item => Number.isInteger(item) && item >= 10 && item <= 300,
  };
  for (const [key, item] of Object.entries(transformSource || {})) {
    if (!Object.hasOwn(transformValidators, key)) return null;
    if (item === null) continue;
    if (!transformValidators[key] || !transformValidators[key](item)) return null;
    transform[key] = item;
  }
  const profileSource = value.profiles ?? null;
  if (profileSource !== null && (!profileSource || typeof profileSource !== "object" || Array.isArray(profileSource))) return null;
  const profileKeys = ["machine", "process", "filament"];
  if (profileSource && (Object.keys(profileSource).length !== profileKeys.length
    || Object.keys(profileSource).some(key => !profileKeys.includes(key))
    || profileKeys.some(key => !Object.hasOwn(profileSource, key)))) return null;
  const profiles = {};
  for (const kind of profileKeys) {
    const id = profileSource?.[kind] ?? null;
    if (id === null) continue;
    if (typeof id !== "string" || !new RegExp(`^orca-${kind}-[a-f0-9]{24}$`).test(id)) return null;
    const candidates = allowedProfiles?.[kind];
    if (!Array.isArray(candidates) || !candidates.includes(id)) return null;
    profiles[kind] = id;
  }
  if (Object.keys(profiles).length && (!allowedEvidence || !allowedEvidence.has("slicer.configuredProfiles"))) return null;
  if (!Object.keys(settings).length && !Object.keys(transform).length && !Object.keys(profiles).length) return null;
  return Object.freeze({
    summary: value.summary.trim().slice(0, 1200),
    confidence: value.confidence,
    evidence: Object.freeze([...value.evidence]),
    settings: Object.freeze(settings),
    transform: Object.freeze(transform),
    profiles: Object.freeze(profiles),
  });
}

export function parseAssistantSuggestion(text, { allowedEvidence = null, allowedProfiles = null } = {}) {
  const allowed = allowedEvidence ? new Set(allowedEvidence) : null;
  return validateSuggestion(extractJson(text), { allowedEvidence: allowed, allowedProfiles });
}

export function parseAssistantReply(text, { allowedEvidence = null, allowedProfiles = null, profileCatalogs = null, selectedProfileIds = null } = {}) {
  const value = extractJson(text);
  if (!value || Object.keys(value).some(key => !["schema", "answer", "suggestion"].includes(key)) || value.schema !== ASSISTANT_RESPONSE_SCHEMA || typeof value.answer !== "string" || value.answer.length > 16000) {
    throw new Error("A IA retornou uma resposta fora do formato estruturado do Copiloto. Tente novamente.");
  }
  const answer = value.answer.trim();
  const allowed = allowedEvidence ? new Set(allowedEvidence) : null;
  const suggestion = value.suggestion === null ? null : validateSuggestion(value.suggestion, { allowedEvidence: allowed, allowedProfiles });
  if (value.suggestion !== null && !suggestion) {
    throw new Error("A sugestão da IA não passou pela validação do app. Nenhuma configuração foi aplicada.");
  }
  if (suggestion && Object.keys(suggestion.profiles).length && profileCatalogs) {
    const selected = Object.fromEntries(["machine", "process", "filament"].map(kind => {
      const id = suggestion.profiles[kind] ?? selectedProfileIds?.[kind];
      const profile = Array.isArray(profileCatalogs[kind]) ? profileCatalogs[kind].find(item => item.id === id) : null;
      return [kind, profile || null];
    }));
    const compatibility = assessSlicerProfileCompatibility(selected);
    if (compatibility.status !== "compatible") {
      throw new Error(`A combinação de perfis proposta pela IA não passou pela validação: ${compatibility.reason} Nenhuma configuração foi aplicada.`);
    }
  }
  if (!answer && !suggestion) throw new Error("A IA retornou uma resposta vazia. Tente novamente.");
  return Object.freeze({ text: answer || suggestion.summary, suggestion });
}

export const assistantSuggestionSchema = SUGGESTION_SCHEMA;
