import {
  PIZZA_SIZES as DEFAULT_PIZZA_SIZES,
  PIZZERIA_TABLES as DEFAULT_PIZZERIA_TABLES,
  DEFAULT_DELIVERY_FEE_CENTS,
  calculatePizzaPriceCents,
} from "../domain/domain.mjs";
import { createFoodCommand } from "../application/commands.mjs";
import {
  DEFAULT_KITCHEN_TASKS,
  DEFAULT_KITCHEN_WORKFLOW,
  createKitchenWorkflowPreset,
  KITCHEN_WORKFLOW_SCHEMA,
  currentKitchenStep,
  distributeKitchenSteps,
  saveKitchenWorkflow,
  sortKitchenTickets,
  validateKitchenTasks,
  validateKitchenWorkflow,
} from "../application/kitchen-workflow-preview.mjs";
import { reviewFoodCartPrices } from "../application/cart-pricing.mjs";
import { PREVIEW_CATALOG_PRODUCTS } from "../fixtures/mock-data.mjs";
import { FOOD_RECIPE_INGREDIENT_FIXTURES } from "../fixtures/food-recipes.mjs";
import { assertFoodDataPort, readFoodSnapshot } from "../ports/food-data-port.mjs";
import { renderSpaceCapabilityStatus } from "./space-capability-status.mjs";
import {
  assertFoodPreviewPresentation,
  assertFoodModuleView,
  renderEmbeddedFoodPreview,
} from "./presentation.mjs";
import { renderOrdersPage } from "./views/orders.mjs";
import { renderKitchenPage } from "./views/kitchen.mjs";
import { renderKitchenItemLine } from "./views/kitchen-item.mjs";
import { formatFoodOrderNumber } from "./order-number.mjs";
import {
  PIZZERIA_KITCHEN_ITEM_LABEL,
  PIZZERIA_KITCHEN_STAGE_GUIDANCE,
  presentPizzeriaKitchenItem,
} from "./pizzeria-kitchen-presentation.mjs";
import { renderMenuPage } from "./views/menu.mjs";
import { renderTablesPage } from "./views/tables.mjs";
import { renderDeliveryPage } from "./views/delivery.mjs";
import { renderSettingsPage } from "./views/settings.mjs";

export function createFoodPizzeriaApp({ root, dataPort, presentation = "standalone-preview" } = {}) {
  if (!root || typeof root.querySelector !== "function" || typeof root.addEventListener !== "function") {
    throw new TypeError("O host precisa fornecer o elemento de montagem do OrdaX Food.");
  }
  assertFoodDataPort(dataPort);
  assertFoodPreviewPresentation(presentation, dataPort);
  if (typeof dataPort.getPreviewPreferences !== "function"
    || typeof dataPort.updatePreviewPreferences !== "function") {
    throw new TypeError("A prévia Food precisa do adapter de preferências locais do navegador.");
  }
  const surface = root.getRootNode();
  const querySurface = (selector) => surface.querySelector(selector) ?? root.querySelector(selector);
  const cancelDialog = querySurface("#cancel-dialog");
  const cancelForm = querySurface("#cancel-order-form");
  const tableOpenDialog = querySurface("#table-open-dialog");
  const tableOpenForm = querySurface("#table-open-form");
  if ([cancelDialog, cancelForm, tableOpenDialog, tableOpenForm].some((element) => !element)) {
    throw new TypeError("O host não forneceu a estrutura de interface necessária para o OrdaX Food.");
  }
  
  const STATUS_LABELS = Object.freeze({
    received: "Recebido",
    preparing: "Em preparo",
    ready: "Pronto",
    "out-for-delivery": "Saiu para entrega",
    completed: "Concluído",
    cancelled: "Cancelado",
  });
  const CHANNEL_LABELS = Object.freeze({
    delivery: "Entrega",
    pickup: "Retirada",
    counter: "Balcão",
    "dine-in": "Salão",
  });
  const VIEW_LABELS = Object.freeze({
    overview: "Visão geral",
    orders: "Pedidos",
    menu: "Cardápio",
    kitchen: "Cozinha (KDS)",
    tables: "Mesas e Comandas",
    delivery: "Delivery",
    pos: "Caixa (PDV)",
    inventory: "Estoque",
    customers: "Clientes",
    reports: "Relatórios",
    team: "Equipe",
    settings: "Configurações",
  });
  const PREVIEW_INGREDIENTS = FOOD_RECIPE_INGREDIENT_FIXTURES;
  const routeParams = new URLSearchParams(globalThis.location?.search ?? "");
  const routeStationValue = Number(routeParams.get("station"));
  const routeScreenCountValue = Number(routeParams.get("screenCount"));
  const routeStageValue = routeParams.get("stationStage");
  const activeKitchenScreenFromRoute = Number.isSafeInteger(routeStationValue)
    && routeStationValue >= 1 && routeStationValue <= 8 ? routeStationValue : null;
  const kitchenScreenStageFromRoute = typeof routeStageValue === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(routeStageValue)
    ? routeStageValue
    : null;
  const kitchenScreenCountFromRoute = Number.isSafeInteger(routeScreenCountValue)
    && routeScreenCountValue >= (activeKitchenScreenFromRoute ?? 1)
    && routeScreenCountValue <= 8 ? routeScreenCountValue : null;
  const SPACE_PENDING_VIEWS = new Set(["overview", "pos", "inventory", "customers", "reports", "team"]);
  const ORDER_STATUS_FILTERS = Object.freeze([
    Object.freeze({ id: "all", label: "Todas as etapas" }),
    Object.freeze({ id: "received", label: "Recebidos" }),
    Object.freeze({ id: "preparing", label: "Em preparo" }),
    Object.freeze({ id: "ready", label: "Prontos" }),
    Object.freeze({ id: "out-for-delivery", label: "Saiu para entrega" }),
    Object.freeze({ id: "completed", label: "Concluídos" }),
    Object.freeze({ id: "cancelled", label: "Cancelados" }),
  ]);
  const KITCHEN_CHANNEL_FILTERS = Object.freeze([
    Object.freeze({ id: "all", label: "Todos os canais" }),
    Object.freeze({ id: "delivery", label: "Entrega" }),
    Object.freeze({ id: "pickup", label: "Retirada" }),
    Object.freeze({ id: "counter", label: "Balcão" }),
    Object.freeze({ id: "dine-in", label: "Salão" }),
  ]);
  const ORDER_STAGE_ALERT_MINUTES = Object.freeze({ received: 15, preparing: 35, ready: 15, "out-for-delivery": 45 });
  const ICONS = Object.freeze({
    pizza: '<path d="M3.5 3.5c7.7.3 13.1 3.2 17 17-8.2-1.6-14.3-7.3-17-17Z"/><circle cx="9" cy="10" r="1"/><circle cx="13.5" cy="13.5" r="1"/>',
    overview: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
    orders: '<path d="M7 3.5h8l3 3v14H6v-17h1Z"/><path d="M14.5 3.5v4h4M9 12h6M9 16h6"/>',
    kitchen: '<path d="M5 12.5a4.5 4.5 0 1 1 8.4-2.2A3.6 3.6 0 1 1 18 17H8.5A3.5 3.5 0 0 1 5 13.5v-1Z"/><path d="M7 17v3h10v-3M9 20v1.5M15 20v1.5"/>',
    menu: '<path d="M5 4.5h14v16H5zM8.5 4.5v16M11.5 9h5M11.5 13h5M11.5 17h3"/>',
    settings: '<path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"/><path d="m19.4 15 .1.1a1.8 1.8 0 0 1-2.5 2.5l-.1-.1a1.8 1.8 0 0 0-3 .9v.2a1.8 1.8 0 0 1-3.6 0v-.2a1.8 1.8 0 0 0-3-.9l-.1.1a1.8 1.8 0 0 1-2.5-2.5l.1-.1a1.8 1.8 0 0 0-.9-3h-.2a1.8 1.8 0 0 1 0-3.6h.2a1.8 1.8 0 0 0 .9-3l-.1-.1a1.8 1.8 0 0 1 2.5-2.5l.1.1a1.8 1.8 0 0 0 3-.9v-.2a1.8 1.8 0 0 1 3.6 0v.2a1.8 1.8 0 0 0 3 .9l.1-.1a1.8 1.8 0 0 1 2.5 2.5l-.1.1a1.8 1.8 0 0 0 .9 3h.2a1.8 1.8 0 0 1 0 3.6h-.2a1.8 1.8 0 0 0-.9 3Z"/>',
    ready: '<path d="m5 12.5 4.2 4.2L19.5 6.5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    value: '<path d="M12 3v18M17 7H9.5a3 3 0 0 0 0 6h5a3 3 0 0 1 0 6H6"/>',
    delivery: '<path d="M3 7h11v10H3zM14 10h4l3 3v4h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
    tables: '<path d="M4 9h16v5H4zM6 14v6M18 14v6M7 9V5h10v4"/>',
    pos: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h2M14 11h2M8 15h2M14 15h2M9 21v-3h6v3"/>',
    inventory: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4.5 7.8 7.5 4.3 7.5-4.3M12 12v9M8 5.3l8 4.5"/>',
    customers: '<path d="M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20M9.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM17 4.5a4 4 0 0 1 0 7.5M21 20v-1.5a4 4 0 0 0-3-3.9"/>',
    reports: '<path d="M4 20V11M10 20V5M16 20v-8M22 20H2"/>',
    team: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20v-1.2a5 5 0 0 1 5-5h3a5 5 0 0 1 5 5V20M16 5a3.5 3.5 0 0 1 0 6.8M18 14h.5a4 4 0 0 1 4 4V20"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  });
  
  const store = dataPort;
  let snapshot = null;
  let previewPreferences = { deliveryFeeCents: DEFAULT_DELIVERY_FEE_CENTS };
  let PIZZA_SIZES = DEFAULT_PIZZA_SIZES.map((size) => ({ ...size, active: true }));
  let PIZZERIA_TABLES = DEFAULT_PIZZERIA_TABLES.map((table) => ({ ...table, active: true }));
  let recipeFlavorId = null;
  let recipeDraftLines = [];
  let settingsSizesDraft = null;
  let settingsTablesDraft = null;
  let unsubscribe = null;
  let activeView = activeKitchenScreenFromRoute === null ? "orders" : "kitchen";
  let orderQuery = "";
  let orderStatusFilter = "all";
  let orderChannelFilter = "all";
  let kitchenChannelFilter = "all";
  let kitchenOrderQuery = "";
  let kitchenLateOnly = false;
  let kitchenWorkflowDraft = null;
  let kitchenSetupExpanded = false;
  const activeKitchenScreen = activeKitchenScreenFromRoute;
  let activeCommandId = null;
  let editFlavorId = null;
  let cart = [];
  let busy = false;
  let notice = null;
  let noticeTimer = null;
  let ageRefreshTimer = null;
  let destroyed = false;
  let mounted = false;
  
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[char]);
  }
  
  function money(cents) {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
  }
  
  function parseMoney(raw) {
    const value = String(raw ?? "").trim().replace(/^R\$\s*/i, "").replace(/\s/g, "");
    let normalized;
    if (value.includes(",")) {
      if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(value)) return null;
      normalized = value.replace(/\./g, "").replace(",", ".");
    } else {
      if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
      normalized = value;
    }
    const number = Number(normalized);
    if (!Number.isFinite(number) || number < 0 || number > 10_000_000) return null;
    const result = Math.round(number * 100);
    return Number.isSafeInteger(result) ? result : null;
  }
  
  function uid() {
    if (typeof globalThis.crypto?.randomUUID !== "function") {
      throw new Error("Este navegador não oferece identificadores seguros para registrar pedidos.");
    }
    return globalThis.crypto.randomUUID();
  }
  
  function timeLabel(value) {
    return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
  }
  
  function clockTime(value) {
    return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
  }
  
  function stageStartedAt(order) {
    return order.statusHistory.at(-1)?.changedAt ?? order.createdAt;
  }
  
  function elapsedMinutes(startedAt, now = Date.now()) {
    const timestamp = Date.parse(startedAt);
    return Number.isFinite(timestamp) ? Math.max(0, Math.floor((now - timestamp) / 60000)) : 0;
  }
  
  function formatElapsed(minutes) {
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const remainder = String(minutes % 60).padStart(2, "0");
    return `${hours}h ${remainder}min`;
  }
  
  function orderNumber(order) {
    return formatFoodOrderNumber(order.id);
  }
  
  function commandById(commandId) {
    return snapshot?.tableCommands.find(({ id }) => id === commandId) ?? null;
  }
  
  function orderChannelLabel(order) {
    if (order.tableCommandId) {
      const command = commandById(order.tableCommandId);
      if (command) return `Mesa ${String(command.tableId).padStart(2, "0")}`;
    }
    return CHANNEL_LABELS[order.channel];
  }

  function kitchenWorkflowConfiguration() {
    return validateKitchenWorkflow(
      kitchenWorkflowDraft ?? previewPreferences?.kitchenWorkflow ?? DEFAULT_KITCHEN_WORKFLOW,
    );
  }

  function kitchenScreenHref(screenNumber, stage, screenCount) {
    const currentHref = globalThis.location?.href;
    if (!currentHref) {
      return `?presentation=embedded-preview&view=kitchen&station=${screenNumber}&stationStage=${encodeURIComponent(stage)}&screenCount=${screenCount}`;
    }
    const url = new URL(currentHref);
    url.searchParams.set("view", "kitchen");
    url.searchParams.set("station", String(screenNumber));
    url.searchParams.set("stationStage", stage);
    url.searchParams.set("screenCount", String(screenCount));
    return `${url.pathname}${url.search}${url.hash}`;
  }

  function kitchenOverviewHref() {
    const currentHref = globalThis.location?.href;
    if (!currentHref) return "?presentation=embedded-preview&view=kitchen";
    const url = new URL(currentHref);
    url.searchParams.set("view", "kitchen");
    url.searchParams.delete("station");
    url.searchParams.delete("stationStage");
    url.searchParams.delete("screenCount");
    return `${url.pathname}${url.search}${url.hash}`;
  }
  
  function report(error) {
    if (destroyed) return;
    notice = { type: "error", text: error instanceof Error ? error.message : "Não foi possível concluir esta operação." };
    renderNotice();
  }
  
  function setBusyUI(value) {
    if (!root) return;
    root.setAttribute("aria-busy", String(value));
    for (const buttonElement of root.querySelectorAll("button")) {
      if (value) {
        buttonElement.dataset.busyWasDisabled = String(buttonElement.disabled);
        buttonElement.disabled = true;
      } else if ("busyWasDisabled" in buttonElement.dataset) {
        buttonElement.disabled = buttonElement.dataset.busyWasDisabled === "true";
        delete buttonElement.dataset.busyWasDisabled;
      }
    }
  }
  
  async function dispatch(commandInput, successText, { renderAfter = true } = {}) {
    if (busy || destroyed) return false;
    const startingRevision = snapshot?.revision;
    notice = null;
    busy = true;
    setBusyUI(true);
    let committed = false;
    try {
      const command = createFoodCommand({
        ...commandInput,
        expectedRevision: startingRevision,
      });
      await store.execute(command);
      if (destroyed) return false;
      committed = true;
      notice = { type: "success", text: successText };
      clearTimeout(noticeTimer);
      noticeTimer = setTimeout(() => {
        notice = null;
        renderNotice();
      }, 3600);
      return true;
    } catch (error) {
      if (!destroyed) {
        notice = { type: "error", text: error instanceof Error ? error.message : "Não foi possível salvar os dados." };
      }
      return false;
    } finally {
      busy = false;
      if (!destroyed) {
        setBusyUI(false);
        if (committed) {
          if (renderAfter) render();
          else renderNotice();
        } else if (snapshot?.revision !== startingRevision) {
          render();
        } else {
          renderNotice();
        }
      }
    }
  }
  
  function button(label, action, { kind = "quiet", icon = "", disabled = false, extra = "" } = {}) {
    return `<button class="button button-${kind}" type="button" data-action="${escapeHtml(action)}" ${disabled || busy ? "disabled" : ""} ${extra}>${icon ? `<span aria-hidden="true">${icon}</span>` : ""}${escapeHtml(label)}</button>`;
  }
  
  function iconSvg(name) {
    return `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ""}</svg>`;
  }
  
  function navButton(view, iconName) {
    const selected = activeView === view;
    return `<button class="nav-item ${selected ? "is-active" : ""}" type="button" data-view="${view}" aria-label="${escapeHtml(VIEW_LABELS[view])}" title="${escapeHtml(VIEW_LABELS[view])}" aria-current="${selected ? "page" : "false"}"><span class="nav-icon">${iconSvg(iconName)}</span><span>${VIEW_LABELS[view]}</span>${view === "orders" && activeOrderCount() > 0 ? `<span class="nav-count">${activeOrderCount()}</span>` : ""}</button>`;
  }
  
  function activeOrderCount() {
    return snapshot?.orders.filter(({ status }) => !["completed", "cancelled"].includes(status)).length ?? 0;
  }
  
  function header() {
    const name = snapshot.settings?.storeName ?? "Pizzaria";
    return `<header class="topbar">
      <div class="mobile-brand"><span class="brand-mark">${iconSvg("pizza")}</span><span>OrdaX <b>Food</b></span></div>
      <form id="global-search" class="global-search"><span aria-hidden="true">⌕</span><input name="query" aria-label="Buscar pedido ou cliente no pedido" placeholder="Buscar pedido ou cliente no pedido..." value="${escapeHtml(orderQuery)}"><kbd>/</kbd></form>
      <div class="topbar-right"><button type="button" class="avatar-button" aria-label="Configurações da pizzaria" data-view="settings">${escapeHtml(name.slice(0, 1).toUpperCase())}</button></div>
    </header>`;
  }
  
  function shell(content) {
    if (presentation === "embedded-preview") {
      return renderEmbeddedFoodPreview(content, notice
        ? `<div class="toast toast-${notice.type}" role="${notice.type === "error" ? "alert" : "status"}"><span>${notice.type === "error" ? "!" : "✓"}</span>${escapeHtml(notice.text)}<button type="button" aria-label="Fechar aviso" data-action="dismiss-notice">×</button></div>`
        : "", { kitchenStation: activeKitchenScreen !== null });
    }
    const name = snapshot.settings?.storeName ?? "Pizzaria";
    return `<div class="app-shell">
      <aside class="sidebar">
        <a class="brand" href="#" data-view="orders" aria-label="OrdaX Food — pedidos"><span class="brand-mark">${iconSvg("pizza")}</span><span class="brand-copy"><strong>OrdaX <b>Food</b></strong><small>PEDIDOS · PRODUÇÃO · CARDÁPIO</small></span></a>
        <div class="side-store"><span class="store-avatar">${iconSvg("pizza")}</span><span class="store-copy"><strong>${escapeHtml(name)}</strong><small>Unidade principal</small></span><button type="button" class="store-menu" data-view="settings" aria-label="Configurações da pizzaria">⌄</button></div>
        <nav class="main-nav" aria-label="Navegação principal">
          ${navButton("overview", "overview")}${navButton("orders", "orders")}${navButton("menu", "menu")}${navButton("kitchen", "kitchen")}${navButton("tables", "tables")}${navButton("delivery", "delivery")}${navButton("pos", "pos")}${navButton("inventory", "inventory")}${navButton("customers", "customers")}${navButton("reports", "reports")}${navButton("team", "team")}
        </nav>
        <div class="sidebar-bottom"><button type="button" class="nav-item settings-link ${activeView === "settings" ? "is-active" : ""}" data-view="settings" aria-current="${activeView === "settings" ? "page" : "false"}"><span class="nav-icon">${iconSvg("settings")}</span><span>Configurações</span></button></div>
      </aside>
      <div class="main-column">${header()}<main id="main-content" class="content" tabindex="-1">${notice ? `<div class="toast toast-${notice.type}" role="${notice.type === "error" ? "alert" : "status"}"><span>${notice.type === "error" ? "!" : "✓"}</span>${escapeHtml(notice.text)}<button type="button" aria-label="Fechar aviso" data-action="dismiss-notice">×</button></div>` : ""}${content}</main></div>
    </div>`;
  }
  
  function setupPage() {
    return `<section class="setup-page">
      <div class="setup-orbit" aria-hidden="true"><span>✦</span></div>
      <p class="eyebrow">ORdAX FOOD · PRIMEIROS AJUSTES</p>
      <h1>Vamos preparar<br> sua pizzaria.</h1>
      <p class="setup-description">Comece pelo nome da loja e escolha como o sistema calcula uma pizza meio a meio. Você poderá alterar isso depois.</p>
      <form id="setup-form" class="form-card">
        <label for="setup-name">Nome da pizzaria</label>
        <input id="setup-name" name="storeName" maxlength="80" placeholder="Ex.: Forno da Praça" required autocomplete="organization" autofocus>
        <label for="setup-policy">Preço da pizza meio a meio</label>
        <select id="setup-policy" name="halfPricePolicy"><option value="highest">Cobrar pelo sabor de maior preço</option><option value="average">Usar a média dos dois sabores</option></select>
        <p class="field-hint">A regra será aplicada às próximas vendas e ficará registrada em cada pedido.</p>
        <button class="button button-primary button-wide" type="submit" ${busy ? "disabled" : ""}>Configurar pizzaria <span aria-hidden="true">→</span></button>
      </form>
      <p class="setup-footnote">Os ajustes podem ser alterados a qualquer momento.</p>
    </section>`;
  }
  
  function viewModel() {
    return {
      PIZZA_SIZES, PIZZERIA_TABLES, PREVIEW_CATALOG_PRODUCTS, PREVIEW_INGREDIENTS,
      deliveryFeeCents: previewPreferences.deliveryFeeCents,
      kitchenWorkflow: kitchenWorkflowConfiguration(),
      kitchenTasks: validateKitchenTasks(previewPreferences?.kitchenTasks ?? DEFAULT_KITCHEN_TASKS),
      kitchenTaskActionsAvailable: typeof store.recordKitchenTaskAction === "function",
      kitchenItemPresentation,
      kitchenItemLabel: PIZZERIA_KITCHEN_ITEM_LABEL,
      kitchenStageGuidance: PIZZERIA_KITCHEN_STAGE_GUIDANCE,
      kitchenSearchPlaceholder: "Buscar pedido, mesa ou sabor",
      kitchenSearchLabel: "Buscar pedido, mesa ou sabor",
      activeKitchenScreen,
      kitchenScreenStage: kitchenScreenStageFromRoute,
      kitchenScreenCount: kitchenScreenCountFromRoute,
      kitchenScreenHref,
      kitchenOverviewHref,
      kitchenSetupExpanded,
      STATUS_LABELS, CHANNEL_LABELS, ORDER_STATUS_FILTERS,
      KITCHEN_CHANNEL_FILTERS, ORDER_STAGE_ALERT_MINUTES, snapshot, recipeFlavorId,
      recipeDraftLines, orderQuery, orderStatusFilter, orderChannelFilter, kitchenChannelFilter,
      kitchenOrderQuery, kitchenLateOnly,
      activeCommandId, editFlavorId, cart, busy, button, iconSvg, metricCard,
      orderItemDescription, nextStatus, nextActionLabel, orderAction, canCancel,
      renderOrderCard, renderKitchenOrderCard, emptyState, sizeOptions, flavorOptions, cartHtml, flavorForm,
      kitchenChannelButton, activeCommandForTable, tableCard, sectionHeader, statCard,
      tableOrders, tableCommandTotalCents, money, escapeHtml, timeLabel, clockTime, stageStartedAt,
      elapsedMinutes, formatElapsed, orderNumber, orderChannelLabel, commandById,
    };
  }
  function metricCard({ label, value, detail, icon, tone = "red" }) {
    return `<article class="metric-card"><div class="metric-top"><span>${escapeHtml(label)}</span><span class="metric-icon tone-${tone}">${iconSvg(icon)}</span></div><strong class="metric-value">${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small></article>`;
  }
  
  function orderItemDescription(item) {
    if (item.type === "catalog-product") return `${item.quantity}× ${item.name} · ${item.category}`;
    const size = item.sizeLabel ?? PIZZA_SIZES.find(({ id }) => id === item.size)?.label ?? item.size;
    const flavors = item.flavors.map(({ name }) => name).join(" + ");
    return `${item.quantity}× ${size} · ${flavors}`;
  }

  function kitchenItemPresentation(item) {
    return presentPizzeriaKitchenItem(item, PIZZA_SIZES);
  }
  
  function nextStatus(order) {
    if (order.status === "received") return "preparing";
    if (order.status === "preparing") return "ready";
    if (order.status === "ready") return order.channel === "delivery" ? "out-for-delivery" : "completed";
    if (order.status === "out-for-delivery") return "completed";
    return null;
  }
  
  function nextActionLabel(status) {
    return ({ preparing: "Iniciar preparo", ready: "Marcar como pronto", "out-for-delivery": "Saiu para entrega", completed: "Concluir pedido" })[status] ?? "";
  }
  
  function orderAction(order) {
    const status = nextStatus(order);
    if (!status) return "";
    return button(nextActionLabel(status), "advance-order", {
      kind: status === "ready" ? "primary" : "quiet",
      extra: `data-order-id="${escapeHtml(order.id)}" data-next-status="${status}"`,
    });
  }
  
  function canCancel(order) {
    return ["received", "preparing", "ready"].includes(order.status);
  }
  
  function renderOrderCard(order, { kitchen = false } = {}) {
    const items = order.items.map((item) => `<li><span>${escapeHtml(orderItemDescription(item))}</span><strong>${money(item.lineTotalCents)}</strong></li>`).join("");
    const lastChange = order.statusHistory.at(-1);
    const startedAt = stageStartedAt(order);
    const alertAfter = ORDER_STAGE_ALERT_MINUTES[order.status];
    const channelLabel = orderChannelLabel(order);
    const identityDetails = [
      ...(order.tableCommandId && channelLabel === order.customerName ? [] : [channelLabel]),
      ...(order.phone ? [order.phone] : []),
    ];
    const age = kitchen && alertAfter ? `<div class="order-age" data-order-age data-started-at="${escapeHtml(startedAt)}" data-target-minutes="${alertAfter}"><span>Na etapa há</span><strong data-age-value>${formatElapsed(elapsedMinutes(startedAt))}</strong><span class="age-alert" data-age-alert hidden>Acima de ${alertAfter} min</span></div>` : "";
    return `<article class="order-card ${kitchen ? "order-card-kitchen" : ""}">
      <div class="order-card-head"><div><span class="order-number">${orderNumber(order)}</span><span class="order-time">${timeLabel(order.createdAt)}</span></div><span class="status-badge status-${order.status}"><span></span>${STATUS_LABELS[order.status]}</span></div>
      <div class="order-customer"><strong>${escapeHtml(order.customerName)}</strong>${identityDetails.length ? `<span>${escapeHtml(identityDetails.join(" · "))}</span>` : ""}</div>
      ${age}
      ${order.channel === "delivery" ? `<div class="order-address">${escapeHtml(order.address)}</div>` : ""}
      <ul class="order-items">${items}</ul>
      ${order.notes ? `<p class="order-note"><span>Observação</span>${escapeHtml(order.notes)}</p>` : ""}
      ${order.status === "cancelled" ? `<p class="cancel-reason">Cancelado: ${escapeHtml(lastChange.reason)}</p>` : ""}
      <div class="order-card-foot"><div><span>Total do pedido</span><strong>${money(order.totalCents)}</strong>${order.deliveryFeeCents ? `<small>Inclui ${money(order.deliveryFeeCents)} de entrega</small>` : ""}</div><div class="order-actions">${canCancel(order) ? button("Cancelar", "cancel-order", { extra: `data-order-id="${escapeHtml(order.id)}"` }) : ""}${orderAction(order)}</div></div>
    </article>`;
  }

  function renderKitchenOrderCard(order, { deliveryDetails = false, task = null, screenNumber = null, canPassNext = false, passBehindCount = 1 } = {}) {
    const totalItems = order.items.reduce((sum, item) => sum + item.quantity, 0);
    const items = order.items.map((item) => renderKitchenItemLine(item, kitchenItemPresentation(item), escapeHtml)).join("");
    const startedAt = stageStartedAt(order);
    const alertAfter = ORDER_STAGE_ALERT_MINUTES[order.status];
    const age = alertAfter
      ? `<div class="order-age kitchen-ticket-age" data-order-age data-started-at="${escapeHtml(startedAt)}" data-target-minutes="${alertAfter}"><span>Na etapa há</span><strong data-age-value>${formatElapsed(elapsedMinutes(startedAt))}</strong><span class="kitchen-sla-target">Meta ${alertAfter} min</span><span class="age-alert" data-age-alert hidden>Acima da meta</span></div>`
      : "";
    const dispatchDetails = deliveryDetails && order.channel === "delivery"
      ? `<div class="kitchen-delivery-details"><span>DESTINO</span><strong>${escapeHtml(order.customerName)}</strong><p>${escapeHtml(order.address)}</p>${order.phone ? `<small>${escapeHtml(order.phone)}</small>` : ""}</div>`
      : "";
    const currentTask = task ? currentKitchenStep(task) : null;
    const taskProgress = task && currentTask
      ? `<section class="kitchen-task-progress" aria-label="Etapa ${task.steps.filter(({ status }) => status === "completed").length + 1} de ${task.steps.length}"><div><span>ETAPA ${task.steps.filter(({ status }) => status === "completed").length + 1} DE ${task.steps.length}</span><strong>${escapeHtml(currentTask.label)}</strong></div><ol aria-label="Progresso do pedido">${task.steps.map((step) => `<li class="is-${step.status}" aria-label="${escapeHtml(step.label)}: ${({ completed: "concluída", active: "em andamento", queued: "aguardando", pending: "próxima" })[step.status]}"></li>`).join("")}</ol></section>`
      : "";
    const taskActions = task && currentTask && Number.isSafeInteger(screenNumber)
      ? `<footer class="kitchen-ticket-actions kitchen-task-actions">${currentTask.status === "queued"
        ? button("Iniciar", "kitchen-task-action", { kind: "primary", disabled: typeof store.recordKitchenTaskAction !== "function", extra: `aria-label="Iniciar ${escapeHtml(currentTask.label)}" data-task-action="start" data-order-id="${escapeHtml(order.id)}" data-step-id="${escapeHtml(currentTask.id)}" data-screen-number="${screenNumber}"` })
        : button(currentTask.id === "prepare-order" ? "Enviar para o forno" : `Concluir ${currentTask.label}`, "kitchen-task-action", { kind: "primary", disabled: typeof store.recordKitchenTaskAction !== "function", extra: `aria-label="${currentTask.id === "prepare-order" ? "Concluir preparo e enviar para o forno" : `Concluir ${escapeHtml(currentTask.label)}`}" data-task-action="complete" data-order-id="${escapeHtml(order.id)}" data-step-id="${escapeHtml(currentTask.id)}" data-screen-number="${screenNumber}"` })}${button("Próximo", "kitchen-task-action", { kind: "quiet", disabled: typeof store.recordKitchenTaskAction !== "function" || !canPassNext, extra: `title="${canPassNext ? `O pedido atual volta na ${passBehindCount === 2 ? "terceira posição" : "segunda posição"}.` : "Não há outro pedido nesta etapa."}" aria-label="${canPassNext ? `Passar para o próximo; o atual volta na ${passBehindCount === 2 ? "terceira" : "segunda"} posição` : "Não há outro pedido nesta etapa"}" data-task-action="pass-next" data-order-id="${escapeHtml(order.id)}" data-step-id="${escapeHtml(currentTask.id)}" data-screen-number="${screenNumber}" data-pass-behind="${passBehindCount}"` })}</footer>`
      : "";
    return `<article class="order-card order-card-kitchen" data-status="${order.status}">
      <header class="kitchen-ticket-head"><div class="kitchen-ticket-identity"><strong>${orderNumber(order)}</strong><span class="kitchen-channel-chip">${escapeHtml(orderChannelLabel(order))}</span></div><span class="status-badge status-${order.status}"><span></span>${escapeHtml(STATUS_LABELS[order.status])}</span></header>
      <div class="kitchen-ticket-meta"><span>Pedido às ${clockTime(order.createdAt)}</span><strong>${totalItems} ${totalItems === 1 ? "item" : "itens"}</strong></div>
      ${taskProgress}
      ${age}
      <ul class="kitchen-item-lines">${items}</ul>
      ${order.notes ? `<div class="kitchen-production-note"><span>INSTRUÇÃO DE PREPARO</span><p>${escapeHtml(order.notes)}</p></div>` : ""}
      ${dispatchDetails}
      ${taskActions}
    </article>`;
  }
  
  function emptyState({ icon, title, text, action = "", view = "" }) {
    return `<div class="empty-state"><span class="empty-icon" aria-hidden="true">${icon}</span><h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p>${action ? `<button type="button" class="button button-primary" data-view="${view}">${escapeHtml(action)} <span aria-hidden="true">→</span></button>` : ""}</div>`;
  }
  


  function sizeOptions(selected = "medium") {
    return PIZZA_SIZES.filter(({ active }) => active).map(({ id, label, slices }) => `<option value="${id}" ${selected === id ? "selected" : ""}>${escapeHtml(label)} · ${slices} fatias</option>`).join("");
  }
  
  function flavorOptions(selected = "") {
    const active = snapshot.flavors.filter(({ id, active }) => active && snapshot.recipes.some((recipe) => recipe.flavorId === id));
    return `<option value="">Escolha um sabor</option>${active.map(({ id, name }) => `<option value="${escapeHtml(id)}" ${id === selected ? "selected" : ""}>${escapeHtml(name)}</option>`).join("")}`;
  }
  
  function cartHtml() {
    if (!cart.length) return `<div class="cart-empty" id="cart-empty"><span aria-hidden="true">◌</span><p>Adicione uma pizza ou outro produto ao pedido.</p></div>`;
    return `<ul class="cart-list">${cart.map((item, index) => {
      if (item.type === "catalog-product") {
        return `<li class="cart-line"><div><strong>${item.quantity}× ${escapeHtml(item.name)}</strong><span>${escapeHtml(item.category)}</span></div><strong>${money(item.unitPriceCents * item.quantity)}</strong><button class="icon-button" type="button" data-action="remove-cart-item" data-index="${index}" aria-label="Remover ${escapeHtml(item.name)}">×</button></li>`;
      }
      const size = PIZZA_SIZES.find(({ id }) => id === item.size)?.label;
      const flavorNames = item.flavorIds.map((id) => snapshot.flavors.find((flavor) => flavor.id === id)?.name ?? "Sabor indisponível");
      let unit = 0;
      try {
        unit = calculatePizzaPriceCents({ size: item.size, flavorIds: item.flavorIds, flavors: snapshot.flavors, halfPricePolicy: snapshot.settings.halfPricePolicy, pizzaSizes: PIZZA_SIZES, maxFlavorsPerPizza: snapshot.settings.maxFlavorsPerPizza });
      } catch { unit = item.unitPriceCents; }
      return `<li class="cart-line"><div><strong>${item.quantity}× ${escapeHtml(size)}</strong><span>${escapeHtml(flavorNames.join(" + "))}</span></div><strong>${money(unit * item.quantity)}</strong><button class="icon-button" type="button" data-action="remove-cart-item" data-index="${index}" aria-label="Remover ${escapeHtml(flavorNames.join(" e "))}">×</button></li>`;
    }).join("")}</ul>`;
  }
  
  function ordersPage() { return renderOrdersPage(viewModel()); }

  function kitchenChannelButton(filter, activeOrders) {
    const count = filter.id === "all" ? activeOrders.length : activeOrders.filter(({ channel }) => channel === filter.id).length;
    return `<button class="order-filter ${kitchenChannelFilter === filter.id ? "is-active" : ""}" type="button" data-kitchen-channel="${filter.id}" aria-pressed="${kitchenChannelFilter === filter.id}">${filter.label}<span>${count}</span></button>`;
  }
  
  function kitchenPage() { return renderKitchenPage(viewModel()); }

  function flavorForm() {
    const flavor = snapshot.flavors.find(({ id }) => id === editFlavorId) ?? null;
    const prices = flavor?.pricesCents ?? {};
    return `<form id="flavor-form" class="panel flavor-form">
      <div class="panel-heading"><div><p class="eyebrow">${flavor ? "ATUALIZAR CADASTRO" : "NOVO SABOR"}</p><h2>${flavor ? "Editar sabor" : "Adicionar ao cardápio"}</h2></div><span class="step-number">${flavor ? "✎" : "＋"}</span></div>
      <label>Nome do sabor<input name="name" maxlength="60" required value="${escapeHtml(flavor?.name ?? "")}" placeholder="Ex.: Margherita"></label>
      <label>Descrição <span class="optional-tag">opcional</span><textarea name="description" maxlength="240" rows="2" placeholder="Ingredientes ou detalhes para a cozinha">${escapeHtml(flavor?.description ?? "")}</textarea></label>
      <div class="price-fields"><span>Preço por tamanho</span><div class="price-grid">${PIZZA_SIZES.map(({ id, label, active }) => `<label>${escapeHtml(label)}${active ? "" : " · inativo"}<div class="currency-input"><span>R$</span><input name="price-${id}" inputmode="decimal" placeholder="${active ? "0,00" : "0,00 (inativo)"}" ${active ? "required" : ""} value="${flavor ? money(prices[id]).replace("R$ ", "").trim() : active ? "" : "0,00"}"></div></label>`).join("")}</div></div>
      <div class="flavor-form-actions">${flavor ? button("Cancelar edição", "cancel-flavor-edit") : ""}<button class="button button-primary" type="submit" ${busy ? "disabled" : ""}>${flavor ? "Salvar alterações" : "Salvar sabor"} <span aria-hidden="true">→</span></button></div>
    </form>`;
  }
  
  function menuPage() { return renderMenuPage(viewModel()); }

  function settingsPage() {
    settingsSizesDraft ??= snapshot.settings.pizzaSizes.map((size) => ({ ...size }));
    settingsTablesDraft ??= snapshot.settings.tables.map((table) => ({ ...table }));
    return renderSettingsPage({
      ...viewModel(),
      settingsSizesDraft,
      settingsTablesDraft,
    });
  }

  function sectionHeader(eyebrow, title, description, action = "") {
    return `<div class="page-heading"><div><p class="eyebrow">${escapeHtml(eyebrow)}</p><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></div>${action}</div>`;
  }
  
  function statCard(label, value, detail, icon, tone = "orange") {
    return metricCard({ label, value: String(value), detail, icon, tone });
  }
  
  function activeCommandForTable(tableId) {
    return snapshot.tableCommands.find((command) => command.tableId === tableId && command.closedAt === null) ?? null;
  }
  
  function tableOrders(commandId) {
    return snapshot.orders.filter((order) => order.tableCommandId === commandId);
  }
  
  function tableCommandTotalCents(commandId) {
    return tableOrders(commandId)
      .filter(({ status }) => status !== "cancelled")
      .reduce((sum, order) => sum + BigInt(order.totalCents), 0n);
  }
  
  function tableCard(table) {
    const command = activeCommandForTable(table.id);
    if (!command) {
      return `<button type="button" class="table-card table-free" data-action="open-table-command" data-table-id="${table.id}"><span class="table-card-top"><span class="table-number">${String(table.id).padStart(2, "0")}</span><span>${table.seats} lugares</span></span><strong>Livre</strong><small>Toque para abrir comanda</small></button>`;
    }
    const orders = tableOrders(command.id);
    const unfinishedOrders = orders.filter(({ status }) => !["completed", "cancelled"].includes(status));
    const canClose = unfinishedOrders.length === 0;
    const orderSummary = orders.length
      ? orders.map((order) => `${orderNumber(order)} · ${STATUS_LABELS[order.status]}`).join(" · ")
      : "Ainda sem pedidos";
    return `<article class="table-card table-occupied table-card-open"><div class="table-card-top"><span class="table-number">${String(table.id).padStart(2, "0")}</span><span>${command.guestCount}/${table.seats} pessoas</span></div><strong>${escapeHtml(command.customerName)}</strong><small data-order-age data-started-at="${escapeHtml(command.openedAt)}"><span>Aberta há</span> <b data-age-value>${formatElapsed(elapsedMinutes(command.openedAt))}</b></small><div class="table-card-summary"><span>${orders.length} ${orders.length === 1 ? "pedido" : "pedidos"}</span><strong>${money(Number(tableCommandTotalCents(command.id)))}</strong></div><p class="table-order-list">${escapeHtml(orderSummary)}</p><div class="table-card-actions">${button("Adicionar pedido", "add-command-order", { kind: "primary", extra: `data-command-id="${escapeHtml(command.id)}"` })}${button("Encerrar comanda", "close-table-command", { disabled: !canClose, extra: `data-command-id="${escapeHtml(command.id)}"` })}</div>${!canClose ? `<small class="table-close-hint">Conclua ou cancele os pedidos na Cozinha para encerrar.</small>` : ""}</article>`;
  }
  
  function openTableCommandDialog(preselectedTableId = null) {
    const availableTables = PIZZERIA_TABLES.filter(({ active, id }) => active && !activeCommandForTable(id));
    if (!availableTables.length) {
      notice = { type: "error", text: "Todas as mesas já têm uma comanda aberta." };
      renderNotice();
      return;
    }
    const select = tableOpenForm.elements.tableId;
    select.innerHTML = availableTables.map((table) => `<option value="${table.id}">Mesa ${String(table.id).padStart(2, "0")} · ${table.seats} lugares</option>`).join("");
    const selected = availableTables.find(({ id }) => String(id) === String(preselectedTableId)) ?? availableTables[0];
    select.value = String(selected.id);
    tableOpenForm.elements.customerName.value = "";
    tableOpenForm.elements.guestCount.value = String(Math.min(2, selected.seats));
    tableOpenForm.elements.guestCount.max = String(selected.seats);
    tableOpenDialog.showModal();
    tableOpenForm.elements.customerName.focus();
  }
  
  function tablesPage() { return renderTablesPage(viewModel()); }

  function deliveryPage() { return renderDeliveryPage(viewModel()); }

  function render() {
    if (destroyed || !root) return;
    PIZZA_SIZES = snapshot?.settings?.pizzaSizes ?? DEFAULT_PIZZA_SIZES.map((size) => ({ ...size, active: true }));
    PIZZERIA_TABLES = snapshot?.settings?.tables?.filter(({ active }) => active)
      ?? DEFAULT_PIZZERIA_TABLES.map((table) => ({ ...table, active: true }));
    if (!snapshot) {
      root.innerHTML = `<section class="fatal-state"><span class="fatal-mark">!</span><h1>Não foi possível abrir os dados da pizzaria</h1><p>${escapeHtml(notice?.text ?? "O armazenamento está indisponível.")}</p><small>Os dados existentes foram preservados.</small></section>`;
      return;
    }
    if (snapshot.settings === null) {
      root.innerHTML = shell(setupPage());
      return;
    }
    const page = SPACE_PENDING_VIEWS.has(activeView)
      ? renderSpaceCapabilityStatus(activeView, { labels: VIEW_LABELS, iconSvg })
      : ({ orders: ordersPage, kitchen: kitchenPage, menu: menuPage, tables: tablesPage, delivery: deliveryPage, settings: settingsPage })[activeView]();
    root.innerHTML = shell(page);
    if (activeView === "orders") {
      updateDeliveryVisibility();
      updateCartTotals();
      updatePizzaPricePreview();
    }
    refreshElapsedIndicators();
  }
  
  function refreshElapsedIndicators() {
    if (!root) return;
    const now = Date.now();
    const indicators = [...root.querySelectorAll("[data-order-age]")];
    for (const indicator of indicators) {
      const minutes = elapsedMinutes(indicator.dataset.startedAt, now);
      const target = Number(indicator.dataset.targetMinutes);
      const overdue = Number.isFinite(target) && minutes >= target;
      const value = indicator.querySelector("[data-age-value]");
      const alert = indicator.querySelector("[data-age-alert]");
      if (value) value.textContent = formatElapsed(minutes);
      if (alert) alert.hidden = !overdue;
      indicator.classList.toggle("is-overdue", overdue);
    }
    const visibleOverdueCount = indicators.filter((indicator) => indicator.classList.contains("is-overdue")).length;
    const visibleOverdueValue = root.querySelector("[data-kitchen-overdue-count]");
    if (visibleOverdueValue) visibleOverdueValue.textContent = String(visibleOverdueCount);
    const activeStatuses = new Set(["received", "preparing", "ready", "out-for-delivery"]);
    const totalOverdueCount = snapshot?.orders.filter((order) => activeStatuses.has(order.status)
      && Number.isFinite(ORDER_STAGE_ALERT_MINUTES[order.status])
      && elapsedMinutes(stageStartedAt(order), now) >= ORDER_STAGE_ALERT_MINUTES[order.status]).length ?? 0;
    const totalOverdueValue = root.querySelector("[data-kitchen-overdue-total]");
    if (totalOverdueValue) totalOverdueValue.textContent = String(totalOverdueCount);
  }
  
  function renderNotice() {
    if (destroyed) return;
    if (!root || !snapshot) {
      render();
      return;
    }
    const content = root.querySelector("#main-content");
    if (!content) return;
    content.querySelector(".toast")?.remove();
    if (!notice) return;
    const toast = document.createElement("div");
    toast.className = `toast toast-${notice.type}`;
    toast.setAttribute("role", notice.type === "error" ? "alert" : "status");
    const icon = document.createElement("span");
    icon.textContent = notice.type === "error" ? "!" : "✓";
    const text = document.createTextNode(notice.text);
    const close = document.createElement("button");
    close.type = "button";
    close.setAttribute("aria-label", "Fechar aviso");
    close.dataset.action = "dismiss-notice";
    close.textContent = "×";
    toast.append(icon, text, close);
    content.prepend(toast);
  }
  
  function updateDeliveryVisibility() {
    const form = root.querySelector("#create-order-form");
    if (!form) return;
    const delivery = form.elements.channel.value === "delivery";
    const section = root.querySelector("#delivery-fields");
    section.hidden = !delivery;
    form.elements.phone.required = delivery;
    form.elements.address.required = delivery;
    form.elements.deliveryFee.disabled = !delivery;
  }
  
  function updatePizzaPricePreview() {
    const form = root.querySelector("#add-pizza-form");
    if (!form) return;
    const price = root.querySelector("#pizza-price-preview");
    const button = form.querySelector('[data-action="add-pizza"]');
    const flavorIds = [...form.querySelectorAll('[name^="flavor"]')].map(({ value }) => value).filter(Boolean);
    const quantity = Number(form.elements.quantity.value);
    try {
      if (!flavorIds.length) throw new Error("Selecione ao menos um sabor.");
      if (new Set(flavorIds).size !== flavorIds.length) throw new Error("Escolha sabores diferentes.");
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 50) throw new Error("Confira a quantidade.");
      const unit = calculatePizzaPriceCents({ size: form.elements.size.value, flavorIds, flavors: snapshot.flavors, halfPricePolicy: snapshot.settings.halfPricePolicy, pizzaSizes: PIZZA_SIZES, maxFlavorsPerPizza: snapshot.settings.maxFlavorsPerPizza });
      price.textContent = `${money(unit)} por pizza · ${money(unit * quantity)} no total`;
      price.classList.remove("has-error");
      button.disabled = busy;
    } catch (error) {
      price.textContent = error.message;
      price.classList.add("has-error");
      button.disabled = true;
    }
  }
  
  function updateCartTotals() {
    const form = root.querySelector("#create-order-form");
    if (!form) return;
    const subtotal = cart.reduce((sum, item) => {
      if (item.type === "catalog-product") return sum + item.unitPriceCents * item.quantity;
      try {
        const unit = calculatePizzaPriceCents({ size: item.size, flavorIds: item.flavorIds, flavors: snapshot.flavors, halfPricePolicy: snapshot.settings.halfPricePolicy, pizzaSizes: PIZZA_SIZES, maxFlavorsPerPizza: snapshot.settings.maxFlavorsPerPizza });
        return sum + unit * item.quantity;
      } catch {
        return sum + item.unitPriceCents * item.quantity;
      }
    }, 0);
    const delivery = form.elements.channel.value === "delivery" ? parseMoney(form.elements.deliveryFee.value) ?? 0 : 0;
    const total = root.querySelector("#order-total-value");
    if (total) total.textContent = money(subtotal + delivery);
    const count = root.querySelector("#cart-count");
    if (count) count.textContent = `${cart.length} ${cart.length === 1 ? "item" : "itens"}`;
    const content = root.querySelector("#cart-content");
    if (content) content.innerHTML = cartHtml();
    const createButton = form.querySelector('[type="submit"]');
    if (createButton) createButton.disabled = busy || cart.length === 0;
    const feeHelp = form.querySelector('[name="deliveryFee"]')?.parentElement?.querySelector("small");
    if (feeHelp) {
      const valid = parseMoney(form.elements.deliveryFee.value) !== null;
      feeHelp.textContent = valid
        ? "Taxa padrão; ajuste neste pedido se necessário. Sem cálculo por distância."
        : "Informe um valor válido, como 8,00.";
      feeHelp.classList.toggle("field-error", !valid && form.elements.channel.value === "delivery");
    }
  }
  
  function addPizza() {
    const form = root.querySelector("#add-pizza-form");
    if (!form) return;
    const flavorIds = [...form.querySelectorAll('[name^="flavor"]')].map(({ value }) => value).filter(Boolean);
    const quantity = Number(form.elements.quantity.value);
    const unitPriceCents = calculatePizzaPriceCents({
      size: form.elements.size.value,
      flavorIds,
      flavors: snapshot.flavors,
      halfPricePolicy: snapshot.settings.halfPricePolicy,
      pizzaSizes: PIZZA_SIZES,
      maxFlavorsPerPizza: snapshot.settings.maxFlavorsPerPizza,
    });
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 50) throw new TypeError("Quantidade inválida.");
    cart.push({ id: uid(), size: form.elements.size.value, flavorIds, quantity, unitPriceCents });
    form.elements.quantity.value = "1";
    updatePizzaPricePreview();
    updateCartTotals();
  }

  function addCatalogProduct(productId) {
    const product = PREVIEW_CATALOG_PRODUCTS.find(({ id }) => id === productId);
    if (!product) throw new Error("Este produto não está disponível no catálogo da prévia.");
    const existing = cart.find((item) => item.type === "catalog-product" && item.productId === product.id);
    if (existing) {
      if (existing.quantity >= 50) throw new TypeError("O pedido permite até 50 unidades por produto.");
      existing.quantity += 1;
    } else {
      cart.push({
        id: uid(),
        type: "catalog-product",
        productId: product.id,
        name: product.name,
        category: product.category,
        quantity: 1,
        unitPriceCents: product.priceCents,
      });
    }
    updateCartTotals();
  }
  
  async function submitOrder(form) {
    if (cart.length === 0) throw new Error("Adicione ao menos uma pizza ou outro produto antes de registrar o pedido.");
    // Require renewed confirmation when another tab or settings change reprices the draft.
    // dispatch() uses the same snapshot revision as a CAS guard against changes after this review.
    const review = reviewFoodCartPrices(cart, snapshot, PREVIEW_CATALOG_PRODUCTS);
    if (review.changed) {
      cart = [...review.items];
      updateCartTotals();
      throw new Error("O preço do cardápio mudou. Confira o novo total e confirme o pedido novamente.");
    }
    const channel = form.elements.channel.value;
    const deliveryFeeCents = channel === "delivery" ? parseMoney(form.elements.deliveryFee.value) : 0;
    if (deliveryFeeCents === null) throw new TypeError("Informe uma taxa de entrega válida, como 8,00.");
    const orderId = uid();
    const saved = await dispatch({
      type: "order.create",
      payload: {
        id: orderId,
        historyId: uid(),
        createdAt: new Date().toISOString(),
        customerName: form.elements.customerName.value,
        phone: form.elements.phone.value,
        channel,
        tableCommandId: form.elements.tableCommandId.value || null,
        address: channel === "delivery" ? form.elements.address.value : null,
        deliveryFeeCents,
        notes: form.elements.notes.value,
        items: cart.map((item) => item.type === "catalog-product"
          ? { id: item.id, type: item.type, productId: item.productId, quantity: item.quantity }
          : { id: item.id, size: item.size, flavorIds: item.flavorIds, quantity: item.quantity }),
      },
    }, `Pedido ${orderNumber({ id: orderId })} registrado.`, { renderAfter: false });
    if (saved) {
      cart = [];
      form.reset();
      activeView = "orders";
      render();
    }
  }

  async function savePreviewDeliveryFee(form) {
    if (busy || destroyed) return false;
    const deliveryFeeCents = parseMoney(form?.elements.deliveryFee.value);
    if (deliveryFeeCents === null) {
      report(new TypeError("Informe uma taxa padrão válida, como 8,00."));
      return false;
    }
    busy = true;
    setBusyUI(true);
    try {
      await store.updatePreviewPreferences({ ...previewPreferences, deliveryFeeCents });
      if (destroyed) return false;
      previewPreferences = store.getPreviewPreferences();
      notice = { type: "success", text: "Taxa padrão salva para os próximos pedidos." };
      clearTimeout(noticeTimer);
      noticeTimer = setTimeout(() => {
        notice = null;
        renderNotice();
      }, 3600);
      return true;
    } catch (error) {
      if (!destroyed) notice = { type: "error", text: error instanceof Error ? error.message : "Não foi possível salvar a preferência local." };
      return false;
    } finally {
      busy = false;
      if (!destroyed) {
        setBusyUI(false);
        render();
      }
    }
  }

  function kitchenWorkflowFromForm(form, { autoDistribute = false } = {}) {
    const values = new FormData(form);
    const current = validateKitchenWorkflow(previewPreferences?.kitchenWorkflow ?? DEFAULT_KITCHEN_WORKFLOW);
    const stepCount = Number(values.get("stepCount"));
    const screenCount = Number(values.get("screenCount"));
    if (!Number.isSafeInteger(stepCount) || stepCount < 1 || stepCount > 8
      || !Number.isSafeInteger(screenCount) || screenCount < 1 || screenCount > stepCount) {
      throw new TypeError("O número de telas precisa ser menor ou igual ao número de etapas.");
    }
    const steps = Array.from({ length: stepCount }, (_, index) => {
      const old = current.steps[index];
      const label = values.get(`step-label-${index + 1}`);
      const screen = Number(values.get(`step-screen-${index + 1}`));
      const distributedScreen = Math.min(screenCount, Math.floor(index * screenCount / stepCount) + 1);
      return {
        id: String(values.get(`step-id-${index + 1}`) ?? old?.id ?? `step-${uid().replaceAll("-", "").slice(0, 12)}`),
        label: String(label ?? old?.label ?? `Etapa ${index + 1}`),
        screen: autoDistribute || !Number.isSafeInteger(screen) || screen < 1 || screen > screenCount
          ? distributedScreen
          : screen,
      };
    });
    const candidate = validateKitchenWorkflow({
      schema: KITCHEN_WORKFLOW_SCHEMA,
      revision: current.revision,
      screenCount,
      queueMode: String(values.get("queueMode") ?? current.queueMode),
      steps,
    });
    return autoDistribute ? distributeKitchenSteps(candidate, screenCount) : candidate;
  }

  async function saveKitchenWorkflowConfiguration(form) {
    if (busy || destroyed) return false;
    kitchenSetupExpanded = root.querySelector(".kitchen-display-setup")?.open ?? kitchenSetupExpanded;
    let kitchenWorkflow;
    try {
      kitchenWorkflow = saveKitchenWorkflow(
        previewPreferences?.kitchenWorkflow ?? DEFAULT_KITCHEN_WORKFLOW,
        kitchenWorkflowFromForm(form),
      );
    } catch (error) {
      report(error);
      return false;
    }
    busy = true;
    setBusyUI(true);
    try {
      await store.updatePreviewPreferences({ ...previewPreferences, kitchenWorkflow });
      if (destroyed) return false;
      previewPreferences = store.getPreviewPreferences();
      kitchenWorkflowDraft = null;
      notice = { type: "success", text: "Fluxo e telas da cozinha salvos." };
      clearTimeout(noticeTimer);
      noticeTimer = setTimeout(() => {
        notice = null;
        renderNotice();
      }, 3600);
      return true;
    } catch (error) {
      if (!destroyed) notice = { type: "error", text: error instanceof Error ? error.message : "Não foi possível salvar o fluxo da cozinha." };
      return false;
    } finally {
      busy = false;
      if (!destroyed) {
        setBusyUI(false);
        render();
      }
    }
  }

  async function handleKitchenTaskAction(target) {
    if (busy || destroyed) return;
    if (typeof store.recordKitchenTaskAction !== "function") {
      report(new Error("O contrato Food de tarefas de produção ainda não está disponível neste adapter."));
      return;
    }
    busy = true;
    setBusyUI(true);
    try {
      const action = target.dataset.taskAction;
      const orderId = target.dataset.orderId;
      const task = previewPreferences.kitchenTasks.tickets.find(({ orderId: id }) => id === orderId);
      const step = task?.steps.find(({ id }) => id === target.dataset.stepId);
      await store.recordKitchenTaskAction({
        action,
        orderId,
        stepId: target.dataset.stepId,
        screenNumber: Number(target.dataset.screenNumber),
        at: new Date().toISOString(),
        commandId: `kds-${uid()}`,
      });
      if (destroyed) return;
      snapshot = readFoodSnapshot(store);
      previewPreferences = store.getPreviewPreferences();
      notice = {
        type: "success",
        text: action === "start" ? `${step?.label ?? "Etapa"} iniciada.`
          : action === "complete" ? `${step?.label ?? "Etapa"} concluída. O pedido seguiu o fluxo.`
            : `Próximo pedido em foco; o atual voltou na ${Number(target.dataset.passBehind) === 2 ? "terceira" : "segunda"} posição.`,
      };
      clearTimeout(noticeTimer);
      noticeTimer = setTimeout(() => {
        notice = null;
        renderNotice();
      }, 3000);
    } catch (error) {
      if (!destroyed) notice = { type: "error", text: error instanceof Error ? error.message : "Não foi possível atualizar esta etapa." };
    } finally {
      busy = false;
      if (!destroyed) {
        setBusyUI(false);
        render();
      }
    }
  }

  async function copyKitchenScreenLink(target) {
    const clipboard = globalThis.navigator?.clipboard;
    if (!clipboard || typeof clipboard.writeText !== "function") {
      report(new Error("Este aparelho não permite copiar o link automaticamente. Abra o link da tela e copie o endereço do navegador."));
      return;
    }
    try {
      const currentHref = globalThis.location?.href ?? "http://localhost/";
      await clipboard.writeText(new URL(target.dataset.copyUrl, currentHref).href);
      notice = { type: "success", text: "Link da tela copiado." };
      renderNotice();
    } catch (error) {
      report(error);
    }
  }
  
  function handleClick(event) {
    const kitchenSetupSummary = event.target.closest("summary");
    if (kitchenSetupSummary?.parentElement?.classList.contains("kitchen-display-setup")) {
      kitchenSetupExpanded = !kitchenSetupExpanded;
      return;
    }
    const target = event.target.closest("button, a");
    if (!target) return;
    if (target.dataset.action === "apply-kitchen-preset") {
      try {
        kitchenWorkflowDraft = createKitchenWorkflowPreset(kitchenWorkflowConfiguration(), target.dataset.preset);
        kitchenSetupExpanded = true;
        render();
        root.querySelector(`[data-action="apply-kitchen-preset"][data-preset="${CSS.escape(target.dataset.preset)}"]`)?.focus({ preventScroll: true });
      } catch (error) {
        report(error);
      }
      return;
    }
    if (target.dataset.action === "move-kitchen-step") {
      const form = target.closest("#kitchen-layout-form");
      if (!form) return;
      try {
        const current = kitchenWorkflowFromForm(form);
        const index = Number(target.dataset.index);
        const destination = index + Number(target.dataset.delta);
        if (!Number.isSafeInteger(index) || !Number.isSafeInteger(destination)
          || index < 0 || destination < 0 || destination >= current.steps.length) return;
        const steps = [...current.steps];
        [steps[index], steps[destination]] = [steps[destination], steps[index]];
        kitchenWorkflowDraft = validateKitchenWorkflow({ ...current, steps });
        kitchenSetupExpanded = true;
        render();
        root.querySelector(`[data-action="move-kitchen-step"][data-index="${destination}"][data-delta="${-Number(target.dataset.delta)}"]`)?.focus({ preventScroll: true });
      } catch (error) {
        report(error);
      }
      return;
    }
    if (target.dataset.action === "fullscreen-kitchen") {
      const display = root.querySelector("[data-kitchen-station-screen]");
      if (!display) {
        report(new Error("A tela da estação não está disponível."));
        return;
      }
      const fallbackClass = "kitchen-display-fullscreen-fallback";
      if (root.classList?.contains(fallbackClass)) {
        root.classList.remove(fallbackClass);
        target.innerHTML = 'Tela cheia <span aria-hidden="true">⛶</span>';
        return;
      }
      if (typeof display.requestFullscreen !== "function") {
        root.classList?.add(fallbackClass);
        target.innerHTML = 'Sair da tela cheia <span aria-hidden="true">⛶</span>';
        return;
      }
      if (globalThis.document?.fullscreenElement === display
        && typeof globalThis.document.exitFullscreen === "function") {
        globalThis.document.exitFullscreen().catch(report);
        return;
      }
      display.requestFullscreen().catch(report);
      return;
    }
    if (target.dataset.action === "exit-kitchen-station") {
      activeView = "kitchen";
      const currentHref = globalThis.location?.href;
      if (currentHref && globalThis.history?.replaceState) {
        const url = new URL(currentHref);
        url.searchParams.delete("station");
        url.searchParams.delete("stationStage");
        url.searchParams.delete("screenCount");
        globalThis.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
      }
      render();
      return;
    }
    if (target.dataset.kitchenChannel) {
      if (!KITCHEN_CHANNEL_FILTERS.some(({ id }) => id === target.dataset.kitchenChannel)) return;
      kitchenChannelFilter = target.dataset.kitchenChannel;
      render();
      root.querySelector(`[data-kitchen-channel="${kitchenChannelFilter}"]`)?.focus({ preventScroll: true });
      return;
    }
    if (target.dataset.action === "toggle-kitchen-late-filter") {
      kitchenLateOnly = !kitchenLateOnly;
      render();
      root.querySelector('[data-action="toggle-kitchen-late-filter"]')?.focus({ preventScroll: true });
      return;
    }
    if (target.dataset.action === "clear-kitchen-search") {
      kitchenOrderQuery = "";
      render();
      root.querySelector("#kitchen-search")?.focus({ preventScroll: true });
      return;
    }
    if (target.dataset.action === "reset-kitchen-filters") {
      kitchenChannelFilter = "all";
      kitchenOrderQuery = "";
      kitchenLateOnly = false;
      render();
      root.querySelector("#kitchen-search")?.focus({ preventScroll: true });
      return;
    }
    if (target.dataset.view) {
      event.preventDefault();
      try {
        navigate(target.dataset.view);
        root.querySelector("#main-content")?.focus({ preventScroll: true });
      } catch (error) {
        report(error);
      }
      return;
    }
    const action = target.dataset.action;
    if (action === "dismiss-notice") {
      notice = null;
      renderNotice();
    } else if (action === "reset-order-filters") {
      orderStatusFilter = "all";
      orderChannelFilter = "all";
      render();
      root.querySelector("[data-order-status-filter]")?.focus({ preventScroll: true });
    } else if (action === "add-pizza-size") {
      settingsPage();
      const suffix = uid().replaceAll("-", "").slice(0, 12);
      settingsSizesDraft.push({ id: `custom-${suffix}`, label: "Novo tamanho", slices: 10, active: false, isDraft: true });
      render();
    } else if (action === "remove-pizza-size") {
      settingsSizesDraft = (settingsSizesDraft ?? []).filter(({ id }) => id !== target.dataset.sizeId);
      render();
    } else if (action === "add-pizzeria-table") {
      settingsPage();
      const id = Math.max(0, ...settingsTablesDraft.map(({ id: tableId }) => tableId)) + 1;
      settingsTablesDraft.push({ id, seats: 4, active: true, isDraft: true });
      render();
    } else if (action === "remove-pizzeria-table") {
      settingsTablesDraft = (settingsTablesDraft ?? []).filter(({ id }) => String(id) !== target.dataset.tableId);
      render();
    } else if (action === "add-pizza") {
      try { addPizza(); } catch (error) { report(error); }
    } else if (action === "add-catalog-product") {
      try { addCatalogProduct(target.dataset.productId); } catch (error) { report(error); }
    } else if (action === "remove-cart-item") {
      cart.splice(Number(target.dataset.index), 1);
      updateCartTotals();
    } else if (action === "edit-flavor") {
      editFlavorId = target.dataset.flavorId;
      render();
      root.querySelector("#flavor-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
      root.querySelector('#flavor-form [name="name"]')?.focus({ preventScroll: true });
    } else if (action === "cancel-flavor-edit") {
      editFlavorId = null;
      render();
    } else if (action === "toggle-flavor") {
      const flavorId = target.dataset.flavorId;
      const active = target.dataset.active === "true";
      void dispatch({
        type: "menu.flavor.availability",
        payload: { flavorId, active, at: new Date().toISOString() },
      }, active ? "Sabor disponível no cardápio." : "Sabor indisponível para novos pedidos.");
    } else if (action === "advance-order") {
      const { orderId, nextStatus: status } = target.dataset;
      void dispatch({
        type: "order.transition",
        payload: {
          orderId,
          nextStatus: status,
          historyId: uid(),
          changedAt: new Date().toISOString(),
        },
      }, `Pedido atualizado: ${STATUS_LABELS[status].toLocaleLowerCase("pt-BR")}.`);
    } else if (action === "kitchen-task-action") {
      void handleKitchenTaskAction(target);
    } else if (action === "copy-kitchen-link") {
      void copyKitchenScreenLink(target);
    } else if (action === "cancel-order") {
      cancelForm.elements.orderId.value = target.dataset.orderId;
      cancelForm.elements.reason.value = "";
      cancelDialog.showModal();
      cancelForm.elements.reason.focus();
    } else if (action === "close-cancel") {
      cancelDialog.close();
    } else if (action === "open-table-command") {
      openTableCommandDialog(target.dataset.tableId ?? null);
    } else if (action === "close-table-dialog") {
      tableOpenDialog.close();
    } else if (action === "add-command-order") {
      const command = commandById(target.dataset.commandId);
      if (!command || command.closedAt !== null) {
        notice = { type: "error", text: "Esta comanda já foi encerrada." };
        renderNotice();
        return;
      }
      if (cart.length) {
        notice = { type: "error", text: "Finalize ou limpe o pedido atual antes de iniciar um pedido para a mesa." };
        renderNotice();
        return;
      }
      activeCommandId = command.id;
      activeView = "orders";
      render();
    } else if (action === "leave-command-context") {
      if (cart.length) return;
      activeCommandId = null;
      render();
    } else if (action === "close-table-command") {
      const command = commandById(target.dataset.commandId);
      if (!command) return;
      void dispatch({
        type: "table.command.close",
        payload: { commandId: command.id, closedAt: new Date().toISOString() },
      }, `Comanda da Mesa ${String(command.tableId).padStart(2, "0")} encerrada.`);
    } else if (action === "edit-recipe") {
      const recipe = snapshot.recipes.find(({ flavorId }) => flavorId === target.dataset.flavorId);
      recipeFlavorId = target.dataset.flavorId;
      recipeDraftLines = recipe
        ? recipe.lines.map((line) => ({ ingredientId: line.ingredientId, quantityBaseBySize: { ...line.quantityBaseBySize } }))
        : [];
      render();
      root.querySelector("#recipe-editor")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (action === "add-recipe-line") {
      const ingredient = PREVIEW_INGREDIENTS.find(({ id }) => !recipeDraftLines.some((line) => line.ingredientId === id));
      if (!ingredient) return;
      recipeDraftLines.push({
        ingredientId: ingredient.id,
        quantityBaseBySize: Object.fromEntries(PIZZA_SIZES.map(({ id, active }) => [id, active ? "" : 0])),
      });
      render();
    } else if (action === "remove-recipe-line") {
      recipeDraftLines.splice(Number(target.dataset.index), 1);
      render();
    } else if (action === "close-recipe-editor") {
      recipeFlavorId = null;
      recipeDraftLines = [];
      render();
    }
  }
  
  async function handleSubmit(event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const kind = form.id;
    if (kind === "kitchen-search-form") {
      event.preventDefault();
      kitchenOrderQuery = String(new FormData(form).get("query") ?? "").trim();
      render();
      root.querySelector("#kitchen-search")?.focus({ preventScroll: true });
      return;
    }
    if (kind === "global-search") {
      event.preventDefault();
      orderQuery = String(new FormData(form).get("query") ?? "");
      activeView = "orders";
      orderStatusFilter = "all";
      orderChannelFilter = "all";
      render();
      return;
    }
    if (kind === "preview-delivery-fee-form") {
      event.preventDefault();
      if (busy) return;
      await savePreviewDeliveryFee(form);
      return;
    }
    if (kind === "kitchen-layout-form") {
      event.preventDefault();
      await saveKitchenWorkflowConfiguration(form);
      return;
    }
    if (!["setup-form", "flavor-form", "recipe-editor", "settings-form", "create-order-form", "cancel-order-form", "table-open-form"].includes(kind)) return;
    event.preventDefault();
    if (busy) return;
    try {
      if (kind === "setup-form") {
        const values = new FormData(form);
        const saved = await dispatch({
          type: "food.setup.configure",
          payload: {
            storeName: values.get("storeName"),
            halfPricePolicy: values.get("halfPricePolicy"),
          },
        }, "Pizzaria configurada. Cadastre os sabores para começar.", { renderAfter: false });
        if (saved) {
          activeView = "menu";
          render();
        }
      } else if (kind === "flavor-form") {
        const values = new FormData(form);
        const pricesCents = Object.fromEntries(PIZZA_SIZES.map(({ id }) => {
          const parsed = parseMoney(values.get(`price-${id}`));
          const size = PIZZA_SIZES.find((entry) => entry.id === id);
          if (parsed === null || (size.active && parsed === 0)) throw new TypeError(`Informe um preço válido para pizza ${size.label}.`);
          return [id, parsed];
        }));
        const flavorId = editFlavorId ?? uid();
        const saved = await dispatch({
          type: "menu.flavor.save",
          payload: {
            id: flavorId,
            name: values.get("name"),
            description: values.get("description"),
            pricesCents,
            at: new Date().toISOString(),
          },
        }, editFlavorId ? "Sabor atualizado. Os pedidos anteriores mantiveram o preço registrado." : "Sabor adicionado ao cardápio.", { renderAfter: false });
        if (saved) {
          editFlavorId = null;
          render();
        }
      } else if (kind === "recipe-editor") {
        const values = new FormData(form);
        const lines = recipeDraftLines.map((line, index) => ({
          ingredientId: values.get(`ingredient-${index}`),
          quantityBaseBySize: Object.fromEntries(PIZZA_SIZES.map(({ id }) => {
            const quantity = Number(values.get(`quantity-${index}-${id}`));
            const size = PIZZA_SIZES.find((entry) => entry.id === id);
            if (!Number.isSafeInteger(quantity) || quantity < (size.active ? 1 : 0)) throw new TypeError(`Informe uma quantidade válida para o tamanho ${size.label}.`);
            return [id, quantity];
          })),
        }));
        const saved = await dispatch({
          type: "menu.recipe.save",
          payload: {
            flavorId: recipeFlavorId,
            lines,
            at: new Date().toISOString(),
          },
        }, "Ficha técnica salva. A nova composição será aplicada aos próximos pedidos; os pedidos existentes preservam sua proposta de consumo.", { renderAfter: false });
        if (saved) {
          recipeFlavorId = null;
          recipeDraftLines = [];
          render();
        }
      } else if (kind === "settings-form") {
        const values = new FormData(form);
        const pizzaSizes = settingsSizesDraft.map(({ id }) => ({
          id,
          label: values.get(`size-label-${id}`),
          slices: Number(values.get(`size-slices-${id}`)),
          active: values.has(`size-active-${id}`),
        }));
        const tables = settingsTablesDraft.map(({ id }) => ({
          id,
          seats: Number(values.get(`table-seats-${id}`)),
          active: values.has(`table-active-${id}`),
        }));
        const activeSizeIds = new Set(pizzaSizes.filter(({ active }) => active).map(({ id }) => id));
        const maxFlavorsPerPizza = Number(values.get("maxFlavorsPerPizza"));
        if (cart.some(({ size, flavorIds }) => !activeSizeIds.has(size) || flavorIds.length > maxFlavorsPerPizza)) {
          throw new Error("Atualize ou remova os itens do carrinho antes de desativar um tamanho ou reduzir o limite de sabores.");
        }
        const saved = await dispatch({
          type: "food.settings.update",
          payload: {
            storeName: values.get("storeName"),
            halfPricePolicy: values.get("halfPricePolicy"),
            maxFlavorsPerPizza,
            pizzaSizes,
            tables,
          },
        }, "Ajustes salvos.", { renderAfter: false });
        if (saved) {
          settingsSizesDraft = null;
          settingsTablesDraft = null;
          render();
        }
      } else if (kind === "create-order-form") {
        await submitOrder(form);
      } else if (kind === "cancel-order-form") {
        const values = new FormData(form);
        const orderId = values.get("orderId");
        const saved = await dispatch({
          type: "order.transition",
          payload: {
            orderId,
            nextStatus: "cancelled",
            historyId: uid(),
            changedAt: new Date().toISOString(),
            reason: values.get("reason"),
          },
        }, `Pedido ${orderNumber({ id: orderId })} cancelado com motivo registrado.`);
        if (saved) cancelDialog.close();
      } else if (kind === "table-open-form") {
        const values = new FormData(form);
        const tableId = Number(values.get("tableId"));
        const table = PIZZERIA_TABLES.find(({ id }) => id === tableId);
        const commandId = `command-${uid()}`;
        const saved = await dispatch({
          type: "table.command.open",
          payload: {
            id: commandId,
            tableId,
            customerName: values.get("customerName"),
            guestCount: Number(values.get("guestCount")),
            openedAt: new Date().toISOString(),
          },
        }, `Comanda aberta${table ? ` na Mesa ${String(table.id).padStart(2, "0")}` : ""}.`, { renderAfter: false });
        if (saved) {
          tableOpenDialog.close();
          render();
        }
      }
    } catch (error) {
      report(error);
    }
  }
  
  function handleInput(event) {
    if (event.type === "change" && event.target.closest("#kitchen-layout-form")
      && ["screenCount", "stepCount"].includes(event.target.name)) {
      const form = event.target.closest("#kitchen-layout-form");
      try {
        kitchenSetupExpanded = root.querySelector(".kitchen-display-setup")?.open ?? kitchenSetupExpanded;
        kitchenWorkflowDraft = kitchenWorkflowFromForm(form, { autoDistribute: true });
        render();
        root.querySelector(`#${CSS.escape(event.target.id)}`)?.focus({ preventScroll: true });
      } catch (error) {
        report(error);
      }
    } else if (event.type === "change" && event.target.matches("[data-order-status-filter]")) {
      orderStatusFilter = event.target.value;
      render();
      root.querySelector("[data-order-status-filter]")?.focus({ preventScroll: true });
    } else if (event.type === "change" && event.target.matches("[data-order-channel-filter]")) {
      orderChannelFilter = event.target.value;
      render();
      root.querySelector("[data-order-channel-filter]")?.focus({ preventScroll: true });
    } else if (event.target.closest("#create-order-form")) {
      if (event.target.name === "channel") updateDeliveryVisibility();
      updateCartTotals();
    } else if (event.target.closest("#add-pizza-form")) {
      updatePizzaPricePreview();
    } else if (event.type === "change" && event.target.id === "table-open-id") {
      const table = PIZZERIA_TABLES.find(({ id }) => id === Number(event.target.value));
      if (table) {
        tableOpenForm.elements.guestCount.max = String(table.seats);
        if (Number(tableOpenForm.elements.guestCount.value) > table.seats) {
          tableOpenForm.elements.guestCount.value = String(table.seats);
        }
      }
    } else if (event.type === "change" && event.target.name.startsWith("ingredient-") && event.target.closest("#recipe-editor")) {
      const unit = event.target.selectedOptions[0]?.textContent.split("·").at(-1)?.trim() ?? "g";
      const line = event.target.closest(".recipe-line");
      for (const label of line.querySelectorAll("label[data-size]") ) label.firstChild.textContent = `${label.dataset.size} (${unit})`;
    }
  }
  
  function closeOnBackdrop(event) {
    if (event.target === event.currentTarget) event.currentTarget.close();
  }
  
  async function mount() {
    if (mounted || destroyed) throw new Error("Esta instância do OrdaX Food não pode ser montada novamente.");
    mounted = true;
    try {
      await store.initialize();
      if (destroyed) throw new Error("A interface Food foi encerrada durante a inicialização.");
      snapshot = readFoodSnapshot(store);
      previewPreferences = store.getPreviewPreferences();
      unsubscribe = store.subscribe(() => {
        if (destroyed) return;
        snapshot = readFoodSnapshot(store);
        previewPreferences = store.getPreviewPreferences();
        if (!busy) render();
      });
    } catch (error) {
      if (destroyed) throw new Error("A interface Food foi encerrada durante a inicialização.", { cause: error });
      notice = { type: "error", text: error instanceof Error ? error.message : "Armazenamento local indisponível." };
    }
    if (destroyed) throw new Error("A interface Food foi encerrada durante a inicialização.");
    root.addEventListener("click", handleClick);
    root.addEventListener("submit", handleSubmit);
    root.addEventListener("input", handleInput);
    root.addEventListener("change", handleInput);
    cancelForm.addEventListener("submit", handleSubmit);
    tableOpenForm.addEventListener("submit", handleSubmit);
    cancelDialog.addEventListener("click", handleClick);
    tableOpenDialog.addEventListener("click", handleClick);
    tableOpenDialog.addEventListener("change", handleInput);
    cancelDialog.addEventListener("click", closeOnBackdrop);
    tableOpenDialog.addEventListener("click", closeOnBackdrop);
    ageRefreshTimer = setInterval(refreshElapsedIndicators, 60000);
    render();
  }
  
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    clearTimeout(noticeTimer);
    clearInterval(ageRefreshTimer);
    unsubscribe?.();
    root.removeEventListener("click", handleClick);
    root.removeEventListener("submit", handleSubmit);
    root.removeEventListener("input", handleInput);
    root.removeEventListener("change", handleInput);
    cancelForm.removeEventListener("submit", handleSubmit);
    tableOpenForm.removeEventListener("submit", handleSubmit);
    cancelDialog.removeEventListener("click", handleClick);
    tableOpenDialog.removeEventListener("click", handleClick);
    tableOpenDialog.removeEventListener("change", handleInput);
    cancelDialog.removeEventListener("click", closeOnBackdrop);
    tableOpenDialog.removeEventListener("click", closeOnBackdrop);
    if (cancelDialog.open) cancelDialog.close?.();
    if (tableOpenDialog.open) tableOpenDialog.close?.();
    root.removeAttribute?.("aria-busy");
    root.innerHTML = "";
    cart = [];
    snapshot = null;
    notice = null;
  }
  
  function navigate(view) {
    if (destroyed) throw new Error("A interface Food já foi encerrada.");
    if (presentation === "embedded-preview") assertFoodModuleView(view);
    else if (!Object.hasOwn(VIEW_LABELS, view)) throw new TypeError("Área desconhecida do Food.");
    activeView = view;
    if (activeView !== "menu") editFlavorId = null;
    if (mounted) render();
  }

  return Object.freeze({ mount, navigate, destroy });
}
