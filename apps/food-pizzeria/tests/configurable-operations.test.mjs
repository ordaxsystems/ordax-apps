import test from "node:test";
import assert from "node:assert/strict";

import {
  calculatePizzaPriceCents,
  calculatePizzeriaOrderConsumption,
  configureFoodPizzeria,
  createEmptyFoodPizzeriaState,
  migrateFoodPizzeriaState,
  validateFoodPizzeriaState,
  createPizzeriaOrder,
  createPizzeriaTableCommand,
  closePizzeriaTableCommand,
  transitionPizzeriaOrder,
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

function withoutSliceCount(source) {
  return {
    ...source,
    orders: source.orders.map((order) => ({
      ...order,
      items: order.items.map((item) => {
        if (item.type === "catalog-product") return item;
        const { sliceCount: _sliceCount, ...legacyItem } = item;
        return legacyItem;
      }),
    })),
  };
}

test("configuração inicial preserva tamanhos, mesas e limite de sabores informados", () => {
  const configured = configureFoodPizzeria(createEmptyFoodPizzeriaState(), {
    storeName: "Pizzaria de teste",
    halfPricePolicy: "average",
    maxFlavorsPerPizza: 3,
    pizzaSizes: [
      { id: "small", label: "Individual", slices: 4, active: true },
    ],
    tables: [{ id: 22, seats: 5, active: true }],
  });

  assert.equal(configured.settings.halfPricePolicy, "average");
  assert.equal(configured.settings.maxFlavorsPerPizza, 3);
  assert.deepEqual(configured.settings.pizzaSizes, [
    { id: "small", label: "Individual", slices: 4, active: true },
  ]);
  assert.deepEqual(configured.settings.tables, [{ id: 22, seats: 5, active: true }]);
  assert.equal(Object.hasOwn(configured.settings, "deliveryFeeCents"), false);
});

test("nova pizzaria inicia com quatro sabores e aplica a regra de preço configurada", () => {
  let state = createSeedFoodState();
  const flavorIds = ["ng-calabresa", "ng-portuguesa", "ng-marguerita", "ng-frango-catupiry"];

  assert.equal(state.settings.maxFlavorsPerPizza, 4);
  const unitPriceCents = calculatePizzaPriceCents({
    size: "medium",
    flavorIds,
    flavors: state.flavors,
    halfPricePolicy: state.settings.halfPricePolicy,
    pizzaSizes: state.settings.pizzaSizes,
    maxFlavorsPerPizza: state.settings.maxFlavorsPerPizza,
  });
  assert.equal(unitPriceCents, Math.max(...flavorIds.map((id) =>
    state.flavors.find(({ id: flavorId }) => flavorId === id).pricesCents.medium)));

  state = createPizzeriaOrder(state, {
    id: "four-flavor-order",
    historyId: "four-flavor-order-received",
    createdAt: new Date().toISOString(),
    customerName: "Cliente Quatro Sabores",
    channel: "pickup",
    items: [{ id: "four-flavor-pizza", size: "medium", flavorIds, quantity: 1 }],
  });

  const item = state.orders.find(({ id }) => id === "four-flavor-order").items[0];
  assert.deepEqual(item.flavors.map(({ id }) => id), flavorIds);
  assert.equal(item.unitPriceCents, unitPriceCents);
  assert.equal(item.sliceCount, 6);
});

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
  assert.equal(order.items[0].sliceCount, 12);
  assert.equal(order.channel, "pickup");

  const relabelled = updateFoodPizzeriaSettings(state, {
    pizzaSizes: state.settings.pizzaSizes.map((size) => size.id === "family" ? { ...size, label: "Família Grande" } : size),
  });
  assert.equal(relabelled.settings.pizzaSizes.find(({ id }) => id === "family").label, "Família Grande");
  assert.equal(relabelled.orders.find(({ id }) => id === "family-order-1").items[0].sizeLabel, "Família");

  const resized = updateFoodPizzeriaSettings(relabelled, {
    pizzaSizes: relabelled.settings.pizzaSizes.map((size) => size.id === "family" ? { ...size, slices: 10 } : size),
  });
  assert.equal(resized.orders.find(({ id }) => id === "family-order-1").items[0].sliceCount, 12);
  const nextOrderAt = new Date(Math.max(Date.now(), Date.parse(createdAt)) + 1000).toISOString();
  const withNextOrder = createPizzeriaOrder(resized, {
    id: "family-order-2",
    historyId: "family-order-history-2",
    createdAt: nextOrderAt,
    customerName: "Cliente seguinte",
    channel: "pickup",
    items: [{ id: "family-item-2", size: "family", flavorIds: ["ng-calabresa"], quantity: 1 }],
  });
  assert.equal(withNextOrder.orders.find(({ id }) => id === "family-order-2").items[0].sliceCount, 10);
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
  const legacySource = withoutSliceCount(state);
  const v5 = {
    ...legacySource,
    schema: "ordax.food-pizzeria-state/5",
    settings: Object.fromEntries(Object.entries(state.settings).filter(([key]) => key !== "deliveryFeeCents")),
    orders: legacySource.orders.map(({ consumptionSnapshot, ...order }) => order),
  };
  const migrated = migrateFoodPizzeriaState(v5);
  assert.equal(migrated.schema, "ordax.food-pizzeria-state/8");
  assert.equal(Object.hasOwn(migrated.settings, "deliveryFeeCents"), false);
  assert.equal(migrated.orders.length, state.orders.length);
  assert.ok(migrated.orders.every(({ consumptionSnapshot }) => consumptionSnapshot === null));
  assert.ok(migrated.orders.every(({ items }) => items.filter(({ type }) => type !== "catalog-product").every(({ sliceCount }) => sliceCount === null)));
  assert.throws(() => calculatePizzeriaOrderConsumption(migrated, migrated.orders[0].id),
    /consumo histórico não é verificável/);
  assert.equal(Object.hasOwn(migrated, "inventoryMovements"), false);
});

test("taxa explicitamente informada fica congelada no pedido sem alterar o estado canônico", () => {
  const initial = createSeedFoodState();
  const historicalDelivery = initial.orders.find(({ channel }) => channel === "delivery");
  assert.equal(initial.schema, "ordax.food-pizzeria-state/8");
  assert.equal(Object.hasOwn(initial.settings, "deliveryFeeCents"), false);
  assert.equal(initial.orders.find(({ id }) => id === historicalDelivery.id).deliveryFeeCents, historicalDelivery.deliveryFeeCents);

  const createdAt = new Date().toISOString();
  const next = createPizzeriaOrder(initial, {
    id: "delivery-fee-default-order",
    historyId: "delivery-fee-default-history",
    createdAt,
    customerName: "Cliente da prévia",
    phone: "(11) 99999-0000",
    channel: "delivery",
    address: "Rua da Amostra, 10 — Centro",
    deliveryFeeCents: 875,
    items: [{ id: "delivery-fee-default-item", size: "medium", flavorIds: ["ng-calabresa"], quantity: 1 }],
  });
  const order = next.orders.find(({ id }) => id === "delivery-fee-default-order");
  assert.equal(order.deliveryFeeCents, 875);
  assert.equal(order.totalCents, order.subtotalCents + 875);
});

test("Food v6 migra ao schema v8 sem inventar fatias históricas nem incorporar preferências locais", () => {
  const current = createSeedFoodState();
  const legacySource = withoutSliceCount(current);
  const v6 = {
    ...legacySource,
    schema: "ordax.food-pizzeria-state/6",
  };

  const migrated = migrateFoodPizzeriaState(v6);
  assert.equal(migrated.schema, "ordax.food-pizzeria-state/8");
  assert.equal(migrated.revision, current.revision);
  assert.equal(Object.hasOwn(migrated.settings, "deliveryFeeCents"), false);
  assert.deepEqual(migrated.orders, v6.orders.map((order) => ({
    ...order,
    items: order.items.map((item) => item.type === "catalog-product" ? item : { ...item, sliceCount: null }),
  })));
});

test("Food v7 migration preserves legacy orders and leaves historical slice count unknown", () => {
  const current = createSeedFoodState();
  const legacy = {
    ...withoutSliceCount(current),
    schema: "ordax.food-pizzeria-state/7",
  };
  const migrated = migrateFoodPizzeriaState(legacy);

  assert.equal(migrated.schema, "ordax.food-pizzeria-state/8");
  assert.equal(migrated.revision, legacy.revision);
  assert.deepEqual(migrated.orders, legacy.orders.map((order) => ({
    ...order,
    items: order.items.map((item) => item.type === "catalog-product" ? item : { ...item, sliceCount: null }),
  })));
  for (const order of migrated.orders) {
    for (const item of order.items.filter(({ type }) => type !== "catalog-product")) {
      assert.equal(item.sliceCount, null);
    }
  }
});

test("table commands reject orders before opening and closure before the last order update", () => {
  const base = createSeedFoodState();
  const openedAt = "2026-10-24T12:00:00.000Z";
  let state = createPizzeriaTableCommand(base, {
    id: "table-chronology-2",
    tableId: 2,
    customerName: "Grupo Cronologia",
    guestCount: 2,
    openedAt,
  });
  const request = {
    id: "chronology-order-1",
    historyId: "chronology-history-received",
    customerName: "Grupo Cronologia",
    channel: "dine-in",
    tableCommandId: "table-chronology-2",
    items: [{ id: "chronology-item-1", size: "medium", flavorIds: ["ng-calabresa"], quantity: 1 }],
  };
  assert.throws(() => createPizzeriaOrder(state, {
    ...request,
    createdAt: "2026-10-24T11:59:59.000Z",
  }), /anteceder a abertura/);

  state = createPizzeriaOrder(state, { ...request, createdAt: "2026-10-24T12:01:00.000Z" });
  const received = state;
  const malformed = structuredClone(received);
  const order = malformed.orders.find(({ id }) => id === request.id);
  order.createdAt = "2026-10-24T11:59:59.000Z";
  order.updatedAt = order.createdAt;
  order.statusHistory[0].changedAt = order.createdAt;
  assert.throws(() => validateFoodPizzeriaState(malformed), /anteceder a abertura/);

  const transitions = [
    ["preparing", "2026-10-24T12:02:00.000Z"],
    ["ready", "2026-10-24T12:03:00.000Z"],
    ["completed", "2026-10-24T12:04:00.000Z"],
  ];
  for (const [nextStatus, changedAt] of transitions) {
    state = transitionPizzeriaOrder(state, {
      orderId: request.id,
      nextStatus,
      changedAt,
      historyId: `chronology-history-${nextStatus}`,
    });
  }
  assert.throws(() => closePizzeriaTableCommand(state, {
    commandId: request.tableCommandId,
    closedAt: "2026-10-24T12:03:30.000Z",
  }), /última atualização/);
  const closed = closePizzeriaTableCommand(state, {
    commandId: request.tableCommandId,
    closedAt: "2026-10-24T12:05:00.000Z",
  });
  assert.equal(closed.tableCommands.find(({ id }) => id === request.tableCommandId).closedAt,
    "2026-10-24T12:05:00.000Z");

  const invalidClose = structuredClone(closed);
  invalidClose.tableCommands.find(({ id }) => id === request.tableCommandId).closedAt =
    "2026-10-24T12:03:30.000Z";
  assert.throws(() => validateFoodPizzeriaState(invalidClose), /antes da última atualização/);
});

test("reducing table capacity cannot invalidate an open command or an active snapshot", () => {
  const base = createSeedFoodState();
  const openedAt = "2026-10-24T15:00:00.000Z";
  const opened = createPizzeriaTableCommand(base, {
    id: "seat-limit-session",
    tableId: 2,
    customerName: "Grupo do Teste",
    guestCount: 4,
    openedAt,
  });
  const fewerSeats = opened.settings.tables.map((table) =>
    table.id === 2 ? { ...table, seats: 2 } : table);
  assert.throws(() => updateFoodPizzeriaSettings(opened, { tables: fewerSeats }),
    /reduzir a capacidade/);

  const modified = structuredClone(opened);
  modified.settings.tables.find(({ id }) => id === 2).seats = 2;
  assert.throws(() => validateFoodPizzeriaState(modified),
    /comanda aberta exige uma mesa ativa com capacidade suficiente/);

  const closed = closePizzeriaTableCommand(opened, {
    commandId: "seat-limit-session",
    closedAt: "2026-10-24T15:01:00.000Z",
  });
  const resized = updateFoodPizzeriaSettings(closed, { tables: fewerSeats });
  assert.equal(resized.settings.tables.find(({ id }) => id === 2).seats, 2);
  assert.equal(resized.tableCommands.find(({ id }) => id === "seat-limit-session").guestCount, 4);
  assert.equal(resized.tableCommands.find(({ id }) => id === "seat-limit-session").closedAt,
    "2026-10-24T15:01:00.000Z");
});

test("one table cannot have overlapping sessions, even when the earlier command is closed", () => {
  const base = createSeedFoodState();
  const previous = createPizzeriaTableCommand(base, {
    id: "history-session-a",
    tableId: 2,
    customerName: "Grupo A",
    guestCount: 3,
    openedAt: "2026-10-24T12:00:00.000Z",
  });
  const closed = closePizzeriaTableCommand(previous, {
    commandId: "history-session-a",
    closedAt: "2026-10-24T12:05:00.000Z",
  });

  assert.throws(() => createPizzeriaTableCommand(closed, {
    id: "history-session-overlap",
    tableId: 2,
    customerName: "Grupo B",
    guestCount: 2,
    openedAt: "2026-10-24T12:04:59.000Z",
  }), /sobrepor o atendimento anterior/);

  const reopened = createPizzeriaTableCommand(closed, {
    id: "history-session-b",
    tableId: 2,
    customerName: "Grupo B",
    guestCount: 2,
    openedAt: "2026-10-24T12:05:00.000Z",
  });
  const mutated = structuredClone(reopened);
  mutated.tableCommands.find(({ id }) => id === "history-session-a").closedAt =
    "2026-10-24T12:06:00.000Z";
  assert.throws(() => validateFoodPizzeriaState(mutated), /períodos sobrepostos/);

  const fullyClosed = closePizzeriaTableCommand(reopened, {
    commandId: "history-session-b",
    closedAt: "2026-10-24T12:08:00.000Z",
  });
  assert.throws(() => createPizzeriaTableCommand(fullyClosed, {
    id: "history-session-backdated",
    tableId: 2,
    customerName: "Grupo C",
    guestCount: 2,
    openedAt: "2026-10-24T12:07:00.000Z",
  }), /sobrepor o atendimento anterior/);
  const third = createPizzeriaTableCommand(fullyClosed, {
    id: "history-session-c",
    tableId: 2,
    customerName: "Grupo C",
    guestCount: 2,
    openedAt: "2026-10-24T12:08:00.000Z",
  });
  assert.equal(third.tableCommands.find(({ id }) => id === "history-session-c").closedAt, null);
  assert.equal(third.tableCommands.filter(({ tableId }) => tableId === 2).length, 3);
});
