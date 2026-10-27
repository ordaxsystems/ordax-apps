import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { renderDeliveryPage } from "../src/ui/views/delivery.mjs";

function renderDelivery(orders) {
  return renderDeliveryPage({
    snapshot: { orders },
    sectionHeader: (_eyebrow, title, description, actions = "") => `<header><h1>${title}</h1><p>${description}</p>${actions}</header>`,
    statCard: (title, count) => `<div>${title}: ${count}</div>`,
    renderOrderCard: (order, { allowCancel = false, allowAdvance = false } = {}) => `<article data-order-id="${order.id}" data-can-cancel="${allowCancel}" data-can-advance="${allowAdvance}">${allowCancel ? "Cancelar" : allowAdvance ? "Avançar pedido" : ""}</article>`,
    emptyState: ({ title }) => `<div>${title}</div>`,
    iconSvg: () => "icon",
    orderNumber: ({ id }) => `#${id}`,
    escapeHtml: (value) => String(value),
    clockTime: () => "10:00",
  });
}

test("Expedição separa despacho de entrega e entrega ao cliente em retirada, balcão e salão", () => {
  const html = renderDelivery([
    { id: "delivery-ready-newer", channel: "delivery", status: "ready", customerName: "Ana", address: "Rua A", updatedAt: "2026-10-27T10:20:00.000Z" },
    { id: "delivery-ready-older", channel: "delivery", status: "ready", customerName: "Bela", address: "Rua AA", updatedAt: "2026-10-27T10:00:00.000Z" },
    { id: "route", channel: "delivery", status: "out-for-delivery", customerName: "Bia", address: "Rua B", updatedAt: "2026-10-27T10:10:00.000Z" },
    { id: "pickup", channel: "pickup", status: "ready", customerName: "Caio", address: "", updatedAt: "2026-10-27T10:20:00.000Z" },
    { id: "counter", channel: "counter", status: "ready", customerName: "Dani", address: "", updatedAt: "2026-10-27T10:30:00.000Z" },
    { id: "dine-in", channel: "dine-in", status: "ready", customerName: "Mesa 2", address: "", updatedAt: "2026-10-27T10:40:00.000Z" },
    { id: "still-in-kitchen", channel: "pickup", status: "preparing", customerName: "Eli", address: "", updatedAt: "2026-10-27T10:50:00.000Z" },
  ]);

  assert.match(html, /<h1>Expedição<\/h1>/);
  assert.match(html, /Prontos para despacho/);
  assert.match(html, /Retirada e atendimento/);
  assert.match(html, /Aguardando cliente: 3/);
  assert.ok(html.indexOf('data-order-id="delivery-ready-older"')
    < html.indexOf('data-order-id="delivery-ready-newer"'),
  "Entregas prontas devem ser despachadas da mais antiga para a mais recente.");
  for (const id of ["delivery-ready-older", "delivery-ready-newer", "pickup", "counter", "dine-in", "route"]) {
    assert.match(html, new RegExp(`data-order-id="${id}" data-can-cancel="false" data-can-advance="true"`));
  }
  assert.doesNotMatch(html, /data-order-id="still-in-kitchen"/);
  assert.doesNotMatch(html, /Cancelar|data-can-cancel="true"/);
});

test("parada em rota oferece ligação e cópia do endereço", () => {
  const html = renderDelivery([
    { id: "route", channel: "delivery", status: "out-for-delivery", customerName: "Bia", phone: "+55 (11) 99999-0000", address: "Rua B, 10", updatedAt: "2026-10-27T10:10:00.000Z" },
    { id: "pickup", channel: "pickup", status: "ready", customerName: "Caio", phone: "", address: "", updatedAt: "2026-10-27T10:20:00.000Z" },
  ]);

  assert.match(html, /href="tel:\+5511999990000" aria-label="Ligar para Bia do pedido #route"/);
  assert.match(html, /data-action="copy-delivery-address" data-address="Rua B, 10" data-order-number="#route">Copiar endereço/);
  assert.doesNotMatch(html, /data-address=""/);
  assert.doesNotMatch(html, /href="tel:.*Caio/);
});

test("a Expedição mantém ordem previsível quando transições ocorrem no mesmo instante", () => {
  const sharedReleaseAt = "2026-10-27T10:20:00.000Z";
  const html = renderDelivery([
    { id: "delivery-tie-newer", channel: "delivery", status: "ready", customerName: "Ana", address: "Rua A", createdAt: "2026-10-27T10:00:00.000Z", updatedAt: sharedReleaseAt },
    { id: "delivery-tie-older", channel: "delivery", status: "ready", customerName: "Bela", address: "Rua B", createdAt: "2026-10-27T09:55:00.000Z", updatedAt: sharedReleaseAt },
    { id: "handoff-tie-newer", channel: "pickup", status: "ready", customerName: "Caio", address: "", createdAt: "2026-10-27T10:00:00.000Z", updatedAt: sharedReleaseAt },
    { id: "handoff-tie-older", channel: "counter", status: "ready", customerName: "Dani", address: "", createdAt: "2026-10-27T09:55:00.000Z", updatedAt: sharedReleaseAt },
    { id: "route-tie-newer", channel: "delivery", status: "out-for-delivery", customerName: "Eli", address: "Rua E", createdAt: "2026-10-27T10:00:00.000Z", updatedAt: sharedReleaseAt },
    { id: "route-tie-older", channel: "delivery", status: "out-for-delivery", customerName: "Fabi", address: "Rua F", createdAt: "2026-10-27T09:55:00.000Z", updatedAt: sharedReleaseAt },
    { id: "delivery-id-z", channel: "delivery", status: "ready", customerName: "Gabi", address: "Rua G", createdAt: "2026-10-27T10:00:00.000Z", updatedAt: sharedReleaseAt },
    { id: "delivery-id-a", channel: "delivery", status: "ready", customerName: "Hugo", address: "Rua H", createdAt: "2026-10-27T10:00:00.000Z", updatedAt: sharedReleaseAt },
  ]);

  for (const [older, newer] of [
    ["delivery-tie-older", "delivery-tie-newer"],
    ["handoff-tie-older", "handoff-tie-newer"],
    ["route-tie-older", "route-tie-newer"],
    ["delivery-id-a", "delivery-id-z"],
  ]) {
    assert.ok(
      html.indexOf(`data-order-id="${older}"`) < html.indexOf(`data-order-id="${newer}"`),
      `${older} deve aparecer antes de ${newer} quando o horário da transição coincide.`,
    );
  }
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

test("cartões de expedição quebram o cabeçalho em telefones estreitos", async () => {
  const css = await readFile(new URL("../assets/food-pizzeria.css", import.meta.url), "utf8");
  const mobileRules = css.match(/@media\s*\(max-width:\s*380px\)\s*\{([^}]+(?:\}[^}]*)*)\}/)?.[1] ?? "";

  assert.match(mobileRules, /\.delivery-stage \.order-card-head\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(mobileRules, /\.delivery-stage \.order-card-head > div\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(mobileRules, /\.delivery-stage \.status-badge\s*\{[^}]*white-space:\s*normal/);
});
