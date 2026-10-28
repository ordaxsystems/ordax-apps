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
  const pricedOrders = orders.filter((order) => order.status !== "cancelled"
    && Number.isSafeInteger(order.totalCents) && order.totalCents >= 0);
  const totalOrderValueCents = pricedOrders.reduce((sum, order) => {
    if (!Number.isSafeInteger(sum + order.totalCents)) {
      throw new RangeError("O total dos pedidos excede o intervalo monetário seguro do relatório.");
    }
    return sum + order.totalCents;
  }, 0);
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
    totalOrderValueCents: pricedOrders.length ? totalOrderValueCents : null,
    averageOrderValueCents: pricedOrders.length ? Math.round(totalOrderValueCents / pricedOrders.length) : null,
    pricedOrderSampleSize: pricedOrders.length,
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

function csvCell(value) {
  const text = String(value ?? "");
  const spreadsheetFormula = /^[\u0000-\u0020\uFEFF]*[=+\-@]/.test(text);
  const safeText = spreadsheetFormula ? `'${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}

export function serializeFoodOperationalReportCsv(report, {
  channelLabels = {},
  statusLabels = {},
  orderNumber = ({ id }) => String(id ?? ""),
} = {}) {
  if (!report || !Number.isFinite(report.start) || !Number.isFinite(report.end)
    || !Array.isArray(report.recentOrders) || typeof orderNumber !== "function") {
    throw new TypeError("O relatório Food não pode ser exportado.");
  }

  const channelTotal = Object.values(report.byChannel ?? {}).reduce((sum, count) => sum + count, 0);
  const rows = [
    ["seção", "indicador", "valor", "unidade", "detalhes"],
    ["Período", "Início", new Date(report.start).toISOString(), "UTC", report.range],
    ["Período", "Fim", new Date(report.end).toISOString(), "UTC", report.range],
    ["Pedidos", "Total", report.totalOrders, "pedidos", "Criados no período"],
    ["Pedidos", "Na cozinha", report.kitchenOrders, "pedidos", "Recebidos ou em preparo"],
    ["Pedidos", "Prontos", report.readyOrders, "pedidos", "Estado atual do pedido"],
    ["Pedidos", "Concluídos", report.completedOrders, "pedidos", "Estado atual do pedido"],
    ["Pedidos", "Cancelados", report.cancelledOrders, "pedidos", `${Math.round(report.cancellationRate * 100)}% do período`],
    ["Pedidos", "Valor dos pedidos", formatBrl(report.totalOrderValueCents), "BRL", "Exclui cancelados; não confirma pagamento"],
    ["Pedidos", "Média por pedido", formatBrl(report.averageOrderValueCents), "BRL", `${report.pricedOrderSampleSize ?? 0} pedidos válidos não cancelados`],
    ["Produção", "Mediana até Pronto", report.medianReadyMinutes ?? "", "minutos", `${report.readySampleSize} pedidos na amostra`],
    ["Itens", "Pizzas", report.pizzaUnits, "unidades", "Quantidades dos snapshots Food"],
    ["Itens", "Produtos adicionais", report.additionalProductUnits, "unidades", "Sem baixa de Inventory"],
  ];

  for (const [channel, count] of Object.entries(report.byChannel ?? {})) {
    const share = channelTotal > 0 ? Math.round((count / channelTotal) * 100) : 0;
    rows.push(["Canais", channelLabels[channel] ?? channel, count, "pedidos", `${share}% dos canais classificados`]);
  }
  for (const flavor of report.topFlavors ?? []) {
    const share = report.topFlavors[0]?.pizzas > 0
      ? Math.round((flavor.pizzas / report.topFlavors[0].pizzas) * 100)
      : 0;
    rows.push(["Sabores", flavor.name, flavor.pizzas, "pizzas", `${share}% do sabor mais presente; combinações contam cada sabor`]);
  }
  for (const order of report.recentOrders) {
    const details = `${channelLabels[order.channel] ?? order.channel} · ${order.createdAt}`;
    rows.push(["Pedidos recentes", orderNumber(order), statusLabels[order.status] ?? order.status, "status", details]);
  }

  return `\uFEFF${rows.map((row) => row.map(csvCell).join(";")).join("\r\n")}\r\n`;
}

function formatBrl(cents) {
  return Number.isSafeInteger(cents) && cents >= 0
    ? new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100)
    : "";
}
