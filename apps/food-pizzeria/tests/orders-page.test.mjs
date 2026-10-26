import assert from "node:assert/strict";
import test from "node:test";
import { renderOrdersPage } from "../src/ui/views/orders.mjs";
import { createSeedFoodState } from "../src/fixtures/mock-data.mjs";

function renderOrders(orders, deliveryFeeCents = 500) {
  return renderOrdersPage({
    PIZZERIA_TABLES: [],
    deliveryFeeCents,
    STATUS_LABELS: {},
    CHANNEL_LABELS: {},
    ORDER_STATUS_FILTERS: [],
    snapshot: { orders, flavors: [], recipes: [], settings: { maxFlavorsPerPizza: 2 } },
    orderQuery: "",
    orderStatusFilter: "all",
    orderChannelFilter: "all",
    activeCommandId: null,
    cart: [],
    busy: false,
    commandById: () => null,
    orderNumber: ({ id }) => id,
    sizeOptions: () => "",
    flavorOptions: () => "",
    cartHtml: () => "",
    renderOrderCard: ({ id }) => `<article data-order-id="${id}"></article>`,
    emptyState: () => "",
    button: () => "",
    money: () => "R$ 0,00",
    escapeHtml: (value) => value,
  });
}

test("formulário de entrega inicia com a taxa configurada e comunica que pode ser ajustada", () => {
  const html = renderOrders([], 875);

  assert.match(html, /name="deliveryFee"[^>]*value="8,75"/);
  assert.match(html, /Taxa padrão configurada para a prévia; ajuste neste pedido se necessário/);
  assert.doesNotMatch(html, /Valor inicial fictício/);
});

test("histórico de pedidos prioriza o horário de criação mesmo se a lista vier fora de ordem", () => {
  const earlier = {
    id: "pedido-antigo",
    createdAt: "2026-10-26T17:00:00.000Z",
    customerName: "Cliente antigo",
    phone: "",
    channel: "pickup",
    status: "received",
    items: [],
  };
  const later = {
    ...earlier,
    id: "pedido-recente",
    createdAt: "2026-10-26T18:00:00.000Z",
    customerName: "Cliente recente",
  };
  const invalidTimestamp = { ...earlier, id: "pedido-legado", createdAt: "data-inválida" };
  const html = renderOrders([earlier, invalidTimestamp, later]);

  assert.ok(html.indexOf('data-order-id="pedido-recente"') < html.indexOf('data-order-id="pedido-antigo"'));
  assert.ok(html.indexOf('data-order-id="pedido-antigo"') < html.indexOf('data-order-id="pedido-legado"'));
});

test("horários dos pedidos fictícios acompanham a sequência numérica do histórico", () => {
  const timestamps = createSeedFoodState().orders.map(({ createdAt }) => Date.parse(createdAt));

  assert.ok(timestamps.every((timestamp, index) => index === 0 || timestamps[index - 1] >= timestamp));
});
