// Product-owned financial cash-flow domain, without storage or system authority.
// This module is NOT an installable app or a substitute for scoped App Data.
export const FINANCE_LEDGER_SCHEMA = "ordax.finance-ledger/1";
export const MAX_FINANCE_ENTRIES = 2048;
export const MAX_FINANCE_ENTRY_CENTS = 100_000_000_000; // 1 billion BRL / entry
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/;
const ENTRY_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,95}$/;
const KINDS = new Set(["income", "expense", "reversal"]);

function exact(value, fields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join(",") !== [...fields].sort().join(",")) {
    throw new TypeError(label + " has incompatible fields");
  }
  return value;
}

function scopeId(value, label) {
  if (typeof value !== "string" || !ID.test(value)) {
    throw new TypeError(label + " is invalid");
  }
  return value;
}

function boundedText(value, label, maximum) {
  if (typeof value !== "string" || !value.trim()
      || value.length > maximum || value.includes("\0")) {
    throw new TypeError(label + " must be bounded text");
  }
  return value.trim();
}

function instant(value) {
  if (typeof value !== "string" || value.length > 24
      || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)) {
    throw new TypeError("Finance entry timestamp must be canonical UTC");
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)
      || ![new Date(parsed).toISOString(), new Date(parsed).toISOString().replace(".000Z", "Z")].includes(value)) {
    throw new TypeError("Finance entry timestamp must be canonical UTC");
  }
  return value;
}

function entry(value) {
  const source = exact(value,
    ["id", "kind", "amountCents", "description", "occurredAt", "reversesId"],
    "Finance entry");
  if (typeof source.id !== "string" || !ENTRY_ID.test(source.id)) {
    throw new TypeError("Finance entry id is invalid");
  }
  if (!KINDS.has(source.kind)) throw new TypeError("Finance entry kind is invalid");
  if (!Number.isSafeInteger(source.amountCents) || source.amountCents < 1
      || source.amountCents > MAX_FINANCE_ENTRY_CENTS) {
    throw new TypeError("Finance entry amount must be positive integer cents");
  }
  const reversesId = source.kind === "reversal"
    ? source.reversesId
    : null;
  if (source.kind === "reversal") {
    if (typeof reversesId !== "string" || !ENTRY_ID.test(reversesId)
        || reversesId === source.id) {
      throw new TypeError("Finance reversal reference is invalid");
    }
  } else if (source.reversesId !== null) {
    throw new TypeError("Only a reversal can reference another entry");
  }
  return Object.freeze({
    id: source.id, kind: source.kind, amountCents: source.amountCents,
    description: boundedText(source.description, "Finance entry description", 240),
    occurredAt: instant(source.occurredAt), reversesId,
  });
}

export function validateFinanceLedger(value) {
  const source = exact(value,
    ["schema", "revision", "ownerId", "spaceId", "currency", "entries"],
    "Finance ledger");
  if (source.schema !== FINANCE_LEDGER_SCHEMA || source.currency !== "BRL") {
    throw new TypeError("Finance ledger schema or currency is invalid");
  }
  if (!Number.isSafeInteger(source.revision) || source.revision < 0) {
    throw new TypeError("Finance ledger revision is invalid");
  }
  const ownerId = scopeId(source.ownerId, "Finance owner");
  const spaceId = scopeId(source.spaceId, "Finance Space");
  if (!Array.isArray(source.entries) || source.entries.length > MAX_FINANCE_ENTRIES) {
    throw new TypeError("Finance ledger entry count exceeds bounds");
  }
  const known = new Map();
  const reversed = new Set();
  const entries = source.entries.map((raw) => {
    const normalized = entry(raw);
    if (known.has(normalized.id)) {
      throw new TypeError("Duplicate Finance entry id");
    }
    if (normalized.kind === "reversal") {
      const original = known.get(normalized.reversesId);
      if (!original || original.kind === "reversal"
          || reversed.has(normalized.reversesId)
          || original.amountCents !== normalized.amountCents) {
        throw new TypeError("Finance reversal must match a single existing entry");
      }
      if (Date.parse(normalized.occurredAt) < Date.parse(original.occurredAt)) {
        throw new TypeError("Finance reversal cannot predate the original entry");
      }
      reversed.add(normalized.reversesId);
    }
    known.set(normalized.id, normalized);
    return normalized;
  });
  // Every logical append increments revision exactly once. This also prevents
  // a snapshot with unseen events being mistaken for revision zero.
  if (source.revision !== entries.length) {
    throw new TypeError("Finance ledger revision and append count diverged");
  }
  return Object.freeze({
    schema: FINANCE_LEDGER_SCHEMA, revision: source.revision,
    ownerId, spaceId, currency: "BRL", entries: Object.freeze(entries),
  });
}

// Caller supplies scope derived from the OS, not from a text prompt. This
// comparison is defense in depth and DOES NOT authenticate the caller.
export function assertFinanceScope(ledger, authorizedScope) {
  const snapshot = validateFinanceLedger(ledger);
  const scope = exact(authorizedScope, ["ownerId", "spaceId"], "Finance authorized scope");
  const ownerId = scopeId(scope.ownerId, "Finance authorized owner");
  const spaceId = scopeId(scope.spaceId, "Finance authorized Space");
  if (snapshot.ownerId !== ownerId || snapshot.spaceId !== spaceId) {
    throw new Error("Finance ledger belongs to another owner or Space");
  }
  return snapshot;
}

export function createFinanceLedger(authorizedScope) {
  const scope = exact(authorizedScope, ["ownerId", "spaceId"], "Finance authorized scope");
  return validateFinanceLedger({
    schema: FINANCE_LEDGER_SCHEMA, revision: 0,
    ownerId: scopeId(scope.ownerId, "Finance owner"),
    spaceId: scopeId(scope.spaceId, "Finance Space"),
    currency: "BRL", entries: [],
  });
}

export function appendFinanceEntry(ledger, {
  authorizedScope, expectedRevision, value,
} = {}) {
  const snapshot = assertFinanceScope(ledger, authorizedScope);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new TypeError("Finance expected revision must be a safe integer");
  }
  const next = entry(value);
  if (snapshot.revision !== expectedRevision) {
    // A caller may lose the acknowledgement for a committed append. A true
    // retry carries its ORIGINAL expectedRevision, which is exactly the index
    // occupied by that append in the immutable journal. Only that byte-for-
    // byte equivalent entry may be acknowledged without another mutation.
    // Later/foreign events and other stale writes must still conflict.
    const originallyCommitted = snapshot.entries[expectedRevision];
    if (expectedRevision < snapshot.revision && originallyCommitted?.id === next.id) {
      if (JSON.stringify(originallyCommitted) !== JSON.stringify(next)) {
        throw new Error("Finance entry id has conflicting content");
      }
      return snapshot;
    }
    throw new Error("Finance ledger revision conflict");
  }
  const duplicate = snapshot.entries.find((item) => item.id === next.id);
  if (duplicate) {
    if (JSON.stringify(duplicate) !== JSON.stringify(next)) {
      throw new Error("Finance entry id has conflicting content");
    }
    return snapshot; // idempotent exact retry
  }
  if (snapshot.entries.length >= MAX_FINANCE_ENTRIES) {
    throw new RangeError("Finance ledger reached maximum entry count");
  }
  return validateFinanceLedger({
    ...snapshot, revision: snapshot.revision + 1,
    entries: [...snapshot.entries, next],
  });
}

function safeAmount(value, label) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError(label + " exceeds safe integer cents");
  }
  return Number(value);
}

// A cash-flow report, not an accounting/tax profit-and-loss statement.
// Period is [start, end), and a reversal affects the date of its own entry.
export function summarizeFinanceLedger(ledger, {
  authorizedScope, start, end,
} = {}) {
  const snapshot = assertFinanceScope(ledger, authorizedScope);
  const from = instant(start);
  const until = instant(end);
  if (Date.parse(until) <= Date.parse(from)) {
    throw new TypeError("Finance report period must have a positive duration");
  }
  const sources = new Map(snapshot.entries.map((item) => [item.id, item]));
  let income = 0n;
  let expenses = 0n;
  let count = 0;
  for (const item of snapshot.entries) {
    if (Date.parse(item.occurredAt) < Date.parse(from)
        || Date.parse(item.occurredAt) >= Date.parse(until)) continue;
    const actual = item.kind === "reversal" ? sources.get(item.reversesId).kind : item.kind;
    const delta = BigInt(item.amountCents) * (item.kind === "reversal" ? -1n : 1n);
    if (actual === "income") income += delta;
    else expenses += delta;
    count += 1;
  }
  return Object.freeze({
    schema: "ordax.finance-cash-flow/1",
    ownerId: snapshot.ownerId, spaceId: snapshot.spaceId,
    currency: "BRL", start: from, end: until, entryCount: count,
    incomeCents: safeAmount(income, "Finance income"),
    expenseCents: safeAmount(expenses, "Finance expenses"),
    netCents: safeAmount(income - expenses, "Finance net cash flow"),
    isAccountingProfit: false,
  });
}


// Read-only, bounded journal browsing for a future authorized Finance UI.
// Every page carries the revision pinned by its first request; a concurrent
// append invalidates the continuation instead of skipping/repeating entries.
// This is not a storage port, Identity check, or accounting statement.
export function queryFinanceEntries(ledger, {
  authorizedScope, expectedRevision, start, end,
  kinds = ["income", "expense", "reversal"],
  offset = 0, limit = 50,
} = {}) {
  const snapshot = assertFinanceScope(ledger, authorizedScope);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== snapshot.revision) {
    throw new Error("Finance query revision conflict");
  }
  const from = instant(start);
  const until = instant(end);
  if (Date.parse(until) <= Date.parse(from)) {
    throw new TypeError("Finance query period must have a positive duration");
  }
  if (!Array.isArray(kinds) || kinds.length === 0 || kinds.length > 3
    || new Set(kinds).size !== kinds.length || kinds.some((kind) => !KINDS.has(kind))) {
    throw new TypeError("Finance query kinds are invalid");
  }
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > MAX_FINANCE_ENTRIES
    || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new TypeError("Finance query pagination is outside bounds");
  }
  const allowed = new Set(kinds);
  const filtered = snapshot.entries.filter((item) => (
    allowed.has(item.kind)
    && Date.parse(item.occurredAt) >= Date.parse(from)
    && Date.parse(item.occurredAt) < Date.parse(until)
  ));
  const page = filtered.slice(offset, offset + limit);
  return Object.freeze({
    schema: "ordax.finance-ledger-query/1",
    ownerId: snapshot.ownerId,
    spaceId: snapshot.spaceId,
    currency: snapshot.currency,
    revision: snapshot.revision,
    start: from,
    end: until,
    total: filtered.length,
    offset,
    nextOffset: offset + page.length < filtered.length
      ? offset + page.length : null,
    entries: Object.freeze([...page]),
  });
}
