import test from "node:test";
import assert from "node:assert/strict";

import { createModaPreviewDataPort } from "../../../prototypes/moda/preview-data-port.mjs";
import { renderCustomersPage, renderPosPage, renderReturnsPage, renderTeamPage } from "../src/ui/views.mjs";
import { returnableQuantity } from "../src/domain/derived.mjs";

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

test("view counters use singular and plural labels for zero, one, and multiple records", async () => {
  const state = await createState();
  const originalReturn = structuredClone(state.returns.items[0]);

  state.returns.items = [];
  assert.match(renderReturnsPage(state), /0 registros<\/span>/);

  state.returns.items = [originalReturn];
  assert.match(renderReturnsPage(state), /1 registro<\/span>/);
  state.returns.items.push({ ...originalReturn, id: "return-extra" });
  assert.match(renderReturnsPage(state), /2 registros<\/span>/);

  state.team.members = state.team.members.slice(0, 1);
  assert.match(renderTeamPage(state), /1 pessoa<\/span>/);

  state.customers.records = state.customers.records.slice(0, 1);
  assert.match(renderCustomersPage(state), /1 cadastro<\/span>/);

  state.sales.orders = state.sales.orders.slice(0, 1);
  assert.match(renderPosPage(state), /1 venda registrada<\/span>/);
});

test("return form derives its quantity limit from the sale and marks zero-stock replacements unavailable", async () => {
  const state = await createState();
  const sale = [...state.sales.orders].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  const firstReturnableLine = sale.lines.find((line) => returnableQuantity(state, sale.id, line.sku) > 0);
  assert.ok(firstReturnableLine);
  const returnable = returnableQuantity(state, sale.id, firstReturnableLine.sku);
  const initialMarkup = renderReturnsPage(state, sale.id);
  assert.match(initialMarkup, new RegExp('name="quantity" data-return-quantity type="number" min="1" max="' + returnable + '"'));
  assert.match(initialMarkup, new RegExp('value="' + firstReturnableLine.sku + '" data-returnable="' + returnable + '"'));

  const unavailableSku = state.catalog.products.flatMap((product) => product.variants)
    .find((variant) => variant.sku !== firstReturnableLine.sku)?.sku;
  assert.ok(unavailableSku);
  state.inventory.movements = state.inventory.movements.filter((movement) => movement.sku !== unavailableSku);
  const unavailableMarkup = renderReturnsPage(state, sale.id);
  assert.match(unavailableMarkup, new RegExp('value="' + unavailableSku + '" data-stock="0" disabled'));
});
