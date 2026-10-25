import assert from "node:assert/strict";
import test from "node:test";

import { createFoodCommand } from "../src/application/commands.mjs";
import { createFoodOrderCore } from "../src/application/food-order-core.mjs";
import { createFoodPostgresTransactions } from "../src/adapters/postgres-order-transactions.mjs";
import { FoodOrderRejectedError } from "../src/ports/food-order-commit-port.mjs";
import { createSeedFoodState } from "../src/fixtures/mock-data.mjs";

const SPACE_A = "11111111-1111-4111-8111-111111111111";
const SPACE_B = "22222222-2222-4222-8222-222222222222";
const ACTOR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMMIT = "33333333-3333-4333-8333-333333333333";

function transition(state, commandId = "order-transaction-1") {
  const order = state.orders.find(({ status }) => status === "received");
  assert.ok(order, "Fixture must have a received order");
  return createFoodCommand({
    type: "order.transition",
    commandId,
    expectedRevision: state.revision,
    issuedAt: "2026-10-25T06:00:00.000Z",
    payload: {
      orderId: order.id,
      nextStatus: "preparing",
      historyId: `food-transaction-${commandId}`,
      changedAt: new Date(Math.max(Date.parse(order.updatedAt), Date.parse("2026-10-25T06:00:00Z"))).toISOString(),
    },
  });
}

function dbFixture() {
  let state = createSeedFoodState();
  const journal = new Map();
  const calls = [];
  let releaseArgument;
  let rejectAfter = null;
  let commitFailure = false;
  const pool = {
    async connect() {
      const snapshot = structuredClone(state);
      const commandSnapshot = new Map(journal);
      return {
        async query(sql, params = []) {
          calls.push({ sql, params });
          if (sql === "BEGIN ISOLATION LEVEL SERIALIZABLE") return { rowCount: null, rows: [] };
          if (sql === "ROLLBACK") {
            state = snapshot;
            journal.clear();
            for (const [key, value] of commandSnapshot) journal.set(key, value);
            return { rowCount: null, rows: [] };
          }
          if (sql === "COMMIT") {
            if (commitFailure) throw new Error("COMMIT reply lost");
            return { rowCount: null, rows: [] };
          }
          if (sql.startsWith("select s.space_id")) {
            return { rowCount: params[0] === SPACE_A ? 1 : 0,
              rows: params[0] === SPACE_A ? [{ space_id: SPACE_A }] : [] };
          }
          if (sql.startsWith("select revision, document")) {
            return { rowCount: 1, rows: [{ revision: state.revision, document: structuredClone(state) }] };
          }
          if (sql.startsWith("select space_id, command_id")) {
            const item = journal.get(`${params[0]}:${params[1]}`);
            return { rowCount: item ? 1 : 0, rows: item ? [item] : [] };
          }
          if (sql.startsWith("update private.ordax_food_space_state")) {
            if (params[0] !== SPACE_A || params[3] !== state.revision) {
              return { rowCount: 0, rows: [] };
            }
            state = JSON.parse(params[2]);
            return { rowCount: 1, rows: [{ revision: state.revision }] };
          }
          if (sql.includes("insert into private.ordax_food_command_journal")) {
            assert.equal(params.length, 7);
            assert.equal(params[0], SPACE_A);
            assert.equal(params[3], ACTOR);
            const receipt = {
              schema: "ordax.food-order-commit-receipt/1",
              spaceId: params[0], commandId: params[1],
              orderId: params[4], status: params[5],
              revision: params[6], commitId: COMMIT,
            };
            const key = `${params[0]}:${params[1]}`;
            assert.ok(!journal.has(key));
            journal.set(key, {
              space_id: params[0], command_id: params[1],
              digest: params[2], receipt,
            });
            return { rowCount: 1, rows: [{ receipt }] };
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        },
        release(value) { releaseArgument = value; },
      };
    },
  };
  let grant = true;
  let epoch = "session-1";
  let checks = 0;
  const authorization = async (_, action) => {
    checks += 1;
    if (rejectAfter !== null && checks >= rejectAfter) grant = false;
    return {
      granted: grant,
      spaceId: SPACE_A, subjectId: ACTOR, epoch,
      action,
    };
  };
  const transactions = createFoodPostgresTransactions({ pool, authorizeAction: authorization });
  const core = createFoodOrderCore({ transactions });
  return {
    pool, transactions, core, calls, journal,
    command: () => transition(state), get state() { return state; },
    revoke() { grant = false; }, switchSession() { epoch = "session-2"; },
    revokeOnCheck(count) { rejectAfter = count; },
    loseCommitReply() { commitFailure = true; },
    get releaseArgument() { return releaseArgument; },
    get checks() { return checks; },
  };
}

test("PostgreSQL adapter requires trusted server connection and per-action authority", async () => {
  assert.throws(() => createFoodPostgresTransactions(),
    /conexão server-side e autoridade per-action/);
  assert.throws(() => createFoodPostgresTransactions({ pool: { connect() {} } }),
    /autoridade per-action/);
  const fx = dbFixture();
  const value = await fx.core.findCommandReceipt("not-yet-written");
  assert.equal(value, null);
  assert.ok(fx.calls.some((x) => x.sql === "BEGIN ISOLATION LEVEL SERIALIZABLE"));
  assert.ok(fx.calls.some((x) => x.sql === "COMMIT"));
  assert.ok(!fx.calls.some((x) => x.sql.startsWith("update private")));
});

test("owner core and PostgreSQL adapter commit one state and journal together", async () => {
  const fx = dbFixture();
  const original = fx.state;
  const command = fx.command();
  const receipt = await fx.core.commitOrderCommand(command);
  assert.equal(receipt.spaceId, SPACE_A);
  assert.equal(receipt.commandId, command.commandId);
  assert.equal(receipt.revision, original.revision + 1);
  assert.equal(fx.state.orders.find(x => x.id === command.payload.orderId).status, "preparing");
  assert.equal(fx.journal.size, 1);
  assert.equal(fx.releaseArgument, undefined);
  assert.ok(fx.checks >= 2);
  assert.deepEqual(await fx.core.commitOrderCommand(command), receipt);
  assert.equal(fx.journal.size, 1, "Exact replay must not write again");
  assert.deepEqual(await fx.core.findCommandReceipt(command.commandId), receipt);
  const writes = fx.calls.filter(x => x.sql.startsWith("update private")).length;
  assert.equal(writes, 1);
  assert.ok(fx.calls.some(x => x.sql.includes("for update")));
  assert.ok(fx.calls.every(x => !x.sql.includes(command.commandId) || x.sql === command.commandId),
    "Order id must appear in bound parameters, not interpolated SQL");
});

test("revoked action cannot inspect state or write the idempotency journal", async () => {
  const fx = dbFixture();
  const cmd = fx.command();
  fx.revoke();
  await assert.rejects(fx.core.commitOrderCommand(cmd),
    { name: "FoodOrderRejectedError", reason: "permission-denied" });
  assert.equal(fx.journal.size, 0);
  assert.ok(!fx.calls.some(x => x.sql.startsWith("select revision, document")));
  assert.ok(fx.calls.some(x => x.sql === "ROLLBACK"));
});

test("revocation between read and commit prevents a write", async () => {
  const fx = dbFixture();
  const cmd = fx.command();
  fx.revokeOnCheck(2);
  await assert.rejects(fx.core.commitOrderCommand(cmd),
    { name: "FoodOrderRejectedError", reason: "permission-denied" });
  assert.equal(fx.journal.size, 0);
  assert.ok(!fx.calls.some(x => x.sql.startsWith("update private")));
});

test("session switch between reads and writes fails closed", async () => {
  const fx = dbFixture();
  const cmd = fx.command();
  // In this test only, the server authority switches epoch on recheck.
  let count = 0;
  const freshAdapter = createFoodPostgresTransactions({
    pool: fx.pool,
    authorizeAction: async () => ({
      granted: true, spaceId: SPACE_A, subjectId: ACTOR,
      epoch: ++count === 1 ? "session-1" : "session-2",
    }),
  });
  const protectedCore = createFoodOrderCore({ transactions: freshAdapter });
  await assert.rejects(protectedCore.commitOrderCommand(cmd),
    { name: "FoodOrderRejectedError", reason: "permission-denied" });
  assert.equal(fx.journal.size, 0);
  assert.ok(!fx.calls.some(x => x.sql.startsWith("update private")));
});

test("revoked or foreign Space never gets a private Food state read", async () => {
  const fx = dbFixture();
  await assert.rejects(fx.transactions.transact(async (tx) => {
    await tx.authorize("order.read");
    await tx.findCommand(SPACE_B, "command");
  }), { name: "FoodOrderRejectedError", reason: "permission-denied" });
  assert.ok(!fx.calls.some(x => x.sql.startsWith("select revision, document")));
});

test("COMMIT network failure is an unknown outcome and poisons its connection", async () => {
  const fx = dbFixture();
  const cmd = fx.command();
  fx.loseCommitReply();
  await assert.rejects(fx.core.commitOrderCommand(cmd),
    { name: "FoodOrderOutcomeUnknownError" });
  assert.ok(fx.releaseArgument instanceof Error);
  assert.ok(fx.calls.some(x => x.sql === "COMMIT"));
});

test("invalid production Space state cannot be provisioned from a preview fallback", async () => {
  const fx = dbFixture();
  const invalid = createFoodPostgresTransactions({
    pool: { connect: async () => ({
      query: async (sql) => {
        if (sql.startsWith("select s.space_id")) return { rowCount: 0, rows: [] };
        return { rowCount: 0, rows: [] };
      },
      release() {},
    }) },
    authorizeAction: async () => ({ granted: true, spaceId: SPACE_A, subjectId: ACTOR, epoch: "session" }),
  });
  await assert.rejects(invalid.transact((tx) => tx.authorize("order.create")),
    { name: "FoodOrderRejectedError", reason: "permission-denied" });
  assert.ok(fx.state.orders.length > 0); // Fixture never became a backend fallback.
});
