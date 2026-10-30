import assert from "node:assert/strict";
import test from "node:test";
import { renderOrdersPage } from "../src/ui/views/orders.mjs";
import { createSeedFoodState } from "../src/fixtures/mock-data.mjs";

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);

function renderOrders(orders, overrides = {}) {
  return renderOrdersPage({
    STATUS_LABELS: {},
    CHANNEL_LABELS: { pickup: "Retirada" },
    ORDER_STATUS_FILTERS: [{ id: "all", label: "Todas as etapas" }],
    snapshot: { orders, settings: {}, flavors: [], recipes: [], tableCommands: [] },
    orderQuery: "",
    showLocalSearch: false,
    escapeHtml,
    orderStatusFilter: "all",
    orderChannelFilter: "all",
    commandById: () => null,
    orderNumber: ({ id }) => id,
    renderOrderCard: ({ id }, { allowCancel = false, allowAdvance = false, showHistory = false } = {}) => `<article data-order-id="${id}" data-can-cancel="${allowCancel}" data-can-advance="${allowAdvance}" data-show-history="${showHistory}"></article>`,
    emptyState: () => `<div class="empty-state"></div>`,
    ...overrides,
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

test("host incorporado oferece busca local e permite limpar uma consulta ativa", () => {
  const html = renderOrders([], { showLocalSearch: true, orderQuery: "1050" });

  assert.match(html, /<form id="orders-search-form"/);
  assert.match(html, /id="orders-search" type="search" name="query" value="1050"/);
  assert.match(html, /aria-label="Buscar pedido, cliente, telefone, endereço, mesa ou item"/);
  assert.match(html, /data-action="reset-order-filters">Limpar filtros/);
  assert.doesNotMatch(renderOrders([]), /id="orders-search-form"/);
  const unsafe = renderOrders([], { showLocalSearch: true, orderQuery: '"><img src=x onerror=alert(1)>' });
  assert.doesNotMatch(unsafe, /<img src=x/);
  assert.match(unsafe, /value="&quot;&gt;&lt;img/);
});

test("busca textual combina etapa e canal sem criar uma segunda lista de pedidos", () => {
  const matching = {
    id: "ng-order-1050",
    createdAt: "2026-10-27T10:00:00.000Z",
    customerName: "Ana Souza",
    phone: "11999990000",
    channel: "pickup",
    status: "preparing",
    items: [{ type: "pizza", flavors: [{ name: "Calabresa" }] }],
  };
  const wrongStatus = { ...matching, id: "ng-order-1049", status: "ready" };
  const html = renderOrders([matching, wrongStatus], {
    orderQuery: "calabresa",
    orderStatusFilter: "preparing",
    orderChannelFilter: "pickup",
  });

  assert.match(html, /data-order-id="ng-order-1050"/);
  assert.doesNotMatch(html, /data-order-id="ng-order-1049"/);
  assert.match(html, /1 de 2 pedidos/);
});

test("busca de pedidos combina termos em campos diferentes, ignora acentos e pontuação do telefone", () => {
  const matching = {
    id: "ng-order-1049",
    createdAt: "2026-10-27T10:00:00.000Z",
    customerName: "Carla Souza",
    phone: "(11) 99812-7731",
    address: "Av. Central, 456 — Aclimação",
    channel: "pickup",
    status: "received",
    items: [{ type: "pizza", flavors: [{ name: "Calabresa" }] }],
  };
  const distractor = { ...matching, id: "ng-order-1050", address: "Rua Augusta, 10 — Consolação" };
  const html = renderOrders([matching, distractor], {
    orderQuery: "  CARLA aclimacao 998127731 calabresa  ",
  });

  assert.match(html, /data-order-id="ng-order-1049"/);
  assert.doesNotMatch(html, /data-order-id="ng-order-1050"/);
  assert.match(html, /1 de 2 pedidos/);
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
