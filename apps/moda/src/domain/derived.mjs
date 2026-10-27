export const MODA_CATEGORIES = Object.freeze(["Roupas", "Calçados", "Bolsas", "Acessórios"]);

export function money(cents) {
  const value = Number.isSafeInteger(cents) ? cents : 0;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value / 100);
}

export function number(value) {
  return new Intl.NumberFormat("pt-BR").format(Number(value) || 0);
}

export function normalizeSearchText(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
}

export function searchMatches(query, text) {
  const needle = normalizeSearchText(query).trim();
  return !needle || normalizeSearchText(text).includes(needle);
}

export function dateLabel(value, withTime = false) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", withTime
    ? { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }
    : { day: "2-digit", month: "short" }).format(date);
}

export function productForSku(state, sku) {
  for (const product of state.catalog.products) {
    const variant = product.variants.find((item) => item.sku === sku);
    if (variant) return { product, variant };
  }
  return null;
}

export function stockForSku(state, sku) {
  const movementById = new Map(state.inventory.movements.map((item) => [item.id, item]));
  const reversed = new Set(state.inventory.movements
    .filter((item) => item.kind === "reversal")
    .map((item) => item.reversesId));
  let balance = 0;
  for (const movement of state.inventory.movements) {
    if (movement.sku !== sku) continue;
    if (movement.kind === "reversal") {
      const original = movementById.get(movement.reversesId);
      if (original && original.sku === sku) balance += original.kind === "receive" ? -movement.quantity : movement.quantity;
    } else if (!reversed.has(movement.id)) {
      balance += movement.kind === "receive" ? movement.quantity : -movement.quantity;
    }
  }
  return Math.max(0, balance);
}

export function getSale(state, saleId) {
  return state.sales.orders.find((sale) => sale.id === saleId) ?? null;
}

export function returnableQuantity(state, saleId, sku) {
  const sale = getSale(state, saleId);
  if (!sale) return 0;
  const sold = sale.lines.filter((line) => line.sku === sku).reduce((sum, line) => sum + line.quantity, 0);
  const returned = state.returns.items
    .filter((item) => item.saleId === saleId && item.sku === sku)
    .reduce((sum, item) => sum + item.quantity, 0);
  return Math.max(0, sold - returned);
}

function returnImpact(items = []) {
  return items.reduce((impact, item) => {
    const quantity = Number.isSafeInteger(item?.quantity) && item.quantity > 0 ? item.quantity : 0;
    const returnedCents = Number.isSafeInteger(item?.valueCents) && item.valueCents >= 0 ? item.valueCents : 0;
    const exchange = item?.type === "exchange" && Boolean(item.replacementSku);
    const replacementCents = exchange && Number.isSafeInteger(item.replacementValueCents) && item.replacementValueCents >= 0
      ? item.replacementValueCents
      : 0;
    const pendingDifferenceCents = exchange && item.settlement === "pending" && Number.isSafeInteger(item.differenceCents)
      ? item.differenceCents
      : 0;
    return {
      returnedCents: impact.returnedCents + returnedCents,
      replacementCents: impact.replacementCents + replacementCents,
      unitsReturned: impact.unitsReturned + quantity,
      unitsExchanged: impact.unitsExchanged + (exchange ? quantity : 0),
      pendingDifferenceCents: impact.pendingDifferenceCents + pendingDifferenceCents,
    };
  }, {
    returnedCents: 0,
    replacementCents: 0,
    unitsReturned: 0,
    unitsExchanged: 0,
    pendingDifferenceCents: 0,
  });
}

export function deriveReturnValuePreview(state, {
  saleId, sku, quantity = 1, type = "return", replacementSku = "",
} = {}) {
  if (type !== "return" && type !== "exchange") return null;
  const sale = getSale(state, saleId);
  const line = sale?.lines.find((item) => item.sku === sku);
  const units = Number(quantity);
  if (!line || !Number.isSafeInteger(units) || units < 1 || units > returnableQuantity(state, saleId, sku)) return null;

  const returnedValueCents = line.unitPriceCents * units;
  if (!Number.isSafeInteger(returnedValueCents)) return null;
  const estimate = { type, quantity: units, returnedValueCents };
  if (type === "return") return { ...estimate, status: "reference-only" };

  const replacementId = String(replacementSku ?? "");
  if (!replacementId) return { ...estimate, status: "choose-replacement" };
  const replacement = productForSku(state, replacementId);
  if (!replacement || replacementId === sku || !replacement.product.active || !replacement.variant.active
    || stockForSku(state, replacementId) < units) {
    return { ...estimate, status: "replacement-unavailable" };
  }

  const replacementValueCents = replacement.variant.priceCents * units;
  const differenceCents = replacementValueCents - returnedValueCents;
  if (!Number.isSafeInteger(replacementValueCents) || !Number.isSafeInteger(differenceCents)) return null;
  return {
    ...estimate,
    status: "ready",
    replacementSku: replacementId,
    replacementValueCents,
    differenceCents,
    direction: differenceCents > 0 ? "collect" : differenceCents < 0 ? "credit" : "balanced",
  };
}

export function saleCustomerId(state, saleId) {
  return state.customerLinks[saleId] ?? null;
}

export function salesTotals(state, since = null) {
  const cutoff = since ? new Date(since).getTime() : Number.NEGATIVE_INFINITY;
  const sales = state.sales.orders.filter((sale) => Date.parse(sale.createdAt) >= cutoff);
  const returned = state.returns.items.filter((item) => Date.parse(item.createdAt) >= cutoff);
  const impact = returnImpact(returned);
  const grossCents = sales.reduce((sum, sale) => sum + sale.totalCents, 0);
  const unitsSold = sales.reduce((sum, sale) => sum + sale.lines.reduce((total, line) => total + line.quantity, 0), 0);
  const units = unitsSold - impact.unitsReturned + impact.unitsExchanged;
  return {
    sales,
    returns: returned,
    grossCents,
    returnedCents: impact.returnedCents,
    replacementCents: impact.replacementCents,
    pendingExchangeDifferenceCents: impact.pendingDifferenceCents,
    netCents: grossCents - impact.returnedCents + impact.replacementCents,
    unitsSold,
    unitsReturned: impact.unitsReturned,
    unitsExchanged: impact.unitsExchanged,
    units,
    ticketCount: sales.length,
    averageCents: sales.length ? Math.round(grossCents / sales.length) : 0,
  };
}

export function deriveOverview(state, now = new Date()) {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const today = salesTotals(state, dayStart);
  const variants = state.catalog.products.filter((product) => product.active)
    .flatMap((product) => product.variants.filter((variant) => variant.active).map((variant) => ({
    product, variant, stock: stockForSku(state, variant.sku),
    })));
  const lowStock = variants.filter(({ stock }) => stock <= state.settings.lowStockAt)
    .sort((a, b) => a.stock - b.stock || a.product.name.localeCompare(b.product.name, "pt-BR"));
  const recentSales = [...state.sales.orders].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 6);
  const bestBySku = new Map();
  for (const sale of state.sales.orders) {
    for (const line of sale.lines) bestBySku.set(line.sku, (bestBySku.get(line.sku) ?? 0) + line.quantity);
  }
  for (const item of state.returns.items) {
    bestBySku.set(item.sku, Math.max(0, (bestBySku.get(item.sku) ?? 0) - item.quantity));
  }
  const bestByProduct = new Map();
  for (const [sku, quantity] of bestBySku) {
    const found = productForSku(state, sku);
    if (!found || quantity <= 0) continue;
    const current = bestByProduct.get(found.product.id) ?? {
      product: found.product, variant: found.variant, quantity: 0, topVariantQuantity: 0,
    };
    current.quantity += quantity;
    if (quantity > current.topVariantQuantity) {
      current.variant = found.variant;
      current.topVariantQuantity = quantity;
    }
    bestByProduct.set(found.product.id, current);
  }
  const best = [...bestByProduct.values()]
    .sort((a, b) => b.quantity - a.quantity || a.product.name.localeCompare(b.product.name, "pt-BR"))
    .slice(0, 4)
    .map(({ product, variant, quantity }) => ({ product, variant, quantity }));
  return { today, lowStock, recentSales, best, variants };
}

export function deriveReport(state, days = 7, now = new Date()) {
  const rangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1)).getTime();
  const buckets = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
    const start = date.getTime();
    const end = start + 86_400_000;
    const sales = state.sales.orders.filter((sale) => Date.parse(sale.createdAt) >= start && Date.parse(sale.createdAt) < end);
    const returns = state.returns.items.filter((item) => Date.parse(item.createdAt) >= start && Date.parse(item.createdAt) < end);
    const impact = returnImpact(returns);
    const grossCents = sales.reduce((sum, sale) => sum + sale.totalCents, 0);
    const soldUnits = sales.reduce((sum, sale) => sum + sale.lines.reduce((total, line) => total + line.quantity, 0), 0);
    buckets.push({
      label: new Intl.DateTimeFormat("pt-BR", { weekday: "short" }).format(date).replace(".", ""),
      date: date.toISOString(),
      grossCents,
      returnedCents: impact.returnedCents,
      replacementCents: impact.replacementCents,
      pendingExchangeDifferenceCents: impact.pendingDifferenceCents,
      netCents: grossCents - impact.returnedCents + impact.replacementCents,
      unitsSold: soldUnits,
      unitsReturned: impact.unitsReturned,
      unitsExchanged: impact.unitsExchanged,
      units: soldUnits - impact.unitsReturned + impact.unitsExchanged,
      tickets: sales.length,
    });
  }
  const totals = buckets.reduce((all, item) => ({
    grossCents: all.grossCents + item.grossCents,
    returnedCents: all.returnedCents + item.returnedCents,
    replacementCents: all.replacementCents + item.replacementCents,
    pendingExchangeDifferenceCents: all.pendingExchangeDifferenceCents + item.pendingExchangeDifferenceCents,
    netCents: all.netCents + item.netCents,
    unitsSold: all.unitsSold + item.unitsSold,
    unitsReturned: all.unitsReturned + item.unitsReturned,
    unitsExchanged: all.unitsExchanged + item.unitsExchanged,
    units: all.units + item.units,
    tickets: all.tickets + item.tickets,
  }), {
    grossCents: 0, returnedCents: 0, replacementCents: 0,
    pendingExchangeDifferenceCents: 0, netCents: 0,
    unitsSold: 0, unitsReturned: 0, unitsExchanged: 0, units: 0, tickets: 0,
  });
  const categories = new Map();
  for (const sale of state.sales.orders.filter((item) => Date.parse(item.createdAt) >= rangeStart)) {
    for (const line of sale.lines) {
      const found = productForSku(state, line.sku);
      if (!found) continue;
      const category = found.product.category;
      categories.set(category, (categories.get(category) ?? 0) + line.unitPriceCents * line.quantity);
    }
  }
  return { buckets, totals, categories: [...categories.entries()].sort((a, b) => b[1] - a[1]) };
}

export function customerMetrics(state, customerId) {
  const orderIds = Object.entries(state.customerLinks)
    .filter(([, linkedId]) => linkedId === customerId)
    .map(([saleId]) => saleId);
  const orders = state.sales.orders.filter((sale) => orderIds.includes(sale.id));
  const returns = state.returns.items.filter((item) => orderIds.includes(item.saleId));
  const impact = returnImpact(returns);
  const grossCents = orders.reduce((sum, sale) => sum + sale.totalCents, 0);
  return {
    orders,
    returns,
    grossCents,
    returnedCents: impact.returnedCents,
    replacementCents: impact.replacementCents,
    pendingExchangeDifferenceCents: impact.pendingDifferenceCents,
    spendCents: Math.max(0, grossCents - impact.returnedCents + impact.replacementCents),
    lastOrder: [...orders].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] ?? null,
  };
}
