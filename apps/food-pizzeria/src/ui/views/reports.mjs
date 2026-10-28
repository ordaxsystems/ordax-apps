import { buildFoodOperationalReport, FOOD_REPORT_RANGES } from "../../application/food-order-reporting.mjs";

const RANGE_LABELS = Object.freeze({ "24h": "24 h", "7d": "7 dias", "30d": "30 dias" });
const RANGE_DESCRIPTIONS = Object.freeze({ "24h": "Últimas 24 horas", "7d": "Últimos 7 dias", "30d": "Últimos 30 dias" });

function safeShare(value, total) {
  return total > 0 ? Math.max(0, Math.min(100, (value / total) * 100)) : 0;
}

export function renderFoodReportsPage(viewModel) {
  const { snapshot, reportRange, orderNumber, CHANNEL_LABELS, STATUS_LABELS, timeLabel, iconSvg, escapeHtml } = viewModel;
  const report = buildFoodOperationalReport(snapshot, { range: reportRange });
  const totalChannelOrders = Object.values(report.byChannel).reduce((sum, value) => sum + value, 0);
  const totalItems = report.pizzaUnits + report.additionalProductUnits;
  const rangeControls = FOOD_REPORT_RANGES.map((range) => `<button class="food-report-range ${reportRange === range ? "is-active" : ""}" type="button" data-report-range="${range}" aria-pressed="${reportRange === range}">${RANGE_LABELS[range]}</button>`).join("");
  const channelRows = Object.entries(CHANNEL_LABELS).map(([id, label]) => {
    const count = report.byChannel[id] ?? 0;
    const share = safeShare(count, totalChannelOrders);
    return `<li class="food-report-bar-row"><span>${escapeHtml(label)}</span><progress class="food-report-progress" max="100" value="${share}" aria-label="${escapeHtml(label)}: ${count} pedidos, ${Math.round(share)}%">${Math.round(share)}%</progress><strong>${count}</strong><small>${Math.round(share)}%</small></li>`;
  }).join("");
  const itemRows = [
    ["Pizzas nos pedidos", report.pizzaUnits],
    ["Unidades adicionais", report.additionalProductUnits],
  ].map(([label, count]) => {
    const share = safeShare(count, totalItems);
    return `<li class="food-report-bar-row"><span>${escapeHtml(label)}</span><progress class="food-report-progress" max="100" value="${share}" aria-label="${escapeHtml(label)}: ${count} unidades, ${Math.round(share)}%">${Math.round(share)}%</progress><strong>${count}</strong><small>${Math.round(share)}%</small></li>`;
  }).join("");
  const flavorRows = report.topFlavors.length
    ? report.topFlavors.map((flavor, index) => {
      const share = safeShare(flavor.pizzas, report.topFlavors[0].pizzas);
      return `<li class="rank-row food-report-flavor"><span class="rank-number">${String(index + 1).padStart(2, "0")}</span><div><strong>${escapeHtml(flavor.name)}</strong><progress class="food-report-progress food-report-flavor-progress" max="100" value="${share}" aria-label="${escapeHtml(flavor.name)}: ${flavor.pizzas} pizzas que incluem este sabor">${Math.round(share)}%</progress></div><b>${flavor.pizzas}</b></li>`;
    }).join("")
    : `<li class="food-report-empty">Nenhuma pizza registrada neste período.</li>`;
  const recentRows = report.recentOrders.length
    ? report.recentOrders.map((order) => `<li class="food-report-recent-row"><span><strong>${escapeHtml(orderNumber(order))}</strong><small>${escapeHtml(CHANNEL_LABELS[order.channel] ?? order.channel)} · ${escapeHtml(timeLabel(order.createdAt))}</small></span><span class="status-badge status-${order.status}"><span></span>${escapeHtml(STATUS_LABELS[order.status] ?? "Status")}</span></li>`).join("")
    : `<li class="food-report-empty">Nenhum pedido registrado neste período.</li>`;
  const readyValue = report.medianReadyMinutes === null
    ? "—"
    : `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(report.medianReadyMinutes)} min`;
  const averageOrderValue = report.averageOrderValueCents === null
    ? "—"
    : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(report.averageOrderValueCents / 100);

  return `<section class="page-section food-report-page">
    <div class="page-heading food-report-heading"><div><p class="eyebrow">ANÁLISE OPERACIONAL</p><h1>Relatórios</h1><p>Volume, andamento e valores registrados nos pedidos Food.</p></div><div class="food-report-actions"><button class="button button-quiet" type="button" data-action="export-food-report"><span aria-hidden="true">↓</span> Baixar CSV</button><button class="button button-quiet" type="button" data-view="kitchen">${iconSvg("kitchen")} Abrir cozinha</button><button class="button button-primary" type="button" data-view="pos">Novo pedido <span aria-hidden="true">→</span></button></div></div>
    <div class="food-report-toolbar"><div class="food-report-range-group" role="group" aria-label="Período de análise">${rangeControls}</div><span>${RANGE_DESCRIPTIONS[reportRange]}</span></div>
    <section class="metrics-grid food-report-metrics" aria-label="Indicadores de pedidos no período">
      <article class="metric-card"><div class="metric-top"><span>Pedidos</span><span class="metric-icon tone-orange">${iconSvg("orders")}</span></div><strong class="metric-value">${report.totalOrders}</strong><small>Registrados no período</small></article>
      <article class="metric-card food-report-value-metric"><div class="metric-top"><span>Média por pedido</span><span class="metric-icon tone-violet">${iconSvg("reports")}</span></div><strong class="metric-value">${averageOrderValue}</strong><small>${report.pricedOrderSampleSize} pedidos não cancelados · não confirma pagamento</small></article>
      <article class="metric-card"><div class="metric-top"><span>Na cozinha</span><span class="metric-icon tone-blue">${iconSvg("kitchen")}</span></div><strong class="metric-value">${report.kitchenOrders}</strong><small>Recebidos ou em preparo</small></article>
      <article class="metric-card"><div class="metric-top"><span>Prontos para saída</span><span class="metric-icon tone-green">${iconSvg("delivery")}</span></div><strong class="metric-value">${report.readyOrders}</strong><small>Aguardando retirada ou expedição</small></article>
      <article class="metric-card"><div class="metric-top"><span>Mediana até ficar pronto</span><span class="metric-icon tone-violet">${iconSvg("reports")}</span></div><strong class="metric-value">${readyValue}</strong><small>${report.readySampleSize ? `De ${report.readySampleSize} pedidos que chegaram a Pronto` : "Ainda sem pedidos prontos no período"}</small></article>
    </section>
    ${report.totalOrders ? `<div class="reports-layout food-report-layout">
      <div class="food-report-main-column">
        <section class="panel report-chart-panel food-report-chart" aria-labelledby="food-report-channels-title"><div class="panel-heading"><div><p class="eyebrow">ENTRADA DE PEDIDOS</p><h2 id="food-report-channels-title">Pedidos por canal</h2></div><span class="food-report-total">${report.totalOrders}</span></div><ul class="food-report-bars">${channelRows}</ul></section>
        <section class="panel report-chart-panel food-report-chart" aria-labelledby="food-report-items-title"><div class="panel-heading"><div><p class="eyebrow">COMPOSIÇÃO</p><h2 id="food-report-items-title">Itens nos pedidos</h2></div></div><ul class="food-report-bars">${itemRows}</ul><p class="food-report-footnote">Itens adicionais são contados pelas quantidades congeladas nos pedidos; não representam baixa de estoque.</p></section>
      </div>
      <div class="food-report-side-column">
        <section class="panel top-products food-report-top-flavors" aria-labelledby="food-report-flavors-title"><div class="panel-heading"><div><p class="eyebrow">CARDÁPIO</p><h2 id="food-report-flavors-title">Sabores mais presentes</h2></div></div><ol class="food-report-rank-list">${flavorRows}</ol><p class="food-report-footnote">Conta pizzas que incluem cada sabor. Em pizzas combinadas, cada sabor aparece na contagem.</p></section>
        <section class="panel food-report-recent" aria-labelledby="food-report-recent-title"><div class="panel-heading"><div><p class="eyebrow">ACOMPANHAMENTO</p><h2 id="food-report-recent-title">Pedidos recentes</h2></div><button class="text-button" type="button" data-view="orders">Ver histórico →</button></div><ul class="food-report-recent-list">${recentRows}</ul><p class="food-report-cancellations">${report.cancelledOrders} ${report.cancelledOrders === 1 ? "pedido cancelado" : "pedidos cancelados"} · ${Math.round(report.cancellationRate * 100)}% do período</p></section>
      </div>
    </div>` : `<section class="panel food-report-empty-state"><span class="empty-icon" aria-hidden="true">${iconSvg("reports")}</span><h2>Sem pedidos neste período</h2><p>Escolha um intervalo maior ou registre um novo pedido para acompanhar a operação.</p><button class="button button-primary" type="button" data-view="pos">Registrar pedido <span aria-hidden="true">→</span></button></section>`}
    <p class="food-report-scope">Este relatório deriva do histórico de pedidos Food. A média usa o total congelado nos pedidos não cancelados; não confirma valores recebidos. Pagamentos e saldos de estoque continuam nos respectivos owners.</p>
  </section>`;
}
