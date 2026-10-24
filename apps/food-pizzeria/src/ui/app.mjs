import {
  PIZZA_SIZES,
  PIZZERIA_TABLES,
  calculatePizzaPriceCents,
} from "../domain/domain.mjs";
import { createFoodCommand } from "../application/commands.mjs";
import { PREVIEW_CATALOG_PRODUCTS } from "../fixtures/mock-data.mjs";
import { FOOD_RECIPE_INGREDIENT_FIXTURES } from "../fixtures/food-recipes.mjs";
import { assertFoodDataPort, readFoodSnapshot } from "../ports/food-data-port.mjs";
import { renderSpaceCapabilityStatus } from "./space-capability-status.mjs";

export function createFoodPizzeriaApp({ root, dataPort } = {}) {
  if (!root || typeof root.querySelector !== "function" || typeof root.addEventListener !== "function") {
    throw new TypeError("O host precisa fornecer o elemento de montagem do OrdaX Food.");
  }
  assertFoodDataPort(dataPort);
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
  const PREVIEW_DELIVERY_FEE_CENTS = 500;
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
  let recipeFlavorId = null;
  let recipeDraftLines = [];
  let unsubscribe = null;
  let activeView = "orders";
  let orderQuery = "";
  let orderStatusFilter = "all";
  let orderChannelFilter = "all";
  let kitchenChannelFilter = "all";
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
    const numericSuffix = order.id.match(/(\d+)$/)?.[1];
    return `#${(numericSuffix ?? order.id.replaceAll("-", "").slice(-6)).toUpperCase()}`;
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
  
  function report(error) {
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
    if (busy) return false;
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
      committed = true;
      notice = { type: "success", text: successText };
      clearTimeout(noticeTimer);
      noticeTimer = setTimeout(() => {
        notice = null;
        renderNotice();
      }, 3600);
      return true;
    } catch (error) {
      notice = { type: "error", text: error instanceof Error ? error.message : "Não foi possível salvar os dados." };
      return false;
    } finally {
      busy = false;
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
      <div class="topbar-right"><div class="preview-context" role="status"><strong>Prévia local</strong><small>Dados fictícios · sem sincronização</small></div><button type="button" class="avatar-button" aria-label="Configurações da pizzaria" data-view="settings">${escapeHtml(name.slice(0, 1).toUpperCase())}</button></div>
    </header>`;
  }
  
  function shell(content) {
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
  
  function metricCard({ label, value, detail, icon, tone = "red" }) {
    return `<article class="metric-card"><div class="metric-top"><span>${escapeHtml(label)}</span><span class="metric-icon tone-${tone}">${iconSvg(icon)}</span></div><strong class="metric-value">${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small></article>`;
  }
  
  function orderItemDescription(item) {
    const size = PIZZA_SIZES.find(({ id }) => id === item.size)?.label ?? item.size;
    const flavors = item.flavors.map(({ name }) => name).join(" + ");
    return `${item.quantity}× ${size} · ${flavors}`;
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
    const age = kitchen && alertAfter ? `<div class="order-age" data-order-age data-started-at="${escapeHtml(startedAt)}" data-target-minutes="${alertAfter}"><span>Na etapa há</span><strong data-age-value>${formatElapsed(elapsedMinutes(startedAt))}</strong><span class="age-alert" data-age-alert hidden>Acima de ${alertAfter} min</span></div>` : "";
    return `<article class="order-card ${kitchen ? "order-card-kitchen" : ""}">
      <div class="order-card-head"><div><span class="order-number">${orderNumber(order)}</span><span class="order-time">${timeLabel(order.createdAt)}</span></div><span class="status-badge status-${order.status}"><span></span>${STATUS_LABELS[order.status]}</span></div>
      <div class="order-customer"><strong>${escapeHtml(order.customerName)}</strong><span>${escapeHtml(orderChannelLabel(order))}${order.phone ? ` · ${escapeHtml(order.phone)}` : ""}</span></div>
      ${age}
      ${order.channel === "delivery" ? `<div class="order-address">${escapeHtml(order.address)}</div>` : ""}
      <ul class="order-items">${items}</ul>
      ${order.notes ? `<p class="order-note"><span>Observação</span>${escapeHtml(order.notes)}</p>` : ""}
      ${order.status === "cancelled" ? `<p class="cancel-reason">Cancelado: ${escapeHtml(lastChange.reason)}</p>` : ""}
      <div class="order-card-foot"><div><span>Total do pedido</span><strong>${money(order.totalCents)}</strong>${order.deliveryFeeCents ? `<small>Inclui ${money(order.deliveryFeeCents)} de entrega</small>` : ""}</div><div class="order-actions">${canCancel(order) ? button("Cancelar", "cancel-order", { extra: `data-order-id="${escapeHtml(order.id)}"` }) : ""}${orderAction(order)}</div></div>
    </article>`;
  }
  
  function emptyState({ icon, title, text, action = "", view = "" }) {
    return `<div class="empty-state"><span class="empty-icon" aria-hidden="true">${icon}</span><h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p>${action ? `<button type="button" class="button button-primary" data-view="${view}">${escapeHtml(action)} <span aria-hidden="true">→</span></button>` : ""}</div>`;
  }
  


  function sizeOptions(selected = "medium") {
    return PIZZA_SIZES.map(({ id, label, slices }) => `<option value="${id}" ${selected === id ? "selected" : ""}>${label} · ${slices} fatias</option>`).join("");
  }
  
  function flavorOptions(selected = "") {
    const active = snapshot.flavors.filter(({ id, active }) => active && snapshot.recipes.some((recipe) => recipe.flavorId === id));
    return `<option value="">Escolha um sabor</option>${active.map(({ id, name }) => `<option value="${escapeHtml(id)}" ${id === selected ? "selected" : ""}>${escapeHtml(name)}</option>`).join("")}`;
  }
  
  function cartHtml() {
    if (!cart.length) return `<div class="cart-empty" id="cart-empty"><span aria-hidden="true">◌</span><p>Adicione a primeira pizza ao pedido.</p></div>`;
    return `<ul class="cart-list">${cart.map((item, index) => {
      const size = PIZZA_SIZES.find(({ id }) => id === item.size)?.label;
      const flavorNames = item.flavorIds.map((id) => snapshot.flavors.find((flavor) => flavor.id === id)?.name ?? "Sabor indisponível");
      let unit = 0;
      try {
        unit = calculatePizzaPriceCents({ size: item.size, flavorIds: item.flavorIds, flavors: snapshot.flavors, halfPricePolicy: snapshot.settings.halfPricePolicy });
      } catch { unit = item.unitPriceCents; }
      return `<li class="cart-line"><div><strong>${item.quantity}× ${escapeHtml(size)}</strong><span>${escapeHtml(flavorNames.join(" + "))}</span></div><strong>${money(unit * item.quantity)}</strong><button class="icon-button" type="button" data-action="remove-cart-item" data-index="${index}" aria-label="Remover ${escapeHtml(flavorNames.join(" e "))}">×</button></li>`;
    }).join("")}</ul>`;
  }
  
  function ordersPage() {
    const activeFlavors = snapshot.flavors.filter(({ id, active }) => active && snapshot.recipes.some((recipe) => recipe.flavorId === id));
    const activeWithoutRecipe = snapshot.flavors.some(({ id, active }) => active && !snapshot.recipes.some((recipe) => recipe.flavorId === id));
    const selectedCommand = activeCommandId ? commandById(activeCommandId) : null;
    const tableCommand = selectedCommand?.closedAt === null ? selectedCommand : null;
    const commandTable = tableCommand ? PIZZERIA_TABLES.find(({ id }) => id === tableCommand.tableId) : null;
    const query = orderQuery.trim().toLocaleLowerCase("pt-BR");
    const allOrders = [...snapshot.orders];
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
          <div class="builder-title"><span class="builder-icon" aria-hidden="true">✦</span><div><strong>Pizza</strong><small>Escolha tamanho e até dois sabores.</small></div></div>
          <div class="builder-grid"><label>Tamanho<select name="size">${sizeOptions()}</select></label><label>Primeiro sabor<select name="flavor1" required>${flavorOptions()}</select></label><label class="second-flavor">Segundo sabor <span class="optional-tag">opcional</span><select name="flavor2"><option value="">Sem segundo sabor</option>${activeFlavors.map(({ id, name }) => `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`).join("")}</select></label><label>Quantidade<input name="quantity" type="number" min="1" max="50" value="1" required></label></div>
          <div class="builder-bottom"><span id="pizza-price-preview">Selecione um sabor para ver o preço.</span><button class="button button-dark" type="button" data-action="add-pizza">Adicionar pizza <span aria-hidden="true">＋</span></button></div>
        </form>` : emptyState({ icon: "◉", title: activeWithoutRecipe ? "Fichas técnicas pendentes" : "Seu cardápio ainda está vazio", text: activeWithoutRecipe ? "Cadastre as receitas dos sabores no Cardápio antes de receber pedidos para preparo." : "Cadastre sabores e preços para começar a receber pedidos.", action: activeWithoutRecipe ? "Abrir cardápio" : "Cadastrar sabores", view: "menu" })}
        <div class="cart-section"><div class="cart-heading"><strong>Itens do pedido</strong><span id="cart-count">${cart.length} ${cart.length === 1 ? "item" : "itens"}</span></div><div id="cart-content">${cartHtml()}</div></div>
        <form id="create-order-form" class="customer-form">
          <div class="cart-heading"><strong>Dados para atendimento</strong><span class="step-number step-small">02</span></div>
          <input type="hidden" name="tableCommandId" value="${escapeHtml(tableCommand?.id ?? "")}">
          ${tableCommand ? `<div class="table-order-context"><div><strong>Comanda da Mesa ${String(tableCommand.tableId).padStart(2, "0")}</strong><span>${escapeHtml(tableCommand.customerName)} · ${tableCommand.guestCount} pessoas</span></div><small>Este pedido entrará na mesma fila da cozinha e será somado à comanda.</small>${button("Sair da comanda", "leave-command-context", { disabled: cart.length > 0 })}</div><label>Grupo da mesa<input name="customerName" maxlength="80" value="${escapeHtml(tableCommand.customerName)}" readonly required></label><input type="hidden" name="channel" value="counter"><input type="hidden" name="phone" value="">` : `<label>Nome do cliente<input name="customerName" maxlength="80" placeholder="Nome para identificar o pedido" required></label><div class="builder-grid customer-grid"><label>Canal<select name="channel"><option value="pickup">Retirada</option><option value="delivery">Entrega</option><option value="counter">Balcão</option></select></label><label>Telefone <span class="optional-tag">opcional, exceto entrega</span><input name="phone" maxlength="32" inputmode="tel" placeholder="(11) 99999-9999"></label></div>`}
          <div id="delivery-fields" class="delivery-fields" hidden><label>Endereço de entrega<textarea name="address" maxlength="240" rows="2" placeholder="Rua, número, bairro e referência"></textarea></label><label>Taxa de entrega<input name="deliveryFee" inputmode="decimal" placeholder="0,00" value="${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(PREVIEW_DELIVERY_FEE_CENTS / 100)}"><small>Valor inicial fictício da prévia; não representa configuração persistente. A distância não é calculada.</small></label></div>
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
  
  function kitchenChannelButton(filter, activeOrders) {
    const count = filter.id === "all" ? activeOrders.length : activeOrders.filter(({ channel }) => channel === filter.id).length;
    return `<button class="order-filter ${kitchenChannelFilter === filter.id ? "is-active" : ""}" type="button" data-kitchen-channel="${filter.id}" aria-pressed="${kitchenChannelFilter === filter.id}">${filter.label}<span>${count}</span></button>`;
  }
  
  function kitchenPage() {
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
  
  function flavorForm() {
    const flavor = snapshot.flavors.find(({ id }) => id === editFlavorId) ?? null;
    const prices = flavor?.pricesCents ?? { small: "", medium: "", large: "" };
    return `<form id="flavor-form" class="panel flavor-form">
      <div class="panel-heading"><div><p class="eyebrow">${flavor ? "ATUALIZAR CADASTRO" : "NOVO SABOR"}</p><h2>${flavor ? "Editar sabor" : "Adicionar ao cardápio"}</h2></div><span class="step-number">${flavor ? "✎" : "＋"}</span></div>
      <label>Nome do sabor<input name="name" maxlength="60" required value="${escapeHtml(flavor?.name ?? "")}" placeholder="Ex.: Margherita"></label>
      <label>Descrição <span class="optional-tag">opcional</span><textarea name="description" maxlength="240" rows="2" placeholder="Ingredientes ou detalhes para a cozinha">${escapeHtml(flavor?.description ?? "")}</textarea></label>
      <div class="price-fields"><span>Preço por tamanho</span><div class="price-grid">${PIZZA_SIZES.map(({ id, label }) => `<label>${label}<div class="currency-input"><span>R$</span><input name="price-${id}" inputmode="decimal" placeholder="0,00" required value="${flavor ? money(prices[id]).replace("R$ ", "").trim() : ""}"></div></label>`).join("")}</div></div>
      <div class="flavor-form-actions">${flavor ? button("Cancelar edição", "cancel-flavor-edit") : ""}<button class="button button-primary" type="submit" ${busy ? "disabled" : ""}>${flavor ? "Salvar alterações" : "Salvar sabor"} <span aria-hidden="true">→</span></button></div>
    </form>`;
  }
  
  function menuPage() {
    const sorted = [...snapshot.flavors].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "pt-BR"));
    const recipeFlavor = snapshot.flavors.find(({ id }) => id === recipeFlavorId) ?? null;
    const recipeLines = recipeDraftLines;
    const recipeEditor = recipeFlavor ? `<form id="recipe-editor" class="panel recipe-editor">
      <div class="panel-heading"><div><p class="eyebrow">FICHA TÉCNICA</p><h2>${escapeHtml(recipeFlavor.name)}</h2><p>Quantidades por pizza; use g, ml ou unidades conforme o insumo.</p></div>${button("Fechar", "close-recipe-editor")}</div>
      <p class="recipe-preview-note">Os insumos desta prévia são referências fictícias. O Food calcula consumo, mas não consulta nem movimenta o Inventory.</p>
      <div class="recipe-lines">${recipeLines.map((line, index) => `<div class="recipe-line"><label>Insumo<select name="ingredient-${index}" required>${PREVIEW_INGREDIENTS.map((ingredient) => `<option value="${escapeHtml(ingredient.id)}" ${line.ingredientId === ingredient.id ? "selected" : ""}>${escapeHtml(ingredient.name)} · ${ingredient.unit}</option>`).join("")}</select></label>${PIZZA_SIZES.map(({ id, label }) => `<label data-size="${label}">${label} (${PREVIEW_INGREDIENTS.find(({ id: current }) => current === line.ingredientId)?.unit ?? "g"})<input name="quantity-${index}-${id}" type="number" min="1" step="1" value="${line.quantityBaseBySize[id] ?? ""}" required></label>`).join("")}<button class="icon-button" type="button" data-action="remove-recipe-line" data-index="${index}" aria-label="Remover insumo">×</button></div>`).join("")}</div>
      <div class="recipe-editor-actions">${button("＋ Adicionar insumo", "add-recipe-line", { kind: "quiet", disabled: PREVIEW_INGREDIENTS.length <= recipeLines.length })}<span>Custos e saldos não são exibidos sem provider Inventory.</span><button class="button button-primary" type="submit" ${busy || !recipeLines.length ? "disabled" : ""}>Salvar ficha técnica</button></div>
    </form>` : "";
    return `<section class="page-section">
      <div class="page-heading"><div><p class="eyebrow">PRODUTOS E PREÇOS</p><h1>Cardápio</h1><p>Cadastre sabores e preços; as fichas técnicas ficam registradas separadamente do saldo de estoque.</p></div><span class="heading-counter">${snapshot.flavors.filter(({ active }) => active).length} disponíveis</span></div>
      <div class="menu-layout">${flavorForm()}<section class="menu-list"><div class="panel-heading"><div><p class="eyebrow">SABORES CADASTRADOS</p><h2>Seu cardápio</h2></div><span class="column-count">${snapshot.flavors.length}</span></div>
        ${sorted.length ? `<div class="flavor-cards">${sorted.map((flavor) => {
          const recipe = snapshot.recipes.find(({ flavorId }) => flavorId === flavor.id);
          return `<article class="flavor-card ${flavor.active ? "" : "is-unavailable"}"><div class="flavor-card-top"><span class="flavor-avatar" aria-hidden="true">${escapeHtml(flavor.name.slice(0, 1).toUpperCase())}</span><div class="flavor-title"><h3>${escapeHtml(flavor.name)}</h3><span class="availability ${flavor.active ? "available" : "unavailable"}"><span></span>${flavor.active ? "Disponível" : "Indisponível"}</span></div><button class="icon-button edit-button" type="button" data-action="edit-flavor" data-flavor-id="${escapeHtml(flavor.id)}" aria-label="Editar ${escapeHtml(flavor.name)}">✎</button></div>${flavor.description ? `<p class="flavor-description">${escapeHtml(flavor.description)}</p>` : ""}<div class="flavor-prices">${PIZZA_SIZES.map(({ id, label }) => `<div><small>${label}</small><strong>${money(flavor.pricesCents[id])}</strong></div>`).join("")}</div><div class="recipe-summary"><span class="${recipe ? "recipe-ready" : "recipe-missing"}">${recipe ? "Ficha técnica cadastrada · custo sem provider Inventory" : "Ficha técnica pendente"}</span><button class="text-button" type="button" data-action="edit-recipe" data-flavor-id="${escapeHtml(flavor.id)}" aria-label="Editar ficha técnica de ${escapeHtml(flavor.name)}">${recipe ? "Editar" : "Cadastrar ficha"}</button></div><div class="flavor-card-foot"><span>Alterado ${timeLabel(flavor.updatedAt)}</span>${button(flavor.active ? "Indisponibilizar" : "Disponibilizar", "toggle-flavor", { extra: `data-flavor-id="${escapeHtml(flavor.id)}" data-active="${!flavor.active}"` })}</div></article>`;
        }).join("")}</div>` : emptyState({ icon: "◉", title: "Nenhum sabor cadastrado", text: "Adicione sabores para começar a montar pedidos." })}
      </section></div>
      ${recipeEditor}
      <section class="panel catalog-products"><div class="panel-heading"><div><p class="eyebrow">AMOSTRAS FICTÍCIAS</p><h2>Bebidas, combos e acompanhamentos</h2></div><span class="stock-status">Somente referência visual</span></div><div class="catalog-grid">${PREVIEW_CATALOG_PRODUCTS.map((product) => `<article class="catalog-row"><span class="catalog-thumb">${product.category === "Bebidas" ? "🥤" : product.category === "Sobremesas" ? "🍰" : "🧄"}</span><span><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.category)}</small></span><b>${money(product.priceCents)}</b><span class="stock-status">Amostra</span></article>`).join("")}</div></section>
    </section>`;
  }
  
  function settingsPage() {
    return `<section class="page-section settings-page">
      <div class="page-heading"><div><p class="eyebrow">CONFIGURAÇÃO DA LOJA</p><h1>Configurações</h1><p>Defina os dados da pizzaria, preços e preferências de atendimento.</p></div></div>
      <form id="settings-form" class="panel settings-form">
        <div class="panel-heading"><div><p class="eyebrow">PREFERÊNCIAS</p><h2>Dados da pizzaria</h2></div><span class="step-number">⚙</span></div>
        <label>Nome da pizzaria<input name="storeName" maxlength="80" required value="${escapeHtml(snapshot.settings.storeName)}"></label>
        <label>Regra para pizzas meio a meio<select name="halfPricePolicy"><option value="highest" ${snapshot.settings.halfPricePolicy === "highest" ? "selected" : ""}>Cobrar pelo sabor de maior preço</option><option value="average" ${snapshot.settings.halfPricePolicy === "average" ? "selected" : ""}>Usar a média dos dois sabores</option></select><small>O pedido registra a regra usada e mantém seus preços originais.</small></label>
        <button class="button button-primary" type="submit" ${busy ? "disabled" : ""}>Salvar ajustes <span aria-hidden="true">→</span></button>
      </form>
      <section class="panel capability-pending"><span class="capability-pending-mark" aria-hidden="true">${iconSvg("settings")}</span><div><strong>Preferências operacionais indisponíveis</strong><p>Horários, canais e políticas de atendimento ainda não fazem parte do estado versionado do Food. Não são exibidos como se estivessem configurados.</p></div></section>
    </section>`;
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
    const availableTables = PIZZERIA_TABLES.filter(({ id }) => !activeCommandForTable(id));
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
    tableOpenForm.elements.guestCount.value = "2";
    tableOpenForm.elements.guestCount.max = String(selected.seats);
    tableOpenDialog.showModal();
    tableOpenForm.elements.customerName.focus();
  }
  
  function tablesPage() {
    const openCommands = snapshot.tableCommands.filter(({ closedAt }) => closedAt === null);
    const occupiedTables = openCommands.length;
    const openOrders = snapshot.orders.filter((order) => order.tableCommandId
      && openCommands.some(({ id }) => id === order.tableCommandId)
      && !["completed", "cancelled"].includes(order.status));
    const freeTables = PIZZERIA_TABLES.length - occupiedTables;
    return `<section class="page-section">${sectionHeader("SALÃO", "Mesas e Comandas", "Abra comandas, vincule pedidos da cozinha e acompanhe o consumo por mesa.", button("Abrir comanda", "open-table-command", { kind: "primary", disabled: freeTables === 0 }))}
      <div class="metrics-grid three-metrics">${statCard("Mesas ocupadas", `${occupiedTables}/${PIZZERIA_TABLES.length}`, "Ocupação agora", "tables", "orange")}${statCard("Comandas abertas", openCommands.length, "Vinculadas às mesas ocupadas", "orders", "blue")}${statCard("Pedidos em andamento", openOrders.length, "Nas comandas do salão", "kitchen", "gold")}</div>
      <section class="panel tables-panel"><div class="panel-heading"><div><p class="eyebrow">MAPA DO SALÃO</p><h2>Unidade principal</h2></div><div class="table-legend"><span><i class="legend-free"></i>Livre</span><span><i class="legend-occupied"></i>Comanda aberta</span></div></div><div class="table-map">${PIZZERIA_TABLES.map(tableCard).join("")}</div><p class="table-helper">O valor e os pedidos da mesa são calculados a partir do histórico compartilhado. Para encerrar, todos os pedidos precisam estar concluídos ou cancelados.</p></section>
    </section>`;
  }
  
  function deliveryPage() {
    const deliveries = snapshot.orders.filter(({ channel, status }) => channel === "delivery" && !["completed", "cancelled"].includes(status));
    const kitchenOrders = deliveries.filter(({ status }) => ["received", "preparing"].includes(status));
    const readyOrders = deliveries.filter(({ status }) => status === "ready");
    const routeOrders = deliveries
      .filter(({ status }) => status === "out-for-delivery")
      .sort((left, right) => Date.parse(left.updatedAt) - Date.parse(right.updatedAt));
    const stagePanel = (title, eyebrow, orders, emptyTitle, emptyText) => `<section class="panel delivery-stage"><div class="panel-heading"><div><p class="eyebrow">${eyebrow}</p><h2>${title}</h2></div><span class="column-count">${orders.length}</span></div>${orders.length ? `<div class="history-list">${orders.map((order) => renderOrderCard(order)).join("")}</div>` : emptyState({ icon: iconSvg("delivery"), title: emptyTitle, text: emptyText })}</section>`;
    return `<section class="page-section">${sectionHeader("ENTREGAS", "Delivery", "Organize pedidos para despacho e acompanhe o status da entrega.", `<button class="button button-quiet" type="button" data-view="settings">Configurar delivery</button>`)}
      <div class="metrics-grid three-metrics">${statCard("Na cozinha", kitchenOrders.length, "Recebidos ou em preparo", "kitchen", "blue")}${statCard("Prontos para sair", readyOrders.length, "Aguardando despacho", "ready", "gold")}${statCard("Na rua", routeOrders.length, "Entregas não concluídas", "delivery", "green")}</div>
      ${kitchenOrders.length ? `<div class="delivery-kds-callout"><span>${kitchenOrders.length} ${kitchenOrders.length === 1 ? "pedido está" : "pedidos estão"} na fila da cozinha.</span><button class="button button-quiet" type="button" data-view="kitchen">Abrir Cozinha (KDS) →</button></div>` : ""}
      <div class="delivery-layout"><div class="delivery-stage-grid">${stagePanel("Prontos para despacho", "AGUARDANDO SAÍDA", readyOrders, "Nenhum pedido pronto", "Quando a cozinha liberar um pedido de entrega, ele aparecerá aqui.")}${stagePanel("Em rota", "ENTREGAS ATIVAS", routeOrders, "Nenhuma entrega na rua", "Marque um pedido pronto como saiu para entrega para acompanhar seu endereço aqui.")}</div><section class="panel route-panel"><div class="panel-heading"><div><p class="eyebrow">REGIÃO DE ATENDIMENTO</p><h2>Paradas em rota</h2></div><span class="column-count">${routeOrders.length}</span></div><div class="route-map" aria-label="Diagrama ilustrativo, sem geolocalização"><div class="route-street street-one"></div><div class="route-street street-two"></div><div class="route-street street-three"></div><span class="map-pin pin-shop">🍕</span><span class="map-label label-shop">Pizzaria</span><span class="map-route-count">${routeOrders.length} ${routeOrders.length === 1 ? "destino" : "destinos"} em rota</span></div><p class="route-note">Diagrama esquemático, sem GPS ou cálculo de trajeto. Use os endereços salvos nos pedidos para organizar a saída.</p>${routeOrders.length ? `<ol class="delivery-stops">${routeOrders.map((order, index) => `<li class="delivery-stop"><span class="delivery-stop-number">${String(index + 1).padStart(2, "0")}</span><div><strong>${orderNumber(order)} · ${escapeHtml(order.customerName)}</strong><small>${escapeHtml(order.address)}</small></div><span class="delivery-stop-time">${clockTime(order.updatedAt)}</span></li>`).join("")}</ol>` : emptyState({ icon: iconSvg("delivery"), title: "Sem paradas ativas", text: "Os endereços aparecerão após a saída para entrega." })}</section></div>
    </section>`;
  }
  


















  function render() {
    if (destroyed || !root) return;
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
    for (const indicator of root.querySelectorAll("[data-order-age]")) {
      const minutes = elapsedMinutes(indicator.dataset.startedAt, now);
      const target = Number(indicator.dataset.targetMinutes);
      const overdue = Number.isFinite(target) && minutes >= target;
      const value = indicator.querySelector("[data-age-value]");
      const alert = indicator.querySelector("[data-age-alert]");
      if (value) value.textContent = formatElapsed(minutes);
      if (alert) alert.hidden = !overdue;
      indicator.classList.toggle("is-overdue", overdue);
    }
  }
  
  function renderNotice() {
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
    const flavorIds = [form.elements.flavor1.value, form.elements.flavor2.value].filter(Boolean);
    const quantity = Number(form.elements.quantity.value);
    try {
      if (!flavorIds.length) throw new Error("Selecione ao menos um sabor.");
      if (flavorIds.length > 1 && flavorIds[0] === flavorIds[1]) throw new Error("Escolha dois sabores diferentes.");
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 50) throw new Error("Confira a quantidade.");
      const unit = calculatePizzaPriceCents({ size: form.elements.size.value, flavorIds, flavors: snapshot.flavors, halfPricePolicy: snapshot.settings.halfPricePolicy });
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
      try {
        const unit = calculatePizzaPriceCents({ size: item.size, flavorIds: item.flavorIds, flavors: snapshot.flavors, halfPricePolicy: snapshot.settings.halfPricePolicy });
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
        ? "Valor padrão da pizzaria; pode ser ajustado neste pedido. Não calcula distância."
        : "Informe um valor válido, como 8,00.";
      feeHelp.classList.toggle("field-error", !valid && form.elements.channel.value === "delivery");
    }
  }
  
  function addPizza() {
    const form = root.querySelector("#add-pizza-form");
    if (!form) return;
    const flavorIds = [form.elements.flavor1.value, form.elements.flavor2.value].filter(Boolean);
    const quantity = Number(form.elements.quantity.value);
    const unitPriceCents = calculatePizzaPriceCents({
      size: form.elements.size.value,
      flavorIds,
      flavors: snapshot.flavors,
      halfPricePolicy: snapshot.settings.halfPricePolicy,
    });
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 50) throw new TypeError("Quantidade inválida.");
    cart.push({ id: uid(), size: form.elements.size.value, flavorIds, quantity, unitPriceCents });
    form.elements.quantity.value = "1";
    updatePizzaPricePreview();
    updateCartTotals();
  }
  
  async function submitOrder(form) {
    if (cart.length === 0) throw new Error("Adicione ao menos uma pizza antes de registrar o pedido.");
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
        items: cart.map((item) => ({
          id: item.id,
          size: item.size,
          flavorIds: item.flavorIds,
          quantity: item.quantity,
        })),
      },
    }, `Pedido ${orderNumber({ id: orderId })} registrado.`, { renderAfter: false });
    if (saved) {
      cart = [];
      form.reset();
      activeView = "orders";
      render();
    }
  }
  
  function handleClick(event) {
    const target = event.target.closest("button, a");
    if (!target) return;
    if (target.dataset.kitchenChannel) {
      if (!KITCHEN_CHANNEL_FILTERS.some(({ id }) => id === target.dataset.kitchenChannel)) return;
      kitchenChannelFilter = target.dataset.kitchenChannel;
      render();
      root.querySelector(`[data-kitchen-channel="${kitchenChannelFilter}"]`)?.focus({ preventScroll: true });
      return;
    }
    if (target.dataset.view) {
      event.preventDefault();
      activeView = target.dataset.view;
      if (activeView !== "menu") editFlavorId = null;
      render();
      root.querySelector("#main-content")?.focus({ preventScroll: true });
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
    } else if (action === "add-pizza") {
      try { addPizza(); } catch (error) { report(error); }
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
        quantityBaseBySize: { small: "", medium: "", large: "" },
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
    if (kind === "global-search") {
      event.preventDefault();
      orderQuery = String(new FormData(form).get("query") ?? "");
      activeView = "orders";
      orderStatusFilter = "all";
      orderChannelFilter = "all";
      render();
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
          if (parsed === null || parsed === 0) throw new TypeError(`Informe um preço válido para pizza ${id === "small" ? "pequena" : id === "medium" ? "média" : "grande"}.`);
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
            if (!Number.isSafeInteger(quantity) || quantity < 1) throw new TypeError("Informe uma quantidade inteira e positiva para cada tamanho.");
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
        }, "Ficha técnica salva. A cozinha usará esta composição ao iniciar o preparo.", { renderAfter: false });
        if (saved) {
          recipeFlavorId = null;
          recipeDraftLines = [];
          render();
        }
      } else if (kind === "settings-form") {
        const values = new FormData(form);
        await dispatch({
          type: "food.settings.update",
          payload: {
            storeName: values.get("storeName"),
            halfPricePolicy: values.get("halfPricePolicy"),
          },
        }, "Ajustes salvos.");
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
    if (event.type === "change" && event.target.matches("[data-order-status-filter]")) {
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
      snapshot = readFoodSnapshot(store);
      unsubscribe = store.subscribe(() => {
        snapshot = readFoodSnapshot(store);
        if (!busy) render();
      });
    } catch (error) {
      notice = { type: "error", text: error instanceof Error ? error.message : "Armazenamento local indisponível." };
    }
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
  }
  
  return Object.freeze({ mount, destroy });
}
