const historyTimestamp = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
});

// Read-only projection of the status events already stored on the Food order.
export function renderOrderHistoryTimeline(order, { statusLabels = {}, escapeHtml = String } = {}) {
  const events = Array.isArray(order?.statusHistory) ? order.statusHistory : [];
  if (events.length === 0) return "";

  const entries = events.map((event) => {
    const label = statusLabels[event.status] ?? "Etapa registrada";
    const parsedAt = Date.parse(event.changedAt);
    const formattedAt = Number.isFinite(parsedAt)
      ? historyTimestamp.format(parsedAt)
      : "Horário indisponível";
    const dateTime = typeof event.changedAt === "string" ? escapeHtml(event.changedAt) : "";

    return `<li><span class="order-history-marker" aria-hidden="true"></span><div><strong>${escapeHtml(label)}</strong><time datetime="${dateTime}">${escapeHtml(formattedAt)}</time></div></li>`;
  }).join("");
  const count = events.length;
  const countLabel = `${count} ${count === 1 ? "registro" : "registros"}`;

  return `<details class="order-history-timeline"><summary><span>Histórico do pedido</span><small>${escapeHtml(countLabel)}</small></summary><ol aria-label="Etapas registradas do pedido">${entries}</ol></details>`;
}
