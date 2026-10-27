import {
  DEFAULT_KITCHEN_TASKS,
  DEFAULT_KITCHEN_WORKFLOW,
  KITCHEN_WORKFLOW_PRESETS,
  currentKitchenStep,
  reconcileKitchenTasks,
  sortKitchenTickets,
  validateKitchenTasks,
  validateKitchenWorkflow,
} from "../../application/kitchen-workflow-preview.mjs";
import { defaultKitchenItemPresentation, renderKitchenItemLine } from "./kitchen-item.mjs";

export function renderKitchenPage(viewModel) {
  const {
    KITCHEN_CHANNEL_FILTERS, kitchenChannelFilter, kitchenOrderQuery = "", kitchenLateOnly = false,
    snapshot, ORDER_STAGE_ALERT_MINUTES, stageStartedAt, elapsedMinutes, renderKitchenOrderCard,
    kitchenChannelButton, orderNumber, orderChannelLabel, escapeHtml,
    kitchenWorkflow: workflowValue = DEFAULT_KITCHEN_WORKFLOW,
    kitchenTasks: tasksValue = DEFAULT_KITCHEN_TASKS,
    activeKitchenScreen = null, kitchenScreenCount = null,
    kitchenScreenHref = () => "#", kitchenOverviewHref = () => "#",
    kitchenItemPresentation = defaultKitchenItemPresentation,
    kitchenItemLabel = { singular: "item", plural: "itens", metricLabel: "Pedidos em produção" },
    kitchenStageGuidance = {},
    kitchenSearchPlaceholder = "Buscar pedido, canal ou item",
    kitchenSearchLabel = "Buscar pedido, canal ou item",
    kitchenTaskActionsAvailable = false,
  } = viewModel;
  const workflow = validateKitchenWorkflow(workflowValue);
  const tasks = reconcileKitchenTasks(validateKitchenTasks(tasksValue), snapshot.orders, workflow);
  const ordersById = new Map(snapshot.orders.map((order) => [order.id, order]));
  const ORDER_COLUMNS = workflow.steps;
  const activeOrders = snapshot.orders.filter(({ status }) => ["received", "preparing", "ready", "out-for-delivery"].includes(status));
  const channelMatches = ({ channel }) => kitchenChannelFilter === "all" || channel === kitchenChannelFilter;
  const isOverdue = (order) => Number.isFinite(ORDER_STAGE_ALERT_MINUTES[order.status])
    && elapsedMinutes(stageStartedAt(order)) >= ORDER_STAGE_ALERT_MINUTES[order.status];
  const query = kitchenOrderQuery.trim().toLocaleLowerCase("pt-BR");
  const itemText = (item) => {
    const presentation = kitchenItemPresentation(item);
    return [presentation.title, presentation.detail, presentation.modifierLabel, ...presentation.modifiers].filter(Boolean).join(" ");
  };
  const queryMatches = (order) => !query || [
    orderNumber(order), orderChannelLabel(order), ...order.items.map(itemText),
  ].join(" ").toLocaleLowerCase("pt-BR").includes(query);
  const visibleOrders = activeOrders.filter(channelMatches).filter(queryMatches)
    .filter((order) => !kitchenLateOnly || isOverdue(order));
  const visibleIds = new Set(visibleOrders.map(({ id }) => id));
  const activeTickets = tasks.tickets.filter((ticket) => visibleIds.has(ticket.orderId) && currentKitchenStep(ticket));
  const readyOrders = visibleOrders.filter(({ status }) => status === "ready");
  const deliveryOrders = visibleOrders.filter(({ status }) => status === "out-for-delivery");
  const productionOrders = visibleOrders.filter(({ status }) => ["received", "preparing"].includes(status));
  const waitingTickets = activeTickets.filter((ticket) => currentKitchenStep(ticket).status === "queued");
  const workingTickets = activeTickets.filter((ticket) => currentKitchenStep(ticket).status === "active");
  const overdueOrders = visibleOrders.filter(isOverdue);
  const hasFilters = kitchenChannelFilter !== "all" || query.length > 0 || kitchenLateOnly;
  const countLabel = hasFilters
    ? `${visibleOrders.length} de ${activeOrders.length} pedidos`
    : `${activeOrders.length} ${activeOrders.length === 1 ? "pedido ativo" : "pedidos ativos"}`;
  const itemCount = (count) => `${count} ${count === 1 ? kitchenItemLabel.singular : kitchenItemLabel.plural}`;
  const sumItems = (orders) => orders.reduce((total, order) => total
    + order.items.reduce((count, item) => count + item.quantity, 0), 0);
  const summaryCards = [
    { label: kitchenItemLabel.metricLabel, value: sumItems(productionOrders), detail: `${productionOrders.length} ${productionOrders.length === 1 ? "pedido" : "pedidos"} em produção`, tone: "orange" },
    { label: "Aguardando etapa", value: waitingTickets.length, detail: `${itemCount(sumItems(waitingTickets.map(({ orderId }) => ordersById.get(orderId)).filter(Boolean)))} na fila`, tone: "violet" },
    { label: "Em andamento", value: workingTickets.length, detail: `${workingTickets.length} ${workingTickets.length === 1 ? "estação ocupada" : "etapas ativas"}`, tone: "green" },
    { label: "Pedidos acima da meta", value: overdueOrders.length, detail: `${itemCount(sumItems(overdueOrders))} precisam de atenção`, tone: "red" },
  ];

  const screenCount = Math.max(workflow.screenCount, activeKitchenScreen ?? 0, kitchenScreenCount ?? 0);
  const screenLinks = Array.from({ length: workflow.screenCount }, (_, index) => {
    const screenNumber = index + 1;
    const assigned = workflow.steps.filter(({ screen }) => screen === screenNumber);
    const stageLabel = assigned.map(({ label }) => label).join(" · ");
    const href = kitchenScreenHref(screenNumber, assigned[0]?.id ?? workflow.steps[0].id, workflow.screenCount);
    return `<div class="kitchen-display-row"><div class="kitchen-screen-assignment"><strong>Tela ${screenNumber}</strong><span>${escapeHtml(stageLabel)}</span></div><div class="kitchen-screen-actions"><a class="button button-quiet kitchen-open-display" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">Abrir tela <span aria-hidden="true">↗</span></a><button class="button button-quiet" type="button" data-action="copy-kitchen-link" data-copy-url="${escapeHtml(href)}">Copiar link</button></div></div>`;
  }).join("");
  const stepRows = workflow.steps.map((step, index) => `<div class="kitchen-workflow-step"><span class="kitchen-step-number">${index + 1}</span><label class="kitchen-step-fields" for="kitchen-step-label-${index + 1}"><span>Nome da etapa</span><input id="kitchen-step-label-${index + 1}" name="step-label-${index + 1}" maxlength="48" minlength="2" required value="${escapeHtml(step.label)}"><input type="hidden" name="step-id-${index + 1}" value="${escapeHtml(step.id)}"></label><label class="kitchen-step-screen" for="kitchen-step-screen-${index + 1}"><span>Tela</span><select id="kitchen-step-screen-${index + 1}" name="step-screen-${index + 1}" aria-label="Tela da etapa ${index + 1}">${Array.from({ length: workflow.screenCount }, (_, screenIndex) => `<option value="${screenIndex + 1}" ${step.screen === screenIndex + 1 ? "selected" : ""}>${screenIndex + 1}</option>`).join("")}</select></label><div class="kitchen-step-order"><button type="button" data-action="move-kitchen-step" data-index="${index}" data-delta="-1" aria-label="Mover ${escapeHtml(step.label)} para cima" ${index === 0 ? "disabled" : ""}>↑</button><button type="button" data-action="move-kitchen-step" data-index="${index}" data-delta="1" aria-label="Mover ${escapeHtml(step.label)} para baixo" ${index === workflow.steps.length - 1 ? "disabled" : ""}>↓</button></div></div>`).join("");
  const configuration = `<details class="panel kitchen-display-setup" ${viewModel.kitchenSetupExpanded ? "open" : ""}>
    <summary><span class="kitchen-setup-icon" aria-hidden="true">▦</span><span class="kitchen-setup-summary"><strong>Fluxo e telas da cozinha</strong><small>${workflow.steps.length} etapas · ${workflow.screenCount} ${workflow.screenCount === 1 ? "tela" : "telas"}</small></span><span class="kitchen-setup-chevron" aria-hidden="true">⌄</span></summary>
    <div class="kitchen-display-setup-body"><form id="kitchen-layout-form" class="kitchen-layout-form">
      <fieldset class="kitchen-workflow-presets"><legend>Começar com um fluxo pronto</legend><button class="button button-quiet" type="button" data-action="apply-kitchen-preset" data-preset="${KITCHEN_WORKFLOW_PRESETS.SINGLE_PIZZAIOLO}"><strong>1 pizzaiolo</strong><span>Prepara o pedido e envia ao forno · 1 tela</span></button><button class="button button-quiet" type="button" data-action="apply-kitchen-preset" data-preset="${KITCHEN_WORKFLOW_PRESETS.PIZZERIA_LINE}"><strong>Linha por etapas</strong><span>Abrir massa → montagem → forno → finalização · 4 telas</span></button></fieldset>
      <div class="kitchen-layout-controls"><label for="kitchen-workflow-step-count">Etapas do fluxo<select id="kitchen-workflow-step-count" name="stepCount">${Array.from({ length: 8 }, (_, index) => `<option value="${index + 1}" ${workflow.steps.length === index + 1 ? "selected" : ""}>${index + 1} ${index === 0 ? "etapa" : "etapas"}</option>`).join("")}</select></label><label for="kitchen-display-count">Quantidade de telas<select id="kitchen-display-count" name="screenCount">${Array.from({ length: workflow.steps.length }, (_, index) => `<option value="${index + 1}" ${workflow.screenCount === index + 1 ? "selected" : ""}>${index + 1} ${index === 0 ? "tela" : "telas"}</option>`).join("")}</select></label></div>
      <label class="kitchen-queue-mode-control" for="kitchen-queue-mode">Como a equipe trabalha<select id="kitchen-queue-mode" name="queueMode"><option value="by-order" ${workflow.queueMode === "by-order" ? "selected" : ""}>Pedido a pedido</option><option value="by-stage" ${workflow.queueMode === "by-stage" ? "selected" : ""}>Por função em lote</option></select></label>
      <p class="kitchen-layout-mode-note"><strong>Pedido a pedido:</strong> conclua as etapas deste posto no mesmo pedido antes de pegar o próximo. <strong>Por função em lote:</strong> faça a mesma etapa nos pedidos da fila antes de avançar para a próxima função. Iniciar reserva o pedido em foco; concluir avança a produção. No fluxo de 1 pizzaiolo, enviar o preparo libera o pedido para o forno. <strong>Próximo</strong> coloca outro pedido em foco e retorna o atual à 3ª posição quando há fila suficiente. Ao salvar outro fluxo, pedidos ainda não iniciados são reorganizados; os que já começaram mantêm suas etapas.</p>
      <div class="kitchen-workflow-step-list" aria-label="Etapas configuradas">${stepRows}</div>
      <div class="kitchen-layout-footer"><p>As etapas e ações ficam salvas neste navegador. Para compartilhar a fila entre aparelhos, falta a integração Food de produção em tempo real.</p><button class="button button-primary" type="submit">Salvar fluxo</button></div>
    </form><section class="kitchen-screen-links" aria-label="Links diretos das telas"><h3>Abrir cada tela em um aparelho</h3>${screenLinks}</section>
    <div class="kitchen-assignment-pending"><strong>Cancelamentos e operadores</strong><span>O KDS não cancela pedidos. O cancelamento continua em Pedidos; a autorização por função e a distribuição por operador usam os owners de Pessoas e Identidade.</span></div></div>
  </details>`;

  const kitchenItemLines = (order, compact = false) => order.items
    .map((item) => renderKitchenItemLine(item, kitchenItemPresentation(item), escapeHtml, { compact })).join("");
  const ticketSort = (first, second) => {
    const firstTask = currentKitchenStep(first);
    const secondTask = currentKitchenStep(second);
    if (firstTask.status === "active" && secondTask.status !== "active") return -1;
    if (secondTask.status === "active" && firstTask.status !== "active") return 1;
    return firstTask.queuePosition - secondTask.queuePosition;
  };
  const stageQueues = new Map(workflow.steps.map((step) => [step.id,
    activeTickets.filter((ticket) => currentKitchenStep(ticket)?.id === step.id).sort(ticketSort)]));
  const activeAssignedLabels = activeKitchenScreen === null ? []
    : workflow.steps.filter(({ screen }) => screen === activeKitchenScreen).map(({ label }) => label);
  const stationQueue = activeKitchenScreen === null ? [] : sortKitchenTickets(tasks.tickets, workflow, activeKitchenScreen);
  const focusedStationStep = stationQueue[0] ? currentKitchenStep(stationQueue[0]) : null;
  const passableStationQueue = workflow.queueMode === "by-stage"
    ? stationQueue.filter((ticket) => currentKitchenStep(ticket)?.id === focusedStationStep?.id)
    : stationQueue;
  const stationTitle = focusedStationStep?.label ?? (activeAssignedLabels.length === 1
    ? activeAssignedLabels[0]
    : activeAssignedLabels.length === 2
      ? `${activeAssignedLabels[0]} + ${activeAssignedLabels[1]}`
      : activeKitchenScreen === 1 && workflow.screenCount === 1
        ? "Produção completa"
        : activeAssignedLabels.join(" · ") || "Posto multi-etapa");
  const stationDescription = workflow.steps.length === 2 && workflow.screenCount === 1
    ? workflow.queueMode === "by-stage"
      ? "Uma pessoa · faça o preparo de todos os pedidos antes de avançar ao forno."
      : "Uma pessoa · um pedido por vez · enviar ao forno ao concluir o preparo."
    : activeAssignedLabels.length > 1
    ? activeAssignedLabels.length + " etapas nesta tela · "
      + (workflow.queueMode === "by-stage" ? "faça cada função em lote." : "conclua este pedido antes do próximo.")
    : "Conclua esta etapa para liberar o pedido seguinte.";

  const stationContent = activeKitchenScreen !== null
    ? (() => {
      const currentTicket = stationQueue[0] ?? null;
      const currentOrder = currentTicket ? ordersById.get(currentTicket.orderId) : null;
      const nextTickets = stationQueue.slice(1, 6);
      const remaining = Math.max(0, stationQueue.length - 6);
      const queueLabels = stationQueue.map((ticket) => currentKitchenStep(ticket)?.label).filter(Boolean);
      const screenLabel = [...new Set(activeAssignedLabels.length ? activeAssignedLabels : queueLabels)].join(" · ") || "Fila sem etapas atribuídas";
      const upcomingRows = nextTickets.map((ticket, index) => {
        const order = ordersById.get(ticket.orderId);
        const task = currentKitchenStep(ticket);
        if (!order || !task) return "";
        return `<li class="kitchen-up-next-item" data-kitchen-upcoming-order="${escapeHtml(order.id)}"><div class="kitchen-up-next-head"><strong>${escapeHtml(orderNumber(order))}</strong><span>${escapeHtml(orderChannelLabel(order))} · ${escapeHtml(task.label)}</span><small>${elapsedMinutes(stageStartedAt(order))} min</small></div><ul class="kitchen-item-lines kitchen-up-next-items">${kitchenItemLines(order, true)}</ul><small class="kitchen-up-next-position">${index + 2}º da fila</small></li>`;
      }).join("");
      return `<div class="kitchen-station-workspace"><section class="kitchen-current-order" data-kitchen-stage="${activeKitchenScreen}" aria-label="Pedido atual na tela ${activeKitchenScreen}"><div class="kitchen-current-order-heading"><div><p class="eyebrow">PEDIDO EM FOCO</p><h2>${currentOrder ? "Pedido atual" : "Fila vazia"}</h2></div></div>${currentOrder ? `<div data-kitchen-current-order="${escapeHtml(currentOrder.id)}">${renderKitchenOrderCard(currentOrder, { task: currentTicket, screenNumber: activeKitchenScreen, canPassNext: passableStationQueue.length > 1, passBehindCount: passableStationQueue.length > 2 ? 2 : 1 })}</div>` : `<div class="kitchen-station-empty">Nenhum pedido aguardando nesta tela.</div>`}</section><aside class="kitchen-up-next" aria-labelledby="kitchen-up-next-title"><header><div><p class="eyebrow">${escapeHtml(screenLabel)}</p><h2 id="kitchen-up-next-title">Próximos pedidos</h2></div><span>${nextTickets.length} / 5</span></header>${nextTickets.length ? `<ol class="kitchen-up-next-list">${upcomingRows}</ol>` : `<p class="kitchen-up-next-empty">Sem outros pedidos aguardando.</p>`}${remaining ? `<p class="kitchen-up-next-more">+ ${remaining} ${remaining === 1 ? "pedido" : "pedidos"} depois dos próximos cinco.</p>` : ""}</aside></div>`;
    })()
    : `<div class="kitchen-board" tabindex="0" aria-label="Etapas configuradas da produção">${ORDER_COLUMNS.map((step) => {
      const queue = stageQueues.get(step.id) ?? [];
      const orders = queue.map(({ orderId }) => ordersById.get(orderId)).filter(Boolean);
      const overdueCount = orders.filter(isOverdue).length;
      return `<section class="kitchen-column kitchen-workflow-column" data-kitchen-stage="${escapeHtml(step.id)}"><header class="kitchen-column-head"><span class="kitchen-column-icon" aria-hidden="true">◉</span><h2>${escapeHtml(step.label)}</h2><span class="kitchen-column-volume"><strong>${orders.length}</strong><small>${itemCount(sumItems(orders))}</small></span></header>${overdueCount ? `<p class="column-alert-summary">${overdueCount} ${overdueCount === 1 ? "pedido" : "pedidos"} acima da meta</p>` : ""}<div class="kitchen-column-body">${queue.length ? queue.map((ticket) => {
        const order = ordersById.get(ticket.orderId);
        return order ? renderKitchenOrderCard(order, { task: ticket }) : "";
      }).join("") : `<div class="column-empty">Nenhum pedido nesta etapa.</div>`}</div></section>`;
    }).join("")}</div>`;

  const handoffContent = activeKitchenScreen === null
    ? `<section class="kitchen-handoff-grid"><article class="panel kitchen-handoff-panel"><header><div><p class="eyebrow">PRÓXIMO PASSO</p><h2>Prontos para retirada ou entrega</h2></div><span class="column-count">${readyOrders.length}</span></header>${readyOrders.length ? `<div class="delivery-cards">${readyOrders.map((order) => renderKitchenOrderCard(order)).join("")}</div>` : `<p class="kitchen-up-next-empty">Nenhum pedido aguardando a liberação final.</p>`}</article><article class="panel kitchen-handoff-panel"><header><div><p class="eyebrow">DELIVERY</p><h2>Em entrega</h2></div><span class="column-count">${deliveryOrders.length}</span></header>${deliveryOrders.length ? `<div class="delivery-cards">${deliveryOrders.map((order) => renderKitchenOrderCard(order, { deliveryDetails: true })).join("")}</div>` : `<p class="kitchen-up-next-empty">Nenhum pedido em entrega.</p>`}</article></section>`
    : "";
  const stationHeader = activeKitchenScreen !== null
    ? `<div class="kitchen-station-header"><div><p class="eyebrow">TELA ${activeKitchenScreen} DE ${screenCount}</p><h1>${escapeHtml(stationTitle)}</h1><p>${escapeHtml(stationDescription)}</p></div><div class="kitchen-station-controls"><a class="button button-quiet" href="${escapeHtml(kitchenOverviewHref())}" aria-label="Voltar ao quadro"><span class="kitchen-overview-label-full">Voltar ao quadro</span><span class="kitchen-overview-label-compact" aria-hidden="true">Quadro</span></a><button class="button button-primary" type="button" data-action="fullscreen-kitchen">Tela cheia <span aria-hidden="true">⛶</span></button></div></div>`
    : `<div class="page-heading kitchen-page-heading"><div><p class="eyebrow">OPERAÇÃO · COZINHA</p><h1>Produção</h1><p>${workflow.steps.map(({ label }) => escapeHtml(label)).join(" → ")}</p></div><span class="kitchen-active-count">${countLabel}</span></div>`;

  return `<section class="page-section kitchen-page ${activeKitchenScreen !== null ? "kitchen-station-screen" : ""}" ${activeKitchenScreen !== null ? `data-kitchen-station-screen="${activeKitchenScreen}"` : ""}>
    ${stationHeader}${activeKitchenScreen === null ? configuration : ""}
    ${activeKitchenScreen === null ? `<section class="kitchen-summary" aria-label="Resumo da produção atual">${summaryCards.map(({ label, value, detail, tone }) => `<article class="kitchen-summary-card kitchen-summary-${tone}"><span>${escapeHtml(label)}</span><strong ${tone === "red" ? "data-kitchen-overdue-count" : ""}>${value}</strong><small>${escapeHtml(detail)}</small></article>`).join("")}</section>
    <section class="panel kitchen-toolbar" aria-label="Busca e filtros da fila da cozinha"><div class="kitchen-toolbar-main"><form id="kitchen-search-form" class="kitchen-search-form"><label class="sr-only" for="kitchen-search">${escapeHtml(kitchenSearchLabel)}</label><input id="kitchen-search" name="query" type="search" value="${escapeHtml(kitchenOrderQuery)}" placeholder="${escapeHtml(kitchenSearchPlaceholder)}" autocomplete="off"><button class="button button-secondary" type="submit">Buscar</button>${query ? `<button class="button button-quiet" type="button" data-action="clear-kitchen-search" aria-label="Limpar busca">Limpar</button>` : ""}</form><button class="kitchen-late-filter ${kitchenLateOnly ? "is-active" : ""}" type="button" data-action="toggle-kitchen-late-filter" aria-pressed="${kitchenLateOnly}"><span aria-hidden="true">!</span>Acima da meta <strong data-kitchen-overdue-total>${activeOrders.filter(isOverdue).length}</strong></button></div><div class="kitchen-toolbar-filters"><strong>Canal</strong><div class="order-filters" role="group" aria-label="Filtrar fila por canal">${KITCHEN_CHANNEL_FILTERS.map((filter) => kitchenChannelButton(filter, activeOrders)).join("")}</div>${hasFilters ? `<button class="button button-quiet clear-kitchen-filters" type="button" data-action="reset-kitchen-filters">Limpar filtros</button>` : ""}</div><p class="kitchen-results-summary">${visibleOrders.length === 0 ? "Nenhum pedido corresponde aos filtros." : `Exibindo ${visibleOrders.length} ${visibleOrders.length === 1 ? "pedido" : "pedidos"} · ${itemCount(sumItems(visibleOrders))}`}</p></section>` : ""}
    ${stationContent}${handoffContent}
  </section>`;
}
