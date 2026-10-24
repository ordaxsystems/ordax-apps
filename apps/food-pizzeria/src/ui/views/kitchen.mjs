// Pure Food page renderer. All business state and actions are supplied by the app view model.
export function renderKitchenPage(viewModel) {
  const { KITCHEN_CHANNEL_FILTERS, kitchenChannelFilter, snapshot, ORDER_STAGE_ALERT_MINUTES, stageStartedAt, elapsedMinutes, renderOrderCard, emptyState } = viewModel;
  const columns = [
    { status: "received", title: "Recebidos", icon: "◉" },
    { status: "preparing", title: "Em preparo", icon: "◷" },
    { status: "ready", title: "Prontos", icon: "✓" },
  ];
  const activeStatuses = new Set(["received", "preparing", "ready", "out-for-delivery"]);
  const activeOrders = snapshot.orders.filter(({ status }) => activeStatuses.has(status));
  const channelMatches = ({ channel }) => kitchenChannelFilter === "all" || channel === kitchenChannelFilter;
  const delivery = activeOrders.filter(({ status }) => status === "out-for-delivery").filter(channelMatches)
    .sort((first, second) => Date.parse(stageStartedAt(first)) - Date.parse(stageStartedAt(second)));
  return `<section class="page-section kitchen-page">
    <div class="page-heading"><div><p class="eyebrow">PRODUÇÃO</p><h1>Fila da cozinha</h1><p>Pedidos organizados por etapa de preparo.</p></div><span class="live-indicator"><span></span>Turno aberto</span></div>
    <section class="panel kitchen-toolbar" aria-label="Filtros da fila da cozinha"><div class="kitchen-toolbar-copy"><strong>Canal de atendimento</strong><span>A fila mantém primeiro os pedidos há mais tempo na etapa.</span></div><div class="order-filters" role="group" aria-label="Filtrar fila por canal">${KITCHEN_CHANNEL_FILTERS.map((filter) => kitchenChannelButton(filter, activeOrders)).join("")}</div></section>
    <div class="kitchen-board">${columns.map(({ status, title, icon }) => {
      const orders = activeOrders.filter((order) => order.status === status).filter(channelMatches)
        .sort((first, second) => Date.parse(stageStartedAt(first)) - Date.parse(stageStartedAt(second)));
      const overdueCount = orders.filter((order) => elapsedMinutes(stageStartedAt(order)) >= ORDER_STAGE_ALERT_MINUTES[status]).length;
      return `<section class="kitchen-column kitchen-${status}"><header class="kitchen-column-head"><span class="kitchen-column-icon" aria-hidden="true">${icon}</span><h2>${title}</h2><span class="column-count">${orders.length}</span></header>${overdueCount ? `<p class="column-alert-summary">${overdueCount} ${overdueCount === 1 ? "pedido acima" : "pedidos acima"} do tempo esperado</p>` : ""}<div class="kitchen-column-body">${orders.length ? orders.map((order) => renderOrderCard(order, { kitchen: true })).join("") : `<div class="column-empty">Nenhum pedido ${status === "received" ? "aguardando" : status === "preparing" ? "em preparo" : "pronto"}.</div>`}</div></section>`;
    }).join("")}</div>
    ${activeOrders.some(({ status }) => status === "out-for-delivery") ? `<section class="delivery-list"><div class="panel-heading"><div><p class="eyebrow">EXPEDIÇÃO</p><h2>Na rua</h2></div><span class="column-count">${delivery.length}</span></div>${delivery.length ? `<div class="delivery-cards">${delivery.map((order) => renderOrderCard(order, { kitchen: true })).join("")}</div>` : `<div class="panel kitchen-empty-delivery">Nenhum pedido em entrega neste canal.</div>`}</section>` : ""}
  </section>`;
}
