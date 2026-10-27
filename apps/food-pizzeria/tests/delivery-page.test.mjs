import assert from "node:assert/strict";
import test from "node:test";
import { renderDeliveryPage } from "../src/ui/views/delivery.mjs";

function renderDelivery(orders) {
  return renderDeliveryPage({
    snapshot: { orders },
    sectionHeader: (_eyebrow, title, description, actions = "") => `<header><h1>${title}</h1><p>${description}</p>${actions}</header>`,
    statCard: (title, count) => `<div>${title}: ${count}</div>`,
    renderOrderCard: (order, { allowCancel = false, allowAdvance = false } = {}) => `<article data-order-id="${order.id}" data-can-cancel="${allowCancel}" data-can-advance="${allowAdvance}">${allowCancel ? "Cancelar" : allowAdvance ? "Avançar entrega" : ""}</article>`,
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

  assert.match(html, /data-order-id="ready" data-can-cancel="false" data-can-advance="true"/);
  assert.match(html, /data-order-id="route" data-can-cancel="false" data-can-advance="true"/);
  assert.doesNotMatch(html, /Cancelar|data-can-cancel="true"/);
  assert.doesNotMatch(html, /data-order-id="pickup"/);
});

test("parada em rota oferece ligação e cópia do endereço sem expor ações em pedido de retirada", () => {
  const html = renderDelivery([
    { id: "route", channel: "delivery", status: "out-for-delivery", customerName: "Bia", phone: "+55 (11) 99999-0000", address: "Rua B, 10", updatedAt: "2026-10-27T10:10:00.000Z" },
    { id: "pickup", channel: "pickup", status: "ready", customerName: "Caio", phone: "", address: "", updatedAt: "2026-10-27T10:20:00.000Z" },
  ]);

  assert.match(html, /href="tel:\+5511999990000" aria-label="Ligar para Bia do pedido #route"/);
  assert.match(html, /data-action="copy-delivery-address" data-address="Rua B, 10" data-order-number="#route">Copiar endereço/);
  assert.doesNotMatch(html, /data-address=""/);
  assert.doesNotMatch(html, /href="tel:.*Caio/);
});

test("fila de entrega informa a ordem de saída sem apresentar mapa ou GPS", () => {
  const html = renderDelivery([
    { id: "saída-posterior", channel: "delivery", status: "out-for-delivery", customerName: "Bia", phone: "11999990000", address: "Rua B", updatedAt: "2026-10-27T10:20:00.000Z" },
    { id: "saída-anterior", channel: "delivery", status: "out-for-delivery", customerName: "Ana", phone: "11988880000", address: "Rua A", updatedAt: "2026-10-27T10:10:00.000Z" },
  ]);

  assert.match(html, /<h2>Fila de entrega<\/h2>/);
  assert.match(html, /Da saída mais antiga à mais recente/);
  assert.ok(html.indexOf("#saída-anterior") < html.indexOf("#saída-posterior"));
  assert.doesNotMatch(html, /route-map|Diagrama esquemático|geolocalização|GPS|map-pin/);
});
