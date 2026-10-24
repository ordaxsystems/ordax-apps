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
  reopened.destroy();
});
