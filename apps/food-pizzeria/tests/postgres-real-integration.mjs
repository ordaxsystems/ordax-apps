// CI-only integration proof with a real ephemeral PostgreSQL 17 database.
// Not imported by browser previews, the application or production host.
// The SQL fixtures and pg package come from a pinned ordax-platform commit.
import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { createRequire } from "node:module";

import { createFoodCommand } from "../src/application/commands.mjs";
import { createFoodOrderCore } from "../src/application/food-order-core.mjs";
import { createFoodPostgresTransactions } from "../src/adapters/postgres-order-transactions.mjs";
import { createFoodPostgresActionAuthorizer } from "../src/adapters/postgres-food-action-authorizer.mjs";
import { createSeedFoodState } from "../src/fixtures/mock-data.mjs";
import { validateFoodPizzeriaState } from "../src/domain/domain.mjs";

const loadPlatformPackage = createRequire(path.resolve(
  ".food-platform/control-plane/cloudflare/package.json",
));
const { Pool } = loadPlatformPackage("pg");
const dbUrl = process.env.FOOD_TEST_POSTGRES_URL;
if (!dbUrl || !dbUrl.includes("/food_ci")) {
  throw new Error("Food PostgreSQL integration test requires the isolated food_ci database");
}
const SPACE_A = "11111111-1111-4111-8111-111111111111";
const SPACE_B = "22222222-2222-4222-8222-222222222222";
const OWNER_A = "00000001-0000-4000-8000-000000000000";
const ADMIN_A = "00000002-0000-4000-8000-000000000000";
const VIEWER_A = "00000004-0000-4000-8000-000000000000";
const OWNER_B = "00000007-0000-4000-8000-000000000000";
const pool = new Pool({ connectionString: dbUrl, max: 8, connectionTimeoutMillis: 5000 });
let current = Object.freeze({ subjectId: ADMIN_A, spaceId: SPACE_A, epoch: "session-1" });
let verifiedBindingCalls = 0;
let beforeBinding = null;
function bind(subjectId, spaceId, epoch = "session-1") {
  current = Object.freeze({ subjectId, spaceId, epoch });
  beforeBinding = null;
}
const authorizeAction = createFoodPostgresActionAuthorizer({
  getVerifiedBinding: async (db) => {
    assert.equal(typeof db.query, "function");
    verifiedBindingCalls += 1;
    if (beforeBinding) await beforeBinding();
    return current;
  },
});
const transactions = createFoodPostgresTransactions({ pool, authorizeAction });
const core = createFoodOrderCore({ transactions });

function transition(state, commandId, orderId) {
  const order = state.orders.find(item => item.status === "received"
    && (!orderId || item.id === orderId));
  assert.ok(order, "Food seeded state needs a received order");
  return createFoodCommand({
    type: "order.transition",
    commandId,
    expectedRevision: state.revision,
    issuedAt: "2026-10-25T06:00:00Z",
    payload: {
      orderId: order.id, nextStatus: "preparing",
      historyId: `real-pg-history-${commandId}`,
      changedAt: new Date(Math.max(Date.parse(order.updatedAt), Date.parse("2026-10-25T06:00:00Z"))).toISOString(),
    },
  });
}
function newOrder(state, commandId, orderId) {
  const flavor = state.flavors.find(entry => entry.active
    && state.recipes.some(recipe => recipe.flavorId === entry.id));
  const size = state.settings.pizzaSizes.find(entry => entry.active);
  assert.ok(flavor && size);
  return createFoodCommand({
    type: "order.create", commandId,
    expectedRevision: state.revision,
    issuedAt: "2026-10-25T06:00:00Z",
    payload: {
      id: orderId,
      historyId: `real-pg-history-${commandId}`,
      createdAt: "2026-10-25T06:00:00Z",
      customerName: "Teste isolado",
      channel: "pickup",
      items: [{ id: `item-${commandId}`, size: size.id, flavorIds: [flavor.id], quantity: 1 }],
    },
  });
}
async function readState(spaceId) {
  const res = await pool.query(
    "select revision, document from private.ordax_food_space_state where space_id=$1::uuid",
    [spaceId],
  );
  assert.equal(res.rowCount, 1);
  return validateFoodPizzeriaState(res.rows[0].document);
}
async function journal(spaceId) {
  const res = await pool.query(
    "select command_id, receipt from private.ordax_food_command_journal where space_id=$1::uuid order by command_id",
    [spaceId],
  );
  return res.rows;
}

test("real PostgreSQL: one Food domain, durable creation, exact replay and receipt reconciliation", async () => {
  const baseline = createSeedFoodState();
  validateFoodPizzeriaState(baseline);
  for (const spaceId of [SPACE_A, SPACE_B]) {
    await pool.query(
      "insert into private.ordax_food_space_state(space_id, revision, document) values($1::uuid,$2::bigint,$3::jsonb)",
      [spaceId, baseline.revision, JSON.stringify(baseline)],
    );
  }
  bind(ADMIN_A, SPACE_A);
  const command = newOrder(baseline, "pg-create-1", "pg-order-1");
  const receipt = await core.commitOrderCommand(command);
  assert.equal(receipt.spaceId, SPACE_A);
  assert.equal(receipt.orderId, "pg-order-1");
  assert.equal(receipt.revision, baseline.revision + 1);
  assert.match(receipt.commitId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(await core.commitOrderCommand(command), receipt);
  assert.deepEqual(await core.findCommandReceipt(command.commandId), receipt);
  assert.equal((await journal(SPACE_A)).length, 1);
  assert.equal((await readState(SPACE_A)).orders.find(x => x.id === "pg-order-1")?.status, "received");
  assert.deepEqual(await readState(SPACE_B), baseline);
  assert.ok(verifiedBindingCalls >= 4, "replay must reauthorize at the server");
});

test("real PostgreSQL: transition, collision and stale revision never duplicate a receipt", async () => {
  bind(ADMIN_A, SPACE_A);
  const state = await readState(SPACE_A);
  const command = transition(state, "pg-transition-1");
  const receipt = await core.commitOrderCommand(command);
  assert.equal(receipt.status, "preparing");
  assert.deepEqual(await core.commitOrderCommand(command), receipt);
  const different = createFoodCommand({
    ...command, payload: { ...command.payload, historyId: "a-different-history-id" },
  });
  await assert.rejects(core.commitOrderCommand(different),
    { name: "FoodOrderRejectedError", reason: "invalid-command" });
  await assert.rejects(core.commitOrderCommand(transition(state, "pg-stale-1")),
    { name: "FoodOrderRejectedError", reason: "revision-conflict" });
  assert.equal((await journal(SPACE_A)).length, 2);
});

test("real PostgreSQL: Space-scoped role policy, revocation and session binding fail closed", async () => {
  const spaceA = await readState(SPACE_A);
  bind(VIEWER_A, SPACE_A);
  await assert.rejects(core.commitOrderCommand(transition(spaceA, "pg-viewer-denied")),
    { name: "FoodOrderRejectedError", reason: "permission-denied" });
  assert.equal(await core.findCommandReceipt("pg-create-1")?.then(x => x?.orderId), "pg-order-1");

  bind(ADMIN_A, SPACE_B);
  await assert.rejects(core.commitOrderCommand(transition(await readState(SPACE_B), "pg-cross-space-denied")),
    { name: "FoodOrderRejectedError", reason: "permission-denied" });
  await assert.rejects(core.findCommandReceipt("pg-create-1"),
    { name: "FoodOrderRejectedError", reason: "permission-denied" });

  bind(OWNER_B, SPACE_B);
  assert.equal(await core.findCommandReceipt("pg-create-1"), null);
  const allowed = transition(await readState(SPACE_B), "pg-owner-b-1");
  const receipt = await core.commitOrderCommand(allowed);
  assert.equal(receipt.spaceId, SPACE_B);
  assert.equal((await journal(SPACE_B)).length, 1);

  bind(ADMIN_A, SPACE_A);
  const currentState = await readState(SPACE_A);
  let calls = 0;
  beforeBinding = async () => {
    calls += 1;
    if (calls === 2) current = Object.freeze({ ...current, epoch: "session-2" });
  };
  await assert.rejects(core.commitOrderCommand(transition(currentState, "pg-session-swap")),
    { name: "FoodOrderRejectedError", reason: "permission-denied" });
  assert.equal((await journal(SPACE_A)).length, 2);
  beforeBinding = null;

  await pool.query(
    "update public.ordax_space_members set state='suspended' where space_id=$1::uuid and user_id=$2::uuid",
    [SPACE_A, ADMIN_A],
  );
  bind(ADMIN_A, SPACE_A);
  await assert.rejects(core.commitOrderCommand(transition(currentState, "pg-revoked-denied")),
    { name: "FoodOrderRejectedError", reason: "permission-denied" });
  await assert.rejects(core.findCommandReceipt("pg-create-1"),
    { name: "FoodOrderRejectedError", reason: "permission-denied" });
  assert.equal((await journal(SPACE_A)).length, 2, "revocation must not erase durable history");
  bind(OWNER_A, SPACE_A);
  assert.equal((await core.findCommandReceipt("pg-create-1")).orderId, "pg-order-1");
});

test("real PostgreSQL: concurrent same-revision commands permit at most one mutation", async () => {
  bind(OWNER_A, SPACE_A);
  const before = await readState(SPACE_A);
  const one = transition(before, "pg-race-a");
  const two = transition(before, "pg-race-b");
  const results = await Promise.allSettled([core.commitOrderCommand(one), core.commitOrderCommand(two)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(results.filter(r => r.status === "rejected").length, 1);
  const failed = results.find(r => r.status === "rejected").reason;
  assert.equal(failed?.name, "FoodOrderRejectedError", "serializable conflict must have stable Food rejection");
  assert.equal(failed?.reason, "revision-conflict");
  assert.equal((await journal(SPACE_A)).length, 3);
  assert.equal((await readState(SPACE_A)).revision, before.revision + 1);
});

test("real PostgreSQL: commit persisted but acknowledgment lost, so reconcile rather than resend", async () => {
  bind(OWNER_A, SPACE_A);
  const before = await readState(SPACE_A);
  const cmd = transition(before, "pg-commit-reply-lost");
  const unknownPool = {
    async connect() {
      const client = await pool.connect();
      return {
        async query(sql, params) {
          const result = await client.query(sql, params);
          if (sql === "COMMIT") throw new Error("synthetic COMMIT acknowledgment lost");
          return result;
        },
        release(error) { client.release(error); },
      };
    },
  };
  const unknownCore = createFoodOrderCore({ transactions: createFoodPostgresTransactions({
    pool: unknownPool, authorizeAction,
  }) });
  await assert.rejects(unknownCore.commitOrderCommand(cmd),
    { name: "FoodOrderOutcomeUnknownError" });
  const committed = await core.findCommandReceipt(cmd.commandId);
  assert.equal(committed?.commandId, cmd.commandId);
  assert.deepEqual(await core.commitOrderCommand(cmd), committed, "replay returns exact durable receipt");
  assert.equal((await journal(SPACE_A)).filter(x => x.command_id === cmd.commandId).length, 1);
});

test.after(async () => {
  await pool.end();
});
