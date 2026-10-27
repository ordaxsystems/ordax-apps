import assert from "node:assert/strict";
import test from "node:test";
import { buildFoodOperationalReport } from "../src/application/food-order-reporting.mjs";

const NOW = Date.parse("2026-10-27T16:00:00.000Z");

function order(id, { createdAt, channel = "pickup", status = "received", items = [], history = [] }) {
  return {
    id,
    createdAt: new Date(createdAt).toISOString(),
    channel,
    status,
    items,
    statusHistory: history,
  };
}

const pizza = (id, names, quantity = 1) => ({
  id,
  quantity,
  flavors: names.map((name) => ({ id: name.toLowerCase(), name })),
});

const catalogItem = (id, quantity) => ({ id, type: "catalog-product", quantity });

const snapshot = {
  orders: [
    order("ready-now", {
      createdAt: "2026-10-27T15:00:00.000Z",
      channel: "delivery",
      status: "ready",
      items: [pizza("pizza-1", ["Calabresa", "Portuguesa"], 2), catalogItem("drink-1", 3)],
      history: [
        { status: "received", changedAt: "2026-10-27T15:00:00.000Z" },
        { status: "preparing", changedAt: "2026-10-27T15:05:00.000Z" },
        { status: "ready", changedAt: "2026-10-27T15:18:00.000Z" },
      ],
    }),
    order("completed", {
      createdAt: "2026-10-27T13:00:00.000Z",
      channel: "dine-in",
      status: "completed",
      items: [pizza("pizza-2", ["Calabresa"])],
      history: [
        { status: "received", changedAt: "2026-10-27T13:00:00.000Z" },
        { status: "ready", changedAt: "2026-10-27T13:12:00.000Z" },
        { status: "completed", changedAt: "2026-10-27T13:30:00.000Z" },
      ],
    }),
    order("cancelled", {
      createdAt: "2026-10-27T14:00:00.000Z",
      channel: "pickup",
      status: "cancelled",
      items: [catalogItem("drink-2", 1)],
    }),
    order("older", {
      createdAt: "2026-10-26T10:00:00.000Z",
      channel: "counter",
      status: "preparing",
      items: [pizza("pizza-3", ["Marguerita"])],
    }),
    order("future", {
      createdAt: "2026-10-27T17:00:00.000Z",
      items: [pizza("pizza-4", ["Pepperoni"])],
    }),
  ],
};

test("operational report derives counts and ready time from Food order snapshots", () => {
  const report = buildFoodOperationalReport(snapshot, { range: "24h", now: NOW });
  assert.equal(report.totalOrders, 3);
  assert.equal(report.kitchenOrders, 0);
  assert.equal(report.readyOrders, 1);
  assert.equal(report.completedOrders, 1);
  assert.equal(report.cancelledOrders, 1);
  assert.equal(report.cancellationRate, 1 / 3);
  assert.equal(report.medianReadyMinutes, 15);
  assert.equal(report.readySampleSize, 2);
  assert.deepEqual(report.byChannel, { delivery: 1, pickup: 1, counter: 0, "dine-in": 1 });
});

test("item and flavor counts preserve combined pizzas without assigning flavor fractions", () => {
  const report = buildFoodOperationalReport(snapshot, { range: "24h", now: NOW });
  assert.equal(report.pizzaUnits, 3);
  assert.equal(report.additionalProductUnits, 4);
  assert.deepEqual(report.topFlavors.map(({ name, pizzas }) => [name, pizzas]), [
    ["Calabresa", 3], ["Portuguesa", 2],
  ]);
});

test("rolling windows exclude future records and include older Food records in wider ranges", () => {
  const oneDay = buildFoodOperationalReport(snapshot, { range: "24h", now: NOW });
  const sevenDays = buildFoodOperationalReport(snapshot, { range: "7d", now: NOW });
  assert.equal(oneDay.totalOrders, 3);
  assert.equal(sevenDays.totalOrders, 4);
  assert.equal(sevenDays.byChannel.counter, 1);
});

test("report rejects missing Food order data, unsupported ranges and invalid clocks", () => {
  assert.throws(() => buildFoodOperationalReport({}, { now: NOW }), /snapshot de pedidos/);
  assert.throws(() => buildFoodOperationalReport(snapshot, { range: "year", now: NOW }), /Período/);
  assert.throws(() => buildFoodOperationalReport(snapshot, { now: Number.NaN }), /horário/);
});
