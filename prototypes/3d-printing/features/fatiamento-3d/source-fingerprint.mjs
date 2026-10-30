export async function fingerprintSourceBytes(sourceBytes, cryptoProvider = globalThis.crypto) {
  const isBuffer = sourceBytes instanceof ArrayBuffer;
  const isView = ArrayBuffer.isView(sourceBytes);
  if (!isBuffer && !isView) throw new TypeError("A identidade do modelo precisa dos bytes originais.");
  if (typeof cryptoProvider?.subtle?.digest !== "function") {
    throw new Error("Este host precisa oferecer SHA-256 via Web Crypto para identificar o modelo com segurança.");
  }

  const digest = await cryptoProvider.subtle.digest("SHA-256", sourceBytes);
  const hex = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
  return `sha256-${hex}`;
}
