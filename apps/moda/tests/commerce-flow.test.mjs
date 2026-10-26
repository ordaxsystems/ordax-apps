import test from "node:test";
import assert from "node:assert/strict";
import { stockForSku } from "../src/domain/derived.mjs";
import { MAX_CHECKOUT_LINES, MAX_CHECKOUT_LINE_QUANTITY, normalizeCheckoutLines } from "../src/domain/checkout.mjs";
import { validateSalesBook } from "../../sales/src/domain/orders.mjs";
import { createModaPreviewDataPort, MAX_LOCAL_PREVIEW_MOVEMENTS } from "../../../prototypes/moda/preview-data-port.mjs";

class MemoryStorage {
  #values = new Map();
  getItem(key) { return this.#values.get(key) ?? null; }
  setItem(key, value) { this.#values.set(key, String(value)); }
}

function createPort({ storage = new MemoryStorage() } = {}) {
  return createModaPreviewDataPort({
    storage,
    clock: () => new Date("2026-10-25T12:00:00.000Z"),
  });
}

test("receipt accepts the local maximum and rejects invalid quantities atomically", async () => {
  const port = createPort();
  const initial = await port.initialize();
  const sku = "AUR-CAMISA-BRISA-P-AREIA";
  const stockBefore = stockForSku(initial, sku);
  const movementsBefore = initial.inventory.movements.length;

  const received = await port.execute({ type: "inventory.receive", payload: { sku, quantity: 100_000 } });
  assert.equal(received.result.quantity, 100_000);
  assert.equal(stockForSku(received.snapshot, sku), stockBefore + 100_000);
  assert.equal(received.snapshot.inventory.movements.length, movementsBefore + 1);

  for (const quantity of [0, -1, 1.5, 100_001]) {
    await assert.rejects(port.execute({ type: "inventory.receive", payload: { sku, quantity } }), /número inteiro entre 1 e 100000/);
  }
  assert.deepEqual(port.getSnapshot(), received.snapshot);
  port.destroy();
});

test("receipts stop at the bounded local preview movement limit", async () => {
  const storage = new MemoryStorage();
  const seedPort = createPort({ storage });
  const seed = await seedPort.initialize();
  const sku = "AUR-CAMISA-BRISA-P-AREIA";
  const filled = structuredClone(seed);
  for (let index = filled.inventory.movements.length; index < MAX_LOCAL_PREVIEW_MOVEMENTS; index += 1) {
    const id = `capacity-${index}`;
    filled.inventory.movements.push({
      id, sku, kind: "receive", quantity: 1,
      occurredAt: "2026-10-25T12:00:00.000Z", reversesId: null,
    });
    filled.inventory.references[id] = { kind: "stock-receipt", sourceId: id };
  }
  filled.inventory.revision = MAX_LOCAL_PREVIEW_MOVEMENTS;
  filled.revision += 1;
  storage.setItem("ordax.moda.atelie-aurora.preview.v1", JSON.stringify(filled));
  seedPort.destroy();

  const port = createPort({ storage });
  const snapshot = await port.initialize();
  const storedBefore = storage.getItem("ordax.moda.atelie-aurora.preview.v1");
  const stockBefore = stockForSku(snapshot, sku);
  assert.equal(snapshot.inventory.movements.length, MAX_LOCAL_PREVIEW_MOVEMENTS);

  await assert.rejects(
    port.execute({ type: "inventory.receive", payload: { sku, quantity: 1 } }),
    /limite de armazenamento de 2\.048 movimentações/,
  );
  assert.deepEqual(port.getSnapshot(), snapshot);
  assert.equal(stockForSku(port.getSnapshot(), sku), stockBefore);
  assert.equal(storage.getItem("ordax.moda.atelie-aurora.preview.v1"), storedBefore);
  port.destroy();
});

test("checkout line limits match the canonical Sales order schema", () => {
  const lines = Array.from({ length: MAX_CHECKOUT_LINES }, (_, index) => ({
    sku: "AUR-TEST-" + index,
    quantity: MAX_CHECKOUT_LINE_QUANTITY,
    unitPriceCents: 1,
  }));
  const normalized = normalizeCheckoutLines(lines);
  assert.equal(normalized.length, MAX_CHECKOUT_LINES);
  assert.ok(normalized.every((line) => line.quantity === MAX_CHECKOUT_LINE_QUANTITY));

  const book = validateSalesBook({
    schema: "ordax.sales-book/1", revision: 1,
    ownerId: "owner-test", spaceId: "space-test", currency: "BRL",
    events: [{
      id: "event-1", orderId: "order-1", kind: "created",
      occurredAt: "2026-10-25T12:00:00.000Z", lines, reason: null,
    }],
  });
  assert.equal(book.revision, 1);
  assert.throws(() => normalizeCheckoutLines([
    { sku: "AUR-TEST-1", quantity: MAX_CHECKOUT_LINE_QUANTITY + 1 },
  ]), /10\.000/);
});

test("checkout aggregates repeated SKUs and rejects combined oversell atomically", async () => {
  const port = createPort();
  const initial = await port.initialize();
  const sku = "AUR-CAMISA-BRISA-P-AREIA";
  const stockBefore = stockForSku(initial, sku);
  const salesBefore = initial.sales.orders.length;
  const movementsBefore = initial.inventory.movements.length;

  await assert.rejects(port.execute({
    type: "sale.complete",
    payload: { lines: [{ sku, quantity: 8 }, { sku, quantity: 8 }] },
  }), /Estoque insuficiente/);
  let current = port.getSnapshot();
  assert.equal(current.sales.orders.length, salesBefore);
  assert.equal(current.inventory.movements.length, movementsBefore);
  assert.equal(stockForSku(current, sku), stockBefore);

  const completed = await port.execute({
    type: "sale.complete",
    payload: { lines: [{ sku, quantity: 2 }, { sku, quantity: 3 }] },
  });
  assert.equal(completed.result.lines.length, 1);
  assert.equal(completed.result.lines[0].quantity, 5);
  assert.equal(stockForSku(completed.snapshot, sku), stockBefore - 5);
  assert.equal(completed.snapshot.inventory.movements.length, movementsBefore + 1);
  port.destroy();
});

test("checkout rejects an archived product without changing sales or stock", async () => {
  const port = createPort();
  const initial = await port.initialize();
  const product = initial.catalog.products.find((item) => item.id === "camisa-brisa");
  const sku = product.variants.find((item) => item.size === "P" && item.color === "Areia").sku;
  const stockBefore = stockForSku(initial, sku);
  const salesBefore = initial.sales.orders.length;
  await port.execute({ type: "catalog.toggle", payload: { productId: product.id } });

  await assert.rejects(port.execute({
    type: "sale.complete",
    payload: { lines: [{ sku, quantity: 1 }] },
  }), /não está mais disponível/);
  const current = port.getSnapshot();
  assert.equal(current.sales.orders.length, salesBefore);
  assert.equal(stockForSku(current, sku), stockBefore);
  port.destroy();
});

test("exchange returns resalable stock, dispatches its replacement, and leaves price difference pending", async () => {
  const port = createPort();
  const initial = await port.initialize();
  const sale = initial.sales.orders.find((item) => item.id === "sale-1048");
  const returnedSku = sale.lines[0].sku;
  const replacementSku = initial.catalog.products.find((item) => item.id === "bolsa-lumi")
    .variants.find((item) => item.color === "Caramelo").sku;
  const originalStock = stockForSku(initial, returnedSku);
  const replacementStock = stockForSku(initial, replacementSku);

  const result = await port.execute({
    type: "return.create",
    payload: {
      saleId: sale.id, sku: returnedSku, quantity: 1,
      type: "exchange", condition: "resalable", reason: "Cliente prefere outra peça",
      replacementSku,
    },
  });
  assert.equal(result.result.restocked, true);
  assert.equal(result.result.differenceCents, 14_000);
  assert.equal(result.result.settlement, "pending");
  assert.equal(stockForSku(result.snapshot, returnedSku), originalStock + 1);
  assert.equal(stockForSku(result.snapshot, replacementSku), replacementStock - 1);

  const movementsAfterExchange = result.snapshot.inventory.movements.length;
  await assert.rejects(port.execute({
    type: "return.create",
    payload: {
      saleId: sale.id, sku: returnedSku, quantity: 1,
      type: "return", condition: "resalable", reason: "Repetição de devolução",
    },
  }), /saldo não devolvido/);
  assert.equal(port.getSnapshot().inventory.movements.length, movementsAfterExchange);
  port.destroy();
});

test("a damaged return uses the sale allowance but does not add stock", async () => {
  const port = createPort();
  const initial = await port.initialize();
  const sale = initial.sales.orders.find((item) => item.id === "sale-1048");
  const sku = sale.lines[1].sku;
  const stockBefore = stockForSku(initial, sku);

  const result = await port.execute({
    type: "return.create",
    payload: {
      saleId: sale.id, sku, quantity: 1,
      type: "return", condition: "damaged", reason: "Peça devolvida com avaria",
    },
  });
  assert.equal(result.result.restocked, false);
  assert.equal(stockForSku(result.snapshot, sku), stockBefore);
  await assert.rejects(port.execute({
    type: "return.create",
    payload: {
      saleId: sale.id, sku, quantity: 1,
      type: "return", condition: "resalable", reason: "Não devolver duas vezes",
    },
  }), /saldo não devolvido/);
  assert.equal(stockForSku(port.getSnapshot(), sku), stockBefore);
  port.destroy();
});
