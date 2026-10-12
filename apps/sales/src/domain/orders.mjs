// OrdaX Sales domain. Orders are app-owned; no Inventory or Finance writes.
export const SALES_BOOK_SCHEMA = "ordax.sales-book/1";
export const MAX_SALES_EVENTS = 2048;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/;
const SKU = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

function exact(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).sort().join(",") !== [...expected].sort().join(",")) {
    throw new TypeError(label + " fields are incompatible");
  }
  return value;
}

function id(value, label, pattern = ID) {
  if (typeof value !== "string" || !pattern.test(value)) throw new TypeError(label + " is invalid");
  return value;
}

function utc(value) {
  if (typeof value !== "string"
      || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)) {
    throw new TypeError("Sales event timestamp must be canonical UTC");
  }
  const when = Date.parse(value);
  if (!Number.isFinite(when)
      || ![new Date(when).toISOString(), new Date(when).toISOString().replace(".000Z", "Z")].includes(value)) {
    throw new TypeError("Sales event timestamp must be canonical UTC");
  }
  return value;
}

function scope(value) {
  const v = exact(value, ["ownerId", "spaceId"], "Sales authorized scope");
  return Object.freeze({
    ownerId: id(v.ownerId, "Sales owner"),
    spaceId: id(v.spaceId, "Sales Space"),
  });
}

function saleLine(value) {
  const row = exact(value, ["sku", "quantity", "unitPriceCents"], "Sales order line");
  const sku = id(row.sku, "Sales SKU", SKU);
  if (!Number.isSafeInteger(row.quantity) || row.quantity < 1 || row.quantity > 10_000) {
    throw new TypeError("Sales line quantity is invalid");
  }
  if (!Number.isSafeInteger(row.unitPriceCents)
      || row.unitPriceCents < 1 || row.unitPriceCents > 1_000_000_000) {
    throw new TypeError("Sales unit price must be positive integer cents");
  }
  return Object.freeze({ sku, quantity: row.quantity, unitPriceCents: row.unitPriceCents });
}

function event(value) {
  const raw = exact(value,
    ["id", "orderId", "kind", "occurredAt", "lines", "reason"], "Sales event");
  const eventId = id(raw.id, "Sales event id");
  const orderId = id(raw.orderId, "Sales order id");
  if (!["created", "confirmed", "cancelled"].includes(raw.kind)) {
    throw new TypeError("Sales event kind is invalid");
  }
  const lines = raw.kind === "created" ? raw.lines : null;
  if (raw.kind === "created") {
    if (!Array.isArray(lines) || lines.length < 1 || lines.length > 64) {
      throw new TypeError("Sales created order must have bounded lines");
    }
    if (raw.reason !== null) throw new TypeError("Sales creation cannot be cancelled");
  } else if (raw.lines !== null) {
    throw new TypeError("Sales transition cannot replace order lines");
  }
  if (raw.kind === "cancelled") {
    if (typeof raw.reason !== "string" || !raw.reason.trim()
        || raw.reason.length > 240 || raw.reason.includes("\0")) {
      throw new TypeError("Sales cancellation requires a bounded reason");
    }
  } else if (raw.reason !== null) {
    throw new TypeError("Sales reason only applies to a cancellation");
  }
  return Object.freeze({
    id: eventId, orderId, kind: raw.kind, occurredAt: utc(raw.occurredAt),
    lines: lines === null ? null : Object.freeze(lines.map(saleLine)),
    reason: raw.kind === "cancelled" ? raw.reason.trim() : null,
  });
}

function amount(lines) {
  let cents = 0n;
  for (const line of lines) cents += BigInt(line.unitPriceCents) * BigInt(line.quantity);
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("Sales order total exceeds safe integer cents");
  }
  return Number(cents);
}

function summarizeEvents(events) {
  const eventIds = new Set();
  const orders = new Map();
  for (const item of events) {
    if (eventIds.has(item.id)) throw new TypeError("Duplicate Sales event id");
    eventIds.add(item.id);
    const known = orders.get(item.orderId);
    if (item.kind === "created") {
      if (known) throw new TypeError("Sales order already created");
      const totals = amount(item.lines);
      orders.set(item.orderId, Object.freeze({
        id: item.orderId, state: "draft", createdAt: item.occurredAt,
        updatedAt: item.occurredAt, lines: item.lines, totalCents: totals,
        currency: "BRL", cancellationReason: null,
        // Payment and stock remain owned by other apps. This is order value,
        // not cash received, stock reserved, tax, or accounting profit.
        paid: false, stockReserved: false,
      }));
      continue;
    }
    if (!known || known.state === "cancelled"
        || (item.kind === "confirmed" && known.state !== "draft")
        || Date.parse(item.occurredAt) < Date.parse(known.updatedAt)) {
      throw new TypeError("Sales transition is invalid or out of order");
    }
    orders.set(item.orderId, Object.freeze({
      ...known,
      state: item.kind === "confirmed" ? "confirmed" : "cancelled",
      updatedAt: item.occurredAt,
      cancellationReason: item.kind === "cancelled" ? item.reason : null,
    }));
  }
  return orders;
}

export function validateSalesBook(value) {
  const book = exact(value,
    ["schema", "revision", "ownerId", "spaceId", "currency", "events"], "Sales book");
  if (book.schema !== SALES_BOOK_SCHEMA || book.currency !== "BRL") {
    throw new TypeError("Sales book schema or currency is invalid");
  }
  const identity = scope({ ownerId: book.ownerId, spaceId: book.spaceId });
  if (!Array.isArray(book.events) || book.events.length > MAX_SALES_EVENTS
      || !Number.isSafeInteger(book.revision) || book.revision !== book.events.length) {
    throw new TypeError("Sales revision or event count is invalid");
  }
  const events = book.events.map(event);
  summarizeEvents(events);
  return Object.freeze({
    schema: SALES_BOOK_SCHEMA, revision: book.revision,
    ...identity, currency: "BRL", events: Object.freeze(events),
  });
}

export function createSalesBook(authorizedScope) {
  const identity = scope(authorizedScope);
  return validateSalesBook({
    schema: SALES_BOOK_SCHEMA, revision: 0,
    ...identity, currency: "BRL", events: [],
  });
}

function scoped(source, authorizedScope) {
  const book = validateSalesBook(source);
  const identity = scope(authorizedScope);
  if (book.ownerId !== identity.ownerId || book.spaceId !== identity.spaceId) {
    throw new Error("Sales book belongs to another owner or Space");
  }
  return book;
}

export function appendSalesEvent(book, { authorizedScope, expectedRevision, value } = {}) {
  const current = scoped(book, authorizedScope);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== current.revision) {
    throw new Error("Sales book revision conflict");
  }
  const next = event(value);
  const duplicate = current.events.find((row) => row.id === next.id);
  if (duplicate) {
    if (JSON.stringify(duplicate) !== JSON.stringify(next)) {
      throw new Error("Sales event id has conflicting content");
    }
    return current;
  }
  if (current.events.length >= MAX_SALES_EVENTS) {
    throw new RangeError("Sales book event limit reached");
  }
  return validateSalesBook({
    ...current, revision: current.revision + 1,
    events: [...current.events, next],
  });
}

export function listSalesOrders(book, { authorizedScope } = {}) {
  const current = scoped(book, authorizedScope);
  return Object.freeze([...summarizeEvents(current.events).values()]);
}
