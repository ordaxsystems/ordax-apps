import assert from "node:assert/strict";
import test from "node:test";

import { renderPosPage } from "../src/ui/views.mjs";
import { createModaPreviewDataPort } from "../../../prototypes/moda/preview-data-port.mjs";

class MemoryStorage {
  #values = new Map();
  getItem(key) { return this.#values.get(key) ?? null; }
  setItem(key, value) { this.#values.set(key, String(value)); }
}

test("POS exposes an accessible SKU scan field without replacing catalog search", async () => {
  const port = createModaPreviewDataPort({ storage: new MemoryStorage() });
  const snapshot = await port.initialize();
  const html = renderPosPage(snapshot);

  assert.match(html, /type="search" data-pos-search/);
  assert.match(html, /data-pos-scan-sku aria-label="Escanear SKU da variante" aria-describedby="pos-scan-help"/);
  assert.match(html, /Escaneie ou digite o SKU e pressione Enter/);
  port.destroy();
});
