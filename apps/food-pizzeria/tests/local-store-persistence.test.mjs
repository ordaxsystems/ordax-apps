import test from "node:test";
import assert from "node:assert/strict";

import { createFoodCommand } from "../src/application/commands.mjs";
import { createBrowserLocalFoodStore } from "../src/adapters/browser-local-store.mjs";

function createMemoryEnvironment() {
  const records = new Map();
  const storage = {
    getItem(key) { return records.get(key) ?? null; },
    setItem(key, value) { records.set(key, String(value)); },
  };
  const locks = { async request(_name, _options, callback) { return callback(); } };
  const eventTarget = { addEventListener() {}, removeEventListener() {} };
  return { storage, locks, eventTarget };
}

test("browser preview persists revisions, accepts an exact command replay once, and rejects stale writes", async () => {
  const environment = createMemoryEnvironment();
  const businessId = "preview-persistence-test";
  const store = createBrowserLocalFoodStore({ businessId, ...environment });
  const initial = await store.initialize();
  const order = initial.orders.find(({ status }) => status === "received");
  assert.ok(order);

  const transition = createFoodCommand({
    type: "order.transition",
    payload: {
      orderId: order.id,
      nextStatus: "preparing",
      historyId: "persistence-history-1",
      changedAt: new Date(Math.max(Date.now(), Date.parse(order.updatedAt))).toISOString(),
    },
    expectedRevision: initial.revision,
    commandId: "persistence-command-1",
  });
  const committed = await store.execute(transition);
  const replayed = await store.execute(transition);
  assert.equal(committed.revision, initial.revision + 1);
  assert.equal(replayed.revision, committed.revision);
  assert.equal(replayed.orders.find(({ id }) => id === order.id).statusHistory.filter(({ status }) => status === "preparing").length, 1);
  const changedReplay = createFoodCommand({
    type: "order.transition",
    payload: { ...transition.payload, nextStatus: "cancelled", reason: "Reuso de ID" },
    expectedRevision: transition.expectedRevision,
    issuedAt: transition.issuedAt,
    commandId: transition.commandId,
  });
  await assert.rejects(store.execute(changedReplay), /Identificador de operação reutilizado/);
  assert.equal(store.getSnapshot().revision, committed.revision);

  const stale = createFoodCommand({
    type: "order.transition",
    payload: {
      orderId: order.id,
      nextStatus: "ready",
      historyId: "persistence-history-stale",
      changedAt: new Date(Math.max(Date.now(), Date.parse(committed.orders.find(({ id }) => id === order.id).updatedAt))).toISOString(),
    },
    expectedRevision: initial.revision,
    commandId: "persistence-command-stale",
  });
  await assert.rejects(store.execute(stale), { name: "FoodRevisionConflictError" });
  assert.equal(store.getSnapshot().revision, committed.revision);
  store.destroy();

  const reopened = createBrowserLocalFoodStore({ businessId, ...environment });
  assert.deepEqual(await reopened.initialize(), committed);
  assert.equal((await reopened.execute(transition)).revision, committed.revision);
  await assert.rejects(reopened.execute(changedReplay), /Identificador de operação reutilizado/);
  reopened.destroy();
});

test("legacy command ids without fingerprints are migrated but cannot authorize ambiguous replays", async () => {
  const environment = createMemoryEnvironment();
  const businessId = "preview-legacy-replay";
  const { createSeedFoodState } = await import("../src/fixtures/mock-data.mjs");
  const source = createSeedFoodState();
  const commandId = "legacy-command-1";
  const key = `ordax.food-pizzeria.browser-state.v1.${encodeURIComponent(businessId)}`;
  environment.storage.setItem(key, JSON.stringify({
    schema: "ordax.food-pizzeria.browser-state/1",
    state: source,
    processedCommandIds: [commandId],
  }));
  const store = createBrowserLocalFoodStore({ businessId, ...environment });
  const restored = await store.initialize();
  assert.equal(restored.revision, source.revision);
  const upgraded = JSON.parse(environment.storage.getItem(key));
  assert.equal(upgraded.schema, "ordax.food-pizzeria.browser-state/2");
  assert.deepEqual(upgraded.processedCommands, [{ id: commandId, digest: null }]);
  const blocked = createFoodCommand({
    type: "food.settings.update",
    payload: { halfPricePolicy: "average" },
    expectedRevision: source.revision,
    commandId,
  });
  await assert.rejects(store.execute(blocked), /legado não verificável/);
  assert.equal(store.getSnapshot().revision, source.revision);
  store.destroy();
});
