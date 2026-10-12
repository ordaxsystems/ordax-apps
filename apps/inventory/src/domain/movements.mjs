// Product-owned stock movements. No App Data, Identity, Store or cross-app writes.
export const INVENTORY_LEDGER_SCHEMA = "ordax.inventory-ledger/1";
export const MAX_INVENTORY_MOVEMENTS = 2048;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/;
const SKU = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const MAX_QUANTITY = 1_000_000;

function exact(value, fields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).sort().join(",") !== [...fields].sort().join(",")) {
    throw new TypeError(label + " has incompatible fields");
  }
  return value;
}

function id(value, label, pattern = ID) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new TypeError(label + " is invalid");
  }
  return value;
}

function time(value) {
  if (typeof value !== "string"
      || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)) {
    throw new TypeError("Inventory timestamp must be UTC");
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)
      || ![new Date(timestamp).toISOString(), new Date(timestamp).toISOString().replace(".000Z", "Z")].includes(value)) {
    throw new TypeError("Inventory timestamp must be UTC");
  }
  return value;
}

function scope(value) {
  const candidate = exact(value, ["ownerId", "spaceId"], "Inventory scope");
  return Object.freeze({
    ownerId: id(candidate.ownerId, "Inventory owner"),
    spaceId: id(candidate.spaceId, "Inventory Space"),
  });
}

function movement(value) {
  const entry = exact(value,
    ["id", "sku", "kind", "quantity", "occurredAt", "reversesId"], "Inventory movement");
  const movementId = id(entry.id, "Inventory movement id");
  const sku = id(entry.sku, "Inventory SKU", SKU);
  if (!["receive", "dispatch", "reversal"].includes(entry.kind)) {
    throw new TypeError("Inventory movement kind is invalid");
  }
  if (!Number.isSafeInteger(entry.quantity) || entry.quantity < 1 || entry.quantity > MAX_QUANTITY) {
    throw new TypeError("Inventory movement quantity must be a positive integer");
  }
  const reversesId = entry.kind === "reversal" ? id(entry.reversesId, "Inventory reversed movement") : null;
  if (entry.kind !== "reversal" && entry.reversesId !== null) {
    throw new TypeError("Only Inventory reversals reference another movement");
  }
  if (reversesId === movementId) throw new TypeError("Inventory cannot reverse itself");
  return Object.freeze({
    id: movementId, sku, kind: entry.kind,
    quantity: entry.quantity, occurredAt: time(entry.occurredAt), reversesId,
  });
}

function evaluate(entries) {
  const originals = new Map();
  const reversed = new Set();
  const stocks = new Map();
  for (const row of entries) {
    if (originals.has(row.id)) throw new TypeError("Duplicate Inventory movement id");
    let kind = row.kind;
    if (row.kind === "reversal") {
      const original = originals.get(row.reversesId);
      if (!original || original.kind === "reversal" || reversed.has(original.id)
          || original.sku !== row.sku || original.quantity !== row.quantity) {
        throw new TypeError("Inventory reversal must match one existing movement");
      }
      if (Date.parse(row.occurredAt) < Date.parse(original.occurredAt)) {
        throw new TypeError("Inventory reversal cannot predate the movement");
      }
      reversed.add(original.id);
      kind = original.kind === "receive" ? "dispatch" : "receive";
    }
    const stock = (stocks.get(row.sku) ?? 0)
      + row.quantity * (kind === "receive" ? 1 : -1);
    if (!Number.isSafeInteger(stock) || stock < 0) {
      throw new RangeError("Inventory movement would produce negative or unsafe stock");
    }
    stocks.set(row.sku, stock);
    originals.set(row.id, row);
  }
  return stocks;
}

export function validateInventoryLedger(value) {
  const ledger = exact(value,
    ["schema", "revision", "ownerId", "spaceId", "movements"], "Inventory ledger");
  if (ledger.schema !== INVENTORY_LEDGER_SCHEMA) {
    throw new TypeError("Inventory ledger schema is invalid");
  }
  const identity = scope({ ownerId: ledger.ownerId, spaceId: ledger.spaceId });
  if (!Number.isSafeInteger(ledger.revision) || ledger.revision < 0
      || !Array.isArray(ledger.movements) || ledger.movements.length > MAX_INVENTORY_MOVEMENTS
      || ledger.revision !== ledger.movements.length) {
    throw new TypeError("Inventory ledger revision or movement count is invalid");
  }
  const movements = ledger.movements.map(movement);
  evaluate(movements);
  return Object.freeze({
    schema: INVENTORY_LEDGER_SCHEMA, revision: ledger.revision,
    ownerId: identity.ownerId, spaceId: identity.spaceId,
    movements: Object.freeze(movements),
  });
}

export function createInventoryLedger(authorizedScope) {
  const identity = scope(authorizedScope);
  return validateInventoryLedger({
    schema: INVENTORY_LEDGER_SCHEMA, revision: 0,
    ...identity, movements: [],
  });
}

function scoped(value, authorizedScope) {
  const ledger = validateInventoryLedger(value);
  const identity = scope(authorizedScope);
  if (ledger.ownerId !== identity.ownerId || ledger.spaceId !== identity.spaceId) {
    throw new Error("Inventory belongs to another owner or Space");
  }
  return ledger;
}

export function appendInventoryMovement(snapshot, {
  authorizedScope, expectedRevision, value,
} = {}) {
  const ledger = scoped(snapshot, authorizedScope);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== ledger.revision) {
    throw new Error("Inventory ledger revision conflict");
  }
  const next = movement(value);
  const existing = ledger.movements.find((row) => row.id === next.id);
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(next)) {
      throw new Error("Inventory movement id conflicts with existing content");
    }
    return ledger; // exact replay creates no additional stock
  }
  if (ledger.movements.length >= MAX_INVENTORY_MOVEMENTS) {
    throw new RangeError("Inventory ledger reached maximum movement count");
  }
  return validateInventoryLedger({
    ...ledger, revision: ledger.revision + 1,
    movements: [...ledger.movements, next],
  });
}

export function inventoryOnHand(snapshot, { authorizedScope, sku } = {}) {
  const ledger = scoped(snapshot, authorizedScope);
  const product = id(sku, "Inventory SKU", SKU);
  return evaluate(ledger.movements).get(product) ?? 0;
}
