const MAX_GCODE_BYTES = 512 * 1024 * 1024;
const PROCESS_SCHEMA = "ordax.slicer-processes/3";
const OBJECT_TRANSFORM_SCHEMA = "ordax.object-transforms/1";
const PROFILE_SELECTION_SCHEMA = "ordax.slicer-profile-selection/1";
const PROFILE_KINDS = Object.freeze(["machine", "process", "filament"]);

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
    if (!["standard", "fine", "draft"].includes(settings.quality) || !Number.isFinite(settings.layerHeight) || settings.layerHeight < 0.08 || settings.layerHeight > 0.4 || !Number.isInteger(settings.walls) || settings.walls < 1 || settings.walls > 8 || !Number.isFinite(settings.infill) || settings.infill < 0 || settings.infill > 100 || typeof settings.supports !== "boolean" || !["normal(auto)", "tree(auto)"].includes(settings.supportType) || !Number.isInteger(settings.supportThresholdAngle) || settings.supportThresholdAngle < 0 || settings.supportThresholdAngle > 90 || typeof settings.supportOnBuildPlateOnly !== "boolean" || !Number.isInteger(settings.fanMinSpeedPercent) || settings.fanMinSpeedPercent < 0 || settings.fanMinSpeedPercent > 100 || !Number.isInteger(settings.fanMaxSpeedPercent) || settings.fanMaxSpeedPercent < settings.fanMinSpeedPercent || settings.fanMaxSpeedPercent > 100) {
      throw new Error(`As configurações do ${String(process.name || "processo").slice(0, 80)} estão fora dos limites deste app.`);
    }
    for (const objectId of process.objectIds) {
      if (!objectIds.has(objectId) || assigned.has(objectId)) throw new Error("Cada objeto precisa pertencer a exatamente um processo válido.");
      assigned.add(objectId);
    }
  }
  if (assigned.size !== objectIds.size) throw new Error("Há objetos sem processo de impressão atribuído.");
}

export async function readSlicerStatus(port) {
  if (!port || typeof port.getStatus !== "function" || typeof port.slice !== "function") {
    return Object.freeze({ available: false, engine: null, version: null, reason: "Este host ainda não conectou um motor de fatiamento." });
  }
  try {
    const status = await port.getStatus();
    if (!status || status.available !== true || typeof status.engine !== "string" || typeof status.version !== "string" || !validProfileCatalogs(status.profiles)) {
      return Object.freeze({ available: false, engine: status?.engine ?? null, version: status?.version ?? null, reason: String(status?.reason || "O motor não está pronto para receber um trabalho.") });
    }
    return Object.freeze({ ...status, available: true, engine: status.engine, version: status.version, reason: "" });
  } catch (error) {
    return Object.freeze({ available: false, engine: null, version: null, reason: `Não foi possível consultar o motor: ${error?.message || "falha de comunicação"}` });
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
  const result = await port.slice({ ...request, signal, onProgress });
  if (signal?.aborted) throw new DOMException("Fatiamento cancelado.", "AbortError");
  if (!(result?.gcode instanceof Blob) || result.gcode.size <= 0 || result.gcode.size > MAX_GCODE_BYTES) {
    throw new Error("O motor não devolveu um G-code válido dentro do limite desta versão.");
  }
  if (result.engine !== status.engine || result.engineVersion !== status.version) {
    throw new Error("A identidade ou versão do motor mudou durante o fatiamento. Gere o trabalho novamente.");
  }
  const header = await result.gcode.slice(0, Math.min(result.gcode.size, 64 * 1024)).text();
  if (!/^\s*(?:;[^\r\n]*\r?\n\s*)*(?:G0?\d|M\d{2,})\b/m.test(header)) {
    throw new Error("A saída do motor não contém comandos reconhecíveis de impressão.");
  }
  return Object.freeze({
    gcode: result.gcode,
    filename: String(result.filename || "ordax-print.gcode"),
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
  processSchema: PROCESS_SCHEMA,
  objectTransformsSchema: OBJECT_TRANSFORM_SCHEMA,
  profileSelectionSchema: PROFILE_SELECTION_SCHEMA,
  profileSelection: "Cada job escolhe um ID ativo de máquina, processo e filamento dentre os catálogos que o host expôs.",
  processAssignment: "Cada objeto deve ser atribuído a exatamente um processo; cada processo carrega suas próprias configurações. Em 3MF, objetos incluem sourceObjectId e buildItemIndex para que o motor relacione a atribuição aos itens da mesa do arquivo original.",
  objectTransforms: "Cada objeto tem uma transformação validada com offsetMm aplicado sobre a posição original do item, após a transformação global do projeto; rotationDeg usa XYZ e a escala uniforme gira em torno do centro geométrico da peça.",
  result: ["gcode: Blob", "engine", "engineVersion"],
  maxGcodeBytes: MAX_GCODE_BYTES,
});
