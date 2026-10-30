// Pure Food order-history renderer. Draft creation lives in the POS module.
function compareOrdersByCreationTime(first, second) {
  const firstCreatedAt = Date.parse(first.createdAt);
  const secondCreatedAt = Date.parse(second.createdAt);
  const firstIsValid = Number.isFinite(firstCreatedAt);
  const secondIsValid = Number.isFinite(secondCreatedAt);

  if (!firstIsValid || !secondIsValid) {
    if (firstIsValid === secondIsValid) return 0;
    return firstIsValid ? -1 : 1;
  }

  return secondCreatedAt - firstCreatedAt;
}

function normalizeOrderSearchText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim()
    .replace(/\s+/g, " ");
}

export function renderOrdersPage(viewModel) {
  const {
    STATUS_LABELS,
    CHANNEL_LABELS,
    ORDER_STATUS_FILTERS,
    snapshot,
    orderQuery,
    showLocalSearch = false,
    escapeHtml,
    orderStatusFilter,
    orderChannelFilter,
    commandById,
    orderNumber,
    renderOrderCard,
    emptyState,
  } = viewModel;
  const query = normalizeOrderSearchText(orderQuery);
  const queryTerms = query.split(" ").filter(Boolean);
  const allOrders = [...snapshot.orders].sort(compareOrdersByCreationTime);
  const orders = allOrders.filter((order) => {
    const tableNumber = order.tableCommandId ? commandById(order.tableCommandId)?.tableId : null;
    const itemNames = order.items.flatMap((item) => item.type === "catalog-product"
      ? [item.name, item.category]
      : item.flavors.map((flavor) => flavor.name));
    const phone = String(order.phone ?? "");
    const searchable = normalizeOrderSearchText([
      order.id,
      orderNumber(order),
      order.customerName,
      phone,
      phone.replace(/\D/g, ""),
      order.address,
      tableNumber ? `mesa ${String(tableNumber).padStart(2, "0")}` : "",
      ...itemNames,
    ].join(" "));
    return (!queryTerms.length || queryTerms.every((term) => searchable.includes(term)))
      && (orderStatusFilter === "all" || order.status === orderStatusFilter)
      && (orderChannelFilter === "all" || order.channel === orderChannelFilter);
  });
  const hasLocalFilters = Boolean(query) || orderStatusFilter !== "all" || orderChannelFilter !== "all";

  return `<section class="page-section">
    <div class="page-heading"><div><p class="eyebrow">ACOMPANHAMENTO</p><h1>Pedidos</h1><p>Pesquise o histórico e acompanhe o andamento de cada pedido.</p></div><div class="orders-heading-actions"><span class="heading-counter">${orders.length} de ${allOrders.length} pedidos</span><button class="button button-primary" type="button" data-view="pos">Novo pedido <span aria-hidden="true">→</span></button></div></div>
    <section class="panel orders-filter-panel" aria-label="Filtros do histórico de pedidos"><div class="orders-filter-controls">${showLocalSearch ? `<form id="orders-search-form" class="orders-search-form"><label for="orders-search">Buscar pedido</label><div class="orders-search-field"><input id="orders-search" type="search" name="query" value="${escapeHtml(orderQuery)}" aria-label="Buscar pedido, cliente, telefone, endereço, mesa ou item" placeholder="Nº, cliente ou endereço" enterkeyhint="search"><button class="button button-primary" type="submit">Buscar</button></div></form>` : ""}<label>Etapa<select data-order-status-filter aria-label="Filtrar pedidos por etapa">${ORDER_STATUS_FILTERS.map(({ id, label }) => `<option value="${id}" ${orderStatusFilter === id ? "selected" : ""}>${label}</option>`).join("")}</select></label><label>Canal<select data-order-channel-filter aria-label="Filtrar pedidos por canal"><option value="all" ${orderChannelFilter === "all" ? "selected" : ""}>Todos os canais</option>${Object.entries(CHANNEL_LABELS).map(([id, label]) => `<option value="${id}" ${id === orderChannelFilter ? "selected" : ""}>${label}</option>`).join("")}</select></label>${hasLocalFilters ? `<button class="button button-quiet clear-order-filters" type="button" data-action="reset-order-filters">Limpar filtros</button>` : ""}</div><p class="orders-filter-summary">${orders.length} ${orders.length === 1 ? "pedido encontrado" : "pedidos encontrados"}${query ? " para a busca atual" : ""}</p></section>
    ${orders.length ? `<div class="history-list">${orders.map((order) => renderOrderCard(order, { allowCancel: true, showHistory: true })).join("")}</div>` : emptyState({ icon: "▣", title: query || hasLocalFilters ? "Nenhum pedido encontrado" : "Nenhum pedido registrado", text: query || hasLocalFilters ? "Altere a etapa, o canal ou a busca para ampliar os resultados." : "Os pedidos registrados aparecerão aqui." })}
  </section>`;
}
