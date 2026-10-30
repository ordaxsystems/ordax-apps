import assert from "node:assert/strict";
import test from "node:test";

import { createFoodCommand } from "../src/application/commands.mjs";
import { createFoodOrderCore } from "../src/application/food-order-core.mjs";
import { FOOD_PIZZERIA_STATE_SCHEMA_V6 } from "../src/domain/domain.mjs";
import {
  FoodOrderOutcomeUnknownError,
  FoodOrderRejectedError,
  FOOD_ORDER_COMMIT_PORT_SCHEMA,
  submitFoodOrderCommand,
} from "../src/ports/food-order-commit-port.mjs";
import { createSeedFoodState } from "../src/fixtures/mock-data.mjs";

function transitionCommand(state, id = "txn-1", orderId = undefined) {
  const order = state.orders.find(({ id, status }) =>
    status === "received" && (orderId === undefined || id === orderId));
  if (!order) throw new Error("Fixture lacks a received order");
  return createFoodCommand({
    type: "order.transition", commandId: id,
    expectedRevision: state.revision, issuedAt: "2026-10-25T04:00:00.000Z",
    payload: {
      orderId: order.id,
      nextStatus: "preparing",
      historyId: `food-history-${id}`,
      changedAt: new Date(Math.max(Date.parse(order.updatedAt), Date.parse("2026-10-25T04:00:00Z"))).toISOString(),
    },
  });
}

function createCommand(state, id = "create-order-1") {
  const flavor = state.flavors.find((entry) => entry.active
    && state.recipes.some((recipe) => recipe.flavorId === entry.id));
  const size = state.settings.pizzaSizes.find(({ active }) => active);
  if (!flavor || !size) throw new Error("Fixture lacks a priced recipe");
  return createFoodCommand({
    type: "order.create",
    commandId: id,
    expectedRevision: state.revision,
    issuedAt: "2026-10-25T04:00:00.000Z",
    payload: {
      id: "food-order-created-1",
      historyId: "food-order-created-history-1",
      createdAt: "2026-10-25T04:00:00.000Z",
      customerName: "Cliente autorizado",
      channel: "pickup",
      items: [{ id: "food-created-pizza-1", size: size.id, flavorIds: [flavor.id], quantity: 1 }],
    },
  });
}

function asFoodV6(value) {
  return {
    ...value,
    schema: FOOD_PIZZERIA_STATE_SCHEMA_V6,
    orders: value.orders.map((order) => ({
      ...order,
      items: order.items.map((item) => {
        if (item.type === "catalog-product") return item;
        const { sliceCount: _sliceCount, ...legacyItem } = item;
        return legacyItem;
      }),
    })),
  };
}

function transactionalFixture() {
  // Build the seed once, so different Spaces start from identical immutable
  // fixture bytes rather than independent wall-clock timestamps.
  const base = asFoodV6(createSeedFoodState());
  const state = () => structuredClone(base);
  const bySpace = new Map([
    ["space-a", { state: state(), journal: new Map() }],
    ["space-b", { state: state(), journal: new Map() }],
  ]);
  let selected = { spaceId: "space-a", subjectId: "user-a", epoch: "epoch-1" };
  let granted = true;
  let checks = 0;
  let writes = 0;
  let failAfterCommit = false;
  let swapOnRead = null;
  let lock = Promise.resolve();
  const transactions = {
    async transact(callback) {
      let release;
      const next = new Promise((resolve) => { release = resolve; });
      const previous = lock;
      lock = next;
      await previous;
      try {
        return await callback({
          async authorize(action) {
            checks += 1;
            if (!granted || !["order.create", "order.transition", "order.read"].includes(action)) {
              throw new FoodOrderRejectedError("permission-denied", "Sem grant Food válido.");
            }
            return { ...selected };
          },
          async readState(spaceId) {
            if (spaceId !== selected.spaceId) throw new Error("Cross-Space read forbidden");
            if (!bySpace.has(spaceId)) throw new Error("No such space");
            if (swapOnRead) {
              const change = swapOnRead;
              swapOnRead = null;
              change();
            }
            return bySpace.get(spaceId).state;
          },
          async findCommand(spaceId, commandId) {
            if (spaceId !== selected.spaceId) throw new Error("Cross-Space journal read forbidden");
            return bySpace.get(spaceId)?.journal.get(commandId) ?? null;
          },
          async commit(entry) {
            if (!granted || entry.spaceId !== selected.spaceId) {
              throw new FoodOrderRejectedError("permission-denied", "Grant revogado no write boundary.");
            }
            const bucket = bySpace.get(entry.spaceId);
            if (bucket.state.revision !== entry.expectedRevision) {
              throw new FoodOrderRejectedError("revision-conflict");
            }
            if (bucket.journal.has(entry.commandId)) throw new Error("Duplicate durable journal key");
            const receipt = {
              schema: "ordax.food-order-commit-receipt/1",
              spaceId: entry.spaceId,
              commandId: entry.commandId,
              orderId: entry.orderId,
              status: entry.status,
              revision: entry.nextState.revision,
              commitId: `stored-${entry.commandId}`,
            };
            bucket.state = entry.nextState;
            bucket.journal.set(entry.commandId, {
              spaceId: entry.spaceId, commandId: entry.commandId,
              digest: entry.digest, receipt,
            });
            writes += 1;
            if (failAfterCommit) {
              failAfterCommit = false;
              throw new Error("transport dropped after durable write");
            }
            return receipt;
          },
        });
      } finally {
        release();
      }
    },
  };
  return {
    transactions, bySpace,
    setSelected(next) { selected = next; },
    setGranted(value) { granted = value; },
    revokeOnRead(callback) { swapOnRead = callback; },
    failAfterNextCommit() { failAfterCommit = true; },
    get checks() { return checks; },
    get writes() { return writes; },
    get current() { return { ...selected }; },
  };
}

test("Food Core rejects unavailable ACID repository and non-order commands", async () => {
  assert.throws(() => createFoodOrderCore(), /transação atômica autorizada/);
  const fx = transactionalFixture();
  const core = createFoodOrderCore(fx);
  const invalid = createFoodCommand({
    type: "food.settings.update", payload: { halfPricePolicy: "highest" },
    expectedRevision: 1, commandId: "non-order", issuedAt: "2026-10-25T04:00:00Z",
  });
  await assert.rejects(core.commitOrderCommand(invalid),
    { name: "FoodOrderRejectedError", reason: "invalid-command" });
  assert.equal(fx.writes, 0);
});

test("Food Core refuses local v8 preview state while the SQL owner contract is v6", async () => {
  const state = createSeedFoodState();
  let commitCalls = 0;
  const transactions = {
    async transact(work) {
      return work({
        authorize: async () => ({ spaceId: "space-a", subjectId: "user-a", epoch: "epoch-1" }),
        findCommand: async () => null,
        readState: async () => state,
        commit: async () => { commitCalls += 1; throw new Error("Commit must not be reached"); },
      });
    },
  };
  const core = createFoodOrderCore({ transactions });

  await assert.rejects(core.commitOrderCommand(transitionCommand(state)), {
    name: "FoodOrderRejectedError",
    reason: "invalid-command",
  });
  assert.equal(commitCalls, 0);
});

test("Food Core performs a durable owner-authorized order transition once with replay-safe receipt", async () => {
  const fx = transactionalFixture();
  const core = createFoodOrderCore({ transactions: fx.transactions });
  const original = fx.bySpace.get("space-a").state;
  const cmd = transitionCommand(original);
  const first = await core.commitOrderCommand(cmd);
  assert.equal(first.spaceId, "space-a");
  assert.equal(first.status, "preparing");
  assert.equal(first.commandId, cmd.commandId);
  assert.equal(first.revision, original.revision + 1);
  const state = fx.bySpace.get("space-a").state;
  assert.equal(state.orders.find((order) => order.id === cmd.payload.orderId).status, "preparing");
  assert.equal(fx.writes, 1);
  assert.deepEqual(await core.commitOrderCommand(cmd), first);
  assert.deepEqual(await core.findCommandReceipt(cmd.commandId), first);
  assert.equal(fx.writes, 1);
  assert.deepEqual(fx.bySpace.get("space-b").state, original);
});

test("full new order is created by the existing Food domain, not a second Sales master", async () => {
  const fx = transactionalFixture();
  const core = createFoodOrderCore({ transactions: fx.transactions });
  const old = fx.bySpace.get("space-a").state;
  const cmd = createCommand(old);
  const receipt = await core.commitOrderCommand(cmd);
  const next = fx.bySpace.get("space-a").state;
  const actual = next.orders.find(({ id }) => id === cmd.payload.id);
  assert.equal(receipt.orderId, actual.id);
  assert.equal(receipt.status, "received");
  assert.equal(actual.totalCents, actual.subtotalCents);
  assert.ok(actual.consumptionSnapshot.length > 0);
  assert.equal(Object.hasOwn(next, "inventoryMovements"), false);
  assert.equal(fx.writes, 1);
});

test("idempotency key collision and stale CAS cannot write another order event", async () => {
  const fx = transactionalFixture();
  const core = createFoodOrderCore({ transactions: fx.transactions });
  const initial = fx.bySpace.get("space-a").state;
  const cmd = transitionCommand(initial);
  await core.commitOrderCommand(cmd);
  const different = createFoodCommand({
    ...cmd,
    payload: { ...cmd.payload, historyId: "different-history" },
  });
  await assert.rejects(core.commitOrderCommand(different),
    { name: "FoodOrderRejectedError", reason: "invalid-command" });
  const stale = transitionCommand(initial, "other-command");
  await assert.rejects(core.commitOrderCommand(stale),
    { name: "FoodOrderRejectedError", reason: "revision-conflict" });
  assert.equal(fx.writes, 1);
});

test("identity/Space grant revocation before or during a transaction blocks Food writes", async () => {
  const fx = transactionalFixture();
  const core = createFoodOrderCore({ transactions: fx.transactions });
  const cmd = transitionCommand(fx.bySpace.get("space-a").state);
  fx.setGranted(false);
  await assert.rejects(core.commitOrderCommand(cmd),
    { name: "FoodOrderRejectedError", reason: "permission-denied" });
  assert.equal(fx.writes, 0);
  fx.setGranted(true);
  fx.revokeOnRead(() => fx.setGranted(false));
  await assert.rejects(core.commitOrderCommand(cmd),
    { name: "FoodOrderRejectedError", reason: "permission-denied" });
  assert.equal(fx.writes, 0);
});

test("changing the Space between read and commit refuses cross-Space writes", async () => {
  const fx = transactionalFixture();
  const core = createFoodOrderCore({ transactions: fx.transactions });
  const cmd = transitionCommand(fx.bySpace.get("space-a").state);
  fx.revokeOnRead(() => fx.setSelected({
    spaceId: "space-b", subjectId: "user-a", epoch: "epoch-2",
  }));
  await assert.rejects(core.commitOrderCommand(cmd),
    { name: "FoodOrderRejectedError", reason: "permission-denied" });
  assert.equal(fx.writes, 0);
  assert.equal(await core.findCommandReceipt(cmd.commandId), null);
});

test("commit succeeded but the response was lost: reconcile instead of retrying", async () => {
  const fx = transactionalFixture();
  const core = createFoodOrderCore({ transactions: fx.transactions });
  const cmd = transitionCommand(fx.bySpace.get("space-a").state);
  fx.failAfterNextCommit();
  await assert.rejects(core.commitOrderCommand(cmd),
    { name: "FoodOrderOutcomeUnknownError" });
  assert.equal(fx.writes, 1);
  const stored = await core.findCommandReceipt(cmd.commandId);
  assert.equal(stored.commandId, cmd.commandId);
  assert.deepEqual(await core.commitOrderCommand(cmd), stored);
  assert.equal(fx.writes, 1);
});

test("reconciliation never returns a former Space's receipt after account switch", async () => {
  const fx = transactionalFixture();
  const core = createFoodOrderCore({ transactions: fx.transactions });
  const cmd = transitionCommand(fx.bySpace.get("space-a").state);
  await core.commitOrderCommand(cmd);
  fx.setSelected({ spaceId: "space-b", subjectId: "user-b", epoch: "epoch-2" });
  assert.equal(await core.findCommandReceipt(cmd.commandId), null);
  fx.setGranted(false);
  await assert.rejects(core.findCommandReceipt(cmd.commandId),
    { name: "FoodOrderRejectedError", reason: "permission-denied" });
});

test("same-revision concurrent orders serialize; only one mutation can commit", async () => {
  const fx = transactionalFixture();
  const core = createFoodOrderCore({ transactions: fx.transactions });
  const initial = fx.bySpace.get("space-a").state;
  const cmdA = transitionCommand(initial, "concurrent-a");
  const cmdB = transitionCommand(initial, "concurrent-b");
  const results = await Promise.allSettled([core.commitOrderCommand(cmdA), core.commitOrderCommand(cmdB)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal(results.find((result) => result.status === "rejected").reason.reason, "revision-conflict");
  assert.equal(fx.writes, 1);
});

test("a corrupted durable journal never produces a trusted replay or reconciliation receipt", async () => {
  const fx = transactionalFixture();
  const core = createFoodOrderCore({ transactions: fx.transactions });
  const cmd = transitionCommand(fx.bySpace.get("space-a").state);
  await core.commitOrderCommand(cmd);
  fx.bySpace.get("space-a").journal.get(cmd.commandId).receipt = {
    schema: "ordax.food-order-commit-receipt/1",
    spaceId: "space-b",
    commandId: cmd.commandId,
    orderId: cmd.payload.orderId,
    status: "preparing",
    revision: 0,
    commitId: "corrupt",
  };
  await assert.rejects(core.commitOrderCommand(cmd),
    { name: "FoodOrderOutcomeUnknownError" });
  await assert.rejects(core.findCommandReceipt(cmd.commandId),
    { name: "FoodOrderOutcomeUnknownError" });
  assert.equal(fx.writes, 1);
});

test("owner service receipts can pass the already-published consumer validation", async () => {
  const fx = transactionalFixture();
  const core = createFoodOrderCore({ transactions: fx.transactions });
  const cmd = transitionCommand(fx.bySpace.get("space-a").state);
  const transport = {
    schema: FOOD_ORDER_COMMIT_PORT_SCHEMA,
    getBinding: () => fx.current,
    commitOrderCommand: (payload) => core.commitOrderCommand(payload),
  };
  const receipt = await submitFoodOrderCommand(transport, cmd);
  assert.equal(receipt.spaceId, "space-a");
  assert.equal(fx.writes, 1);
});
