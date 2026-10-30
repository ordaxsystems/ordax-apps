import assert from "node:assert/strict";
import test from "node:test";
import { renderOrderHistoryTimeline } from "../src/ui/views/order-history-timeline.mjs";

const statusLabels = Object.freeze({
  received: "Recebido",
  preparing: "Em preparo",
  ready: "Pronto",
  completed: "Concluído",
  cancelled: "Cancelado",
});
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);

test("linha do tempo projeta eventos Food em ordem, sem permitir edição", () => {
  const html = renderOrderHistoryTimeline({
    statusHistory: [
      { status: "received", changedAt: "2026-10-27T10:00:00.000Z", reason: null },
      { status: "preparing", changedAt: "2026-10-27T10:05:00.000Z", reason: null },
      { status: "ready", changedAt: "2026-10-27T10:22:00.000Z", reason: null },
    ],
  }, { statusLabels, escapeHtml });

  assert.match(html, /<details class="order-history-timeline">/);
  assert.match(html, /<summary><span>Histórico do pedido<\/span><small>3 registros<\/small><\/summary>/);
  assert.ok(html.indexOf("Recebido") < html.indexOf("Em preparo"));
  assert.ok(html.indexOf("Em preparo") < html.indexOf("Pronto"));
  assert.equal((html.match(/<time datetime=/g) ?? []).length, 3);
  assert.doesNotMatch(html, /<button|data-action=/);
});

test("linha do tempo escapa os rótulos e não inventa eventos sem histórico", () => {
  const html = renderOrderHistoryTimeline({
    statusHistory: [{ status: "unmapped", changedAt: "invalid<time>", reason: null }],
  }, { statusLabels, escapeHtml });

  assert.match(html, /Etapa registrada/);
  assert.match(html, /datetime="invalid&lt;time&gt;"/);
  assert.match(html, /Horário indisponível/);
  assert.equal(renderOrderHistoryTimeline({ statusHistory: [] }, { statusLabels, escapeHtml }), "");
  assert.equal(renderOrderHistoryTimeline({}), "");
});

test("motivos e dados do pedido não são duplicados pela linha do tempo", () => {
  const html = renderOrderHistoryTimeline({
    id: "pedido-privado",
    customerName: "Cliente",
    statusHistory: [{
      status: "cancelled",
      changedAt: "2026-10-27T10:12:00.000Z",
      reason: "Solicitação do cliente",
    }],
  }, { statusLabels, escapeHtml });

  assert.match(html, /Cancelado/);
  assert.doesNotMatch(html, /Solicitação do cliente|pedido-privado|Cliente/);
});
