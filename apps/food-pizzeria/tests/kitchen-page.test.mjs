import assert from "node:assert/strict";
import test from "node:test";
import { renderKitchenPage } from "../src/ui/views/kitchen.mjs";
import { DEFAULT_KITCHEN_DISPLAY_CONFIGURATION, resizeKitchenDisplayConfiguration } from "../src/application/kitchen-display-configuration.mjs";

const now = Date.parse("2026-10-26T13:00:00.000Z");

function order({ id, status, channel, startedAt, quantity = 1, flavor = "Margherita", flavors = null, tableCommandId = null }) {
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
    items: [{ quantity, size: "large", sizeLabel: "Grande", flavors: flavors ?? [{ name: flavor }] }],
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
    PIZZA_SIZES: [{ id: "large", label: "Grande", slices: 8 }],
    ORDER_STAGE_ALERT_MINUTES: { received: 15, preparing: 35, ready: 15, "out-for-delivery": 45 },
    stageStartedAt: (record) => record.statusHistory.at(-1)?.changedAt ?? record.createdAt,
    elapsedMinutes: (startedAt) => Math.max(0, Math.floor((now - Date.parse(startedAt)) / 60_000)),
    orderNumber: (record) => `#${record.id.slice(-4)}`,
    orderChannelLabel: (record) => record.tableCommandId ? "Mesa 03" : ({ delivery: "Entrega", pickup: "Retirada", counter: "Balcão", "dine-in": "Salão" })[record.channel],
    escapeHtml: (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"),
    renderKitchenOrderCard: (record, { deliveryDetails = false } = {}) => `<article data-order="${record.id}"><header><strong>#${record.id.slice(-4)}</strong></header><span class="status-badge status-${record.status}"></span><ul>${record.items.map((item) => `<li class="kitchen-pizza-line">${item.quantity}× ${item.sizeLabel} · 8 fatias · Sabores: ${item.flavors.length === 2 ? "Meio a meio · " : ""}${item.flavors.map(({ name }) => name).join(" / ")}</li>`).join("")}</ul>${deliveryDetails ? record.address : ""}</article>`,
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

test("KDS exposes screen assignments and states the real production boundary", () => {
  const layout = resizeKitchenDisplayConfiguration(DEFAULT_KITCHEN_DISPLAY_CONFIGURATION, 4, "by-stage");
  const page = render({ kitchenDisplayConfiguration: layout });

  assert.match(page, /id="kitchen-layout-form"/);
  assert.match(page, /name="screenCount"/);
  assert.match(page, /value="by-stage" selected/);
  assert.match(page, /name="display-4"/);
  assert.match(page, /Abrir tela 4/);
  assert.match(page, /abrir massa, montagem e forno dependem do contrato Food de produção/);
  assert.match(page, /Distribuição por pessoa/);
  assert.match(page, /People\/Identity/);
});

test("dedicated display shows only its assigned order stage with fullscreen controls", () => {
  const layout = resizeKitchenDisplayConfiguration(DEFAULT_KITCHEN_DISPLAY_CONFIGURATION, 4, "by-stage");
  const page = render({
    kitchenDisplayConfiguration: layout,
    activeKitchenScreen: 2,
    kitchenScreenStage: "preparing",
    kitchenScreenCount: 4,
  });

  assert.match(page, /TELA 2 DE 4/);
  assert.match(page, /data-kitchen-station-screen="2"/);
  assert.match(page, /data-action="fullscreen-kitchen"/);
  assert.match(page, /data-kitchen-stage="preparing"/);
  assert.match(page, /data-order="order-1002"/);
  assert.match(page, /data-kitchen-current-order="order-1002"/);
  assert.equal((page.match(/#1002/g) ?? []).length, 1,
    "O identificador do pedido em foco não deve ser repetido na tela.");
  assert.match(page, /Grande · 8 fatias/);
  assert.match(page, /Fatias exibidas conforme o cadastro atual do tamanho/);
  assert.doesNotMatch(page, /data-order="order-1001"|data-order="order-1003"/);
  assert.doesNotMatch(page, /kitchen-summary|kitchen-toolbar|kitchen-display-setup/);
  assert.doesNotMatch(page, /PRÉVIA LOCAL|Sem sincronização entre aparelhos|dados fictícios/i);
});

test("station guidance maps existing order states to dough, assembly, and dispatch instructions", () => {
  const layout = resizeKitchenDisplayConfiguration(DEFAULT_KITCHEN_DISPLAY_CONFIGURATION, 3, "by-stage");
  const stations = [
    { number: 1, stage: "received", guidance: "Abertura da massa" },
    { number: 2, stage: "preparing", guidance: "Montagem" },
    { number: 3, stage: "ready", guidance: "Expedição" },
  ];

  for (const { number, stage, guidance } of stations) {
    const page = render({
      kitchenDisplayConfiguration: layout,
      activeKitchenScreen: number,
      kitchenScreenStage: stage,
      kitchenScreenCount: 3,
    });
    assert.match(page, new RegExp(guidance));
    assert.match(page, new RegExp(`data-kitchen-stage="${stage}"`));
  }
});

test("one full-cycle display keeps one FIFO ticket in focus through all order stages", () => {
  const page = render({
    kitchenDisplayConfiguration: DEFAULT_KITCHEN_DISPLAY_CONFIGURATION,
    activeKitchenScreen: 1,
    kitchenScreenStage: "all",
    kitchenScreenCount: 1,
  });

  assert.match(page, /Fluxo completo: acompanhe um pedido por vez/);
  assert.match(page, /data-kitchen-current-order="order-1002"/);
  assert.equal([...page.matchAll(/data-kitchen-current-order="order-\d+"/g)].length, 1);
  assert.match(page, /data-kitchen-upcoming-order="order-1001"/);
  assert.match(page, /Balcão · Recebidos/);

  const advancedToAssembly = render({
    kitchenDisplayConfiguration: DEFAULT_KITCHEN_DISPLAY_CONFIGURATION,
    activeKitchenScreen: 1,
    kitchenScreenStage: "all",
    kitchenScreenCount: 1,
    snapshot: {
      tableCommands: [],
      orders: [
        order({ id: "order-1001", status: "received", channel: "counter", startedAt: "2026-10-26T12:40:00.000Z" }),
        order({ id: "order-1002", status: "preparing", channel: "dine-in", startedAt: "2026-10-26T12:10:00.000Z", tableCommandId: "command-3" }),
        order({ id: "order-1003", status: "ready", channel: "pickup", startedAt: "2026-10-26T12:55:00.000Z" }),
      ],
    },
  });
  assert.match(advancedToAssembly, /data-kitchen-current-order="order-1002"/);
  assert.match(advancedToAssembly, /class="status-badge status-preparing"/);

  const afterCompletion = render({
    kitchenDisplayConfiguration: DEFAULT_KITCHEN_DISPLAY_CONFIGURATION,
    activeKitchenScreen: 1,
    kitchenScreenStage: "all",
    kitchenScreenCount: 1,
    snapshot: {
      tableCommands: [],
      orders: [
        order({ id: "order-1001", status: "received", channel: "counter", startedAt: "2026-10-26T12:40:00.000Z" }),
        order({ id: "order-1002", status: "completed", channel: "dine-in", startedAt: "2026-10-26T12:10:00.000Z", tableCommandId: "command-3" }),
        order({ id: "order-1003", status: "ready", channel: "pickup", startedAt: "2026-10-26T12:55:00.000Z" }),
      ],
    },
  });
  assert.match(afterCompletion, /data-kitchen-current-order="order-1001"/);
  assert.doesNotMatch(afterCompletion, /data-kitchen-current-order="order-1002"/);
});

test("dedicated station focuses one FIFO order and lists only the next five with pizza details", () => {
  const layout = resizeKitchenDisplayConfiguration(DEFAULT_KITCHEN_DISPLAY_CONFIGURATION, 4, "by-stage");
  const stationOrders = Array.from({ length: 8 }, (_, index) => order({
    id: `prep-${index + 1}`,
    status: "preparing",
    channel: "counter",
    startedAt: new Date(now - (60 - index * 5) * 60_000).toISOString(),
    flavor: "Margherita",
    flavors: index === 1 ? [{ name: "Margherita" }, { name: "Calabresa" }] : null,
  }));
  const page = render({
    kitchenDisplayConfiguration: layout,
    activeKitchenScreen: 2,
    kitchenScreenStage: "preparing",
    kitchenScreenCount: 4,
    snapshot: { tableCommands: [], orders: stationOrders },
  });

  assert.equal([...page.matchAll(/data-kitchen-current-order="prep-\d+"/g)].length, 1);
  assert.match(page, /data-kitchen-current-order="prep-1"/);
  assert.equal([...page.matchAll(/data-kitchen-upcoming-order="prep-\d+"/g)].length, 5);
  assert.match(page, /data-kitchen-upcoming-order="prep-6"/);
  assert.doesNotMatch(page, /data-kitchen-upcoming-order="prep-7"|data-kitchen-upcoming-order="prep-8"/);
  assert.match(page, /Meio a meio · Margherita \/ Calabresa/);
  assert.match(page, /\+ 2 pedidos depois dos próximos cinco/);

  const advanced = render({
    kitchenDisplayConfiguration: layout,
    activeKitchenScreen: 2,
    kitchenScreenStage: "preparing",
    kitchenScreenCount: 4,
    snapshot: {
      tableCommands: [],
      orders: stationOrders.map((record, index) => index === 0
        ? { ...record, status: "ready", statusHistory: [...record.statusHistory, { changedAt: new Date(now).toISOString() }] }
        : record),
    },
  });
  assert.match(advanced, /data-kitchen-current-order="prep-2"/);
  assert.doesNotMatch(advanced, /data-kitchen-current-order="prep-1"|data-kitchen-upcoming-order="prep-1"/);
});

test("a station link may carry its display role without relying on another device's local preferences", () => {
  const layout = resizeKitchenDisplayConfiguration(DEFAULT_KITCHEN_DISPLAY_CONFIGURATION, 3, "by-stage");
  const page = render({
    kitchenDisplayConfiguration: layout,
    kitchenScreenHref: (screenNumber, stage, screenCount) => `/?station=${screenNumber}&stationStage=${stage}&screenCount=${screenCount}`,
  });

  assert.match(page, /href="[^"]*station=2&amp;stationStage=preparing&amp;screenCount=3"/);
});
