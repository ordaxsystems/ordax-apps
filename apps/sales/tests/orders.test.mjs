import assert from "node:assert/strict";
import test from "node:test";
import {
  SALES_BOOK_SCHEMA,
  createSalesBook,
  validateSalesBook,
  appendSalesEvent,
  listSalesOrders,
} from "../src/domain/orders.mjs";

const scope = { ownerId: "account-1", spaceId: "pizza-centro" };
const initialTime = "2026-10-08T12:00:00Z";
const later = "2026-10-08T13:00:00Z";
const lines = [{ sku: "PIZZA-MARGHERITA", quantity: 2, unitPriceCents: 3490 }];
const created = (overrides = {}) => ({
  id: "evt-create-1", orderId: "order-1", kind: "created",
  occurredAt: initialTime, lines, reason: null, ...overrides,
});
const transition = (id, kind, overrides = {}) => ({
  id, orderId: "order-1", kind, occurredAt: later,
  lines: null, reason: kind === "cancelled" ? "Cancelado pelo cliente" : null,
  ...overrides,
});
const save = (book, value, authorizedScope = scope) =>
  appendSalesEvent(book, { authorizedScope, expectedRevision: book.revision, value });

test("sales owns the order lifecycle and derives totals only from integer cents", () => {
  const fresh = createSalesBook(scope);
  const pending = save(fresh, created());
  const confirmed = save(pending, transition("evt-confirm-1", "confirmed"));
  assert.equal(confirmed.schema, SALES_BOOK_SCHEMA);
  assert.equal(confirmed.revision, 2);
  const [order] = listSalesOrders(confirmed, { authorizedScope: scope });
  assert.equal(order.id, "order-1");
  assert.equal(order.state, "confirmed");
  assert.equal(order.totalCents, 6980);
  assert.equal(order.currency, "BRL");
  assert.equal(order.paid, false);
  assert.equal(order.stockReserved, false);
  assert.equal(fresh.events.length, 0);
  assert.deepEqual(validateSalesBook(confirmed), confirmed);
  assert.ok(Object.isFrozen(confirmed.events));
  assert.ok(Object.isFrozen(order.lines));
});

test("cancelled orders retain history, original prices and no payment assertion", () => {
  const createdBook = save(createSalesBook(scope), created());
  const approved = save(createdBook, transition("evt-confirm-1", "confirmed"));
  const cancelled = save(approved, transition("evt-cancel-1", "cancelled"));
  assert.equal(listSalesOrders(cancelled, { authorizedScope: scope })[0].state, "cancelled");
  assert.equal(listSalesOrders(cancelled, { authorizedScope: scope })[0].totalCents, 6980);
  assert.equal(cancelled.events[0].kind, "created");
  assert.equal(cancelled.events[1].kind, "confirmed");
  assert.equal(cancelled.events[2].kind, "cancelled");
  assert.throws(() => save(cancelled, transition("evt-confirm-2", "confirmed")),
    /transition is invalid/);
  assert.throws(() => save(cancelled, transition("evt-cancel-2", "cancelled")),
    /transition is invalid/);
});

test("prohibits cross-owner and cross-Space access to orders", () => {
  const book = save(createSalesBook(scope), created());
  for (const wrong of [
    { ...scope, ownerId: "other-account" },
    { ...scope, spaceId: "pizza-shopping" },
  ]) {
    assert.throws(() => listSalesOrders(book, { authorizedScope: wrong }),
      /another owner or Space/);
    assert.throws(() => save(book, transition("evt-confirm", "confirmed"), wrong),
      /another owner or Space/);
  }
});

test("CAS and idempotent retry never create duplicate orders", () => {
  const book = save(createSalesBook(scope), created());
  assert.deepEqual(save(book, created()), book);
  assert.throws(() => save(book, created({
    lines: [{ sku: "PIZZA-MARGHERITA", quantity: 1, unitPriceCents: 3490 }],
  })), /conflicting content/);
  assert.throws(() => appendSalesEvent(book, {
    authorizedScope: scope, expectedRevision: 0,
    value: transition("evt-confirm", "confirmed"),
  }), /revision conflict/);
  assert.throws(() => save(book, created({ id: "evt-create-2" })), /already created/);
  assert.throws(() => save(createSalesBook(scope), transition("evt-confirm", "confirmed")),
    /transition is invalid/);
});

test("rejects invalid prices, order IDs, timestamps and rogue authority fields", () => {
  const empty = createSalesBook(scope);
  for (const price of [0, -1, 12.50, Infinity, NaN, "1000"]) {
    assert.throws(() => save(empty, created({
      lines: [{ sku: "PIZZA-MARGHERITA", quantity: 1, unitPriceCents: price }],
    })), /positive integer cents/);
  }
  assert.throws(() => save(empty, created({ occurredAt: "2026-02-30T12:00:00Z" })),
    /canonical UTC/);
  assert.throws(() => save(empty, created({ orderId: "../private" })),
    /order id is invalid/);
  assert.throws(() => save(empty, { ...created(), grant: "root" }),
    /fields are incompatible/);
  assert.throws(() => save(empty, created({
    lines: [{ sku: "PIZZA-MARGHERITA", quantity: 2, unitPriceCents: 100, stockMovementId: "x" }],
  })), /fields are incompatible/);
  assert.throws(() => createSalesBook({ ...scope, subjectKey: "secret" }),
    /fields are incompatible/);
});

test("order transitions cannot predate creation or replace line items", () => {
  const book = save(createSalesBook(scope), created());
  assert.throws(() => save(book, transition("evt-confirm", "confirmed", {
    occurredAt: "2026-10-07T10:00:00Z",
  })), /out of order/);
  assert.throws(() => save(book, transition("evt-confirm", "confirmed", {
    lines,
  })), /cannot replace order lines/);
  assert.throws(() => save(book, transition("evt-cancel", "cancelled", {
    reason: null,
  })), /bounded reason/);
  assert.throws(() => validateSalesBook({ ...book, revision: 2 }), /revision or event count/);
});

test("different enterprises may have same SKU and independent orders", () => {
  const first = save(createSalesBook(scope), created());
  const otherScope = { ownerId: "account-2", spaceId: "pizza-centro" };
  const second = save(createSalesBook(otherScope), created(), otherScope);
  assert.deepEqual(listSalesOrders(first, { authorizedScope: scope }).map(x => x.totalCents), [6980]);
  assert.deepEqual(listSalesOrders(second, { authorizedScope: otherScope }).map(x => x.totalCents), [6980]);
  assert.equal(first.ownerId, "account-1");
  assert.equal(second.ownerId, "account-2");
});
