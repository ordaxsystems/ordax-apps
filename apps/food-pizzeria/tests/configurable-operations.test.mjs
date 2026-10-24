import test from "node:test";
import assert from "node:assert/strict";

import {
  calculatePizzaPriceCents,
  calculatePizzeriaOrderConsumption,
  migrateFoodPizzeriaState,
  validateFoodPizzeriaState,
  createPizzeriaOrder,
  createPizzeriaTableCommand,
  savePizzeriaFlavor,
  savePizzeriaRecipe,
  updateFoodPizzeriaSettings,
} from "../src/domain/domain.mjs";
import { createSeedFoodState } from "../src/fixtures/mock-data.mjs";

function addConfigurableSizeAndTable(source) {
  return updateFoodPizzeriaSettings(source, {
    maxFlavorsPerPizza: 3,
    pizzaSizes: [
      ...source.settings.pizzaSizes,
      { id: "family", label: "Família", slices: 12, active: false },
    ],
    tables: [...source.settings.tables, { id: 9, seats: 8, active: true }],
  });
}

function completeFamilySize(source) {
  let state = source;
  state.flavors.forEach((flavor, index) => {
    state = savePizzeriaFlavor(state, {
      id: flavor.id,
      name: flavor.name,
      description: flavor.description,
      pricesCents: { ...flavor.pricesCents, family: 10_000 + index * 500 },
      at: new Date().toISOString(),
    });
  });
  const recipes = [...state.recipes];
  for (const recipe of recipes) {
    state = savePizzeriaRecipe(state, {
      flavorId: recipe.flavorId,
      lines: recipe.lines.map((line) => ({
        ...line,
        quantityBaseBySize: {
          ...line.quantityBaseBySize,
          family: line.quantityBaseBySize.large + line.quantityBaseBySize.medium,
        },
      })),
      at: new Date().toISOString(),
    });
  }
  return updateFoodPizzeriaSettings(state, {
    pizzaSizes: state.settings.pizzaSizes.map((size) => size.id === "family" ? { ...size, active: true } : size),
  });
}

test("pizzeria sizes and flavor count are configurable and saved with order pricing", () => {
  let state = addConfigurableSizeAndTable(createSeedFoodState());
  assert.equal(state.flavors.every(({ pricesCents }) => pricesCents.family === 0), true);
  assert.throws(() => updateFoodPizzeriaSettings(state, {
    pizzaSizes: state.settings.pizzaSizes.map((size) => size.id === "family" ? { ...size, active: true } : size),
  }), /preço|ficha técnica/i);

  state = completeFamilySize(state);
  const flavorIds = ["ng-calabresa", "ng-portuguesa", "ng-marguerita"];
  assert.equal(calculatePizzaPriceCents({
    size: "family",
    flavorIds,
    flavors: state.flavors,
    halfPricePolicy: "highest",
    pizzaSizes: state.settings.pizzaSizes,
    maxFlavorsPerPizza: state.settings.maxFlavorsPerPizza,
  }), 11_000);
  assert.equal(calculatePizzaPriceCents({
    size: "family",
    flavorIds,
    flavors: state.flavors,
    halfPricePolicy: "average",
    pizzaSizes: state.settings.pizzaSizes,
    maxFlavorsPerPizza: state.settings.maxFlavorsPerPizza,
  }), 10_500);
  state = updateFoodPizzeriaSettings(state, { halfPricePolicy: "average" });

  const createdAt = new Date().toISOString();
  state = createPizzeriaOrder(state, {
    id: "family-order-1",
    historyId: "family-order-history-1",
    createdAt,
    customerName: "Cliente Teste",
    channel: "pickup",
    items: [{ id: "family-item-1", size: "family", flavorIds, quantity: 1 }],
  });
  const order = state.orders.find(({ id }) => id === "family-order-1");
  assert.equal(order.items[0].flavors.length, 3);
  assert.equal(order.items[0].unitPriceCents, 10_500);
  assert.equal(order.items[0].sizeLabel, "Família");
  assert.equal(order.channel, "pickup");

  const relabelled = updateFoodPizzeriaSettings(state, {
    pizzaSizes: state.settings.pizzaSizes.map((size) => size.id === "family" ? { ...size, label: "Família Grande" } : size),
  });
  assert.equal(relabelled.settings.pizzaSizes.find(({ id }) => id === "family").label, "Família Grande");
  assert.equal(relabelled.orders.find(({ id }) => id === "family-order-1").items[0].sizeLabel, "Família");
});

test("salon orders require an active table command and stay distinct from counter orders", () => {
  const state = completeFamilySize(addConfigurableSizeAndTable(createSeedFoodState()));
  const openedAt = new Date().toISOString();
  const withCommand = createPizzeriaTableCommand(state, {
    id: "table-command-9",
    tableId: 9,
    customerName: "Grupo do Salão",
    guestCount: 8,
    openedAt,
  });
  assert.throws(() => createPizzeriaTableCommand(state, {
    id: "table-command-too-large",
    tableId: 9,
    customerName: "Grupo Grande",
    guestCount: 9,
    openedAt,
  }), /capacidade/);

  const orderInput = {
    id: "salon-order-1",
    historyId: "salon-order-history-1",
    createdAt: openedAt,
    customerName: "Grupo do Salão",
    phone: "",
    channel: "dine-in",
    tableCommandId: "table-command-9",
    items: [{ id: "salon-item-1", size: "medium", flavorIds: ["ng-calabresa"], quantity: 1 }],
  };
  const withOrder = createPizzeriaOrder(withCommand, orderInput);
  assert.equal(withOrder.orders.find(({ id }) => id === orderInput.id).channel, "dine-in");
  assert.throws(() => createPizzeriaOrder(withCommand, { ...orderInput, channel: "counter" }), /salão/);
  assert.throws(() => createPizzeriaOrder(state, { ...orderInput, tableCommandId: null }), /salão/);
});

test("changing a recipe cannot retroactively change the consumption of an existing order", () => {
  const original = createSeedFoodState();
  const order = original.orders.find(({ status }) => status === "received");
  const before = calculatePizzeriaOrderConsumption(original, order.id);
  assert.ok(before.length > 0);
  const flavorId = order.items[0].flavors[0].id;
  const recipe = original.recipes.find(({ flavorId: id }) => id === flavorId);
  const changedLines = recipe.lines.map((line, index) => ({
    ...line,
    quantityBaseBySize: index === 0
      ? Object.fromEntries(Object.entries(line.quantityBaseBySize).map(([size, amount]) => [size, amount + 100]))
      : { ...line.quantityBaseBySize },
  }));
  const updated = savePizzeriaRecipe(original, { flavorId, lines: changedLines, at: new Date().toISOString() });
  assert.notDeepEqual(updated.recipes.find(({ flavorId: id }) => id === flavorId).lines, recipe.lines);
  assert.deepEqual(calculatePizzeriaOrderConsumption(updated, order.id), before);
  assert.deepEqual(updated.orders.find(({ id }) => id === order.id).consumptionSnapshot, before);
  assert.equal(Object.hasOwn(updated, "inventoryMovements"), false);

  const changed = structuredClone(updated);
  const idx = changed.orders.findIndex(({ id }) => id === order.id);
  changed.orders[idx].consumptionSnapshot[0].quantityBase = 0;
  assert.throws(() => validateFoodPizzeriaState(changed), /Proposta de consumo duplicada ou com quantidade inválida/);
});

test("v5 migration does not invent historical ingredient consumption", () => {
  const state = createSeedFoodState();
  const v5 = {
    ...state,
    schema: "ordax.food-pizzeria-state/5",
    orders: state.orders.map(({ consumptionSnapshot, ...order }) => order),
  };
  const migrated = migrateFoodPizzeriaState(v5);
  assert.equal(migrated.schema, "ordax.food-pizzeria-state/6");
  assert.equal(migrated.orders.length, state.orders.length);
  assert.ok(migrated.orders.every(({ consumptionSnapshot }) => consumptionSnapshot === null));
  assert.throws(() => calculatePizzeriaOrderConsumption(migrated, migrated.orders[0].id),
    /consumo histórico não é verificável/);
  assert.equal(Object.hasOwn(migrated, "inventoryMovements"), false);
});
