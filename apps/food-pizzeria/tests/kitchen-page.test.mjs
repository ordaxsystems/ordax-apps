import assert from "node:assert/strict";
import test from "node:test";
import { renderKitchenPage } from "../src/ui/views/kitchen.mjs";

const now = Date.parse("2026-10-26T13:00:00.000Z");

function order({ id, status, channel, startedAt, quantity = 1, flavor = "Margherita", tableCommandId = null }) {
  return {
    id,
    status,
    channel,
    tableCommandId,
    createdAt: startedAt,
    statusHistory: [{ changedAt: startedAt }],
    customerName: "Cliente reservado",
    phone: "11999990000",
    address: "Rua confidencial, 123",
    notes: "Sem cebola",
    items: [{ quantity, size: "large", sizeLabel: "Grande", flavors: [{ name: flavor }] }],
  };
}

function render(overrides = {}) {
  const snapshot = {
    tableCommands: [{ id: "command-3", tableId: 3 }],
    orders: [
      order({ id: "order-1001", status: "received", channel: "counter", startedAt: "2026-10-26T12:40:00.000Z", quantity: 2, flavor: "Calabresa" }),
      order({ id: "order-1002", status: "preparing", channel: "dine-in", startedAt: "2026-10-26T12:10:00.000Z", tableCommandId: "command-3" }),
      order({ id: "order-1003", status: "ready", channel: "pickup", startedAt: "2026-10-26T12:55:00.000Z", flavor: "Quatro queijos" }),
      order({ id: "order-1004", status: "out-for-delivery", channel: "delivery", startedAt: "2026-10-26T12:30:00.000Z" }),
    ],
  };
  const viewModel = {
    KITCHEN_CHANNEL_FILTERS: [
      { id: "all", label: "Todos" },
      { id: "counter", label: "Balcão" },
      { id: "dine-in", label: "Salão" },
      { id: "delivery", label: "Entrega" },
    ],
    kitchenChannelFilter: "all",
    kitchenOrderQuery: "",
    kitchenLateOnly: false,
    snapshot,
    ORDER_STAGE_ALERT_MINUTES: { received: 15, preparing: 35, ready: 15, "out-for-delivery": 45 },
    stageStartedAt: (record) => record.statusHistory.at(-1)?.changedAt ?? record.createdAt,
    elapsedMinutes: (startedAt) => Math.max(0, Math.floor((now - Date.parse(startedAt)) / 60_000)),
    orderNumber: (record) => `#${record.id.slice(-4)}`,
    orderChannelLabel: (record) => record.tableCommandId ? "Mesa 03" : ({ delivery: "Entrega", pickup: "Retirada", counter: "Balcão", "dine-in": "Salão" })[record.channel],
    escapeHtml: (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"),
    renderKitchenOrderCard: (record, { deliveryDetails = false } = {}) => `<article data-order="${record.id}">${deliveryDetails ? record.address : ""}</article>`,
    kitchenChannelButton: (filter) => `<button data-channel="${filter.id}">${filter.label}</button>`,
    ...overrides,
  };
  return renderKitchenPage(viewModel);
}

test("KDS summarizes pizza volume, orders, and delivery without claiming a live shift", () => {
  const page = render();

  assert.match(page, /data-kitchen-overdue-count>2<\/strong>/);
  assert.match(page, /Pizzas na cozinha<\/span><strong\s*>4<\/strong><small>3 pedidos em produção/);
  assert.match(page, /Aguardando início<\/span><strong\s*>1<\/strong><small>2 pizzas na fila/);
  assert.match(page, /Prontos para expedir<\/span><strong\s*>1<\/strong><small>1 pedido<\/small>/);
  assert.match(page, /4 pedidos ativos/);
  assert.match(page, /order-1004/);
  assert.match(page, /Rua confidencial/);
  assert.doesNotMatch(page, /Turno aberto|live-indicator|tempo real/);
});

test("search filters by order, table, and pizza flavor without searching customer data", () => {
  const byTable = render({ kitchenOrderQuery: "mesa 03" });
  assert.match(byTable, /order-1002/);
  assert.doesNotMatch(byTable, /order-1001|order-1003|order-1004/);

  const byFlavor = render({ kitchenOrderQuery: "Calabresa" });
  assert.match(byFlavor, /order-1001/);
  assert.doesNotMatch(byFlavor, /order-1002|order-1003|order-1004/);

  const byPrivateAddress = render({ kitchenOrderQuery: "Rua confidencial" });
  assert.match(byPrivateAddress, /Nenhum pedido corresponde/);
  assert.doesNotMatch(byPrivateAddress, /data-order="order-1004"/);
});

test("overdue filter shows orders beyond their current stage target", () => {
  const page = render({ kitchenLateOnly: true });
  assert.match(page, /data-order="order-1001"/);
  assert.match(page, /data-order="order-1002"/);
  assert.doesNotMatch(page, /data-order="order-1003"|data-order="order-1004"/);
  assert.match(page, /aria-pressed="true"/);
});

test("KDS exposes touch-ready filters and stage navigation affordances", () => {
  const page = render({ kitchenOrderQuery: "pizza" });
  assert.match(page, /id="kitchen-search-form"/);
  assert.match(page, /data-action="toggle-kitchen-late-filter"/);
  assert.match(page, /data-action="reset-kitchen-filters"/);
  assert.match(page, /tabindex="0" aria-label="Etapas da produção/);
});
