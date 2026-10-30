import test from "node:test";
import assert from "node:assert/strict";

import { deriveReturnValuePreview, returnableQuantity, stockForSku } from "../src/domain/derived.mjs";
import { renderReturnsPage } from "../src/ui/views.mjs";
import { createModaPreviewDataPort } from "../../../prototypes/moda/preview-data-port.mjs";

class MemoryStorage {
  #values = new Map();
  getItem(key) { return this.#values.get(key) ?? null; }
  setItem(key, value) { this.#values.set(key, String(value)); }
}

async function createPort() {
  const port = createModaPreviewDataPort({
    storage: new MemoryStorage(),
    clock: () => new Date("2026-10-25T12:00:00.000Z"),
  });
  return { port, state: await port.initialize() };
}

test("return and exchange preview uses the sold line and current replacement variant without settling payments", async () => {
  const { port, state } = await createPort();
  const sale = state.sales.orders.find((item) => item.id === "sale-1048");
  const returnedLine = sale.lines[0];
  const replacementProduct = state.catalog.products.find((item) => item.id === "bolsa-lumi");
  const replacement = replacementProduct.variants.find((item) => item.color === "Caramelo");
  const returnable = returnableQuantity(state, sale.id, returnedLine.sku);
  assert.ok(stockForSku(state, replacement.sku) > 0);

  const estimate = deriveReturnValuePreview(state, {
    saleId: sale.id,
    sku: returnedLine.sku,
    quantity: 1,
    type: "exchange",
    replacementSku: replacement.sku,
  });
  assert.equal(estimate.status, "ready");
  assert.equal(estimate.returnedValueCents, returnedLine.unitPriceCents);
  assert.equal(estimate.replacementValueCents, replacement.priceCents);
  assert.equal(estimate.differenceCents, replacement.priceCents - returnedLine.unitPriceCents);
  assert.equal(estimate.direction, "collect");
  assert.equal(deriveReturnValuePreview(state, {
    saleId: sale.id,
    sku: returnedLine.sku,
    quantity: returnable + 1,
    type: "exchange",
    replacementSku: replacement.sku,
  }), null, "the preview must not quote more units than the sale still allows to return");

  const returnEstimate = deriveReturnValuePreview(state, {
    saleId: sale.id,
    sku: returnedLine.sku,
    quantity: 1,
    type: "return",
  });
  assert.equal(returnEstimate.status, "reference-only");

  const initialMarkup = renderReturnsPage(state, sale.id);
  assert.match(initialMarkup, /data-return-value-preview role="status" aria-live="polite" hidden/);
  assert.match(initialMarkup, /Substituta \/ diferença/);

  const result = await port.execute({
    type: "return.create",
    payload: {
      saleId: sale.id,
      sku: returnedLine.sku,
      quantity: 1,
      type: "exchange",
      condition: "resalable",
      reason: "Troca de tamanho",
      replacementSku: replacement.sku,
    },
  });
  const history = renderReturnsPage(result.snapshot, sale.id);
  assert.match(history, /Bolsa Tiracolo Lumi/);
  assert.match(history, /Cliente paga/);
  assert.match(history, /140,00/);
  assert.match(history, /Acerto pendente/);
  assert.equal(result.result.settlement, "pending", "the local preview records no payment settlement");
  port.destroy();
});
