const RANGE_DURATION_MS = Object.freeze({
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
});

const CHANNELS = Object.freeze(["delivery", "pickup", "counter", "dine-in"]);
const ACTIVE_STATUSES = new Set(["received", "preparing"]);

export const FOOD_REPORT_RANGES = Object.freeze(Object.keys(RANGE_DURATION_MS));

function timestamp(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function reportNow(value) {
  const parsed = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isFinite(parsed)) throw new TypeError("O horário do relatório precisa ser válido.");
  return parsed;
}

export function buildFoodOperationalReport(snapshot, { range = "7d", now = Date.now() } = {}) {
  if (!snapshot || !Array.isArray(snapshot.orders)) {
    throw new TypeError("O relatório precisa do snapshot de pedidos do Food.");
  }
  if (!Object.hasOwn(RANGE_DURATION_MS, range)) {
    throw new TypeError("Período de relatório inválido.");
  }

  const end = reportNow(now);
  const start = end - RANGE_DURATION_MS[range];
  const orders = snapshot.orders.filter((order) => {
    const createdAt = timestamp(order.createdAt);
    return createdAt !== null && createdAt >= start && createdAt <= end;
  });
  const byChannel = Object.fromEntries(CHANNELS.map((channel) => [channel, 0]));
  const flavorCounts = new Map();
  let pizzaUnits = 0;
  let additionalProductUnits = 0;
  const readyDurationsMinutes = [];

  for (const order of orders) {
    if (Object.hasOwn(byChannel, order.channel)) byChannel[order.channel] += 1;
    const createdAt = timestamp(order.createdAt);
    const firstReady = order.statusHistory?.find(({ status }) => status === "ready");
    const readyAt = timestamp(firstReady?.changedAt);
    if (createdAt !== null && readyAt !== null && readyAt >= createdAt && readyAt <= end) {
      readyDurationsMinutes.push((readyAt - createdAt) / 60_000);
    }

    for (const item of order.items ?? []) {
      if (item.type === "catalog-product") {
        additionalProductUnits += item.quantity;
        continue;
      }
      pizzaUnits += item.quantity;
      for (const flavor of item.flavors ?? []) {
        const current = flavorCounts.get(flavor.id) ?? { id: flavor.id, name: flavor.name, pizzas: 0 };
        current.pizzas += item.quantity;
        flavorCounts.set(flavor.id, current);
      }
    }
  }

  const medianReadyMinutes = readyDurationsMinutes.length
    ? (() => {
      const sorted = [...readyDurationsMinutes].sort((first, second) => first - second);
      const middle = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    })()
    : null;
  const recentOrders = [...orders].sort((first, second) => timestamp(second.createdAt) - timestamp(first.createdAt));
  const cancelledOrders = orders.filter(({ status }) => status === "cancelled").length;

  return Object.freeze({
    range,
    start,
    end,
    totalOrders: orders.length,
    kitchenOrders: orders.filter(({ status }) => ACTIVE_STATUSES.has(status)).length,
    readyOrders: orders.filter(({ status }) => status === "ready").length,
    outForDeliveryOrders: orders.filter(({ status }) => status === "out-for-delivery").length,
    completedOrders: orders.filter(({ status }) => status === "completed").length,
    cancelledOrders,
    cancellationRate: orders.length ? cancelledOrders / orders.length : 0,
    medianReadyMinutes,
    readySampleSize: readyDurationsMinutes.length,
    byChannel: Object.freeze(byChannel),
    pizzaUnits,
    additionalProductUnits,
    topFlavors: Object.freeze([...flavorCounts.values()]
      .sort((first, second) => second.pizzas - first.pizzas || first.name.localeCompare(second.name, "pt-BR"))
      .slice(0, 5)
      .map((entry) => Object.freeze(entry))),
    recentOrders: Object.freeze(recentOrders.slice(0, 5)),
  });
}
