import assert from "node:assert/strict";
import test from "node:test";
import { renderOrdersPage } from "../src/ui/views/orders.mjs";
import { createSeedFoodState } from "../src/fixtures/mock-data.mjs";

function renderOrders(orders) {
  return renderOrdersPage({
    STATUS_LABELS: {},
    CHANNEL_LABELS: { pickup: "Retirada" },
    ORDER_STATUS_FILTERS: [{ id: "all", label: "Todas as etapas" }],
    snapshot: { orders, settings: {}, flavors: [], recipes: [], tableCommands: [] },
    orderQuery: "",
    orderStatusFilter: "all",
    orderChannelFilter: "all",
    commandById: () => null,
    orderNumber: ({ id }) => id,
    renderOrderCard: ({ id }, { allowCancel = false, allowAdvance = false, showHistory = false } = {}) => `<article data-order-id="${id}" data-can-cancel="${allowCancel}" data-can-advance="${allowAdvance}" data-show-history="${showHistory}"></article>`,
    emptyState: () => `<div class="empty-state"></div>`,
  });
}

test("Pedidos mostra histórico e encaminha a criação para o PDV", () => {
  const html = renderOrders([]);

  assert.match(html, /<h1>Pedidos<\/h1>/);
  assert.match(html, /data-view="pos">Novo pedido/);
  assert.doesNotMatch(html, /id="create-order-form"|id="add-pizza-form"|Montar pedido/);
});

test("Pedidos é a área de gestão que expõe a ação de cancelamento", () => {
  const order = {
    id: "pedido-ativo",
    createdAt: "2026-10-27T10:00:00.000Z",
    customerName: "Cliente",
    phone: "",
    channel: "pickup",
    status: "received",
    items: [],
  };

  assert.match(renderOrders([order]), /data-can-cancel="true"/);
});

test("Pedidos habilita a linha do tempo histórica sem transferir ações ao acompanhamento", () => {
  const order = {
    id: "pedido-com-historico",
    createdAt: "2026-10-27T10:00:00.000Z",
    customerName: "Cliente",
    phone: "",
    channel: "pickup",
    status: "received",
    items: [],
  };

  assert.match(renderOrders([order]), /data-show-history="true"/);
});

test("histórico acompanha pedidos sem avançar etapas de cozinha ou entrega", () => {
  const order = {
    id: "pedido-acompanhado",
    createdAt: "2026-10-27T10:00:00.000Z",
    customerName: "Cliente",
    phone: "",
    channel: "pickup",
    status: "received",
    items: [],
  };

  assert.match(renderOrders([order]), /data-can-advance="false"/);
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
