import { createStoredZipBlob, readZipDirectory, readZipEntry } from "./zip-container.mjs";

export const projectBundleSchema = "ordax.3d-printing-project/8";
const LEGACY_PROJECT_BUNDLE_SCHEMA = "ordax.3d-printing-project/1";
const LEGACY_PREVIOUS_PROJECT_BUNDLE_SCHEMA = "ordax.3d-printing-project/2";
const PREVIOUS_PROJECT_BUNDLE_SCHEMA = "ordax.3d-printing-project/5";
const PREVIOUS_CURRENT_PROJECT_BUNDLE_SCHEMA = "ordax.3d-printing-project/6";
const PREVIOUS_LATEST_PROJECT_BUNDLE_SCHEMA = "ordax.3d-printing-project/7";
const OLDER_PROJECT_BUNDLE_SCHEMA = "ordax.3d-printing-project/4";
const LEGACY_OLDER_PROJECT_BUNDLE_SCHEMA = "ordax.3d-printing-project/3";
export const projectBundleLimits = Object.freeze({
  maxSourceBytes: 50 * 1024 * 1024,
  maxArchiveBytes: 51 * 1024 * 1024,
  maxManifestBytes: 256 * 1024,
});

const DRAFT_FIELDS = Object.freeze([
  "printer", "filament", "printerProfileId", "processProfileId", "filamentProfileId", "bedType",
  "quality", "layerHeight", "walls", "topShellLayers", "bottomShellLayers", "topShellThickness", "bottomShellThickness", "brimType", "brimWidth", "brimGap", "infill", "infillPattern", "seamPosition", "nozzleTemperatureC", "nozzleTemperatureInitialLayerC", "fanMin", "fanMax", "supports",
  "supportType", "supportThresholdAngle", "supportOnBuildPlateOnly", "rotation", "scale",
  "stlUnit", "objectTransforms", "selectedProcessId", "selectedTab", "processes",
]);
const SETTING_FIELDS = Object.freeze([
  "quality", "layerHeight", "walls", "topShellLayers", "bottomShellLayers", "topShellThickness", "bottomShellThickness", "brimType", "brimWidth", "brimGap", "infill", "infillPattern", "seamPosition", "fanMin", "fanMax", "supports",
  "supportType", "supportThresholdAngle", "supportOnBuildPlateOnly",
]);

function safeBasename(value) {
  const name = String(value || "").split(/[\\/]/).pop().trim();
  if (!name || name.length > 255 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error("O nome de arquivo no projeto é inválido.");
  return name;
}

function portableDraft(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("As configurações do projeto estão inválidas.");
  const result = Object.fromEntries(DRAFT_FIELDS.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]));
  if (Array.isArray(result.processes)) {
    result.processes = result.processes.slice(0, 100).map(process => {
      if (!process || typeof process !== "object") return {};
      return {
        id: process.id,
        name: process.name,
        objectIds: Array.isArray(process.objectIds) ? process.objectIds.slice(0, 10_000) : [],
        settings: Object.fromEntries(SETTING_FIELDS.filter(key => Object.hasOwn(process.settings || {}, key))
          .map(key => [key, process.settings[key]])),
      };
    });
  }
  if (result.objectTransforms && typeof result.objectTransforms === "object" && !Array.isArray(result.objectTransforms)) {
    result.objectTransforms = Object.fromEntries(Object.entries(result.objectTransforms).slice(0, 500));
  } else result.objectTransforms = {};
  return JSON.parse(JSON.stringify(result));
}

function outputFilename(projectName) {
  const stem = String(projectName || "projeto-3d").trim()
    .replace(/\.(?:ordax3d|stl|3mf)$/i, "")
    .replace(/[^\p{L}\p{N}._ -]/gu, "_")
    .replace(/[. ]+$/g, "") || "projeto-3d";
  return `${stem.slice(0, 120)}.ordax3d`;
}

export async function createProjectBundle({ sourceFile, draft, projectName }) {
  if (!(sourceFile instanceof Blob)) throw new TypeError("O projeto precisa de um arquivo STL ou 3MF original.");
  if (sourceFile.size <= 0 || sourceFile.size > projectBundleLimits.maxSourceBytes) throw new Error("O modelo original excede o limite de 50 MB.");
  const sourceName = safeBasename(sourceFile.name);
  const extension = sourceName.split(".").pop().toLowerCase();
  if (extension !== "stl" && extension !== "3mf") throw new Error("O projeto só pode incluir um modelo original STL ou 3MF.");
  const cleanProjectName = String(projectName || sourceName.replace(/\.(?:stl|3mf)$/i, "")).trim().slice(0, 120);
  if (!cleanProjectName || /[\u0000-\u001f\u007f]/.test(cleanProjectName)) throw new Error("O nome do projeto é inválido.");
  const portable = portableDraft(draft);
  const sourcePath = `models/source.${extension}`;
  const manifest = {
    schema: projectBundleSchema,
    projectName: cleanProjectName,
    source: { path: sourcePath, name: sourceName, format: extension.toUpperCase(), size: sourceFile.size },
    draft: portable,
  };
  const manifestBlob = new Blob([JSON.stringify(manifest)], { type: "application/json" });
  if (manifestBlob.size > projectBundleLimits.maxManifestBytes) throw new Error("As configurações do projeto excedem o limite do pacote.");
  const blob = await createStoredZipBlob([
    { name: "project.json", data: manifestBlob },
    { name: sourcePath, data: sourceFile },
  ], { type: "application/vnd.ordax.project+zip" });
  if (blob.size > projectBundleLimits.maxArchiveBytes) throw new Error("O pacote do projeto excede o limite de 51 MB.");
  return { blob, filename: outputFilename(cleanProjectName) };
}

export async function readProjectBundle(buffer) {
  if (!(buffer instanceof ArrayBuffer) && !ArrayBuffer.isView(buffer)) throw new TypeError("O pacote OrdaX precisa ser lido como bytes.");
  if (buffer.byteLength <= 0 || buffer.byteLength > projectBundleLimits.maxArchiveBytes) throw new Error("O pacote do projeto deve ter até 51 MB.");
  const entries = readZipDirectory(buffer, {
    maxEntries: 2,
    maxEntryBytes: projectBundleLimits.maxSourceBytes,
    label: "pacote OrdaX",
  });
  if (entries.size !== 2) throw new Error("O pacote OrdaX deve conter apenas as configurações e o modelo original.");
  const manifestEntry = entries.get("project.json");
  if (!manifestEntry || manifestEntry.filename !== "project.json" || manifestEntry.rawName !== "project.json" || manifestEntry.uncompressedSize > projectBundleLimits.maxManifestBytes) {
    throw new Error("O pacote não contém um manifesto OrdaX válido.");
  }
  const manifestBytes = await readZipEntry(buffer, manifestEntry, { label: "pacote OrdaX" });
  let manifest;
  try { manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes)); }
  catch { throw new Error("O manifesto do pacote OrdaX está inválido."); }
  if (!manifest || ![projectBundleSchema, PREVIOUS_LATEST_PROJECT_BUNDLE_SCHEMA, PREVIOUS_CURRENT_PROJECT_BUNDLE_SCHEMA, PREVIOUS_PROJECT_BUNDLE_SCHEMA, OLDER_PROJECT_BUNDLE_SCHEMA, LEGACY_OLDER_PROJECT_BUNDLE_SCHEMA, LEGACY_PREVIOUS_PROJECT_BUNDLE_SCHEMA, LEGACY_PROJECT_BUNDLE_SCHEMA].includes(manifest.schema) || typeof manifest.projectName !== "string"
    || !manifest.projectName.trim() || manifest.projectName.length > 120 || /[\u0000-\u001f\u007f]/.test(manifest.projectName) || !manifest.source || !manifest.draft
    || typeof manifest.draft !== "object" || Array.isArray(manifest.draft)) {
    throw new Error("A versão ou os dados do pacote OrdaX não são compatíveis.");
  }
  const sourceName = safeBasename(manifest.source.name);
  if (sourceName !== manifest.source.name) throw new Error("O nome do modelo no manifesto do pacote não é canônico.");
  const extension = sourceName.split(".").pop().toLowerCase();
  if ((extension !== "stl" && extension !== "3mf") || manifest.source.format !== extension.toUpperCase()
    || manifest.source.path !== `models/source.${extension}` || manifest.source.size !== entries.get(manifest.source.path)?.uncompressedSize) {
    throw new Error("O manifesto não corresponde ao modelo original incluído no pacote.");
  }
  const sourceEntry = entries.get(manifest.source.path);
  if (!sourceEntry || sourceEntry.filename !== manifest.source.path || sourceEntry.rawName !== manifest.source.path || sourceEntry.uncompressedSize <= 0
    || sourceEntry.uncompressedSize > projectBundleLimits.maxSourceBytes) {
    throw new Error("O pacote não contém um STL ou 3MF dentro dos limites permitidos.");
  }
  const sourceBytes = await readZipEntry(buffer, sourceEntry, { label: "pacote OrdaX" });
  return {
    projectName: manifest.projectName.trim(),
    sourceName,
    sourceFormat: extension.toUpperCase(),
    sourceBytes,
    draft: manifest.draft,
  };
}
