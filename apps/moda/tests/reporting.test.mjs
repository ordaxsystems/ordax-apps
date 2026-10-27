import test from "node:test";
import assert from "node:assert/strict";

import { customerMetrics, deriveOverview, deriveReport, money, salesTotals } from "../src/domain/derived.mjs";
import { renderCustomersPage, renderOverviewPage, renderReportsPage } from "../src/ui/views.mjs";

function reportFixture() {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(todayStart.getTime() - 12 * 60 * 60 * 1000);
  const today = new Date(todayStart.getTime() + 10 * 60 * 60 * 1000);
  const sku = "AUR-CAMISA-P-AREIA";
  const olderSale = {
    id: "sale-yesterday", number: "2001", totalCents: 100_000, createdAt: yesterday.toISOString(),
    lines: [{ sku, quantity: 2, unitPriceCents: 50_000 }],
  };
  const currentSale = {
    id: "sale-today", number: "2002", totalCents: 10_000, createdAt: today.toISOString(),
    lines: [{ sku, quantity: 1, unitPriceCents: 10_000 }],
  };
  return {
    now,
    todayStart,
    state: {
      catalog: { products: [{ id: "camisa", name: "Camisa Brisa", category: "Roupas", kind: "shirt", active: true, variants: [{ sku, size: "P", color: "Areia", active: true }] }] },
      inventory: { movements: [] },
      settings: { lowStockAt: 3 },
      team: { members: [{ name: "Marina Silva", status: "Ativa" }] },
      sales: { orders: [olderSale, currentSale] },
      returns: { items: [{ id: "return-today", saleId: olderSale.id, sku, quantity: 2, valueCents: 100_000, createdAt: today.toISOString() }] },
      customers: { records: [{ id: "customer-1", name: "Marina Azevedo" }] },
      customerLinks: { [olderSale.id]: "customer-1", [currentSale.id]: "customer-1" },
    },
  };
}

test("daily net preserves returns above same-day sales and reconciles the period", () => {
  const { state, now, todayStart } = reportFixture();
  const report = deriveReport(state, 7, now);
  const currentDay = report.buckets.find((bucket) => new Date(bucket.date).getDate() === now.getDate());
  const todayTotals = salesTotals(state, todayStart);

  assert.equal(currentDay.grossCents, 10_000);
  assert.equal(currentDay.returnedCents, 100_000);
  assert.equal(currentDay.netCents, -90_000);
  assert.equal(currentDay.unitsSold, 1);
  assert.equal(currentDay.unitsReturned, 2);
  assert.equal(currentDay.units, -1);
  assert.equal(todayTotals.netCents, -90_000);
  assert.equal(todayTotals.unitsSold, 1);
  assert.equal(todayTotals.unitsReturned, 2);
  assert.equal(todayTotals.units, -1);
  assert.equal(report.totals.netCents, report.totals.grossCents - report.totals.returnedCents);
  assert.equal(report.totals.netCents, 10_000);
});

test("exchange replacement contributes its merchandise value and delivered unit without claiming payment", () => {
  const { state, now, todayStart } = reportFixture();
  const sku = state.sales.orders[1].lines[0].sku;
  const sale = { ...state.sales.orders[1], totalCents: 10_000 };
  state.sales.orders = [sale];
  state.returns.items = [{
    id: "exchange-today", saleId: sale.id, sku, quantity: 1,
    type: "exchange", replacementSku: "AUR-TENIS-37-PRETO",
    valueCents: 10_000, replacementValueCents: 12_500,
    differenceCents: 2_500, settlement: "pending", createdAt: now.toISOString(),
  }];

  const report = deriveReport(state, 7, now);
  const today = report.buckets.find((bucket) => new Date(bucket.date).getDate() === now.getDate());
  const totals = salesTotals(state, todayStart);

  assert.equal(today.grossCents, 10_000);
  assert.equal(today.returnedCents, 10_000);
  assert.equal(today.replacementCents, 12_500);
  assert.equal(today.netCents, 12_500);
  assert.equal(today.unitsSold, 1);
  assert.equal(today.unitsReturned, 1);
  assert.equal(today.unitsExchanged, 1);
  assert.equal(today.units, 1);
  assert.equal(today.pendingExchangeDifferenceCents, 2_500);
  assert.equal(totals.netCents, 12_500);
  assert.match(renderOverviewPage(state), /1 peça vendida · 1 devolvida · 1 substituída em troca hoje/);

  const customerId = "customer-exchange";
  state.customerLinks[sale.id] = customerId;
  const customer = customerMetrics(state, customerId);
  assert.equal(customer.spendCents, 12_500);
  assert.equal(customer.pendingExchangeDifferenceCents, 2_500);
  assert.match(renderReportsPage(state, 7), /Mercadorias líquidas/);
  assert.match(renderReportsPage(state, 7), /acertos não são pagamentos/);
  assert.match(renderCustomersPage(state, "", customerId), /diferenças financeiras pendentes não representam pagamentos confirmados/);
});

test("product highlights do not count exchange replacements as a new sale", () => {
  const sale = {
    id: "sale-exchange", number: "3001", totalCents: 10_000,
    createdAt: "2026-10-26T12:00:00.000Z",
    lines: [{ sku: "SKU-OLD", quantity: 1, unitPriceCents: 10_000 }],
  };
  const state = {
    catalog: { products: [
      { id: "old", name: "Peça antiga", category: "Roupas", active: true, variants: [{ sku: "SKU-OLD", size: "M", color: "Areia", active: true }] },
      { id: "new", name: "Peça substituta", category: "Calçados", active: true, variants: [{ sku: "SKU-NEW", size: "37", color: "Preto", active: true }] },
    ] },
    inventory: { movements: [] }, settings: { lowStockAt: 1 },
    sales: { orders: [sale] },
    returns: { items: [{ saleId: sale.id, sku: "SKU-OLD", replacementSku: "SKU-NEW", type: "exchange", quantity: 1, valueCents: 10_000, replacementValueCents: 12_500 }] },
  };

  const overview = deriveOverview(state, new Date("2026-10-26T16:00:00.000Z"));

  assert.deepEqual(overview.best, []);
});

test("overview shows signed net units and explains sales versus returns", () => {
  const { state } = reportFixture();
  const html = renderOverviewPage(state);

  assert.match(html, /Peças líquidas/);
  assert.match(html, /<strong class="metric-value">-1<\/strong>/);
  assert.match(html, /1 peça vendida · 2 devolvidas hoje/);
});

test("overview includes the date when a recent sale is from another day", () => {
  const { state } = reportFixture();
  const olderSale = state.sales.orders.find((sale) => sale.id === "sale-yesterday");
  const expected = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  }).format(new Date(olderSale.createdAt));
  const html = renderOverviewPage(state);

  assert.match(html, /<th>Data e hora<\/th>/);
  assert.ok(html.includes(`<time datetime="${new Date(olderSale.createdAt).toISOString()}">${expected}</time>`));
});

test("reports render negative days below zero with a signed accessible value", () => {
  const { state } = reportFixture();
  const html = renderReportsPage(state, 7);

  assert.match(html, /report-bar-negative/);
  assert.ok(html.includes(money(-90_000)));
  assert.match(html, /aria-label="[^\"]*: -R\$/);
});
