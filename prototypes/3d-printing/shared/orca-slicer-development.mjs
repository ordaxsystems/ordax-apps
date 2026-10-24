import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, open, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join, posix, resolve, win32 } from "node:path";
import { pipeline } from "node:stream/promises";
import { assessSlicerProfileCompatibility, readProfileCompatibility } from "../features/fatiamento-3d/profile-compatibility.mjs";

const ENGINE_NAME = "OrcaSlicer";
const STATUS_SCHEMA = "ordax.slicer-engine-status/2";
const REQUEST_SCHEMA = "ordax.orca-slice-request/4";
const PROFILE_SELECTION_SCHEMA = "ordax.slicer-profile-selection/1";
const RESULT_SCHEMA = "ordax.slicer-result/1";
const MAX_PROFILE_BYTES = 2 * 1024 * 1024;
const MAX_PROFILES_PER_KIND = 32;
const MAX_PROFILE_CATALOG_BYTES = 16 * 1024 * 1024;
const MAX_MESH_BYTES = 16 * 1024 * 1024;
const MAX_TRIANGLES = 300_000;
const MAX_GCODE_BYTES = 512 * 1024 * 1024;
const MAX_RUNTIME_MS = 30 * 60 * 1000;

function publicError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

function numeric(value) {
  const parsed = Number(first(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function displayName(profile, fallback) {
  for (const key of ["name", "preset_name", "printer_model", "filament_type"]) {
    const value = first(profile?.[key]);
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 120);
  }
  return fallback;
}

function profilePoint(point) {
  if (Array.isArray(point) && point.length >= 2) return [Number(point[0]), Number(point[1])];
  if (typeof point === "string") {
    const match = point.trim().match(/^(-?(?:\d+\.?\d*|\.\d+))\s*(?:x|,|\s)\s*(-?(?:\d+\.?\d*|\.\d+))$/i);
    if (match) return [Number(match[1]), Number(match[2])];
  }
  return null;
}

function cleanPolygon(points) {
  const cleaned = [];
  for (const point of points) {
    if (!cleaned.length || Math.hypot(point[0] - cleaned.at(-1)[0], point[1] - cleaned.at(-1)[1]) > 1e-7) cleaned.push(point);
  }
  if (cleaned.length > 1 && Math.hypot(cleaned[0][0] - cleaned.at(-1)[0], cleaned[0][1] - cleaned.at(-1)[1]) <= 1e-7) cleaned.pop();
  return cleaned;
}

function splitProfilePolygons(points) {
  const polygons = [];
  let current = [];
  const samePoint = (left, right) => Math.hypot(left[0] - right[0], left[1] - right[1]) <= 1e-7;
  for (const point of points) {
    const repeatedAt = current.findIndex(existing => samePoint(existing, point));
    if (repeatedAt >= 0 && (repeatedAt === current.length - 1 ? current.length >= 3 : current.length - repeatedAt >= 3)) {
      const polygon = cleanPolygon(current);
      if (polygon.length >= 3) polygons.push(polygon);
      current = [point];
      continue;
    }
    current.push(point);
  }
  const polygon = cleanPolygon(current);
  if (polygon.length >= 3) polygons.push(polygon);
  return polygons;
}

function profileSegmentsIntersect(a, b, c, d) {
  const cross = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const onSegment = (p, q, r) => Math.abs(cross(p, q, r)) < 1e-7
    && r[0] >= Math.min(p[0], q[0]) - 1e-7 && r[0] <= Math.max(p[0], q[0]) + 1e-7
    && r[1] >= Math.min(p[1], q[1]) - 1e-7 && r[1] <= Math.max(p[1], q[1]) + 1e-7;
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
  if (Math.abs(abC) < 1e-7 && onSegment(a, b, c)) return true;
  if (Math.abs(abD) < 1e-7 && onSegment(a, b, d)) return true;
  if (Math.abs(cdA) < 1e-7 && onSegment(c, d, a)) return true;
  if (Math.abs(cdB) < 1e-7 && onSegment(c, d, b)) return true;
  return (abC > 0) !== (abD > 0) && (cdA > 0) !== (cdB > 0);
}

function validSimplePolygon(points) {
  if (points.length < 3 || points.length > 100) return false;
  let twiceArea = 0;
  for (let index = 0; index < points.length; index++) {
    const current = points[index], next = points[(index + 1) % points.length];
    if (Math.hypot(current[0] - next[0], current[1] - next[1]) <= 1e-7) return false;
    twiceArea += current[0] * next[1] - next[0] * current[1];
    for (let other = index + 1; other < points.length; other++) {
      if (other === index || other === (index + 1) % points.length || (other + 1) % points.length === index) continue;
      if (profileSegmentsIntersect(current, next, points[other], points[(other + 1) % points.length])) return false;
    }
  }
  return Number.isFinite(twiceArea) && Math.abs(twiceArea) > 1e-5;
}

function parseBedShape(profile) {
  const source = profile.printable_area ?? profile.bed_shape;
  if (!Array.isArray(source) || source.length < 3 || source.length > 100) return null;
  const parsedPoints = source.map(profilePoint);
  if (parsedPoints.some(point => !point || !point.every(Number.isFinite))) return null;
  const points = cleanPolygon(parsedPoints);
  if (!validSimplePolygon(points)) return null;
  const x = points.map(point => point[0]), y = points.map(point => point[1]);
  const min = [Math.min(...x), Math.min(...y)], max = [Math.max(...x), Math.max(...y)];
  const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2];
  const size = [max[0] - min[0], max[1] - min[1]];
  if (size.some(value => value < 50 || value > 2000)) return null;
  const normalized = points.map(point => point.map((value, axis) => Number((value - center[axis]).toFixed(3))));
  const rawExcluded = profile.bed_exclude_area;
  let excludedAreas = [];
  if (rawExcluded !== undefined) {
    if (!Array.isArray(rawExcluded) || rawExcluded.length > 100) return null;
    const points = rawExcluded.map(profilePoint);
    if (points.some(point => !point || !point.every(Number.isFinite))) return null;
    excludedAreas = splitProfilePolygons(points).map(polygon => polygon.map(point => point.map((value, axis) => Number((value - center[axis]).toFixed(3)))));
    if (excludedAreas.some(polygon => !validSimplePolygon(polygon))) return null;
  }
  return {
    bedSizeMm: size.map(value => Number(value.toFixed(2))),
    bedOutlineMm: normalized,
    bedExcludeAreasMm: excludedAreas,
  };
}

export { parseBedShape };

function parseProfile(raw, kind, fallbackName) {
  const label = ({ machine: "máquina", process: "processo", filament: "filamento" })[kind] || kind;
  let profile;
  try { profile = JSON.parse(raw.toString("utf8")); }
  catch { throw publicError(`O perfil de ${label} não contém JSON válido.`, 503); }
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) throw publicError(`O perfil de ${label} tem um formato inválido.`, 503);
  const name = displayName(profile, fallbackName);
  const compatibility = readProfileCompatibility(profile);
  if (kind === "machine") {
    const technology = first(profile.printer_technology);
    if (technology && !/^(?:fff|fdm)$/i.test(String(technology))) throw publicError("Esta integração inicial aceita apenas perfis FDM/FFF.", 503);
    const bed = parseBedShape(profile);
    const height = numeric(profile.max_print_height ?? profile.printable_height);
    if (!bed || !Number.isFinite(height) || height < 50 || height > 2000) {
      throw publicError("O perfil da máquina precisa declarar printable_area e max_print_height válidos.", 503);
    }
    const nozzle = first(profile.nozzle_diameter);
    return { name, compatibility, ...bed, heightMm: Number(height.toFixed(2)), nozzleDiameterMm: numeric(nozzle), printerModel: String(first(profile.printer_model) || "").slice(0, 120) || null, source: "JSON local configurado no host" };
  }
  if (kind === "process") {
    if (!profile.layer_height && !profile.layer_height_0) throw publicError("O perfil de processo não contém altura de camada.", 503);
    return { name, compatibility, layerHeightMm: numeric(profile.layer_height ?? profile.layer_height_0), wallLoops: numeric(profile.wall_loops), source: "JSON local configurado no host" };
  }
  const temperatures = [numeric(profile.nozzle_temperature_range_low ?? profile.nozzle_temperature), numeric(profile.nozzle_temperature_range_high ?? profile.nozzle_temperature)];
  const bedTemperatures = [numeric(profile.cool_plate_temp ?? profile.textured_plate_temp ?? profile.bed_temperature), numeric(profile.cool_plate_temp_initial_layer ?? profile.textured_plate_temp_initial_layer ?? profile.bed_temperature_initial_layer)];
  const validRange = values => values.filter(Number.isFinite).length ? values.filter(Number.isFinite) : null;
  return {
    name,
    compatibility,
    type: String(first(profile.filament_type) || "").slice(0, 80) || null,
    nozzleTemperatureC: validRange(temperatures),
    bedTemperatureC: validRange(bedTemperatures),
    source: "JSON local configurado no host",
  };
}

async function readConfiguredProfile(configuredPath, kind, index) {
  let path;
  try { path = await realpath(resolve(configuredPath)); }
  catch { throw publicError(`O arquivo configurado para o perfil de ${kind} não foi encontrado.`, 503); }
  let metadata;
  try { metadata = await stat(path); }
  catch { throw publicError(`Não foi possível ler o perfil de ${kind}.`, 503); }
  if (!metadata.isFile() || metadata.size <= 0 || metadata.size > MAX_PROFILE_BYTES || extname(path).toLowerCase() !== ".json") {
    throw publicError(`O perfil de ${kind} precisa ser um arquivo JSON de até 2 MB.`, 503);
  }
  let contents;
  try { contents = await readFile(path); }
  catch { throw publicError(`Não foi possível ler o perfil de ${kind}.`, 503); }
  const id = `orca-${kind}-${createHash("sha256").update(kind).update("\0").update(contents).digest("hex").slice(0, 24)}`;
  const label = ({ machine: "Máquina", process: "Processo", filament: "Filamento" })[kind] || "Perfil";
  return { id, contents, parsed: parseProfile(contents, kind, `${label} ${String(index + 1).padStart(2, "0")}`) };
}

function configuredProfilePaths(catalogKey, legacyKey, kind) {
  const encoded = process.env[catalogKey]?.trim();
  let paths;
  if (encoded) {
    try { paths = JSON.parse(encoded); }
    catch { throw publicError(`A lista local de perfis de ${kind} não contém JSON válido.`, 503); }
  } else {
    const legacyPath = process.env[legacyKey]?.trim();
    paths = legacyPath ? [legacyPath] : [];
  }
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > MAX_PROFILES_PER_KIND || paths.some(path => typeof path !== "string" || !path.trim())) {
    throw publicError(`Configure de 1 a ${MAX_PROFILES_PER_KIND} caminhos de perfil de ${kind} no host local.`, 503);
  }
  return [...new Set(paths.map(path => path.trim()))];
}

async function readConfiguredProfiles(catalogKey, legacyKey, kind) {
  const paths = configuredProfilePaths(catalogKey, legacyKey, kind);
  const profiles = await Promise.all(paths.map((path, index) => readConfiguredProfile(path, kind, index)));
  const totalBytes = profiles.reduce((sum, profile) => sum + profile.contents.length, 0);
  if (totalBytes > MAX_PROFILE_CATALOG_BYTES) throw publicError(`O catálogo de perfis de ${kind} excede o limite total de 16 MB.`, 503);
  return [...new Map(profiles.map(profile => [profile.id, profile])).values()];
}

function publicProfileCatalog(profiles) {
  return { catalog: profiles.map(({ id, parsed }) => ({ id, ...parsed })) };
}

function selectConfiguredProfiles(configuration, manifest) {
  if (manifest?.profileSelectionSchema !== PROFILE_SELECTION_SCHEMA) throw publicError("A solicitação não corresponde ao contrato de seleção de perfis.");
  const selections = manifest.profileIds;
  if (!selections || typeof selections !== "object" || Array.isArray(selections)) throw publicError("Selecione os perfis de máquina, processo e filamento antes de fatiar.");
  const selected = {};
  for (const kind of ["machine", "process", "filament"]) {
    const id = selections[kind];
    if (typeof id !== "string" || !new RegExp(`^orca-${kind}-[a-f0-9]{24}$`).test(id)) throw publicError(`O perfil selecionado de ${kind} é inválido.`);
    const profile = configuration.profileFiles[kind].find(entry => entry.id === id);
    if (!profile) throw publicError(`O perfil selecionado de ${kind} não pertence ao catálogo carregado neste host. Atualize os perfis e tente novamente.`, 422);
    selected[kind] = profile;
  }
  return selected;
}

export function createOrcaChildEnvironment({ source = process.env, platform = process.platform, jobDirectory = null } = {}) {
  const path = platform === "win32" ? win32 : posix;
  const allowed = platform === "win32"
    ? ["PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT"]
    : ["PATH", "LANG", "LC_ALL", "LC_CTYPE", "TZ"];
  const environment = {};
  for (const name of allowed) {
    const key = Object.keys(source).find(candidate => candidate.toUpperCase() === name);
    const value = key ? source[key] : undefined;
    if (typeof value === "string" && value.length <= 32_767 && !value.includes("\0")) environment[name] = value;
  }
  if (jobDirectory) {
    const privateTemp = path.join(jobDirectory, "tmp");
    environment.HOME = jobDirectory;
    environment.TMPDIR = privateTemp;
    environment.TEMP = privateTemp;
    environment.TMP = privateTemp;
    if (platform === "win32") {
      environment.USERPROFILE = jobDirectory;
      environment.APPDATA = path.join(jobDirectory, "appdata");
      environment.LOCALAPPDATA = path.join(jobDirectory, "local-appdata");
    } else {
      environment.XDG_CONFIG_HOME = path.join(jobDirectory, "config");
      environment.XDG_CACHE_HOME = path.join(jobDirectory, "cache");
      environment.XDG_DATA_HOME = path.join(jobDirectory, "data-home");
      environment.XDG_STATE_HOME = path.join(jobDirectory, "state");
    }
  }
  return Object.freeze(environment);
}

async function prepareChildDirectories(directory) {
  await Promise.all(["tmp", "appdata", "local-appdata", "config", "cache", "data-home", "state"].map(name => mkdir(join(directory, name))));
}

function collectText(target, chunk, maxBytes = 1024 * 1024) {
  if (target.bytes >= maxBytes) return target;
  const remaining = maxBytes - target.bytes;
  const slice = chunk.subarray(0, remaining);
  target.text += slice.toString("utf8");
  target.bytes += slice.length;
  return target;
}

function runChild(executable, args, { cwd, signal, timeoutMs = 15_000 } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    if (signal?.aborted) return rejectPromise(new DOMException("Fatiamento cancelado.", "AbortError"));
    let child;
    try { child = spawn(executable, args, { cwd, env: createOrcaChildEnvironment({ jobDirectory: cwd }), windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] }); }
    catch { return rejectPromise(publicError("Não foi possível iniciar OrcaSlicer.", 503)); }
    const stdout = { text: "", bytes: 0 }, stderr = { text: "", bytes: 0 };
    child.stdout.on("data", chunk => collectText(stdout, chunk));
    child.stderr.on("data", chunk => collectText(stderr, chunk));
    let settled = false, timedOut = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error) rejectPromise(error); else resolvePromise(value);
    };
    const terminate = () => {
      if (child.exitCode !== null || child.killed) return;
      child.kill();
      const force = setTimeout(() => { if (child.exitCode === null) child.kill("SIGKILL"); }, 1500);
      force.unref?.();
    };
    const abort = () => { terminate(); };
    const timer = setTimeout(() => { timedOut = true; terminate(); }, timeoutMs);
    timer.unref?.();
    signal?.addEventListener("abort", abort, { once: true });
    child.once("error", error => finish(publicError(`Não foi possível iniciar OrcaSlicer: ${error.message.slice(0, 180)}`, 503)));
    child.once("close", (code, signalName) => {
      if (signal?.aborted) return finish(new DOMException("Fatiamento cancelado.", "AbortError"));
      if (timedOut) return finish(publicError("OrcaSlicer excedeu o limite de 30 minutos. Simplifique o modelo e tente novamente.", 504));
      finish(null, { code, signal: signalName, stdout: stdout.text, stderr: stderr.text });
    });
  });
}

function readVersion(helpOutput) {
  const match = String(helpOutput).match(/(?:orca[- ]slicer|orcaslicer)[-\s:]v?([0-9]+\.[0-9]+\.[0-9]+(?:[-+][a-z0-9.-]+)?)/i);
  return match?.[1] || null;
}

function normalSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw publicError("O processo não contém configurações válidas.");
  const settings = {
    quality: value.quality,
    layerHeight: Number(value.layerHeight),
    walls: Number(value.walls),
    infill: Number(value.infill),
    supports: value.supports,
    supportType: value.supportType,
    supportThresholdAngle: Number(value.supportThresholdAngle),
    supportOnBuildPlateOnly: value.supportOnBuildPlateOnly,
    fanMinSpeedPercent: Number(value.fanMinSpeedPercent),
    fanMaxSpeedPercent: Number(value.fanMaxSpeedPercent),
  };
  if (!["standard", "fine", "draft"].includes(settings.quality)
    || !Number.isFinite(settings.layerHeight) || settings.layerHeight < 0.08 || settings.layerHeight > 0.4
    || !Number.isInteger(settings.walls) || settings.walls < 1 || settings.walls > 8
    || !Number.isFinite(settings.infill) || settings.infill < 0 || settings.infill > 100
    || typeof settings.supports !== "boolean"
    || !["normal(auto)", "tree(auto)"].includes(settings.supportType)
    || !Number.isInteger(settings.supportThresholdAngle) || settings.supportThresholdAngle < 0 || settings.supportThresholdAngle > 90
    || typeof settings.supportOnBuildPlateOnly !== "boolean"
    || !Number.isInteger(settings.fanMinSpeedPercent) || settings.fanMinSpeedPercent < 0 || settings.fanMinSpeedPercent > 100
    || !Number.isInteger(settings.fanMaxSpeedPercent) || settings.fanMaxSpeedPercent < settings.fanMinSpeedPercent || settings.fanMaxSpeedPercent > 100) {
    throw publicError("As configurações solicitadas estão fora dos limites permitidos.");
  }
  return settings;
}

export function buildOrcaSettingArguments(value) {
  const settings = normalSettings(value);
  return [
    "--layer-height", String(settings.layerHeight),
    "--wall-loops", String(settings.walls),
    "--sparse-infill-density", `${settings.infill}%`,
    `--enable-support=${settings.supports ? 1 : 0}`,
    "--support-type", settings.supportType,
    "--support-threshold-angle", String(settings.supportThresholdAngle),
    `--support-on-build-plate-only=${settings.supportOnBuildPlateOnly ? 1 : 0}`,
    "--fan-min-speed", String(settings.fanMinSpeedPercent),
    "--fan-max-speed", String(settings.fanMaxSpeedPercent),
  ];
}

function validateManifest(manifest, meshBytes) {
  if (!manifest || manifest.schema !== REQUEST_SCHEMA || !Array.isArray(manifest.objects) || !manifest.objects.length || manifest.objects.length > 500 || !Array.isArray(manifest.processes) || !manifest.processes.length || manifest.processes.length > 100) {
    throw publicError("A solicitação do fatiamento não corresponde ao contrato do host.");
  }
  if (!Buffer.isBuffer(meshBytes) || meshBytes.length < 134 || meshBytes.length > MAX_MESH_BYTES || meshBytes.readUInt32LE(80) > MAX_TRIANGLES || 84 + meshBytes.readUInt32LE(80) * 50 !== meshBytes.length) {
    throw publicError("A malha STL preparada está incompleta ou excede os limites.");
  }
  const objectIds = new Set();
  for (const object of manifest.objects) {
    if (!object || typeof object.id !== "string" || !/^[a-z0-9_-]{1,128}$/i.test(object.id) || objectIds.has(object.id) || !Number.isInteger(object.triangleCount) || object.triangleCount < 1) {
      throw publicError("A lista de objetos contém uma identidade ou contagem inválida.");
    }
    objectIds.add(object.id);
  }
  const listedTriangles = manifest.objects.reduce((sum, object) => sum + object.triangleCount, 0);
  if (listedTriangles !== meshBytes.readUInt32LE(80)) throw publicError("A malha preparada não corresponde às contagens de triângulos do projeto.");
  const assigned = new Set();
  const settingsByProcess = [];
  for (const process of manifest.processes) {
    if (!process || typeof process.id !== "string" || !Array.isArray(process.objectIds) || !process.objectIds.length) throw publicError("Um processo está sem objetos atribuídos.");
    settingsByProcess.push(normalSettings(process.settings));
    for (const objectId of process.objectIds) {
      if (!objectIds.has(objectId) || assigned.has(objectId)) throw publicError("Cada peça precisa pertencer a apenas um processo.");
      assigned.add(objectId);
    }
  }
  if (assigned.size !== objectIds.size) throw publicError("Há peças sem processo de impressão atribuído.");
  const uniqueSettings = new Set(settingsByProcess.map(settings => JSON.stringify(settings)));
  if (uniqueSettings.size !== 1) throw publicError("O OrcaSlicer CLI não aceita com segurança estes processos diferentes na mesma mesa. Use uma configuração uniforme até o suporte upstream por peça ser validado.", 422);
  const requestedSettings = normalSettings(manifest.settings);
  if (JSON.stringify(requestedSettings) !== JSON.stringify(settingsByProcess[0])) throw publicError("As configurações gerais e do processo não correspondem.");
  return { settings: requestedSettings, triangleCount: meshBytes.readUInt32LE(80) };
}

function safeFilename(value) {
  const leaf = basename(String(value || "ordax-print.gcode")).replace(/\.[^.]+$/, "");
  return `${leaf.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 100) || "ordax-print"}.gcode`;
}

function parsedStatistics(value) {
  if (!value || typeof value !== "object" || !value.summary || typeof value.summary !== "object") return null;
  const summary = value.summary;
  const finiteOrNull = item => item !== null && item !== undefined && item !== "" && Number.isFinite(Number(item)) ? Number(item) : null;
  const filaments = Array.isArray(summary.filaments) ? summary.filaments : [];
  const weightFromFilaments = filaments.length
    ? filaments.reduce((total, filament) => total + (finiteOrNull(filament?.weight) ?? 0), 0)
    : null;
  const timeSeconds = finiteOrNull(summary.time);
  const featureBreakdown = summary.features && typeof summary.features === "object" && !Array.isArray(summary.features)
    ? Object.entries(summary.features)
      .map(([name, feature]) => {
        const featureTime = finiteOrNull(feature?.time);
        return {
          name: String(name).trim().slice(0, 100),
          timeSeconds: featureTime,
          timeSharePercent: featureTime !== null && timeSeconds > 0 ? Number((featureTime / timeSeconds * 100).toFixed(1)) : null,
          weightGrams: finiteOrNull(feature?.weight),
        };
      })
      .filter(feature => feature.name && feature.timeSeconds !== null && feature.timeSeconds >= 0)
      .sort((left, right) => right.timeSeconds - left.timeSeconds)
      .slice(0, 30)
    : [];
  return {
    timeSeconds,
    filamentGrams: finiteOrNull(summary.weight) ?? weightFromFilaments,
    filamentMeters: filaments.length
      ? Number((filaments.reduce((total, filament) => total + (finiteOrNull(filament?.length) ?? 0), 0) / 1000).toFixed(3))
      : null,
    layerCount: finiteOrNull(summary.layer_count),
    featureBreakdown,
  };
}

function publicStatus(configuration) {
  return Object.freeze({
    schema: STATUS_SCHEMA,
    available: configuration.available,
    engine: ENGINE_NAME,
    version: configuration.version,
    reason: configuration.reason,
    busy: slicing,
    processScope: "uniform",
    executionTarget: "device",
    profiles: configuration.profiles ? Object.freeze(configuration.profiles) : null,
  });
}

let configurationPromise;
let slicing = false;

async function loadConfiguration() {
  const executableSetting = process.env.ORDAX_ORCA_SLICER_PATH?.trim();
  if (!executableSetting) return { available: false, version: null, reason: "Configure o caminho do executável OrcaSlicer no host de desenvolvimento.", profiles: null };
  let executable;
  try {
    executable = await realpath(resolve(executableSetting));
    const metadata = await stat(executable);
    if (!metadata.isFile()) throw new Error("not a file");
  } catch { return { available: false, version: null, reason: "O executável configurado do OrcaSlicer não foi encontrado.", profiles: null }; }

  let machines, processProfiles, filaments;
  try {
    [machines, processProfiles, filaments] = await Promise.all([
      readConfiguredProfiles("ORDAX_ORCA_MACHINE_PROFILES", "ORDAX_ORCA_MACHINE_PROFILE", "machine"),
      readConfiguredProfiles("ORDAX_ORCA_PROCESS_PROFILES", "ORDAX_ORCA_PROCESS_PROFILE", "process"),
      readConfiguredProfiles("ORDAX_ORCA_FILAMENT_PROFILES", "ORDAX_ORCA_FILAMENT_PROFILE", "filament"),
    ]);
  } catch (error) {
    return { executable, available: false, version: null, reason: error.message.slice(0, 300), profiles: null };
  }

  let probe;
  const probeDirectory = await mkdtemp(join(tmpdir(), "ordax-orca-probe-"));
  try {
    await prepareChildDirectories(probeDirectory);
    probe = await runChild(executable, ["--help"], { cwd: probeDirectory, timeoutMs: 15_000 });
  } catch (error) {
    probe = { code: -1, stdout: "", stderr: error.message };
  } finally {
    await rm(probeDirectory, { recursive: true, force: true }).catch(() => {});
  }
  const version = readVersion(`${probe.stdout}\n${probe.stderr}`);
  if (!version) return { executable, available: false, version: null, reason: "O executável não respondeu como uma versão CLI reconhecível do OrcaSlicer.", profiles: null };
  const profiles = {
    machine: publicProfileCatalog(machines),
    process: publicProfileCatalog(processProfiles),
    filament: publicProfileCatalog(filaments),
  };
  return { executable, available: true, version, reason: "", profiles, profileFiles: { machine: machines, process: processProfiles, filament: filaments } };
}

async function configuration() {
  if (!configurationPromise) configurationPromise = loadConfiguration();
  return configurationPromise;
}

export async function getOrcaSlicerStatus() {
  try { return publicStatus(await configuration()); }
  catch { return Object.freeze({ schema: STATUS_SCHEMA, available: false, engine: ENGINE_NAME, version: null, reason: "Não foi possível verificar a configuração local do OrcaSlicer.", busy: slicing, processScope: "uniform", profiles: null }); }
}

function validateCliResult(gcodeBytes) {
  if (!Buffer.isBuffer(gcodeBytes) || gcodeBytes.length <= 0 || gcodeBytes.length > MAX_GCODE_BYTES) throw publicError("O motor não devolveu G-code dentro do limite aceito.", 502);
  const head = gcodeBytes.subarray(0, Math.min(gcodeBytes.length, 64 * 1024)).toString("utf8");
  if (!/^\s*(?:;[^\r\n]*\r?\n\s*)*(?:G0?\d|M\d{2,})\b/m.test(head)) throw publicError("O arquivo produzido pelo motor não contém comandos G-code reconhecíveis.", 502);
}

async function validateCliGcodeFile(path, size) {
  if (!Number.isFinite(size) || size <= 0 || size > MAX_GCODE_BYTES) throw publicError("O G-code produzido excede o limite aceito pelo host.", 502);
  const handle = await open(path, "r");
  try {
    const head = Buffer.alloc(Math.min(size, 64 * 1024));
    const { bytesRead } = await handle.read(head, 0, head.length, 0);
    validateCliResult(head.subarray(0, bytesRead));
  } finally { await handle.close(); }
}

export async function sliceWithOrcaToResponse(formData, response, { signal } = {}) {
  if (slicing) throw publicError("O OrcaSlicer já está processando outro trabalho neste host.", 429);
  slicing = true;
  let temporaryDirectory;
  try {
    const config = await configuration();
    if (!config.available) throw publicError(config.reason || "OrcaSlicer não está pronto.", 503);
    const manifestText = formData?.get("manifest");
    if (typeof manifestText !== "string" || manifestText.length > 512 * 1024) throw publicError("O manifesto do trabalho está ausente ou excede o limite permitido.");
    let manifest;
    try { manifest = JSON.parse(manifestText); }
    catch { throw publicError("O manifesto do trabalho não contém JSON válido."); }
    const uploadedMesh = formData.get("mesh");
    if (!(uploadedMesh instanceof Blob)) throw publicError("O trabalho não inclui a malha STL preparada.");
    if (uploadedMesh.size > MAX_MESH_BYTES) throw publicError("A malha excede o limite de 16 MB do host.", 413);
    const meshBytes = Buffer.from(await uploadedMesh.arrayBuffer());
    const selectedProfiles = selectConfiguredProfiles(config, manifest);
    const validated = validateManifest(manifest, meshBytes);
    const compatibility = assessSlicerProfileCompatibility({
      machine: selectedProfiles.machine.parsed,
      process: selectedProfiles.process.parsed,
      filament: selectedProfiles.filament.parsed,
    });
    if (compatibility.status !== "compatible") throw publicError(compatibility.reason, 422);
    temporaryDirectory = await mkdtemp(join(tmpdir(), "ordax-orca-slice-"));
    const outputDirectory = join(temporaryDirectory, "output");
    const dataDirectory = join(temporaryDirectory, "data");
    await Promise.all([mkdir(outputDirectory), mkdir(dataDirectory), prepareChildDirectories(temporaryDirectory)]);
    const inputPath = join(temporaryDirectory, "ordax-model.stl");
    const machinePath = join(temporaryDirectory, "machine.json");
    const processPath = join(temporaryDirectory, "process.json");
    const filamentPath = join(temporaryDirectory, "filament.json");
    const logPath = join(temporaryDirectory, "orca.log");
    await Promise.all([
      writeFile(inputPath, meshBytes, { flag: "wx" }),
      writeFile(machinePath, selectedProfiles.machine.contents, { flag: "wx" }),
      writeFile(processPath, selectedProfiles.process.contents, { flag: "wx" }),
      writeFile(filamentPath, selectedProfiles.filament.contents, { flag: "wx" }),
    ]);

    const settings = validated.settings;
    const args = [
      inputPath,
      "--load-settings", `${processPath};${machinePath}`,
      "--load-filaments", filamentPath,
      "--datadir", dataDirectory,
      "--outputdir", outputDirectory,
      "--logfile", logPath,
      "--debug", "2",
      "--arrange=0",
      "--orient=0",
      ...buildOrcaSettingArguments(settings),
      "--export-statistics",
      "--slice", "0",
    ];
    const run = await runChild(config.executable, args, { cwd: temporaryDirectory, signal, timeoutMs: MAX_RUNTIME_MS });
    if (run.code !== 0) throw publicError("OrcaSlicer não concluiu o trabalho. Confira a compatibilidade dos perfis, a área da máquina e as opções exigidas pelo motor.", 422);

    const outputEntries = await readdir(outputDirectory, { withFileTypes: true });
    const gcodeEntries = outputEntries.filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith(".gcode"));
    if (gcodeEntries.length !== 1) throw publicError("OrcaSlicer não gerou exatamente um arquivo G-code para este trabalho.", 502);
    const gcodePath = join(outputDirectory, gcodeEntries[0].name);
    const gcodeInfo = await stat(gcodePath);
    if (!gcodeInfo.isFile() || gcodeInfo.size <= 0 || gcodeInfo.size > MAX_GCODE_BYTES) throw publicError("O G-code produzido excede o limite aceito pelo host.", 502);
    await validateCliGcodeFile(gcodePath, gcodeInfo.size);
    const statisticsName = outputEntries.find(entry => entry.isFile() && entry.name.toLowerCase().endsWith(".statistics.json"))?.name;
    let stats = null;
    if (statisticsName) {
      try { stats = parsedStatistics(JSON.parse(await readFile(join(outputDirectory, statisticsName), "utf8"))); }
      catch { stats = null; }
    }
    const filename = safeFilename(manifest.filename);
    const metadata = {
      schema: RESULT_SCHEMA,
      engine: ENGINE_NAME,
      engineVersion: config.version,
      filename,
      printerProfile: selectedProfiles.machine.parsed.name,
      processProfile: selectedProfiles.process.parsed.name,
      filamentProfile: selectedProfiles.filament.parsed.name,
      stats,
      diagnostics: stats ? [] : ["O motor gerou G-code, mas não forneceu estatísticas JSON legíveis."],
    };
    response.writeHead(200, {
      "Content-Type": "application/gcode",
      "Content-Disposition": `attachment; filename="${filename.replace(/["\\\r\n]/g, "_")}"`,
      "Content-Length": String(gcodeInfo.size),
      "X-Ordax-Slicer-Metadata": Buffer.from(JSON.stringify(metadata), "utf8").toString("base64url"),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
    });
    await pipeline(createReadStream(gcodePath), response, { signal });
  } finally {
    slicing = false;
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
  }
}

export const orcaSlicerDevelopmentLimits = Object.freeze({ maxProfileBytes: MAX_PROFILE_BYTES, maxMeshBytes: MAX_MESH_BYTES, maxTriangles: MAX_TRIANGLES, maxGcodeBytes: MAX_GCODE_BYTES, maxRuntimeMs: MAX_RUNTIME_MS });
