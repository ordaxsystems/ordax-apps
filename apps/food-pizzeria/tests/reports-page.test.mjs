import assert from "node:assert/strict";
import test from "node:test";
import { renderFoodReportsPage } from "../src/ui/views/reports.mjs";
import { assertFoodModuleView } from "../src/ui/presentation.mjs";

const snapshot = {
  orders: [{
    id: "order-1048",
    createdAt: "2026-10-27T15:00:00.000Z",
    channel: "pickup",
    status: "ready",
    totalCents: 2450,
    items: [{ id: "pizza-1", quantity: 1, flavors: [{ id: "calabresa", name: "Calabresa" }] }],
    statusHistory: [
      { status: "received", changedAt: "2026-10-27T15:00:00.000Z" },
      { status: "ready", changedAt: "2026-10-27T15:16:00.000Z" },
    ],
  }],
};

function viewModel(overrides = {}) {
  return {
    snapshot,
    reportRange: "7d",
    orderNumber: ({ id }) => `#${id.replace("order-", "")}`,
    CHANNEL_LABELS: { delivery: "Entrega", pickup: "Retirada", counter: "Balcão", "dine-in": "Salão" },
    STATUS_LABELS: { ready: "Pronto" },
    timeLabel: () => "27/10/2026, 12:00",
    iconSvg: (name) => `<svg data-icon="${name}"></svg>`,
    escapeHtml: (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]),
    ...overrides,
  };
}

test("Food reports render operational metrics, period controls and navigation actions", () => {
  const page = renderFoodReportsPage(viewModel());
  assert.match(page, /ANÁLISE OPERACIONAL/);
  assert.match(page, /Pedidos por canal/);
  assert.match(page, /Mediana até ficar pronto/);
  assert.match(page, /Média por pedido/);
  assert.match(page, /R\$ 24,50/);
  assert.match(page, /não confirma pagamento/);
  assert.match(page, /16 min/);
  assert.match(page, /data-report-range="24h"/);
  assert.match(page, /data-report-range="7d" aria-pressed="true"/);
  assert.match(page, /data-report-range="30d"/);
  assert.match(page, /data-view="kitchen"/);
  assert.match(page, /data-view="pos"/);
  assert.match(page, /data-view="orders"/);
  assert.match(page, /data-action="export-food-report"[\s\S]*?Baixar CSV/);
  assert.match(page, /#1048/);
  assert.match(page, /<progress class="food-report-progress" max="100" value="100"/);
  assert.doesNotMatch(page, /style=/);
});

test("reports explain combined-flavor counting and keep payments and inventory outside Food", () => {
  const page = renderFoodReportsPage(viewModel());
  assert.match(page, /Em pizzas combinadas, cada sabor aparece na contagem/);
  assert.match(page, /Pagamentos e saldos de estoque continuam nos respectivos owners/);
  assert.match(page, /total congelado nos pedidos não cancelados/);
  assert.doesNotMatch(page, /faturamento|lucro|receita líquida/i);
});

test("empty report period offers a direct route to register a Food order", () => {
  const page = renderFoodReportsPage(viewModel({ reportRange: "24h", snapshot: { orders: [] } }));
  assert.match(page, /Sem pedidos neste período/);
  assert.match(page, /data-view="pos"/);
  assert.doesNotMatch(page, /undefined|null/);
});

test("reports are an approved embedded Food module while Space-owned overview stays outside", () => {
  assert.equal(assertFoodModuleView("reports"), "reports");
  assert.throws(() => assertFoodModuleView("overview"), /módulos operacionais/);
  assert.throws(() => assertFoodModuleView("inventory"), /módulos operacionais/);
});
