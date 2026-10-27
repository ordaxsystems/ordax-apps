import {
  DEFAULT_KITCHEN_DISPLAY_CONFIGURATION,
  KITCHEN_DISPLAY_STAGES,
  kitchenDisplayStage,
  kitchenDisplayStageLabel,
  validateKitchenDisplayConfiguration,
} from "../../application/kitchen-display-configuration.mjs";

const ORDER_COLUMNS = Object.freeze([
  Object.freeze({ status: "received", title: "Recebidos", icon: "◉" }),
  Object.freeze({ status: "preparing", title: "Em preparo", icon: "◷" }),
  Object.freeze({ status: "ready", title: "Prontos", icon: "✓" }),
]);

export function renderKitchenPage(viewModel) {
  const {
    KITCHEN_CHANNEL_FILTERS, kitchenChannelFilter, kitchenOrderQuery = "", kitchenLateOnly = false,
    snapshot, PIZZA_SIZES = [], ORDER_STAGE_ALERT_MINUTES, stageStartedAt, elapsedMinutes, renderKitchenOrderCard,
    kitchenChannelButton, orderNumber, orderChannelLabel, escapeHtml,
    kitchenDisplayConfiguration = DEFAULT_KITCHEN_DISPLAY_CONFIGURATION,
    activeKitchenScreen = null, kitchenScreenStage = null, kitchenScreenCount = null,
    kitchenScreenHref = () => "#", kitchenOverviewHref = () => "#",
  } = viewModel;
  const layout = validateKitchenDisplayConfiguration(kitchenDisplayConfiguration);
  const stageForScreen = activeKitchenScreen === null
    ? null
    : kitchenScreenStage ?? (activeKitchenScreen <= layout.screenCount
      ? kitchenDisplayStage(layout, activeKitchenScreen)
      : "all");
  const screenStageLabel = stageForScreen === "all"
    ? "Fluxo completo"
    : kitchenDisplayStageLabel(stageForScreen);
  const stationGuidance = {
    all: "Fluxo completo: acompanhe um pedido por vez até a expedição; ele permanece em foco enquanto avança.",
    received: "Abertura da massa: confira tamanho, fatias, sabores e observações antes de iniciar o preparo.",
    preparing: "Montagem: prepare as pizzas deste pedido e confira os sabores e as observações antes de concluir.",
    ready: "Expedição: confira quantidade, tamanho e sabores antes de entregar o pedido.",
  };
  const screenCount = kitchenScreenCount ?? Math.max(layout.screenCount, activeKitchenScreen ?? 0);
  const activeScreen = activeKitchenScreen !== null;
  const columns = activeScreen && stageForScreen !== "all"
    ? ORDER_COLUMNS.filter(({ status }) => status === stageForScreen)
    : ORDER_COLUMNS;
  const activeStatuses = new Set(["received", "preparing", "ready", "out-for-delivery"]);
  const activeOrders = snapshot.orders.filter(({ status }) => activeStatuses.has(status));
  const channelMatches = ({ channel }) => kitchenChannelFilter === "all" || channel === kitchenChannelFilter;
  const isOverdue = (order) => Number.isFinite(ORDER_STAGE_ALERT_MINUTES[order.status])
    && elapsedMinutes(stageStartedAt(order)) >= ORDER_STAGE_ALERT_MINUTES[order.status];
  const query = kitchenOrderQuery.trim().toLocaleLowerCase("pt-BR");
  const queryMatches = (order) => {
    if (!query) return true;
    const searchable = [
      orderNumber(order),
      orderChannelLabel(order),
      ...order.items.flatMap((item) => [
        item.sizeLabel ?? item.size,
        ...item.flavors.map(({ name }) => name),
      ]),
    ].join(" ").toLocaleLowerCase("pt-BR");
    return searchable.includes(query);
  };
  const visibleOrders = activeOrders.filter(channelMatches).filter(queryMatches)
    .filter((order) => !kitchenLateOnly || isOverdue(order));
  const delivery = visibleOrders.filter(({ status }) => status === "out-for-delivery")
    .sort((first, second) => Date.parse(stageStartedAt(first)) - Date.parse(stageStartedAt(second)));
  const sumPizzas = (orders) => orders.reduce((total, order) =>
    total + order.items.reduce((count, item) => count + item.quantity, 0), 0);
  const overdueOrders = visibleOrders.filter(isOverdue);
  const kitchenOrders = visibleOrders.filter(({ status }) => status !== "out-for-delivery");
  const waitingOrders = visibleOrders.filter(({ status }) => status === "received");
  const readyOrders = visibleOrders.filter(({ status }) => status === "ready");
  const hasFilters = kitchenChannelFilter !== "all" || query.length > 0 || kitchenLateOnly;
  const countLabel = hasFilters
    ? `${visibleOrders.length} de ${activeOrders.length} pedidos`
    : `${activeOrders.length} ${activeOrders.length === 1 ? "pedido ativo" : "pedidos ativos"}`;
  const summaryCards = [
    { label: "Pizzas na cozinha", value: sumPizzas(kitchenOrders), detail: `${kitchenOrders.length} ${kitchenOrders.length === 1 ? "pedido" : "pedidos"} em produção`, tone: "orange" },
    { label: "Aguardando início", value: waitingOrders.length, detail: `${sumPizzas(waitingOrders)} ${sumPizzas(waitingOrders) === 1 ? "pizza" : "pizzas"} na fila`, tone: "violet" },
    { label: "Prontos para expedir", value: sumPizzas(readyOrders), detail: `${readyOrders.length} ${readyOrders.length === 1 ? "pedido" : "pedidos"}`, tone: "green" },
    { label: "Acima da meta", value: overdueOrders.length, detail: `${sumPizzas(overdueOrders)} ${sumPizzas(overdueOrders) === 1 ? "pizza" : "pizzas"} precisam de atenção`, tone: "red" },
  ];
  const stageOptions = (selected) => KITCHEN_DISPLAY_STAGES.map(({ id, label }) =>
    `<option value="${id}" ${id === selected ? "selected" : ""}>${label}</option>`).join("");
  const assignmentRows = Array.from({ length: layout.screenCount }, (_, index) => {
    const screenNumber = index + 1;
    const assignedStage = layout.assignments[index];
    const label = kitchenDisplayStageLabel(assignedStage);
    return `<div class="kitchen-display-row"><label for="kitchen-display-${screenNumber}"><span><strong>Tela ${screenNumber}</strong><small>${label}</small></span><select id="kitchen-display-${screenNumber}" name="display-${screenNumber}" aria-label="Etapa exibida na tela ${screenNumber}" ${layout.mode === "complete-cycle" ? "disabled" : ""}>${stageOptions(assignedStage)}</select></label><a class="button button-quiet kitchen-open-display" href="${escapeHtml(kitchenScreenHref(screenNumber, assignedStage, layout.screenCount))}" target="_blank" rel="noopener noreferrer">Abrir tela ${screenNumber}<span aria-hidden="true">↗</span></a></div>`;
  }).join("");
  const stationOrders = activeScreen
    ? visibleOrders.filter(({ status }) => stageForScreen === "all"
      ? ORDER_COLUMNS.some(({ status: stageStatus }) => status === stageStatus)
      : status === stageForScreen)
      .sort((first, second) => stageForScreen === "all"
        ? Date.parse(first.createdAt) - Date.parse(second.createdAt)
        : Date.parse(stageStartedAt(first)) - Date.parse(stageStartedAt(second)))
    : [];
  const currentStationOrder = stationOrders[0] ?? null;
  const upcomingStationOrders = stationOrders.slice(1, 6);
  const remainingStationOrders = Math.max(0, stationOrders.length - 6);
  const pizzaLineSummary = (item) => {
    const size = PIZZA_SIZES.find(({ id }) => id === item.size);
    const sizeLabel = item.sizeLabel ?? size?.label ?? item.size;
    const sliceLabel = size?.slices ? ` · ${size.slices} fatias` : "";
    const flavorNames = item.flavors.map(({ name }) => name);
    const flavors = flavorNames.length === 2
      ? `Meio a meio · ${flavorNames.join(" / ")}`
      : flavorNames.join(" + ");
    return `${item.quantity}× ${sizeLabel}${sliceLabel} · Sabores: ${flavors}`;
  };
  const upcomingOrderRows = upcomingStationOrders.map((order, index) => `<li class="kitchen-up-next-item" data-kitchen-upcoming-order="${escapeHtml(order.id)}">
      <div class="kitchen-up-next-head"><strong>${escapeHtml(orderNumber(order))}</strong><span>${escapeHtml(orderChannelLabel(order))}${stageForScreen === "all" ? ` · ${ORDER_COLUMNS.find(({ status }) => status === order.status)?.title ?? order.status}` : ""}</span><small>${elapsedMinutes(stageStartedAt(order))} min</small></div>
      <ul class="kitchen-up-next-pizzas">${order.items.map((item) => `<li>${escapeHtml(pizzaLineSummary(item))}</li>`).join("")}</ul>
      <small class="kitchen-up-next-position">${index + 2}º da fila</small>
    </li>`).join("");
  const stationContent = activeScreen
    ? `<div class="kitchen-station-workspace">
        <section class="kitchen-current-order" data-kitchen-stage="${escapeHtml(stageForScreen)}" aria-label="Pedido atual em ${escapeHtml(screenStageLabel)}">
          <div class="kitchen-current-order-heading"><div><p class="eyebrow">PEDIDO EM FOCO</p>${currentStationOrder ? "" : "<h2>Fila vazia</h2>"}</div></div>
          ${currentStationOrder ? `<div data-kitchen-current-order="${escapeHtml(currentStationOrder.id)}">${renderKitchenOrderCard(currentStationOrder)}</div>` : `<div class="kitchen-station-empty">Nenhum pedido nesta etapa. O próximo pedido aparecerá aqui.</div>`}
        </section>
        <aside class="kitchen-up-next" aria-labelledby="kitchen-up-next-title">
          <header><div><p class="eyebrow">ORDEM DE CHEGADA</p><h2 id="kitchen-up-next-title">Próximos pedidos</h2></div><span>${upcomingStationOrders.length} / 5</span></header>
          ${upcomingStationOrders.length ? `<ol class="kitchen-up-next-list">${upcomingOrderRows}</ol>` : `<p class="kitchen-up-next-empty">Sem outros pedidos aguardando.</p>`}
          ${remainingStationOrders ? `<p class="kitchen-up-next-more">+ ${remainingStationOrders} ${remainingStationOrders === 1 ? "pedido" : "pedidos"} depois dos próximos cinco.</p>` : ""}
        </aside>
      </div>`
    : `<div class="kitchen-board ${activeScreen ? "kitchen-board-station" : ""}" tabindex="0" aria-label="${activeScreen ? `Fila ${screenStageLabel}` : "Etapas da produção. Em telas pequenas, deslize para percorrer as etapas."}">${columns.map(({ status, title, icon }) => {
      const orders = visibleOrders.filter((order) => order.status === status)
        .sort((first, second) => Date.parse(stageStartedAt(first)) - Date.parse(stageStartedAt(second)));
      const overdueCount = orders.filter(isOverdue).length;
      const pizzaCount = sumPizzas(orders);
      return `<section class="kitchen-column kitchen-${status}" data-kitchen-stage="${status}"><header class="kitchen-column-head"><span class="kitchen-column-icon" aria-hidden="true">${icon}</span><h2>${title}</h2><span class="kitchen-column-volume"><strong>${orders.length}</strong><small>${pizzaCount} ${pizzaCount === 1 ? "pizza" : "pizzas"}</small></span></header>${overdueCount ? `<p class="column-alert-summary">${overdueCount} ${overdueCount === 1 ? "pedido" : "pedidos"} acima da meta</p>` : ""}<div class="kitchen-column-body">${orders.length ? orders.map((order) => renderKitchenOrderCard(order)).join("") : `<div class="column-empty">Nenhum pedido ${status === "received" ? "aguardando" : status === "preparing" ? "em preparo" : "pronto"}.</div>`}</div></section>`;
    }).join("")}</div>`;
  const displayConfiguration = activeScreen ? "" : `<details class="panel kitchen-display-setup" ${viewModel.kitchenSetupExpanded ? "open" : ""}>
      <summary><span class="kitchen-setup-icon" aria-hidden="true">▦</span><span class="kitchen-setup-summary"><strong>Configurar telas da cozinha</strong><small>${layout.screenCount} ${layout.screenCount === 1 ? "tela" : "telas"} · ${layout.mode === "complete-cycle" ? "fluxo completo" : "etapas do pedido"}</small></span><span class="kitchen-setup-chevron" aria-hidden="true">⌄</span></summary>
      <div class="kitchen-display-setup-body">
        <form id="kitchen-layout-form" class="kitchen-layout-form">
          <div class="kitchen-layout-controls"><label for="kitchen-layout-mode">Como a equipe trabalha?<select id="kitchen-layout-mode" name="mode"><option value="complete-cycle" ${layout.mode === "complete-cycle" ? "selected" : ""}>Ciclo completo em cada tela</option><option value="by-stage" ${layout.mode === "by-stage" ? "selected" : ""}>Uma tela para cada etapa do pedido</option></select></label><label for="kitchen-display-count">Quantidade de telas<select id="kitchen-display-count" name="screenCount">${Array.from({ length: 8 }, (_, index) => `<option value="${index + 1}" ${layout.screenCount === index + 1 ? "selected" : ""}>${index + 1} ${index === 0 ? "tela" : "telas"}</option>`).join("")}</select></label></div>
          <p class="kitchen-layout-mode-note">${layout.mode === "complete-cycle" ? "Cada tela mostra o mesmo quadro completo. Para uma única pessoa e um aparelho, mantenha uma tela." : "Distribua as macroetapas atuais do pedido entre os aparelhos. Ao avançar o pedido, ele sai desta fila e aparece na etapa seguinte."}</p>
          <div class="kitchen-display-list" aria-label="Configuração por tela">${assignmentRows}</div>
          <div class="kitchen-layout-footer"><p>A distribuição usa os estados Recebido, Em preparo e Pronto. Os pedidos não sincronizam entre aparelhos; etapas individuais de abrir massa, montagem e forno dependem do contrato Food de produção.</p><button class="button button-primary" type="submit">Salvar configuração</button></div>
        </form>
        <div class="kitchen-assignment-pending"><strong>Distribuição por pessoa</strong><span>Para atribuir pedidos a operadores e dar baixa no ciclo completo por trabalhador, é necessário o owner People/Identity e o contrato de tarefas de produção.</span></div>
      </div>
    </details>`;
  const stationHeader = activeScreen
    ? `<div class="kitchen-station-header"><div><p class="eyebrow">TELA ${activeKitchenScreen} DE ${screenCount}</p><h1>${screenStageLabel}</h1><p>${stationGuidance[stageForScreen]}</p></div><div class="kitchen-station-controls"><a class="button button-quiet" href="${escapeHtml(kitchenOverviewHref())}">Voltar ao quadro</a><button class="button button-primary" type="button" data-action="fullscreen-kitchen">Tela cheia <span aria-hidden="true">⛶</span></button></div></div>`
    : `<div class="page-heading kitchen-page-heading"><div><p class="eyebrow">OPERAÇÃO · COZINHA</p><h1>Produção</h1><p>Organize a fila para um aparelho ou distribua as macroetapas entre telas.</p></div><span class="kitchen-active-count">${countLabel}</span></div>`;
  return `<section class="page-section kitchen-page ${activeScreen ? "kitchen-station-screen" : ""}" ${activeScreen ? `data-kitchen-station-screen="${activeKitchenScreen}"` : ""}>
    ${stationHeader}
    ${displayConfiguration}
    ${activeScreen ? "" : `<section class="kitchen-summary" aria-label="Resumo da produção atual">${summaryCards.map(({ label, value, detail, tone }) => `<article class="kitchen-summary-card kitchen-summary-${tone}"><span>${label}</span><strong ${label === "Acima da meta" ? "data-kitchen-overdue-count" : ""}>${value}</strong><small>${detail}</small></article>`).join("")}</section>
    <section class="panel kitchen-toolbar" aria-label="Busca e filtros da fila da cozinha">
      <div class="kitchen-toolbar-main"><form id="kitchen-search-form" class="kitchen-search-form"><label class="sr-only" for="kitchen-search">Buscar por pedido, mesa ou pizza</label><input id="kitchen-search" name="query" type="search" value="${escapeHtml(kitchenOrderQuery)}" placeholder="Buscar pedido, mesa ou sabor" autocomplete="off"><button class="button button-secondary" type="submit">Buscar</button>${query ? `<button class="button button-quiet" type="button" data-action="clear-kitchen-search" aria-label="Limpar busca">Limpar</button>` : ""}</form><button class="kitchen-late-filter ${kitchenLateOnly ? "is-active" : ""}" type="button" data-action="toggle-kitchen-late-filter" aria-pressed="${kitchenLateOnly}"><span aria-hidden="true">!</span>Acima da meta <strong data-kitchen-overdue-total>${activeOrders.filter(isOverdue).length}</strong></button></div>
      <div class="kitchen-toolbar-filters"><strong>Canal</strong><div class="order-filters" role="group" aria-label="Filtrar fila por canal">${KITCHEN_CHANNEL_FILTERS.map((filter) => kitchenChannelButton(filter, activeOrders)).join("")}</div>${hasFilters ? `<button class="button button-quiet clear-kitchen-filters" type="button" data-action="reset-kitchen-filters">Limpar filtros</button>` : ""}</div>
      <p class="kitchen-results-summary">${visibleOrders.length === 0 ? "Nenhum pedido corresponde aos filtros." : `Exibindo ${visibleOrders.length} ${visibleOrders.length === 1 ? "pedido" : "pedidos"} · ${sumPizzas(visibleOrders)} ${sumPizzas(visibleOrders) === 1 ? "pizza" : "pizzas"}`}</p>
    </section>`}
    ${stationContent}
    ${!activeScreen && visibleOrders.some(({ status }) => status === "out-for-delivery") ? `<section class="delivery-list"><div class="panel-heading"><div><p class="eyebrow">EXPEDIÇÃO</p><h2>Na rua</h2></div><span class="column-count">${delivery.length}</span></div>${delivery.length ? `<div class="delivery-cards">${delivery.map((order) => renderKitchenOrderCard(order, { deliveryDetails: true })).join("")}</div>` : `<div class="panel kitchen-empty-delivery">Nenhum pedido em entrega neste filtro.</div>`}</section>` : ""}
  </section>`;
}
