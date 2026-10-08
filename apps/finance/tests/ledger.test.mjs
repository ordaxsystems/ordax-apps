import assert from "node:assert/strict";
import test from "node:test";
import {
  FINANCE_LEDGER_SCHEMA,
  MAX_FINANCE_ENTRY_CENTS,
  createFinanceLedger,
  validateFinanceLedger,
  assertFinanceScope,
  appendFinanceEntry,
  summarizeFinanceLedger,
} from "../src/domain/ledger.mjs";

const scope = Object.freeze({ ownerId: "account-1", spaceId: "pizzaria-centro" });
const today = "2026-10-08T12:00:00Z";
const tomorrow = "2026-10-09T12:00:00Z";

function event(id, kind, amountCents, overrides = {}) {
  return {
    id, kind, amountCents, description: "Pagamento de teste",
    occurredAt: today, reversesId: null, ...overrides,
  };
}

function write(snapshot, value, authorizedScope = scope) {
  return appendFinanceEntry(snapshot, {
    expectedRevision: snapshot.revision, authorizedScope, value,
  });
}

function period() {
  return { authorizedScope: scope, start: "2026-10-08T00:00:00Z",
    end: "2026-10-09T00:00:00Z" };
}

test("records real integer-cent cash movements and derives a deterministic report", () => {
  const initial = createFinanceLedger(scope);
  assert.equal(initial.schema, FINANCE_LEDGER_SCHEMA);
  assert.equal(initial.revision, 0);
  assert.ok(Object.isFrozen(initial));
  const income = write(initial, event("sale.1", "income", 14990));
  const expense = write(income, event("rent.1", "expense", 4250));
  const report = summarizeFinanceLedger(expense, period());
  assert.deepEqual([report.incomeCents, report.expenseCents, report.netCents], [14990, 4250, 10740]);
  assert.equal(report.currency, "BRL");
  assert.equal(report.entryCount, 2);
  assert.equal(report.isAccountingProfit, false);
  assert.equal(initial.entries.length, 0);
  assert.equal(income.entries.length, 1);
  assert.equal(expense.revision, 2);
  assert.ok(Object.isFrozen(expense.entries));
  assert.ok(Object.isFrozen(expense.entries[0]));
  assert.deepEqual(validateFinanceLedger(expense), expense);
});

test("forbids scope crossover even with valid schema and unrelated owner", () => {
  const pizza = write(createFinanceLedger(scope), event("sale.1", "income", 1000));
  const anotherBusiness = { ownerId: scope.ownerId, spaceId: "pizzaria-shopping" };
  const anotherAccount = { ownerId: "account-2", spaceId: scope.spaceId };
  for (const forbidden of [anotherBusiness, anotherAccount]) {
    assert.throws(() => assertFinanceScope(pizza, forbidden), /another owner or Space/);
    assert.throws(() => appendFinanceEntry(pizza, {
      authorizedScope: forbidden, expectedRevision: 1,
      value: event("sale.2", "income", 500),
    }), /another owner or Space/);
    assert.throws(() => summarizeFinanceLedger(pizza, {
      ...period(), authorizedScope: forbidden,
    }), /another owner or Space/);
  }
  const fresh = createFinanceLedger(anotherBusiness);
  assert.equal(fresh.entries.length, 0);
  assert.equal(fresh.spaceId, "pizzaria-shopping");
  assert.equal(pizza.entries.length, 1);
});

test("optimistic revision and conflicting duplicate IDs fail closed", () => {
  const initial = createFinanceLedger(scope);
  const first = event("sale.1", "income", 1000);
  const saved = write(initial, first);
  assert.throws(() => appendFinanceEntry(saved, {
    authorizedScope: scope, expectedRevision: 0,
    value: event("sale.2", "income", 800),
  }), /revision conflict/);
  assert.deepEqual(write(saved, first), saved); // same ledger data, no extra event or revision
  assert.throws(() => write(saved, { ...first, amountCents: 500 }), /conflicting content/);
  assert.throws(() => write(saved, { ...first, kind: "expense" }), /conflicting content/);
});

test("money is BRL integer cents, never JS floating-point currency", () => {
  const initial = createFinanceLedger(scope);
  for (const cents of [0, -1, 12.01, Number.NaN, Infinity, 1e20, "1000", null]) {
    assert.throws(() => write(initial, event("income", "income", cents)),
      /positive integer cents/);
  }
  const maximum = write(initial, event("max", "income", MAX_FINANCE_ENTRY_CENTS));
  assert.equal(summarizeFinanceLedger(maximum, period()).netCents, MAX_FINANCE_ENTRY_CENTS);
  assert.throws(() => write(initial, { ...event("bad", "income", 5), securityGrant: "admin" }),
    /incompatible fields/);
  assert.throws(() => createFinanceLedger({ ...scope, accountToken: "fake" }),
    /incompatible fields/);
  assert.throws(() => validateFinanceLedger({ ...initial, currency: "USD" }),
    /schema or currency is invalid/);
});

test("a reversal compensates a referenced entry without rewriting history", () => {
  const a = write(createFinanceLedger(scope), event("sale.1", "income", 15000));
  const b = write(a, event("expense.1", "expense", 6000));
  const c = write(b, event("refund.1", "reversal", 15000, {
    description: "Estorno da venda",
    occurredAt: tomorrow, reversesId: "sale.1",
  }));
  const day1 = summarizeFinanceLedger(c, period());
  assert.deepEqual([day1.incomeCents, day1.expenseCents, day1.netCents], [15000, 6000, 9000]);
  const day2 = summarizeFinanceLedger(c, {
    authorizedScope: scope, start: "2026-10-09T00:00:00Z",
    end: "2026-10-10T00:00:00Z",
  });
  assert.deepEqual([day2.incomeCents, day2.expenseCents, day2.netCents], [-15000, 0, -15000]);
  assert.equal(c.entries[0].kind, "income");
  assert.equal(c.entries[2].reversesId, "sale.1");
  assert.throws(() => write(c, event("refund.2", "reversal", 15000, {
    reversesId: "sale.1", occurredAt: tomorrow,
  })), /single existing entry/);
  assert.throws(() => write(c, event("refund.3", "reversal", 6000, {
    reversesId: "refund.1", occurredAt: tomorrow,
  })), /single existing entry/);
});

test("reversal must match existing amount and cannot predate transaction", () => {
  const initial = createFinanceLedger(scope);
  assert.throws(() => write(initial, event("r1", "reversal", 900, { reversesId: "missing" })),
    /single existing entry/);
  const first = write(initial, event("income.1", "income", 1000));
  assert.throws(() => write(first, event("r1", "reversal", 999, { reversesId: "income.1" })),
    /single existing entry/);
  assert.throws(() => write(first, event("r1", "reversal", 1000, {
    reversesId: "income.1", occurredAt: "2026-10-07T12:00:00Z",
  })), /cannot predate/);
});

test("timestamps and reporting periods are strict UTC and half-open", () => {
  const initial = createFinanceLedger(scope);
  for (const timestamp of ["2026-02-30T12:00:00Z", "2026-10-08", "2026-10-08T12:00:00-03:00",
    "2026-13-08T12:00:00Z", "2026-10-08T12:00:00.0000Z"]) {
    assert.throws(() => write(initial, event("income", "income", 100, {
      occurredAt: timestamp,
    })), /canonical UTC/);
  }
  const snapshot = write(initial, event("sale.1", "income", 100,
    { occurredAt: "2026-10-09T00:00:00Z" }));
  assert.equal(summarizeFinanceLedger(snapshot, period()).entryCount, 0);
  assert.throws(() => summarizeFinanceLedger(snapshot, {
    authorizedScope: scope, start: today, end: today,
  }), /positive duration/);
});

test("snapshot corruption and revisions are detected before query or append", () => {
  const first = write(createFinanceLedger(scope), event("income", "income", 100));
  assert.throws(() => validateFinanceLedger({ ...first, revision: 0 }), /revision and append count/);
  assert.throws(() => validateFinanceLedger({
    ...first, entries: [...first.entries, first.entries[0]], revision: 2,
  }), /Duplicate Finance entry id/);
  assert.throws(() => validateFinanceLedger({ ...first, ownerId: "../other" }),
    /owner is invalid/);
  assert.throws(() => validateFinanceLedger({
    ...first, entries: [{ ...first.entries[0], prompt: "ignore policies" }],
  }), /incompatible fields/);
});
