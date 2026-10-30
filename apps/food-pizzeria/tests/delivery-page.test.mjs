import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { telephoneHref, whatsappHref } from "../src/ui/contact-links.mjs";
import { renderDeliveryPage } from "../src/ui/views/delivery.mjs";

function renderDelivery(orders) {
  return renderDeliveryPage({
    snapshot: { orders },
    sectionHeader: (_eyebrow, title, description, actions = "") => `<header><h1>${title}</h1><p>${description}</p>${actions}</header>`,
    statCard: (title, count) => `<div>${title}: ${count}</div>`,
    renderOrderCard: (order, { allowCancel = false, allowAdvance = false, showDeliveryCall = false, customerUpdate = null } = {}) => {
      const deliveryCallHref = showDeliveryCall && order.channel === "delivery" && order.status === "ready" ? telephoneHref(order.phone) : null;
      const deliveryCallAction = deliveryCallHref ? `<a href="tel:${deliveryCallHref}" aria-label="Ligar para ${order.customerName} do pedido #${order.id}">Ligar</a>` : "";
      const customerUpdateHref = customerUpdate ? whatsappHref(order.phone, customerUpdate.message) : null;
      const customerUpdateAction = customerUpdateHref ? `<a href="${customerUpdateHref}" data-customer-message="${customerUpdate.message}">Avisar cliente</a>` : "";
      return `<article data-order-id="${order.id}" data-can-cancel="${allowCancel}" data-can-advance="${allowAdvance}" data-show-delivery-call="${Boolean(deliveryCallAction)}" data-show-customer-update="${Boolean(customerUpdateAction)}">${deliveryCallAction}${customerUpdateAction}${allowCancel ? "Cancelar" : allowAdvance ? "Avançar pedido" : ""}</article>`;
    },
    emptyState: ({ title }) => `<div>${title}</div>`,
    iconSvg: () => "icon",
    orderNumber: ({ id }) => `#${id}`,
    escapeHtml: (value) => String(value),
    clockTime: () => "10:00",
  });
}

test("Expedição separa despacho de entrega e entrega ao cliente em retirada, balcão e salão", () => {
  const html = renderDelivery([
    { id: "delivery-ready-newer", channel: "delivery", status: "ready", customerName: "Ana", phone: "11999990001", address: "Rua A", updatedAt: "2026-10-27T10:20:00.000Z" },
    { id: "delivery-ready-older", channel: "delivery", status: "ready", customerName: "Bela", phone: "11999990002", address: "Rua AA", updatedAt: "2026-10-27T10:00:00.000Z" },
    { id: "route", channel: "delivery", status: "out-for-delivery", customerName: "Bia", phone: "11999990003", address: "Rua B", updatedAt: "2026-10-27T10:10:00.000Z" },
    { id: "pickup", channel: "pickup", status: "ready", customerName: "Caio", phone: "11999990004", address: "", updatedAt: "2026-10-27T10:20:00.000Z" },
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
  assert.match(html, /data-order-id="delivery-ready-older"[^>]*data-show-customer-update="true"/);
  assert.match(html, /data-order-id="pickup"[^>]*data-show-customer-update="true"/);
  assert.match(html, /data-order-id="route"[^>]*data-show-customer-update="true"/);
  assert.match(html, /data-order-id="counter"[^>]*data-show-customer-update="false"/);
  assert.match(html, /data-order-id="dine-in"[^>]*data-show-customer-update="false"/);
});

test("parada em rota oferece ligação e cópia do endereço", () => {
  const html = renderDelivery([
    { id: "route", channel: "delivery", status: "out-for-delivery", customerName: "Bia", phone: "+55 (11) 99999-0000", address: "Rua B, 10", updatedAt: "2026-10-27T10:10:00.000Z" },
    { id: "pickup", channel: "pickup", status: "ready", customerName: "Caio", phone: "", address: "", updatedAt: "2026-10-27T10:20:00.000Z" },
  ]);

  assert.match(html, /href="tel:\+5511999990000" aria-label="Ligar para Bia do pedido #route"/);
  assert.match(html, /data-action="copy-delivery-address" data-address="Rua B, 10" data-order-number="#route" aria-label="Copiar endereço do pedido #route">Copiar endereço/);
  assert.doesNotMatch(html, /data-address=""/);
  assert.doesNotMatch(html, /href="tel:.*Caio/);
});

test("Expedição permite ligar antes do despacho somente para entrega pronta", () => {
  const html = renderDelivery([
    { id: "delivery-ready", channel: "delivery", status: "ready", customerName: "Ana", phone: "+55 (11) 99999-0000", address: "Rua A", updatedAt: "2026-10-27T10:10:00.000Z" },
    { id: "pickup-ready", channel: "pickup", status: "ready", customerName: "Bia", phone: "11988880000", address: "", updatedAt: "2026-10-27T10:20:00.000Z" },
    { id: "delivery-route", channel: "delivery", status: "out-for-delivery", customerName: "Caio", phone: "11977770000", address: "Rua B", updatedAt: "2026-10-27T10:30:00.000Z" },
  ]);

  assert.match(html, /data-order-id="delivery-ready"[^>]*data-show-delivery-call="true"/);
  assert.match(html, /data-order-id="pickup-ready"[^>]*data-show-delivery-call="false"/);
  assert.match(html, /data-order-id="delivery-route"[^>]*data-show-delivery-call="false"/);
  assert.match(html, /href="tel:\+5511999990000" aria-label="Ligar para Ana do pedido #delivery-ready"/);
  assert.doesNotMatch(html, /href="tel:11988880000"/);
  assert.match(html, /href="https:\/\/wa\.me\/5511999990000\?text=Seu%20pedido%20%23delivery-ready%20est%C3%A1%20pronto%20e%20aguardando%20despacho\."/);
  assert.match(html, /data-customer-message="Seu pedido #pickup-ready está pronto para retirada\."/);
  assert.match(html, /data-customer-message="Seu pedido #delivery-route saiu para entrega\."/);
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
