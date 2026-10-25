import { createFoodCommand } from "./commands.mjs";

// Exact command fingerprint reused by the preview and by Food Order Core.
// Include issuedAt, expectedRevision and the entire payload so the same key
// cannot silently refer to another attempted operation.
export async function fingerprintFoodCommand(commandValue) {
  const command = createFoodCommand(commandValue);
  if (typeof globalThis.crypto?.subtle?.digest !== "function") {
    throw new Error("WebCrypto SHA-256 é obrigatório para conferir um comando Food.");
  }
  const bytes = new TextEncoder().encode(JSON.stringify(command));
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
