import test from "node:test";
import assert from "node:assert/strict";

import { createModaPreviewDataPort } from "../../../prototypes/moda/preview-data-port.mjs";
import { searchMatches } from "../src/domain/derived.mjs";
import { renderCustomersPage, renderInventoryPage, renderPosPage, renderProductsPage } from "../src/ui/views.mjs";

class MemoryStorage {
  #values = new Map();
  getItem(key) { return this.#values.get(key) ?? null; }
  setItem(key, value) { this.#values.set(key, String(value)); }
}

async function createState() {
  const port = createModaPreviewDataPort({
    storage: new MemoryStorage(),
    clock: () => new Date("2026-10-25T12:00:00.000Z"),
  });
  try {
    return structuredClone(await port.initialize());
  } finally {
    port.destroy();
  }
}

test("shared search matching ignores Portuguese accents and letter case", () => {
  assert.equal(searchMatches("tenis", "Tênis Canvas Sol"), true);
  assert.equal(searchMatches("CALCA", "Calça Reta Celeste"), true);
  assert.equal(searchMatches("sao", "São Paulo"), true);
  assert.equal(searchMatches("luna", "Tênis Canvas Sol"), false);
  assert.equal(searchMatches("   ", "qualquer produto"), true);
});

test("catalog, POS, inventory, and customer filters accept accentless searches", async () => {
  const state = await createState();

  assert.match(renderProductsPage(state, "tenis"), /Tênis Canvas Sol/);
  assert.doesNotMatch(renderProductsPage(state, "tenis"), /Calça Reta Celeste/);
  assert.match(renderPosPage(state, { query: "tenis" }), /Tênis Canvas Sol/);
  assert.match(renderInventoryPage(state, "calca"), /Calça Reta Celeste/);

  state.customers.records[0].name = "Júlia da Silva";
  assert.match(renderCustomersPage(state, "julia"), /Júlia da Silva/);
});
