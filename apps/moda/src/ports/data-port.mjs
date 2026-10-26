export const MODA_PREVIEW_PORT_SCHEMA = "ordax.moda-preview-data-port/1";

const METHODS = Object.freeze(["initialize", "getSnapshot", "subscribe", "execute", "destroy"]);

export function assertModaPreviewPort(value) {
  if (!value || typeof value !== "object" || value.schema !== MODA_PREVIEW_PORT_SCHEMA) {
    throw new TypeError("O host de desenvolvimento precisa fornecer o port local de Moda.");
  }
  for (const method of METHODS) {
    if (typeof value[method] !== "function") {
      throw new TypeError("O port local de Moda não implementa " + method + "().");
    }
  }
  if (value.persistence !== "browser-local-preview") {
    throw new TypeError("O port informado não é o adapter local de desenvolvimento.");
  }
  return value;
}
