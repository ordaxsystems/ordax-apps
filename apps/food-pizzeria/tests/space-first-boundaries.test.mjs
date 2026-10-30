import test from "node:test";
import assert from "node:assert/strict";

import {
  calculatePizzeriaOrderConsumption,
  migrateFoodPizzeriaState,
  transitionPizzeriaOrder,
} from "../src/domain/domain.mjs";
import { createFoodCommand } from "../src/application/commands.mjs";
import { createSeedFoodState } from "../src/fixtures/mock-data.mjs";
import { createLegacyV3InventoryFixture } from "../src/fixtures/legacy-v3-inventory-fixture.mjs";
import { createBrowserLocalFoodStore } from "../src/adapters/browser-local-store.mjs";

const v3Schema = "ordax.food-pizzeria-state/3";
const v4Schema = "ordax.food-pizzeria-state/4";

function legacyV4State(state) {
  return {
    schema: v4Schema,
    revision: state.revision,
    settings: {
      storeName: state.settings.storeName,
      halfPricePolicy: state.settings.halfPricePolicy,
    },
    flavors: state.flavors.map((flavor) => ({
      ...flavor,
      pricesCents: Object.fromEntries(["small", "medium", "large"].map((id) => [id, flavor.pricesCents[id]])),
    })),
    orders: state.orders.map(({ consumptionSnapshot, ...order }) => ({
      ...order,
      channel: order.tableCommandId === null ? order.channel : "counter",
      items: order.items.map(({ sizeLabel, sliceCount: _sliceCount, ...item }) => item),
    })),
    tableCommands: state.tableCommands,
    recipes: state.recipes.map((recipe) => ({
      ...recipe,
      lines: recipe.lines.map((line) => ({
        ...line,
        quantityBaseBySize: Object.fromEntries(["small", "medium", "large"].map((id) => [
          id,
          line.quantityBaseBySize[id],
        ])),
      })),
    })),
  };
}

function legacyV3State(state) {
  return {
    ...legacyV4State(state),
    schema: v3Schema,
    ingredients: createLegacyV3InventoryFixture().ingredients,
    inventoryMovements: [{
      id: "opening-test",
      ingredientId: "farinha",
      type: "opening",
      quantityBase: 1000,
      occurredAt: "2026-01-01T00:00:00.000Z",
      reference: null,
      note: "Saldo de teste legado",
    }],
  };
}

test("Food v8 keeps food operations and does not own Inventory balances or movements", () => {
  const state = createSeedFoodState();

  assert.equal(state.schema, "ordax.food-pizzeria-state/8");
  assert.equal(Object.hasOwn(state, "ingredients"), false);
  assert.equal(Object.hasOwn(state, "inventoryMovements"), false);
  assert.throws(() => createFoodCommand({
    type: "inventory.movement.record",
    payload: { id: "movement-1" },
    expectedRevision: state.revision,
    commandId: "inventory-command-1",
  }), /desconhecida/);
});

test("starting production changes only the Food order; consumption is a read-only proposal", () => {
  const state = createSeedFoodState();
  const order = state.orders.find(({ status }) => status === "received");
  const proposal = calculatePizzeriaOrderConsumption(state, order.id);
  const next = transitionPizzeriaOrder(state, {
    orderId: order.id,
    nextStatus: "preparing",
    historyId: "space-boundary-history-1",
    changedAt: new Date(Math.max(Date.now(), Date.parse(order.updatedAt))).toISOString(),
  });

  assert.ok(proposal.length > 0);
  assert.deepEqual(Object.keys(next).sort(), Object.keys(state).sort());
  assert.equal(next.orders.find(({ id }) => id === order.id).status, "preparing");
  assert.equal(Object.hasOwn(next, "inventoryMovements"), false);
});

test("v4 migration preserves Food records, configures table service, and labels linked orders as dine-in", () => {
  const state = createSeedFoodState();
  const oldState = legacyV4State(state);
  const migrated = migrateFoodPizzeriaState(oldState);

  assert.equal(migrated.schema, "ordax.food-pizzeria-state/8");
  assert.equal(migrated.orders.length, oldState.orders.length);
  assert.equal(migrated.recipes.length, oldState.recipes.length);
  assert.equal(migrated.settings.tables.length, 8);
  assert.ok(migrated.orders.filter(({ tableCommandId }) => tableCommandId).every(({ channel }) => channel === "dine-in"));
  assert.ok(migrated.orders.some(({ channel, tableCommandId }) => ["pickup", "delivery"].includes(channel) && tableCommandId === null));
  assert.equal(Object.hasOwn(migrated, "inventoryMovements"), false);
  assert.ok(migrated.orders.every(({ consumptionSnapshot }) => consumptionSnapshot === null));
});

test("v3 migration preserves Food data and removes Inventory from active Food state", () => {
  const state = createSeedFoodState();
  const migrated = migrateFoodPizzeriaState(legacyV3State(state));

  assert.equal(migrated.schema, "ordax.food-pizzeria-state/8");
  assert.equal(migrated.orders.length, state.orders.length);
  assert.equal(migrated.recipes.length, state.recipes.length);
  assert.equal(Object.hasOwn(migrated, "ingredients"), false);
  assert.equal(Object.hasOwn(migrated, "inventoryMovements"), false);
  assert.ok(migrated.orders.every(({ consumptionSnapshot }) => consumptionSnapshot === null));
});

test("browser preview archives v3 inventory before rewriting the active Food state", async () => {
  const state = createSeedFoodState();
  const businessId = "preview-migration-test";
  const activeKey = `ordax.food-pizzeria.browser-state.v1.${encodeURIComponent(businessId)}`;
  const legacy = legacyV3State(state);
  const records = new Map([[activeKey, JSON.stringify({
    schema: "ordax.food-pizzeria.browser-state/1",
    state: legacy,
    processedCommandIds: [],
  })]]);
  const storage = {
    getItem(key) { return records.get(key) ?? null; },
    setItem(key, value) { records.set(key, String(value)); },
  };
  const locks = { async request(_name, _options, callback) { return callback(); } };
  const store = createBrowserLocalFoodStore({ businessId, storage, locks });

  const migrated = await store.initialize();
  const archiveRaw = storage.getItem(`${activeKey}.legacy-inventory-v3`);
  const archive = JSON.parse(archiveRaw);
  const active = JSON.parse(storage.getItem(activeKey));

  assert.equal(migrated.schema, "ordax.food-pizzeria-state/8");
  assert.equal(archive.schema, "ordax.food-pizzeria.preview-legacy-inventory/1");
  assert.equal(archive.businessId, businessId);
  assert.equal(archive.movements[0].id, "opening-test");
  assert.equal(active.state.schema, "ordax.food-pizzeria-state/8");
  assert.equal(Object.hasOwn(active.state, "inventoryMovements"), false);
  store.destroy();
});
