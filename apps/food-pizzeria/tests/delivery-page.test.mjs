import assert from "node:assert/strict";
import test from "node:test";
import { renderDeliveryPage } from "../src/ui/views/delivery.mjs";

function renderDelivery(orders) {
  return renderDeliveryPage({
    snapshot: { orders },
    sectionHeader: (_eyebrow, title, description, actions = "") => `<header><h1>${title}</h1><p>${description}</p>${actions}</header>`,
    statCard: (title, count) => `<div>${title}: ${count}</div>`,
    renderOrderCard: (order, { allowCancel = false } = {}) => `<article data-order-id="${order.id}" data-can-cancel="${allowCancel}">${allowCancel ? "Cancelar" : ""}</article>`,
    emptyState: ({ title }) => `<div>${title}</div>`,
    iconSvg: () => "icon",
    orderNumber: ({ id }) => `#${id}`,
    escapeHtml: (value) => String(value),
    clockTime: () => "10:00",
  });
}

test("Delivery exibe pedidos de despacho sem disponibilizar cancelamento", () => {
  const html = renderDelivery([
    { id: "ready", channel: "delivery", status: "ready", customerName: "Ana", address: "Rua A", updatedAt: "2026-10-27T10:00:00.000Z" },
    { id: "route", channel: "delivery", status: "out-for-delivery", customerName: "Bia", address: "Rua B", updatedAt: "2026-10-27T10:10:00.000Z" },
    { id: "pickup", channel: "pickup", status: "ready", customerName: "Caio", address: "", updatedAt: "2026-10-27T10:20:00.000Z" },
  ]);

  assert.match(html, /data-order-id="ready" data-can-cancel="false"/);
  assert.match(html, /data-order-id="route" data-can-cancel="false"/);
  assert.doesNotMatch(html, /Cancelar|data-can-cancel="true"/);
  assert.doesNotMatch(html, /data-order-id="pickup"/);
});
