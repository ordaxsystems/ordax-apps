// Public-contract validation facade pinned to OrdaX App SDK 1.6.0.
// This module carries no platform authority and contains no host transport.
export const COMPONENT_RUNTIME_SCHEMA = "ordax.component-runtime/1";
export const SURFACE_RENDER_LIFECYCLE_SCHEMA = "ordax.surface-render-lifecycle/5";
export const LOCALIZATION_SCHEMA = "ordax.localization/2";
export const APP_ACTIVATION_SCHEMA = "ordax.app-activation/1";
export const FILE_SPACE_SCHEMA = "ordax.file-space/11";
export const INTELLIGENCE_PORT_SCHEMA = "ordax.intelligence/1";
export const INTELLIGENCE_MAX_CONTEXT_ITEM_CHARS = 8192;
export const APP_DATA_SCHEMA = "ordax.app-data/1";
export const MAX_APP_DATA_KEY_CHARS = 128;
export const MAX_APP_DATA_VALUE_BYTES = 1024 * 1024;
export const MAX_APP_DATA_PARTITION_KEYS = 4096;

const IMAGE_PREVIEW_MIME_TYPES = new Set([
  "image/avif", "image/bmp", "image/gif", "image/jpeg", "image/png", "image/webp",
]);
const RESERVED_ENTRY_NAMES = new Set([".ordax-trash"]);
const APP_DATA_KEY_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

export function assertLocalizationPort(port) {
  if (!port || typeof port !== "object" || port.schema !== LOCALIZATION_SCHEMA) {
    throw new TypeError("A compatible localization port is required");
  }
  for (const method of ["getLocale", "getProfile", "translate", "subscribe"]) {
    if (typeof port[method] !== "function") {
      throw new TypeError(`Localization port must implement ${method}()`);
    }
  }
  const locale = port.getLocale();
  if (typeof locale !== "string" || !locale) {
    throw new TypeError("Localization port must expose a non-empty locale");
  }
  return port;
}

export function assertSurfaceRenderLifecycle(value) {
  if (
    !value || typeof value !== "object"
    || value.schema !== SURFACE_RENDER_LIFECYCLE_SCHEMA
    || typeof value.subscribeRender !== "function"
    || typeof value.getAppTarget !== "function"
    || typeof value.setAppTarget !== "function"
  ) {
    throw new TypeError("A compatible Surface render lifecycle is required");
  }
  assertLocalizationPort(value.localization);
  return value;
}

export function assertAppActivationPort(port) {
  if (!port || typeof port !== "object" || port.schema !== APP_ACTIVATION_SCHEMA) {
    throw new TypeError("A compatible app-activation port is required");
  }
  if (typeof port.publish !== "function" || typeof port.subscribe !== "function") {
    throw new TypeError("App-activation port must implement publish() and subscribe()");
  }
  return port;
}

export function validateFileSpacePath(path) {
  if (typeof path !== "string" || !path.startsWith("/")) {
    throw new TypeError("File-space path must be an absolute logical path");
  }
  if (path !== "/" && path.endsWith("/")) {
    throw new TypeError("File-space path must not have a trailing slash");
  }
  if (path === "/") return path;
  const parts = path.split("/").slice(1);
  if (parts.some((part) => !part || part === "." || part === ".." || part.includes("\0") || RESERVED_ENTRY_NAMES.has(part))) {
    throw new TypeError("File-space path contains an invalid segment");
  }
  return path;
}

export function validateTextFile(value) {
  if (!value || typeof value !== "object") throw new TypeError("Text-file payload must be an object");
  const path = validateFileSpacePath(value.path);
  if (!Number.isInteger(value.size) || value.size < 0 || value.size > 256 * 1024) {
    throw new TypeError("Text-file size is outside the preview boundary");
  }
  if (typeof value.text !== "string" || value.text.includes("\0")) {
    throw new TypeError("Text-file content must be valid text");
  }
  return Object.freeze({ path, size: value.size, text: value.text });
}

export function validateImagePreview(value) {
  if (!value || typeof value !== "object") throw new TypeError("Image-preview payload must be an object");
  const path = validateFileSpacePath(value.path);
  if (!Number.isInteger(value.size) || value.size < 0 || value.size > 8 * 1024 * 1024) {
    throw new TypeError("Image-preview size is outside the preview boundary");
  }
  if (!IMAGE_PREVIEW_MIME_TYPES.has(value.mime)) throw new TypeError("Image-preview MIME type is unsupported");
  if (!(value.bytes instanceof Uint8Array) || value.bytes.byteLength !== value.size) {
    throw new TypeError("Image-preview bytes must match the declared size");
  }
  return Object.freeze({ path, size: value.size, mime: value.mime, bytes: value.bytes });
}

export function assertFileSpacePort(port) {
  if (!port || typeof port !== "object" || port.schema !== FILE_SPACE_SCHEMA) {
    throw new TypeError("A compatible file-space port is required");
  }
  for (const method of [
    "list", "createDirectory", "readTextFile", "renameEntry", "copyFile", "moveEntry",
    "trashEntry", "listTrash", "restoreTrashEntry", "exportFile", "importFile",
  ]) {
    if (typeof port[method] !== "function") {
      throw new TypeError(`File-space port must implement ${method}()`);
    }
  }
  return port;
}

export function assertIntelligencePort(port) {
  if (!port || typeof port !== "object" || port.schema !== INTELLIGENCE_PORT_SCHEMA) {
    throw new TypeError("Compatible OrdaX Intelligence port is required");
  }
  for (const method of ["getSnapshot", "subscribe", "respond"]) {
    if (typeof port[method] !== "function") {
      throw new TypeError(`OrdaX Intelligence port must implement ${method}()`);
    }
  }
  return port;
}

export function validateAppDataKey(value) {
  if (typeof value !== "string" || value.length > MAX_APP_DATA_KEY_CHARS || !APP_DATA_KEY_RE.test(value)) {
    throw new TypeError("App Data key is invalid");
  }
  return value;
}

export function validateAppDataBytes(value) {
  if (!(value instanceof Uint8Array)) throw new TypeError("App Data value must be Uint8Array bytes");
  if (value.byteLength > MAX_APP_DATA_VALUE_BYTES) {
    throw new RangeError("App Data value exceeds the per-value hard bound");
  }
  return new Uint8Array(value);
}

export function assertAppDataPort(port) {
  if (!port || typeof port !== "object" || port.schema !== APP_DATA_SCHEMA) {
    throw new TypeError("A compatible App Data port is required");
  }
  if (!port.identity || port.identity.appId !== "notes") {
    throw new TypeError("Notes App Data port must be bound to notes");
  }
  for (const method of ["get", "list", "put", "delete"]) {
    if (typeof port[method] !== "function") throw new TypeError(`App Data port is missing ${method}()`);
  }
  return port;
}
