import assert from "node:assert/strict";
import test from "node:test";
import {
  INVENTORY_LEDGER_SCHEMA,
  createInventoryLedger,
  validateInventoryLedger,
  appendInventoryMovement,
  inventoryOnHand,
} from "../src/domain/movements.mjs";

const scope = { ownerId: "account-1", spaceId: "pizza-centro" };
const now = "2026-10-08T12:00:00Z";
const later = "2026-10-08T14:00:00Z";
const event = (id, kind, quantity, extra = {}) => ({
  id, sku: "MUSSARELA", kind, quantity, occurredAt: now,
  reversesId: null, ...extra,
});
const save = (book, value, authorizedScope = scope) =>
  appendInventoryMovement(book, { authorizedScope, expectedRevision: book.revision, value });

test("inventory movements preserve exact on-hand quantities and source history", () => {
  const empty = createInventoryLedger(scope);
  const stocked = save(empty, event("r1", "receive", 30));
  const shipped = save(stocked, event("d1", "dispatch", 12));
  assert.equal(shipped.schema, INVENTORY_LEDGER_SCHEMA);
  assert.equal(inventoryOnHand(shipped, { authorizedScope: scope, sku: "MUSSARELA" }), 18);
  assert.equal(inventoryOnHand(shipped, { authorizedScope: scope, sku: "OUTRO" }), 0);
  assert.equal(empty.movements.length, 0);
  assert.equal(stocked.movements.length, 1);
  assert.equal(shipped.movements.length, 2);
  assert.ok(Object.isFrozen(shipped.movements[0]));
  assert.deepEqual(validateInventoryLedger(shipped), shipped);
});

test("must never dispatch into negative stock and reversals stay append-only", () => {
  const stocked = save(createInventoryLedger(scope), event("r1", "receive", 10));
  assert.throws(() => save(stocked, event("d1", "dispatch", 11)), /negative or unsafe stock/);
  const dispatched = save(stocked, event("d1", "dispatch", 4));
  const reversed = save(dispatched, event("r2", "reversal", 4, {
    reversesId: "d1", occurredAt: later,
  }));
  assert.equal(inventoryOnHand(reversed, { authorizedScope: scope, sku: "MUSSARELA" }), 10);
  assert.equal(reversed.movements[1].kind, "dispatch");
  assert.throws(() => save(reversed, event("r3", "reversal", 4, {
    reversesId: "d1", occurredAt: later,
  })), /match one existing/);
  assert.throws(() => save(dispatched, event("r4", "reversal", 10, {
    reversesId: "r1", occurredAt: later,
  })), /negative or unsafe stock/);
});

test("reversal cannot forge a different SKU, quantity, time or unknown origin", () => {
  const stocked = save(createInventoryLedger(scope), event("r1", "receive", 10));
  for (const extra of [
    { sku: "FARINHA", reversesId: "r1" },
    { quantity: 9, reversesId: "r1" },
    { reversesId: "not-exists" },
  ]) assert.throws(() => save(stocked, event("r2", "reversal", 10, extra)),
    /match one existing/);
  assert.throws(() => save(stocked, event("r2", "reversal", 10, {
    reversesId: "r1", occurredAt: "2026-10-07T12:00:00Z",
  })), /cannot predate/);
});

test("same-owner other Space or other owner cannot be accessed", () => {
  const book = save(createInventoryLedger(scope), event("r1", "receive", 2));
  for (const wrong of [
    { ...scope, spaceId: "pizza-shopping" },
    { ...scope, ownerId: "account-2" },
  ]) {
    assert.throws(() => inventoryOnHand(book, {
      authorizedScope: wrong, sku: "MUSSARELA",
    }), /another owner or Space/);
    assert.throws(() => save(book, event("d1", "dispatch", 1), wrong),
      /another owner or Space/);
  }
});

test("detects CAS conflicts, duplicate movement IDs and invalid quantities", () => {
  const original = createInventoryLedger(scope);
  const first = save(original, event("r1", "receive", 10));
  assert.throws(() => appendInventoryMovement(first, {
    authorizedScope: scope, expectedRevision: 0, value: event("r2", "receive", 2),
  }), /revision conflict/);
  assert.deepEqual(save(first, event("r1", "receive", 10)), first);
  assert.throws(() => save(first, event("r1", "receive", 8)), /conflicts with existing/);
  for (const value of [0, -1, NaN, Infinity, 3.2, "10", 1e10]) {
    assert.throws(() => save(original, event("invalid", "receive", value)),
      /positive integer/);
  }
  assert.throws(() => validateInventoryLedger({
    ...first, revision: 2,
  }), /revision or movement count/);
  assert.throws(() => save(original, { ...event("r1", "receive", 3), authority: "root" }),
    /incompatible fields/);
});

test("rejects malformed timestamps and IDs, without inventing authorization", () => {
  const original = createInventoryLedger(scope);
  assert.throws(() => save(original, event("r1", "receive", 2, {
    occurredAt: "2026-02-30T12:00:00Z",
  })), /timestamp must be UTC/);
  assert.throws(() => save(original, event("../traversal", "receive", 2)),
    /movement id is invalid/);
  assert.throws(() => createInventoryLedger({ ...scope, grant: "unknown" }),
    /incompatible fields/);
});
