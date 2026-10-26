// Pure Food page renderer. All business state and actions are supplied by the app view model.
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

export function renderOrdersPage(viewModel) {
  const { PIZZERIA_TABLES, deliveryFeeCents, STATUS_LABELS, CHANNEL_LABELS, ORDER_STATUS_FILTERS, snapshot, orderQuery, orderStatusFilter, orderChannelFilter, activeCommandId, cart, busy, commandById, orderNumber, sizeOptions, flavorOptions, cartHtml, renderOrderCard, emptyState, button, money, escapeHtml } = viewModel;
  const activeFlavors = snapshot.flavors.filter(({ id, active }) => active && snapshot.recipes.some((recipe) => recipe.flavorId === id));
  const activeWithoutRecipe = snapshot.flavors.some(({ id, active }) => active && !snapshot.recipes.some((recipe) => recipe.flavorId === id));
  const selectedCommand = activeCommandId ? commandById(activeCommandId) : null;
  const tableCommand = selectedCommand?.closedAt === null ? selectedCommand : null;
  const commandTable = tableCommand ? PIZZERIA_TABLES.find(({ id }) => id === tableCommand.tableId) : null;
  const query = orderQuery.trim().toLocaleLowerCase("pt-BR");
  const allOrders = [...snapshot.orders].sort(compareOrdersByCreationTime);
  const orders = allOrders.filter((order) => {
    const tableNumber = order.tableCommandId ? commandById(order.tableCommandId)?.tableId : null;
    const searchable = `${order.id} ${orderNumber(order)} ${order.customerName} ${order.phone} ${tableNumber ? `mesa ${String(tableNumber).padStart(2, "0")}` : ""} ${order.items.flatMap((item) => item.flavors.map((flavor) => flavor.name)).join(" ")}`.toLocaleLowerCase("pt-BR");
    return (!query || searchable.includes(query))
      && (orderStatusFilter === "all" || order.status === orderStatusFilter)
      && (orderChannelFilter === "all" || order.channel === orderChannelFilter);
  });
  const hasLocalFilters = orderStatusFilter !== "all" || orderChannelFilter !== "all";
  return `<section class="page-section">
    <div class="page-heading"><div><p class="eyebrow">VENDAS DA CASA</p><h1>Pedidos</h1><p>Monte o pedido, confira o preço e acompanhe cada etapa.</p></div><span class="heading-counter">${orders.length} de ${allOrders.length} pedidos</span></div>
    <div class="orders-layout"><section class="panel order-create-panel"><div class="panel-heading"><div><p class="eyebrow">NOVO ATENDIMENTO</p><h2>Montar pedido</h2></div><span class="step-number">01</span></div>
      ${activeFlavors.length ? `<form id="add-pizza-form" class="pizza-builder">
      <div class="builder-title"><span class="builder-icon" aria-hidden="true">✦</span><div><strong>Pizza</strong><small>Escolha tamanho e até ${snapshot.settings.maxFlavorsPerPizza} sabores.</small></div></div>
      <div class="builder-grid"><label>Tamanho<select name="size">${sizeOptions()}</select></label>${Array.from({ length: snapshot.settings.maxFlavorsPerPizza }, (_, index) => `<label class="${index ? "second-flavor" : ""}">${index ? `Sabor ${index + 1} <span class="optional-tag">opcional</span>` : "Primeiro sabor"}<select name="flavor${index + 1}" ${index === 0 ? "required" : ""}>${index ? `<option value="">Sem sabor adicional</option>` : ""}${flavorOptions()}</select></label>`).join("")}<label>Quantidade<input name="quantity" type="number" min="1" max="50" value="1" required></label></div>
        <div class="builder-bottom"><span id="pizza-price-preview">Selecione um sabor para ver o preço.</span><button class="button button-dark" type="button" data-action="add-pizza">Adicionar pizza <span aria-hidden="true">＋</span></button></div>
      </form>` : emptyState({ icon: "◉", title: activeWithoutRecipe ? "Fichas técnicas pendentes" : "Seu cardápio ainda está vazio", text: activeWithoutRecipe ? "Cadastre as receitas dos sabores no Cardápio antes de receber pedidos para preparo." : "Cadastre sabores e preços para começar a receber pedidos.", action: activeWithoutRecipe ? "Abrir cardápio" : "Cadastrar sabores", view: "menu" })}
      <div class="cart-section"><div class="cart-heading"><strong>Itens do pedido</strong><span id="cart-count">${cart.length} ${cart.length === 1 ? "item" : "itens"}</span></div><div id="cart-content">${cartHtml()}</div></div>
      <form id="create-order-form" class="customer-form">
        <div class="cart-heading"><strong>Dados para atendimento</strong><span class="step-number step-small">02</span></div>
        <input type="hidden" name="tableCommandId" value="${escapeHtml(tableCommand?.id ?? "")}">
      ${tableCommand ? `<div class="table-order-context"><div><strong>Comanda da Mesa ${String(tableCommand.tableId).padStart(2, "0")}</strong><span>${escapeHtml(tableCommand.customerName)} · ${tableCommand.guestCount} pessoas</span></div><small>Este pedido entrará na mesma fila da cozinha e será somado à comanda do salão.</small>${button("Sair da comanda", "leave-command-context", { disabled: cart.length > 0 })}</div><label>Grupo da mesa<input name="customerName" maxlength="80" value="${escapeHtml(tableCommand.customerName)}" readonly required></label><input type="hidden" name="channel" value="dine-in"><input type="hidden" name="phone" value="">` : `<label>Nome do cliente<input name="customerName" maxlength="80" placeholder="Nome para identificar o pedido" required></label><div class="builder-grid customer-grid"><label>Canal<select name="channel"><option value="pickup">Retirada</option><option value="delivery">Entrega</option><option value="counter">Balcão</option></select></label><label>Telefone <span class="optional-tag">opcional, exceto entrega</span><input name="phone" maxlength="32" inputmode="tel" placeholder="(11) 99999-9999"></label></div>`}
        <div id="delivery-fields" class="delivery-fields" hidden><label>Endereço de entrega<textarea name="address" maxlength="240" rows="2" placeholder="Rua, número, bairro e referência"></textarea></label><label>Taxa de entrega<input name="deliveryFee" inputmode="decimal" placeholder="0,00" value="${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(deliveryFeeCents / 100)}"><small>Taxa padrão configurada para a prévia; ajuste neste pedido se necessário. Sem cálculo por distância.</small></label></div>
        <label>Observações do pedido<textarea name="notes" maxlength="240" rows="2" placeholder="Ex.: sem cebola, tocar o interfone…"></textarea></label>
        <div class="order-total"><div><span>Total do pedido</span><small>O valor não representa pagamento recebido.</small></div><strong id="order-total-value">${money(0)}</strong></div>
        <button class="button button-primary button-wide" type="submit" ${busy || !activeFlavors.length ? "disabled" : ""}>Registrar pedido <span aria-hidden="true">→</span></button>
      </form>
    </section><section class="orders-history"><div class="panel-heading history-heading"><div><p class="eyebrow">ACOMPANHAMENTO</p><h2>Histórico</h2></div></div>
      <section class="panel orders-filter-panel" aria-label="Filtros do histórico de pedidos"><div class="orders-filter-controls"><label>Etapa<select data-order-status-filter aria-label="Filtrar pedidos por etapa">${ORDER_STATUS_FILTERS.map(({ id, label }) => `<option value="${id}" ${orderStatusFilter === id ? "selected" : ""}>${label}</option>`).join("")}</select></label><label>Canal<select data-order-channel-filter aria-label="Filtrar pedidos por canal"><option value="all" ${orderChannelFilter === "all" ? "selected" : ""}>Todos os canais</option>${Object.entries(CHANNEL_LABELS).map(([id, label]) => `<option value="${id}" ${orderChannelFilter === id ? "selected" : ""}>${label}</option>`).join("")}</select></label>${hasLocalFilters ? `<button class="button button-quiet clear-order-filters" type="button" data-action="reset-order-filters">Limpar filtros</button>` : ""}</div><p class="orders-filter-summary">${orders.length} ${orders.length === 1 ? "pedido encontrado" : "pedidos encontrados"}${query ? " para a busca atual" : ""}</p></section>
      ${orders.length ? `<div class="history-list">${orders.map((order) => renderOrderCard(order)).join("")}</div>` : emptyState({ icon: "▣", title: query || hasLocalFilters ? "Nenhum pedido encontrado" : "Nenhum pedido registrado", text: query || hasLocalFilters ? "Altere a etapa, o canal ou a busca para ampliar os resultados." : "Os pedidos registrados aparecerão aqui." })}
    </section></div>
  </section>`;
}
