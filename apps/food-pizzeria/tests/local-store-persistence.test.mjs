import test from "node:test";
import assert from "node:assert/strict";

import { createFoodCommand } from "../src/application/commands.mjs";
import { createBrowserLocalFoodStore } from "../src/adapters/browser-local-store.mjs";
import { transitionPizzeriaOrder } from "../src/domain/domain.mjs";
import { PREVIEW_SEED_ORDER_AGES_MINUTES, createSeedFoodState } from "../src/fixtures/mock-data.mjs";
import { DEFAULT_KITCHEN_DISPLAY_CONFIGURATION, resizeKitchenDisplayConfiguration } from "../src/application/kitchen-display-configuration.mjs";
import { KITCHEN_QUEUE_MODES } from "../src/application/kitchen-workflow-preview.mjs";

const defaultPreviewPreferences = (deliveryFeeCents = 500) => ({
  deliveryFeeCents,
  kitchenDisplays: DEFAULT_KITCHEN_DISPLAY_CONFIGURATION,
});

function assertKitchenPreviewPreferences(preferences, {
  deliveryFeeCents = 500,
  kitchenDisplays = DEFAULT_KITCHEN_DISPLAY_CONFIGURATION,
  queueMode = KITCHEN_QUEUE_MODES.BY_ORDER,
} = {}) {
  assert.equal(preferences.deliveryFeeCents, deliveryFeeCents);
  assert.deepEqual(preferences.kitchenDisplays, kitchenDisplays);
  assert.equal(preferences.kitchenWorkflow.schema, "ordax.food-kitchen-workflow-preview/2");
  assert.equal(preferences.kitchenWorkflow.queueMode, queueMode);
  assert.equal(preferences.kitchenWorkflow.steps.length, 4);
  assert.ok(preferences.kitchenTasks.tickets.length > 0);
}

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

test("reopening within two hours preserves the untouched sample timeline", async () => {
  const environment = createMemoryEnvironment();
  const businessId = "preview-refresh-under-two-hours";
  const storedAt = Date.parse("2026-10-20T12:00:00.000Z");
  const now = storedAt + 30 * 60000;
  const seeded = createSeedFoodState(storedAt);
  const key = `ordax.food-pizzeria.browser-state.v1.${encodeURIComponent(businessId)}`;
  environment.storage.setItem(key, JSON.stringify({
    schema: "ordax.food-pizzeria.browser-state/2",
    state: seeded,
    processedCommands: [],
  }));

  const store = createBrowserLocalFoodStore({
    businessId,
    clock: () => new Date(now),
    ...environment,
  });
  const reopened = await store.initialize();

  assert.equal(reopened.revision, seeded.revision);
  assert.deepEqual(reopened.orders, seeded.orders);
  assert.deepEqual(reopened.tableCommands, seeded.tableCommands);
  store.destroy();
});

test("reopening refreshes the untouched sample queue in one batch after its oldest activity expires", async () => {
  const environment = createMemoryEnvironment();
  const businessId = "preview-refresh-seed-batch";
  const storedAt = Date.parse("2026-10-20T12:00:00.000Z");
  const now = storedAt + 51 * 60000;
  const seeded = createSeedFoodState(storedAt);
  const key = `ordax.food-pizzeria.browser-state.v1.${encodeURIComponent(businessId)}`;
  environment.storage.setItem(key, JSON.stringify({
    schema: "ordax.food-pizzeria.browser-state/2",
    state: seeded,
    processedCommands: [],
  }));
  const store = createBrowserLocalFoodStore({
    businessId,
    clock: () => new Date(now),
    ...environment,
  });

  const refreshed = await store.initialize();

  for (let index = 0; index < PREVIEW_SEED_ORDER_AGES_MINUTES.length; index += 1) {
    const order = refreshed.orders.find(({ id }) => id === `ng-order-${1047 + index}`);
    assert.equal(order.createdAt,
      new Date(now - PREVIEW_SEED_ORDER_AGES_MINUTES[index] * 60000).toISOString());
  }
  assert.equal(refreshed.revision, seeded.revision + 1);
  assert.equal(refreshed.tableCommands.find(({ id }) => id === "ng-command-04").openedAt,
    new Date(now - 58 * 60000).toISOString());
  store.destroy();
});

test("reopening an old preview refreshes untouched sample timelines and preserves worked orders", async () => {
  const environment = createMemoryEnvironment();
  const businessId = "preview-refresh-seed-timeline";
  const storedAt = Date.parse("2026-10-20T12:00:00.000Z");
  const now = Date.parse("2026-10-26T12:00:00.000Z");
  const seeded = createSeedFoodState(storedAt);
  const workedState = transitionPizzeriaOrder(seeded, {
    orderId: "ng-order-1047",
    nextStatus: "preparing",
    historyId: "local-work-1047-preparing",
    changedAt: new Date(storedAt + 120 * 60000).toISOString(),
  });
  const key = `ordax.food-pizzeria.browser-state.v1.${encodeURIComponent(businessId)}`;
  const journal = [{ id: "preserved-local-command", digest: "a".repeat(64) }];
  environment.storage.setItem(key, JSON.stringify({
    schema: "ordax.food-pizzeria.browser-state/2",
    state: workedState,
    processedCommands: journal,
  }));

  const store = createBrowserLocalFoodStore({
    businessId,
    clock: () => new Date(now),
    ...environment,
  });
  const refreshed = await store.initialize();

  const untouched = refreshed.orders.find(({ id }) => id === "ng-order-1048");
  const worked = refreshed.orders.find(({ id }) => id === "ng-order-1047");
  assert.equal(untouched.createdAt, new Date(now - PREVIEW_SEED_ORDER_AGES_MINUTES[1] * 60000).toISOString());
  assert.equal(untouched.status, "received");
  assert.equal(untouched.statusHistory[0].changedAt, untouched.createdAt);
  assert.equal(worked.status, "preparing");
  assert.equal(worked.createdAt, workedState.orders.find(({ id }) => id === worked.id).createdAt);
  assert.equal(worked.updatedAt, workedState.orders.find(({ id }) => id === worked.id).updatedAt);
  assert.equal(refreshed.revision, workedState.revision + 1);
  assert.equal(refreshed.tableCommands.find(({ id }) => id === "ng-command-04").openedAt,
    new Date(now - 58 * 60000).toISOString());
  const refreshedEnvelope = JSON.parse(environment.storage.getItem(key));
  assert.equal(refreshedEnvelope.schema, "ordax.food-pizzeria.browser-state/5");
  assert.deepEqual(refreshedEnvelope.processedCommands, journal);
  assert.equal(refreshedEnvelope.previewPreferences.deliveryFeeCents, 500);
  store.destroy();
});

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

test("browser-state v3 migrates to v5 while retaining delivery and adding the configurable kitchen flow", async () => {
  const environment = createMemoryEnvironment();
  const businessId = "preview-migrate-browser-envelope-v3";
  const state = createSeedFoodState();
  const key = `ordax.food-pizzeria.browser-state.v1.${encodeURIComponent(businessId)}`;
  environment.storage.setItem(key, JSON.stringify({
    schema: "ordax.food-pizzeria.browser-state/3",
    state,
    processedCommands: [],
    previewPreferences: { deliveryFeeCents: 875 },
  }));

  const store = createBrowserLocalFoodStore({ businessId, ...environment });
  await store.initialize();

  assertKitchenPreviewPreferences(store.getPreviewPreferences(), { deliveryFeeCents: 875 });
  assert.equal(JSON.parse(environment.storage.getItem(key)).schema, "ordax.food-pizzeria.browser-state/5");
  store.destroy();
});

test("legacy command ids without fingerprints are migrated but cannot authorize ambiguous replays", async () => {
  const environment = createMemoryEnvironment();
  const businessId = "preview-legacy-replay";
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
  assert.equal(upgraded.schema, "ordax.food-pizzeria.browser-state/5");
  assert.deepEqual(upgraded.processedCommands, [{ id: commandId, digest: null }]);
  assertKitchenPreviewPreferences(upgraded.previewPreferences);
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

test("browser adapter transparently upgrades v5 Food records without fabricating historical consumption", async () => {
  const environment = createMemoryEnvironment();
  const businessId = "preview-upgrade-food-v5";
  const { calculatePizzeriaOrderConsumption } = await import("../src/domain/domain.mjs");
  const source = createSeedFoodState();
  const historicalState = {
    ...source,
    schema: "ordax.food-pizzeria-state/5",
    orders: source.orders.map(({ consumptionSnapshot, ...order }) => order),
  };
  const key = `ordax.food-pizzeria.browser-state.v1.${encodeURIComponent(businessId)}`;
  environment.storage.setItem(key, JSON.stringify({
    schema: "ordax.food-pizzeria.browser-state/2",
    state: historicalState,
    processedCommands: [],
  }));

  const store = createBrowserLocalFoodStore({ businessId, ...environment });
  const migrated = await store.initialize();
  assert.equal(migrated.schema, "ordax.food-pizzeria-state/6");
  assert.equal(Object.hasOwn(migrated.settings, "deliveryFeeCents"), false);
  assert.equal(migrated.revision, source.revision);
  assert.equal(migrated.orders.length, source.orders.length);
  assert.ok(migrated.orders.every(({ consumptionSnapshot }) => consumptionSnapshot === null));
  assert.throws(() => calculatePizzeriaOrderConsumption(migrated, migrated.orders[0].id),
    /consumo histórico não é verificável/);
  const persisted = JSON.parse(environment.storage.getItem(key));
  assert.equal(persisted.schema, "ordax.food-pizzeria.browser-state/5");
  assert.equal(persisted.state.schema, "ordax.food-pizzeria-state/6");
  assert.equal(persisted.previewPreferences.deliveryFeeCents, 500);
  assert.equal(Object.hasOwn(persisted.state, "inventoryMovements"), false);
  store.destroy();

  const reopened = createBrowserLocalFoodStore({ businessId, ...environment });
  assert.deepEqual(await reopened.initialize(), migrated);
  reopened.destroy();
});

test("browser adapter stores local delivery preference outside the canonical Food state", async () => {
  const environment = createMemoryEnvironment();
  const businessId = "preview-local-delivery-preference";
  const source = createSeedFoodState();
  const store = createBrowserLocalFoodStore({ businessId, ...environment });
  const state = await store.initialize();
  assert.equal(state.schema, "ordax.food-pizzeria-state/6");
  assertKitchenPreviewPreferences(store.getPreviewPreferences());
  const kitchenDisplays = resizeKitchenDisplayConfiguration(DEFAULT_KITCHEN_DISPLAY_CONFIGURATION, 4, "by-stage");
  const kitchenWorkflow = {
    ...store.getPreviewPreferences().kitchenWorkflow,
    queueMode: KITCHEN_QUEUE_MODES.BY_STAGE,
  };
  const saved = await store.updatePreviewPreferences({
    ...store.getPreviewPreferences(),
    deliveryFeeCents: 875,
    kitchenDisplays,
    kitchenWorkflow,
  });
  assert.equal(saved.deliveryFeeCents, 875);
  assert.deepEqual(saved.kitchenDisplays, kitchenDisplays);
  assert.equal(saved.kitchenWorkflow.revision, 1);
  assert.deepEqual(store.getSnapshot(), state);
  assert.equal(Object.hasOwn(store.getSnapshot().settings, "deliveryFeeCents"), false);

  const key = `ordax.food-pizzeria.browser-state.v1.${encodeURIComponent(businessId)}`;
  const persisted = JSON.parse(environment.storage.getItem(key));
  assert.equal(persisted.schema, "ordax.food-pizzeria.browser-state/5");
  assert.equal(persisted.state.schema, "ordax.food-pizzeria-state/6");
  assert.equal(persisted.previewPreferences.deliveryFeeCents, 875);
  assert.equal(persisted.previewPreferences.kitchenWorkflow.queueMode, KITCHEN_QUEUE_MODES.BY_STAGE);
  store.destroy();

  const reopened = createBrowserLocalFoodStore({ businessId, ...environment });
  assert.deepEqual(await reopened.initialize(), state);
  assertKitchenPreviewPreferences(reopened.getPreviewPreferences(), {
    deliveryFeeCents: 875,
    kitchenDisplays,
    queueMode: KITCHEN_QUEUE_MODES.BY_STAGE,
  });
  reopened.destroy();
});

test("browser adapter salvages the earlier local v7 preview into v6 and preserves its fee", async () => {
  const environment = createMemoryEnvironment();
  const businessId = "preview-rollback-food-v7";
  const source = createSeedFoodState();
  const legacyPreview = {
    ...source,
    schema: "ordax.food-pizzeria-state/7",
    settings: { ...source.settings, deliveryFeeCents: 875 },
  };
  const key = `ordax.food-pizzeria.browser-state.v1.${encodeURIComponent(businessId)}`;
  environment.storage.setItem(key, JSON.stringify({
    schema: "ordax.food-pizzeria.browser-state/2",
    state: legacyPreview,
    processedCommands: [],
  }));

  const store = createBrowserLocalFoodStore({ businessId, ...environment });
  const migrated = await store.initialize();

  assert.equal(migrated.schema, "ordax.food-pizzeria-state/6");
  assert.equal(migrated.revision, legacyPreview.revision);
  assert.deepEqual(migrated.orders, legacyPreview.orders);
  assert.equal(Object.hasOwn(migrated.settings, "deliveryFeeCents"), false);
  assertKitchenPreviewPreferences(store.getPreviewPreferences(), { deliveryFeeCents: 875 });
  const persisted = JSON.parse(environment.storage.getItem(key));
  assert.equal(persisted.schema, "ordax.food-pizzeria.browser-state/5");
  assert.equal(persisted.previewPreferences.deliveryFeeCents, 875);
  store.destroy();
});

test("kitchen task actions keep detailed progress local and advance the canonical Food order only at start and handoff", async () => {
  const environment = createMemoryEnvironment();
  const businessId = "preview-kitchen-task-actions";
  const clock = new Date("2026-10-27T12:00:00.000Z");
  const store = createBrowserLocalFoodStore({ businessId, clock: () => clock, ...environment });
  const initial = await store.initialize();
  const order = initial.orders.find(({ status }) => status === "received");
  assert.ok(order);
  let actionAtMs = Math.max(clock.getTime(), Date.parse(order.updatedAt)) + 1000;
  let actionIndex = 0;
  const send = async (action, step) => store.recordKitchenTaskAction({
    action,
    orderId: order.id,
    stepId: step.id,
    screenNumber: step.screen,
    at: new Date(actionAtMs++).toISOString(),
    commandId: `kds-integration-${actionIndex++}`,
  });

  let task = store.getPreviewPreferences().kitchenTasks.tickets.find(({ orderId }) => orderId === order.id);
  const started = await send("start", task.steps[0]);
  assert.equal(started.orders.find(({ id }) => id === order.id).status, "preparing");
  const revisionAfterStart = started.revision;

  for (const originalStep of task.steps) {
    const currentTask = store.getPreviewPreferences().kitchenTasks.tickets.find(({ orderId }) => orderId === order.id);
    const step = currentTask.steps.find(({ status }) => status !== "completed");
    if (step.status === "queued") await send("start", step);
    await send("complete", step);
  }

  const finished = store.getSnapshot();
  task = store.getPreviewPreferences().kitchenTasks.tickets.find(({ orderId }) => orderId === order.id);
  assert.equal(finished.orders.find(({ id }) => id === order.id).status, "ready");
  assert.equal(finished.revision, revisionAfterStart + 1, "etapas locais não incrementam o agregado Food");
  assert.ok(task.steps.every(({ status }) => status === "completed"));
  assert.equal(Object.hasOwn(finished, "kitchenTasks"), false);

  const key = `ordax.food-pizzeria.browser-state.v1.${encodeURIComponent(businessId)}`;
  const persisted = JSON.parse(environment.storage.getItem(key));
  assert.equal(persisted.state.orders.find(({ id }) => id === order.id).status, "ready");
  assert.ok(persisted.previewPreferences.kitchenTasks.commands.length >= 8);
  store.destroy();
});

test("idempotent availability no-op is durable without revision churn or bypassing replay validation", async () => {
  const environment = createMemoryEnvironment();
  const businessId = "preview-idempotent-noop";
  const store = createBrowserLocalFoodStore({ businessId, ...environment });
  const initial = await store.initialize();
  const flavor = initial.flavors.find(({ active }) => active);
  assert.ok(flavor);
  const at = new Date(Math.max(Date.now(), Date.parse(flavor.updatedAt))).toISOString();
  const noOp = createFoodCommand({
    type: "menu.flavor.availability",
    payload: { flavorId: flavor.id, active: true, at },
    expectedRevision: initial.revision,
    commandId: "noop-availability-1",
  });
  const unchanged = await store.execute(noOp);
  assert.equal(unchanged.revision, initial.revision);
  assert.deepEqual(unchanged, initial);
  assert.equal((await store.execute(noOp)).revision, initial.revision);

  const conflictingReplay = createFoodCommand({
    type: "menu.flavor.availability",
    payload: { flavorId: flavor.id, active: false, at },
    expectedRevision: initial.revision,
    issuedAt: noOp.issuedAt,
    commandId: noOp.commandId,
  });
  await assert.rejects(store.execute(conflictingReplay), /Identificador de operação reutilizado/);
  const toggle = createFoodCommand({
    type: "menu.flavor.availability",
    payload: { flavorId: flavor.id, active: false, at },
    expectedRevision: initial.revision,
    commandId: "availability-toggle-1",
  });
  const changed = await store.execute(toggle);
  assert.equal(changed.revision, initial.revision + 1);
  assert.equal(changed.flavors.find(({ id }) => id === flavor.id).active, false);
  store.destroy();

  const reopened = createBrowserLocalFoodStore({ businessId, ...environment });
  assert.deepEqual(await reopened.initialize(), changed);
  assert.equal((await reopened.execute(noOp)).revision, changed.revision);
  await assert.rejects(reopened.execute(conflictingReplay), /Identificador de operação reutilizado/);
  reopened.destroy();
});

test("browser preview never evicts a command idempotency key at its safety limit", async () => {
  const environment = createMemoryEnvironment();
  const businessId = "preview-history-cap";
  const state = createSeedFoodState();
  const key = `ordax.food-pizzeria.browser-state.v1.${encodeURIComponent(businessId)}`;
  environment.storage.setItem(key, JSON.stringify({
    schema: "ordax.food-pizzeria.browser-state/2",
    state,
    processedCommands: Array.from({ length: 999 }, (_, index) => ({
      id: `earlier-${index}`,
      digest: "a".repeat(64),
    })),
  }));
  const store = createBrowserLocalFoodStore({ businessId, ...environment });
  const initial = await store.initialize();
  const flavor = initial.flavors.find(({ active }) => active);
  const noOp = createFoodCommand({
    type: "menu.flavor.availability",
    payload: { flavorId: flavor.id, active: true, at: new Date().toISOString() },
    expectedRevision: initial.revision,
    commandId: "latest-idempotency-entry",
  });
  assert.equal((await store.execute(noOp)).revision, initial.revision);
  const full = JSON.parse(environment.storage.getItem(key));
  assert.equal(full.processedCommands.length, 1000);
  assert.equal(full.processedCommands[0].id, "earlier-0");
  assert.equal(full.processedCommands.at(-1).id, noOp.commandId);
  assert.equal((await store.execute(noOp)).revision, initial.revision);

  const modifiedReplay = createFoodCommand({
    type: "menu.flavor.availability",
    payload: { ...noOp.payload, active: false },
    expectedRevision: noOp.expectedRevision,
    issuedAt: noOp.issuedAt,
    commandId: noOp.commandId,
  });
  await assert.rejects(store.execute(modifiedReplay), /Identificador de operação reutilizado/);
  const newCommand = createFoodCommand({
    type: "menu.flavor.availability",
    payload: { ...noOp.payload, active: false },
    expectedRevision: initial.revision,
    commandId: "after-history-cap",
  });
  await assert.rejects(store.execute(newCommand), /histórico local de operações atingiu o limite seguro/);
  assert.equal(store.getSnapshot().revision, initial.revision);
  assert.deepEqual(JSON.parse(environment.storage.getItem(key)), full);
  store.destroy();

  const reopened = createBrowserLocalFoodStore({ businessId, ...environment });
  assert.deepEqual(await reopened.initialize(), initial);
  assert.equal((await reopened.execute(noOp)).revision, initial.revision);
  await assert.rejects(reopened.execute(modifiedReplay), /Identificador de operação reutilizado/);
  await assert.rejects(reopened.execute(newCommand), /histórico local de operações atingiu o limite seguro/);
  reopened.destroy();
});

test("delayed cross-tab storage notifications always load the newest persisted revision", async () => {
  const records = new Map();
  const listeners = new Set();
  const storage = {
    getItem(key) { return records.get(key) ?? null; },
    setItem(key, value) { records.set(key, String(value)); },
  };
  const locks = { async request(_name, _options, callback) { return callback(); } };
  const eventTarget = {
    addEventListener(type, callback) { if (type === "storage") listeners.add(callback); },
    removeEventListener(type, callback) { if (type === "storage") listeners.delete(callback); },
  };
  const environment = { storage, locks, eventTarget };
  const businessId = "preview-delayed-storage";
  const key = `ordax.food-pizzeria.browser-state.v1.${encodeURIComponent(businessId)}`;
  const first = createBrowserLocalFoodStore({ businessId, ...environment });
  const original = await first.initialize();
  const oldRaw = storage.getItem(key);
  const flavor = original.flavors.find(({ active }) => active);
  const second = createBrowserLocalFoodStore({ businessId, ...environment });
  await second.initialize();
  const command = createFoodCommand({
    type: "menu.flavor.availability",
    payload: { flavorId: flavor.id, active: false, at: new Date().toISOString() },
    expectedRevision: original.revision,
    commandId: "other-tab-update-1",
  });
  const latest = await second.execute(command);
  assert.equal(latest.revision, original.revision + 1);
  for (const callback of [...listeners]) callback({ key, newValue: oldRaw });
  assert.equal(first.getSnapshot().revision, latest.revision);
  assert.equal(first.getSnapshot().flavors.find(({ id }) => id === flavor.id).active, false);
  first.destroy();
  second.destroy();
  assert.equal(listeners.size, 0);
});
