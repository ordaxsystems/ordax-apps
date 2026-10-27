import assert from "node:assert/strict";
import test from "node:test";

import { createFoodCommand } from "../src/application/commands.mjs";
import { createFoodOrderCore } from "../src/application/food-order-core.mjs";
import { createFoodPostgresTransactions } from "../src/adapters/postgres-order-transactions.mjs";
import { FOOD_PIZZERIA_STATE_SCHEMA_V6 } from "../src/domain/domain.mjs";
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
  let state = { ...createSeedFoodState(), schema: FOOD_PIZZERIA_STATE_SCHEMA_V6 };
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
          if (sql.startsWith("select revision, document from private.ordax_food_read_state_v1")) {
            assert.deepEqual(params, [ACTOR, SPACE_A, params[2]]);
            return { rowCount: 1, rows: [{ revision: state.revision, document: structuredClone(state) }] };
          }
          if (sql.startsWith("select space_id, command_id") && sql.includes("ordax_food_find_command_v1")) {
            const item = journal.get(`${params[1]}:${params[3]}`);
            return { rowCount: item ? 1 : 0, rows: item ? [item] : [] };
          }
          if (sql.startsWith("select private.ordax_food_commit_order_v1")) {
            assert.equal(params.length, 9);
            assert.equal(params[0], ACTOR);
            assert.equal(params[1], SPACE_A);
            assert.ok(["order.create", "order.transition"].includes(params[2]));
            assert.equal(params[5], state.revision);
            const receipt = {
              schema: "ordax.food-order-commit-receipt/1",
              spaceId: params[1], commandId: params[3],
              orderId: params[7], status: params[8],
              revision: params[5] + 1, commitId: COMMIT,
            };
            const key = `${params[1]}:${params[3]}`;
            assert.ok(!journal.has(key));
            state = JSON.parse(params[6]);
            journal.set(key, {
              space_id: params[1], command_id: params[3],
              digest: params[4], receipt,
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
  assert.ok(!fx.calls.some((x) => x.sql.includes("ordax_food_commit_order_v1")));
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
  const writes = fx.calls.filter(x => x.sql.includes("ordax_food_commit_order_v1")).length;
  assert.equal(writes, 1);
  assert.ok(fx.calls.some(x => x.sql.includes("ordax_food_read_state_v1")));
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
  assert.ok(!fx.calls.some(x => x.sql.includes("ordax_food_read_state_v1")));
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

test("PostgreSQL explicit serialization/deadlock aborts map to typed CAS conflict without retry", async () => {
  for (const code of ["40001", "40P01"]) {
    for (const point of ["work", "commit"]) {
      const statements = [];
      let releaseArg;
      const db = {
        async query(sql) {
          statements.push(sql);
          if (sql === "COMMIT" && point === "commit") {
            throw Object.assign(new Error("explicit PostgreSQL transaction abort"), { code });
          }
          return { rowCount: 0, rows: [] };
        },
        release(arg) { releaseArg = arg; },
      };
      const transactions = createFoodPostgresTransactions({
        pool: { async connect() { return db; } },
        authorizeAction: async () => ({
          granted: true, spaceId: SPACE_A, subjectId: ACTOR, epoch: "session-1",
        }),
      });
      let calls = 0;
      await assert.rejects(
        transactions.transact(async () => {
          calls += 1;
          if (point === "work") {
            throw Object.assign(new Error("serialization rollback"), { code });
          }
          return "no-write";
        }),
        { name: "FoodOrderRejectedError", reason: "revision-conflict" },
      );
      assert.equal(calls, 1, "adapter must not replay a transaction");
      assert.ok(statements.includes("ROLLBACK"));
      assert.equal(releaseArg, undefined, "explicit server rollback leaves reusable connection");
    }
  }
});

test("invalid production Space state cannot be provisioned from a preview fallback", async () => {
  const fx = dbFixture();
  const invalid = createFoodPostgresTransactions({
    pool: { connect: async () => ({
      query: async (sql) => {
        if (sql.includes("ordax_food_read_state_v1")) return { rowCount: 0, rows: [] };
        return { rowCount: 0, rows: [] };
      },
      release() {},
    }) },
    authorizeAction: async () => ({ granted: true, spaceId: SPACE_A, subjectId: ACTOR, epoch: "session" }),
  });
  await assert.rejects(invalid.transact(async (tx) => {
    await tx.authorize("order.create");
    await tx.readState(SPACE_A);
  }), { name: "FoodOrderRejectedError", reason: "invalid-command" });
  assert.ok(fx.state.orders.length > 0); // Fixture never became a backend fallback.
});
