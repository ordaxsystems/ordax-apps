// Food remains the single owner of orders; this view presents customer handoff and delivery dispatch.
export function renderDeliveryPage(viewModel) {
  const { snapshot, sectionHeader, statCard, renderOrderCard, emptyState, iconSvg, orderNumber, escapeHtml, clockTime } = viewModel;
  const activeDeliveries = snapshot.orders.filter(({ channel, status }) => channel === "delivery" && !["completed", "cancelled"].includes(status));
  const kitchenOrders = snapshot.orders.filter(({ status }) => ["received", "preparing"].includes(status));
  const readyDeliveries = activeDeliveries.filter(({ status }) => status === "ready");
  const customerHandoffs = snapshot.orders
    .filter(({ channel, status }) => channel !== "delivery" && status === "ready")
    .sort((left, right) => Date.parse(left.updatedAt) - Date.parse(right.updatedAt));
  const routeOrders = activeDeliveries
    .filter(({ status }) => status === "out-for-delivery")
    .sort((left, right) => Date.parse(left.updatedAt) - Date.parse(right.updatedAt));
  const stagePanel = (title, eyebrow, orders, emptyTitle, emptyText, icon = "delivery") => `<section class="panel delivery-stage"><div class="panel-heading"><div><p class="eyebrow">${eyebrow}</p><h2>${title}</h2></div><span class="column-count">${orders.length}</span></div>${orders.length ? `<div class="history-list">${orders.map((order) => renderOrderCard(order, { allowCancel: false, allowAdvance: true })).join("")}</div>` : emptyState({ icon: iconSvg(icon), title: emptyTitle, text: emptyText })}</section>`;
  const deliveryStops = routeOrders.map((order, index) => {
    const phoneDigits = (order.phone ?? "").replace(/\D/g, "");
    const phoneNumber = order.phone?.trim().startsWith("+") ? `+${phoneDigits}` : phoneDigits;
    return `<li class="delivery-stop"><span class="delivery-stop-number">${String(index + 1).padStart(2, "0")}</span><div class="delivery-stop-copy"><strong>${orderNumber(order)} · ${escapeHtml(order.customerName)}</strong><small>${escapeHtml(order.address)}</small><div class="delivery-stop-actions">${phoneNumber ? `<a class="delivery-stop-action" href="tel:${escapeHtml(phoneNumber)}" aria-label="Ligar para ${escapeHtml(order.customerName)} do pedido ${orderNumber(order)}">Ligar</a>` : ""}<button class="delivery-stop-action" type="button" data-action="copy-delivery-address" data-address="${escapeHtml(order.address)}" data-order-number="${escapeHtml(orderNumber(order))}">Copiar endereço</button></div></div><span class="delivery-stop-time">${clockTime(order.updatedAt)}</span></li>`;
  }).join("");
  return `<section class="page-section">${sectionHeader("EXPEDIÇÃO", "Expedição", "Libere pedidos de entrega, retirada, balcão e salão após o preparo.", `<button class="button button-quiet" type="button" data-view="settings">Configurar operação</button>`)}
    <div class="metrics-grid">${statCard("Na cozinha", kitchenOrders.length, "Recebidos ou em preparo", "kitchen", "blue")}${statCard("Prontos para sair", readyDeliveries.length, "Aguardando despacho", "ready", "gold")}${statCard("Aguardando cliente", customerHandoffs.length, "Retirada, balcão e salão", "ready", "orange")}${statCard("Na rua", routeOrders.length, "Entregas não concluídas", "delivery", "green")}</div>
    ${kitchenOrders.length ? `<div class="delivery-kds-callout"><span>${kitchenOrders.length} ${kitchenOrders.length === 1 ? "pedido está" : "pedidos estão"} na fila da cozinha.</span><button class="button button-quiet" type="button" data-view="kitchen">Abrir Cozinha (KDS) →</button></div>` : ""}
    <div class="delivery-layout"><div class="delivery-stage-grid">${stagePanel("Prontos para despacho", "AGUARDANDO SAÍDA", readyDeliveries, "Nenhuma entrega pronta", "Os pedidos de entrega aparecem aqui quando a cozinha os libera.")}${stagePanel("Retirada e atendimento", "AGUARDANDO CLIENTE", customerHandoffs, "Nenhum pedido aguardando cliente", "Pedidos de retirada, balcão e salão ficam aqui até serem entregues ou servidos.", "ready")}${stagePanel("Em rota", "ENTREGAS ATIVAS", routeOrders, "Nenhuma entrega na rua", "Marque uma entrega como saiu para acompanhar o endereço nesta fila.")}</div><section class="panel route-panel"><div class="panel-heading"><div><p class="eyebrow">ORDEM DE SAÍDA</p><h2>Fila de entrega</h2><p class="delivery-route-ordering">Da saída mais antiga à mais recente</p></div><span class="column-count">${routeOrders.length}</span></div>${routeOrders.length ? `<ol class="delivery-stops">${deliveryStops}</ol>` : emptyState({ icon: iconSvg("delivery"), title: "Nenhuma entrega em rota", text: "Os pedidos entram nesta lista quando saem para entrega." })}</section></div>
  </section>`;
}
