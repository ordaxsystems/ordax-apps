import { assessSlicerProfileCompatibility } from "./profile-compatibility.mjs";
import { isSupportedInfillPattern } from "../../shared/infill-patterns.mjs";

const MAX_GCODE_BYTES = 512 * 1024 * 1024;
const PROCESS_SCHEMA = "ordax.slicer-processes/8";
const OBJECT_TRANSFORM_SCHEMA = "ordax.object-transforms/1";
const PROFILE_SELECTION_SCHEMA = "ordax.slicer-profile-selection/1";
const PROFILE_KINDS = Object.freeze(["machine", "process", "filament"]);
const EXECUTION_TARGETS = new Set(["device", "server"]);

function executionTargetLabel(status, executionTarget) {
  if (executionTarget === "device") return "Este dispositivo";
  if (typeof status?.executionTargetLabel !== "string") return null;
  const label = status.executionTargetLabel.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 120);
  return label || null;
}

export function formatSliceProgress(progress) {
  const stage = typeof progress?.stage === "string"
    ? progress.stage.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 120)
    : "";
  const rawPercent = progress?.percent;
  const percent = rawPercent !== null && rawPercent !== undefined && rawPercent !== "" && Number.isFinite(Number(rawPercent))
    ? Math.round(Math.max(0, Math.min(100, Number(rawPercent))))
    : null;
  if (percent === null) return `Fatiamento em andamento${stage ? ` · ${stage}` : ""}`;
  return `Fatiamento em andamento · ${percent}%${stage ? ` · ${stage}` : ""}`;
}

function reportProgress(callback, progress) {
  try { callback?.(Object.freeze(progress)); } catch {}
}

function localOutputFilename(value) {
  const leaf = String(value || "ordax-print").split(/[\\/]/).pop();
  const stem = leaf.replace(/\.[^.]+$/, "").replace(/[^\p{L}\p{N}._ -]/gu, "_").trim().slice(0, 120);
  return `${stem || "ordax-print"}.gcode`;
}

function publicProcessSettings(settings) {
  return {
    quality: settings.quality,
    layerHeight: settings.layerHeight,
    walls: settings.walls,
    topShellLayers: settings.topShellLayers,
    bottomShellLayers: settings.bottomShellLayers,
    topShellThickness: settings.topShellThickness,
    bottomShellThickness: settings.bottomShellThickness,
    brimType: settings.brimType,
    brimWidth: settings.brimWidth,
    brimGap: settings.brimGap,
    infill: settings.infill,
    infillPattern: settings.infillPattern,
    supports: settings.supports,
    supportType: settings.supportType,
    supportThresholdAngle: settings.supportThresholdAngle,
    supportOnBuildPlateOnly: settings.supportOnBuildPlateOnly,
    fanMinSpeedPercent: settings.fanMinSpeedPercent,
    fanMaxSpeedPercent: settings.fanMaxSpeedPercent,
  };
}

function remoteSliceRequest(request) {
  const objectIds = new Map(request.objects.map((object, index) => [object.id, `object-${index + 1}`]));
  return {
    filename: "ordax-print.stl",
    format: "STL",
    preparedModel: { file: request.preparedModel.file, triangleCount: request.preparedModel.triangleCount },
    settings: publicProcessSettings(request.settings),
    processesSchema: request.processesSchema,
    objects: request.objects.map((object, index) => ({
      id: `object-${index + 1}`,
      sourceObjectId: `source-${index + 1}`,
      buildItemIndex: index,
      triangleCount: object.triangleCount,
    })),
    objectTransformsSchema: request.objectTransformsSchema,
    objectTransforms: request.objectTransforms.map(transform => ({
      objectId: objectIds.get(transform.objectId),
      offsetMm: [...transform.offsetMm],
      rotationDeg: [...transform.rotationDeg],
      scale: transform.scale,
    })),
    processes: request.processes.map((process, index) => ({
      id: `process-${index + 1}`,
      objectIds: process.objectIds.map(objectId => objectIds.get(objectId)),
      settings: publicProcessSettings(process.settings),
    })),
    profileSelectionSchema: request.profileSelectionSchema,
    profileIds: Object.fromEntries(PROFILE_KINDS.map(kind => [kind, request.profileIds[kind]])),
  };
}

function validProfileCatalogs(profiles) {
  if (!profiles || typeof profiles !== "object") return false;
  return PROFILE_KINDS.every(kind => {
    const catalog = profiles[kind]?.catalog;
    return Array.isArray(catalog) && catalog.length > 0 && catalog.length <= 32
      && catalog.every(profile => profile && typeof profile.id === "string" && new RegExp(`^orca-${kind}-[a-f0-9]{24}$`).test(profile.id) && typeof profile.name === "string");
  });
}

function validateProfileSelection(request, status) {
  if (request.profileSelectionSchema !== PROFILE_SELECTION_SCHEMA || !request.profileIds || typeof request.profileIds !== "object" || Array.isArray(request.profileIds)) throw new Error("Selecione os perfis reais de máquina, processo e filamento.");
  for (const kind of PROFILE_KINDS) {
    const selected = request.profileIds[kind];
    if (!status.profiles[kind].catalog.some(profile => profile.id === selected)) throw new Error(`O perfil de ${kind} não está no catálogo disponível do motor. Atualize os perfis e tente novamente.`);
  }
}

function validateSelectedProfileCompatibility(request, status) {
  const selected = Object.fromEntries(PROFILE_KINDS.map(kind => {
    const catalog = status.profiles[kind].catalog;
    return [kind, catalog.find(profile => profile.id === request.profileIds[kind])];
  }));
  const assessment = assessSlicerProfileCompatibility({
    machine: selected.machine,
    process: selected.process,
    filament: selected.filament,
  });
  if (assessment.status !== "compatible") throw new Error(assessment.reason);
}

function validateProcessAssignmentRequest(request) {
  if (request.processesSchema !== PROCESS_SCHEMA || !Array.isArray(request.objects) || !request.objects.length || request.objects.length > 500 || !Array.isArray(request.processes) || !request.processes.length || request.processes.length > 100) {
    throw new Error("A solicitação não contém a lista de objetos e processos de impressão compatível com este app.");
  }
  const objectIds = new Set();
  for (const object of request.objects) {
    if (!object || typeof object.id !== "string" || !/^[a-z0-9_-]{1,128}$/i.test(object.id) || objectIds.has(object.id) || typeof object.sourceObjectId !== "string" || !/^[a-z0-9._-]{1,128}$/i.test(object.sourceObjectId) || !Number.isInteger(object.buildItemIndex) || object.buildItemIndex < 0 || !Number.isInteger(object.triangleCount) || object.triangleCount < 1) {
      throw new Error("A lista de objetos contém identificadores ou contagens inválidas.");
    }
    objectIds.add(object.id);
  }
  if (request.objectTransformsSchema !== OBJECT_TRANSFORM_SCHEMA || !Array.isArray(request.objectTransforms) || request.objectTransforms.length !== objectIds.size) {
    throw new Error("A solicitação não contém as transformações individuais de todas as peças.");
  }
  const transformed = new Set();
  for (const transform of request.objectTransforms) {
    if (!transform || typeof transform.objectId !== "string" || !objectIds.has(transform.objectId) || transformed.has(transform.objectId)
      || !Array.isArray(transform.offsetMm) || transform.offsetMm.length !== 3 || transform.offsetMm.some(value => !Number.isFinite(value) || value < -500 || value > 500)
      || !Array.isArray(transform.rotationDeg) || transform.rotationDeg.length !== 3 || transform.rotationDeg.some(value => !Number.isInteger(value) || value < 0 || value > 359)
      || !Number.isFinite(transform.scale) || transform.scale < 0.1 || transform.scale > 3) {
      throw new Error("Uma transformação de peça contém posição, rotação ou escala inválida.");
    }
    transformed.add(transform.objectId);
  }
  const assigned = new Set(), processIds = new Set();
  for (const process of request.processes) {
    if (!process || typeof process.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/i.test(process.id) || processIds.has(process.id) || !Array.isArray(process.objectIds) || !process.objectIds.length || !process.settings || typeof process.settings !== "object") {
      throw new Error("Um processo está incompleto ou sem objetos atribuídos.");
    }
    processIds.add(process.id);
    const settings = process.settings;
    if (!["standard", "fine", "draft", "profile", "custom"].includes(settings.quality) || !Number.isFinite(settings.layerHeight) || settings.layerHeight < 0.08 || settings.layerHeight > 0.4 || !Number.isInteger(settings.walls) || settings.walls < 1 || settings.walls > 8 || !Number.isInteger(settings.topShellLayers) || settings.topShellLayers < 0 || settings.topShellLayers > 20 || !Number.isInteger(settings.bottomShellLayers) || settings.bottomShellLayers < 0 || settings.bottomShellLayers > 20 || !Number.isFinite(settings.topShellThickness) || settings.topShellThickness < 0 || settings.topShellThickness > 10 || !Number.isFinite(settings.bottomShellThickness) || settings.bottomShellThickness < 0 || settings.bottomShellThickness > 10 || !(settings.brimType === null || ["outer_only", "inner_only", "outer_and_inner", "no_brim"].includes(settings.brimType)) || !(settings.brimWidth === null || Number.isFinite(settings.brimWidth) && settings.brimWidth >= 0 && settings.brimWidth <= 20) || !(settings.brimGap === null || Number.isFinite(settings.brimGap) && settings.brimGap >= 0 && settings.brimGap <= 10) || !Number.isFinite(settings.infill) || settings.infill < 0 || settings.infill > 100 || !isSupportedInfillPattern(settings.infillPattern) || typeof settings.supports !== "boolean" || !["normal(auto)", "tree(auto)"].includes(settings.supportType) || !Number.isInteger(settings.supportThresholdAngle) || settings.supportThresholdAngle < 0 || settings.supportThresholdAngle > 90 || typeof settings.supportOnBuildPlateOnly !== "boolean" || !Number.isInteger(settings.fanMinSpeedPercent) || settings.fanMinSpeedPercent < 0 || settings.fanMinSpeedPercent > 100 || !Number.isInteger(settings.fanMaxSpeedPercent) || settings.fanMaxSpeedPercent < settings.fanMinSpeedPercent || settings.fanMaxSpeedPercent > 100) {
      throw new Error(`As configurações do ${String(process.name || "processo").slice(0, 80)} estão fora dos limites deste app.`);
    }
    for (const objectId of process.objectIds) {
      if (!objectIds.has(objectId) || assigned.has(objectId)) throw new Error("Cada objeto precisa pertencer a exatamente um processo válido.");
      assigned.add(objectId);
    }
  }
  if (assigned.size !== objectIds.size) throw new Error("Há objetos sem processo de impressão atribuído.");
}

export function hasCompleteProcessAssignment(processes, objects) {
  if (!Array.isArray(processes) || !processes.length || processes.length > 100 || !Array.isArray(objects) || !objects.length || objects.length > 500) return false;
  const objectIds = new Set();
  for (const object of objects) {
    if (typeof object?.id !== "string" || !object.id || objectIds.has(object.id)) return false;
    objectIds.add(object.id);
  }
  const assigned = new Set();
  for (const process of processes) {
    if (!Array.isArray(process?.objectIds) || !process.objectIds.length) return false;
    for (const objectId of process.objectIds) {
      if (typeof objectId !== "string" || !objectIds.has(objectId) || assigned.has(objectId)) return false;
      assigned.add(objectId);
    }
  }
  return assigned.size === objectIds.size;
}

export async function readSlicerStatus(port) {
  if (!port || typeof port.getStatus !== "function" || typeof port.slice !== "function") {
    return Object.freeze({ available: false, engine: null, version: null, executionTarget: "unknown", reason: "Este host ainda não conectou um motor de fatiamento." });
  }
  try {
    const status = await port.getStatus();
    const executionTarget = EXECUTION_TARGETS.has(status?.executionTarget) ? status.executionTarget : "unknown";
    const targetLabel = executionTargetLabel(status, executionTarget);
    if (!status || status.available !== true || typeof status.engine !== "string" || typeof status.version !== "string" || !validProfileCatalogs(status.profiles)) {
      return Object.freeze({ available: false, engine: status?.engine ?? null, version: status?.version ?? null, executionTarget, executionTargetLabel: targetLabel, reason: String(status?.reason || "O motor não está pronto para receber um trabalho.") });
    }
    if (executionTarget === "unknown") {
      return Object.freeze({ available: false, engine: status.engine, version: status.version, executionTarget, executionTargetLabel: null, reason: "O host precisa informar se o motor executará neste dispositivo ou em um servidor web." });
    }
    if (executionTarget === "server" && !targetLabel) {
      return Object.freeze({ available: false, engine: status.engine, version: status.version, executionTarget, executionTargetLabel: null, reason: "O host web precisa identificar o servidor de fatiamento antes de receber a malha." });
    }
    return Object.freeze({ ...status, available: true, engine: status.engine, version: status.version, executionTarget, executionTargetLabel: targetLabel, reason: "" });
  } catch (error) {
    return Object.freeze({ available: false, engine: null, version: null, executionTarget: "unknown", executionTargetLabel: null, reason: `Não foi possível consultar o motor: ${error?.message || "falha de comunicação"}` });
  }
}

export async function requestRealSlice(port, request, { signal, onProgress } = {}) {
  if (!port || typeof port.slice !== "function") throw new Error("Este host não oferece um motor de fatiamento.");
  if (!(request?.file instanceof Blob) || request.file.size <= 0) throw new Error("Selecione um modelo antes de fatiar.");
  if (!(request?.preparedModel?.file instanceof Blob) || request.preparedModel.file.size <= 0 || request.preparedModel.file.size > 16 * 1024 * 1024) {
    throw new Error("A geometria transformada do trabalho não está pronta para o motor.");
  }
  const expectedTriangles = request.objects?.reduce((sum, object) => sum + object.triangleCount, 0);
  if (!Number.isInteger(expectedTriangles) || request.preparedModel.triangleCount !== expectedTriangles) {
    throw new Error("A malha enviada ao motor não corresponde às peças do projeto.");
  }
  if (signal?.aborted) throw new DOMException("Fatiamento cancelado.", "AbortError");
  validateProcessAssignmentRequest(request);
  const status = await readSlicerStatus(port);
  if (!status.available) throw new Error(status.reason);
  validateProfileSelection(request, status);
  validateSelectedProfileCompatibility(request, status);
  if (status.executionTarget === "server" && request.remoteExecutionApproved !== status.executionTargetLabel) {
    throw new Error("Confirme o envio da malha preparada ao servidor web identificado pelo host antes de fatiar.");
  }
  const { remoteExecutionApproved: _remoteExecutionApproved, ...localRequest } = request;
  const sliceRequest = status.executionTarget === "server" ? remoteSliceRequest(localRequest) : localRequest;
  reportProgress(onProgress, { stage: status.executionTarget === "server" ? "Enviando ao servidor identificado" : "Enviando ao motor local" });
  const result = await port.slice(sliceRequest, { signal, onProgress: progress => reportProgress(onProgress, progress) });
  if (signal?.aborted) throw new DOMException("Fatiamento cancelado.", "AbortError");
  if (!(result?.gcode instanceof Blob) || result.gcode.size <= 0 || result.gcode.size > MAX_GCODE_BYTES) {
    throw new Error("O motor não devolveu um G-code válido dentro do limite desta versão.");
  }
  if (result.engine !== status.engine || result.engineVersion !== status.version) {
    throw new Error("A identidade ou versão do motor mudou durante o fatiamento. Gere o trabalho novamente.");
  }
  reportProgress(onProgress, { stage: "Validando o G-code do motor" });
  const header = await result.gcode.slice(0, Math.min(result.gcode.size, 64 * 1024)).text();
  if (!/^\s*(?:;[^\r\n]*\r?\n\s*)*(?:G0?\d|M\d{2,})\b/m.test(header)) {
    throw new Error("A saída do motor não contém comandos reconhecíveis de impressão.");
  }
  reportProgress(onProgress, { percent: 100, stage: "G-code validado" });
  return Object.freeze({
    gcode: result.gcode,
    filename: status.executionTarget === "server" ? localOutputFilename(request.filename) : String(result.filename || localOutputFilename(request.filename)),
    executionTarget: status.executionTarget,
    engine: status.engine,
    engineVersion: status.version,
    printerProfile: result.printerProfile ?? null,
    filamentProfile: result.filamentProfile ?? null,
    processProfile: result.processProfile ?? null,
    profiles: status.profiles ?? null,
    stats: result.stats && typeof result.stats === "object" ? result.stats : null,
    diagnostics: Array.isArray(result.diagnostics) ? result.diagnostics.map(String).slice(0, 100) : [],
    completedAt: new Date().toISOString(),
  });
}

export const slicerPortRequirements = Object.freeze({
  methods: ["getStatus", "slice"],
  executionTargets: Object.freeze({ device: "O motor executa no dispositivo que hospeda o app.", server: "O motor executa em serviço web identificado por executionTargetLabel; cada job requer confirmação com esse rótulo." }),
  processSchema: PROCESS_SCHEMA,
  objectTransformsSchema: OBJECT_TRANSFORM_SCHEMA,
  profileSelectionSchema: PROFILE_SELECTION_SCHEMA,
  profileCompatibilitySchema: "ordax.slicer-profile-compatibility/1",
  profileSelection: "Cada job escolhe um ID ativo de máquina, processo e filamento dentre os catálogos que o host expôs.",
  profileCompatibility: "Cada perfil de processo e filamento expõe compatible_printers, compatible_prints e condições versionadas; o app verifica nomes exatos e bloqueia combinações incompatíveis ou expressões que ainda não avalia. O host valida novamente antes de iniciar o motor.",
  processAssignment: "Cada objeto deve ser atribuído a exatamente um processo; cada processo carrega suas próprias configurações. Em 3MF, objetos incluem sourceObjectId e buildItemIndex para que o motor relacione a atribuição aos itens da mesa do arquivo original.",
  objectTransforms: "Cada objeto tem uma transformação validada com offsetMm aplicado sobre a posição original do item, após a transformação global do projeto; rotationDeg usa XYZ e a escala uniforme gira em torno do centro geométrico da peça.",
  remoteSubmission: "Somente a malha STL transformada, settings permitidos, IDs de objetos/processos remapeados para o job e IDs de perfil são enviados; a aprovação precisa corresponder ao rótulo atual do servidor.",
  result: ["gcode: Blob", "engine", "engineVersion"],
  maxGcodeBytes: MAX_GCODE_BYTES,
});
