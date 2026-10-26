import { assertModaPreviewPort } from "../ports/data-port.mjs";
import { escapeHtml, icon, renderCustomersPage, renderInventoryPage, renderOverviewPage, renderPosPage, renderProductStudioPage, renderProductsPage, renderReportsPage, renderReturnsPage, renderSettingsPage, renderTeamPage } from "./views.mjs";
import { deriveReturnValuePreview, money, productForSku, searchMatches, stockForSku } from "../domain/derived.mjs";
import { evaluateGarmentFit, fitDimensionsForKind } from "../domain/fit-engine.mjs";
import { buildTryOnBrief } from "../domain/fit-brief.mjs";
import { MAX_CHECKOUT_LINES, MAX_CHECKOUT_LINE_QUANTITY } from "../domain/checkout.mjs";

const MODULES = Object.freeze([
  { id: "overview", label: "Visão geral", icon: "grid", group: "LOJA" },
  { id: "pos", label: "PDV e vendas", icon: "bag", group: "LOJA" },
  { id: "products", label: "Produtos e catálogo", icon: "hanger", group: "LOJA" },
  { id: "studio", label: "Estúdio de produto", icon: "sparkle", group: "LOJA" },
  { id: "inventory", label: "Estoque", icon: "box", group: "LOJA" },
  { id: "customers", label: "Clientes", icon: "people", group: "RELACIONAMENTO" },
  { id: "returns", label: "Trocas e devoluções", icon: "return", group: "RELACIONAMENTO" },
  { id: "reports", label: "Relatórios", icon: "chart", group: "GESTÃO" },
  { id: "team", label: "Equipe", icon: "team", group: "GESTÃO" },
  { id: "settings", label: "Configurações", icon: "settings", group: "GESTÃO" },
]);

const PAGE_RENDERERS = Object.freeze({
  overview: (state, ui) => renderOverviewPage(state),
  pos: (state, ui) => renderPosPage(state, { query: ui.query, category: ui.category, cart: ui.cart, selectedVariants: ui.selectedVariants }),
  products: (state, ui) => renderProductsPage(state, ui.query, ui),
  studio: (state, ui) => renderProductStudioPage(state, { ...ui.productStudio, editFitProfileId: ui.editFitProfileId, reviewJobId: ui.reviewJobId }),
  inventory: (state, ui) => renderInventoryPage(state, ui.query),
  customers: (state, ui) => renderCustomersPage(state, ui.query, ui.selectedCustomerId),
  returns: (state, ui) => renderReturnsPage(state, ui.selectedSaleId),
  reports: (state, ui) => renderReportsPage(state, ui.reportDays),
  team: (state) => renderTeamPage(state),
  settings: (state) => renderSettingsPage(state),
});

function centsFromInput(value) {
  let normalized = String(value ?? "").trim().replace(/[R$\s]/g, "");
  if (normalized.includes(",")) normalized = normalized.replace(/\./g, "").replace(",", ".");
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Informe um preço maior que zero.");
  return Math.round(amount * 100);
}

function valuesOf(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function splitOptions(value) {
  return String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function measurementsFromForm(values, prefix, dimensions) {
  return Object.fromEntries(dimensions.map(({ key }) => [key, Number(values[prefix + key])]));
}

function navMarkup(active) {
  let previousGroup = "";
  return MODULES.map((item) => {
    const group = item.group !== previousGroup ? '<p class="nav-group-label">' + item.group + "</p>" : "";
    previousGroup = item.group;
    return group + '<button type="button" class="nav-item ' + (active === item.id ? "is-active" : "") + '" data-view="' + item.id + '" aria-current="' + (active === item.id ? "page" : "false") + '">' + icon(item.icon) + "<span>" + item.label + "</span>" + (active === item.id ? '<span class="nav-active-mark"></span>' : "") + "</button>";
  }).join("");
}

function currentTimeLabel() {
  return new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "long" }).format(new Date());
}

export function createEventScope(target) {
  if (!target || typeof target.addEventListener !== "function") {
    throw new TypeError("A UI event scope requires an event target.");
  }
  const controller = new AbortController();
  return Object.freeze({
    add(type, listener, options = {}) {
      const normalizedOptions = typeof options === "boolean" ? { capture: options } : options;
      target.addEventListener(type, listener, { ...normalizedOptions, signal: controller.signal });
    },
    dispose() {
      controller.abort();
    },
  });
}

export function sidebarFocusWrapTarget(activeIndex, itemCount, shiftKey) {
  if (!Number.isInteger(itemCount) || itemCount < 1) return null;
  if (!Number.isInteger(activeIndex) || activeIndex < 0) return shiftKey ? itemCount - 1 : 0;
  if (shiftKey && activeIndex === 0) return itemCount - 1;
  if (!shiftKey && activeIndex === itemCount - 1) return 0;
  return null;
}

export function mountModaApp({ port, root = document.querySelector("#app") } = {}) {
  if (!root) throw new TypeError("A raiz do OrdaX Moda não foi encontrada.");
  const dataPort = assertModaPreviewPort(port);
  const rootEvents = createEventScope(root);
  const ui = {
    view: "overview",
    query: "",
    category: "Todas",
    catalogCategory: "Todas",
    cart: [],
    selectedVariants: {},
    selectedCustomerId: null,
    selectedSaleId: null,
    editProductId: null,
    editFitProfileId: null,
    reviewJobId: null,
    productStudio: null,
    reportDays: 7,
    sidebarOpen: false,
    toast: "",
    toastTimer: null,
    disposed: false,
  };
  const sidebarBreakpoint = typeof window.matchMedia === "function"
    ? window.matchMedia("(max-width: 720px)")
    : null;
  let snapshot = null;
  let unsubscribe = () => {};

  function render({ preserveSearch = false } = {}) {
    if (!snapshot || ui.disposed) return;
    if (ui.view === "studio" && !ui.productStudio) {
      const product = snapshot.catalog.products.find((item) => item.active && item.fitProfile && fitDimensionsForKind(item.kind).length);
      const variant = product?.variants.find((item) => item.active);
      const model = snapshot.studio.models.find((item) => item.active);
      if (product && variant && model) {
        ui.productStudio = { productId: product.id, variantId: variant.id, modelId: model.id, references: { front: null, detail: null, back: null }, modelReferences: { front: null, side: null, back: null }, report: null, brief: null, selectedJobId: null, revisionOfJobId: null, revisionRequestNote: null };
      }
    }
    const previousSearch = preserveSearch ? root.querySelector("[data-global-search], [data-pos-search]") : null;
    const searchSelector = previousSearch?.matches("[data-pos-search]") ? "[data-pos-search]" : "[data-global-search]";
    const selectionStart = previousSearch?.selectionStart ?? null;
    const selectionEnd = previousSearch?.selectionEnd ?? null;
    const storeName = snapshot.settings.storeName;
    const activeModule = MODULES.find((item) => item.id === ui.view) ?? MODULES[0];
    const manager = snapshot.team.members.find((member) => member.status === "Ativa") ?? snapshot.team.members[0];
    const managerName = manager?.name ?? "Marina";
    const managerInitials = managerName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
    const lowStockCount = snapshot.catalog.products.filter((product) => product.active)
      .flatMap((product) => product.variants.filter((variant) => variant.active))
      .filter((variant) => stockForSku(snapshot, variant.sku) <= snapshot.settings.lowStockAt).length;
    const activeTeamSize = snapshot.team.members.filter((member) => member.status === "Ativa").length;
    const page = (PAGE_RENDERERS[ui.view] ?? PAGE_RENDERERS.overview)(snapshot, ui);
    root.innerHTML =
      '<div class="space-shell ' + (ui.sidebarOpen ? "sidebar-open" : "") + '">' +
        '<aside id="store-navigation" class="space-sidebar"' + (ui.sidebarOpen ? ' role="dialog" aria-modal="true" tabindex="-1"' : '') + ' aria-label="Navegação da loja">' +
          '<div class="sidebar-brand-row"><a class="brand-lockup" href="#" data-view="overview" aria-label="OrdaX Moda, visão geral"><span class="brand-symbol">' + icon("hanger") + '</span><span class="brand-type"><strong>OrdaX</strong><small>MODA</small></span></a><button type="button" class="sidebar-close" data-action="menu-close" aria-label="Fechar navegação">×</button></div>' +
          '<div class="store-switcher"><span class="store-avatar">A</span><span><small>LOJA ATUAL</small><strong>' + escapeHtml(storeName) + '</strong></span><span class="switch-chevron">⌄</span></div>' +
          '<nav class="space-nav">' + navMarkup(ui.view) + '</nav>' +
          '<div class="sidebar-bottom"><div class="plan-card"><span class="plan-gem">' + icon("people") + '</span><div><strong>Equipe da loja</strong><small>' + activeTeamSize + (activeTeamSize === 1 ? ' pessoa ativa' : ' pessoas ativas') + '</small></div><span class="plan-arrow">↗</span></div><div class="sidebar-foot"><span class="presence-dot"></span><span>Unidade <strong>' + escapeHtml(snapshot.settings.unitName) + '</strong></span></div></div>' +
        '</aside>' +
        '<div class="sidebar-scrim" data-action="menu-close"></div>' +
        '<div class="space-content"' + (ui.sidebarOpen ? " inert" : "") + '>' +
          '<header class="topbar"><button type="button" class="mobile-menu" data-action="menu-toggle" aria-controls="store-navigation" aria-expanded="' + (ui.sidebarOpen ? "true" : "false") + '" aria-label="' + (ui.sidebarOpen ? 'Fechar navegação' : 'Abrir navegação') + '">' + (ui.sidebarOpen ? "×" : "☰") + '</button><div class="topbar-context"><span class="context-mark">A</span><span><strong>' + escapeHtml(storeName) + '</strong><small>' + escapeHtml(activeModule.label) + '</small></span></div><form class="quick-search" data-form="quick-search"><span>' + icon("search") + '</span><input name="query" type="search" placeholder="Buscar produtos, clientes ou SKU" aria-label="Buscar na loja"><kbd>/</kbd></form><span class="topbar-date">' + escapeHtml(currentTimeLabel()) + '</span><button class="notification-button" type="button" data-view="inventory" aria-label="Ver ' + lowStockCount + (lowStockCount === 1 ? ' variante' : ' variantes') + ' com estoque baixo">' + icon("bell") + (lowStockCount ? '<span class="notification-count">' + lowStockCount + '</span>' : '') + '</button><button class="profile-button" type="button" data-view="settings"><span class="profile-avatar">' + escapeHtml(managerInitials || "M") + '</span><span><strong>' + escapeHtml(managerName) + '</strong><small>' + escapeHtml(manager?.role ?? "Equipe") + '</small></span><span class="switch-chevron">⌄</span></button></header>' +
          '<main id="main-content" class="main-content" tabindex="-1">' + page + '</main>' +
          '<div class="toast" role="status" aria-live="polite" ' + (ui.toast ? "" : "hidden") + '>' + escapeHtml(ui.toast) + "</div>" +
        '</div>' +
      '</div>';
    syncReturnForm();
    if (preserveSearch && selectionStart !== null) {
      const next = root.querySelector(searchSelector);
      next?.focus();
      if (typeof next?.setSelectionRange === "function") next.setSelectionRange(selectionStart, selectionEnd);
    }
    if (ui.toast) {
      clearTimeout(ui.toastTimer);
      ui.toastTimer = setTimeout(() => {
        ui.toast = "";
        const toast = root.querySelector(".toast");
        if (toast) toast.hidden = true;
      }, 3200);
    }
  }

  function notify(message) {
    ui.toast = message;
    render();
  }

  function syncReturnForm() {
    const form = root.querySelector('form[data-form="return"]');
    if (!form) return;
    const itemSelect = form.querySelector("[data-return-sku]");
    const quantityInput = form.querySelector("[data-return-quantity]");
    const maxReturnable = Number(itemSelect?.selectedOptions[0]?.dataset.returnable) || 0;
    if (quantityInput) {
      const limit = Math.max(1, maxReturnable);
      quantityInput.max = String(limit);
      quantityInput.disabled = maxReturnable < 1;
      quantityInput.value = String(Math.min(limit, Math.max(1, Number(quantityInput.value) || 1)));
    }

    const replacementSelect = form.querySelector("[data-return-replacement]");
    const typeSelect = form.querySelector("[data-return-type]");
    const estimateOutput = form.querySelector("[data-return-value-preview]");
    const estimate = deriveReturnValuePreview(snapshot, {
      saleId: form.querySelector("[data-return-sale]")?.value,
      sku: itemSelect?.value,
      quantity: Number(quantityInput?.value) || 1,
      type: typeSelect?.value,
      replacementSku: replacementSelect?.value,
    });
    if (estimateOutput) {
      let message = "";
      if (estimate?.status === "reference-only") {
        message = "Valor original da peça: " + money(estimate.returnedValueCents) + ". Estorno não processado; depende do serviço de pagamentos.";
      } else if (estimate?.status === "choose-replacement") {
        message = "Valor original da peça: " + money(estimate.returnedValueCents) + ". Selecione a substituta para calcular a diferença.";
      } else if (estimate?.status === "replacement-unavailable") {
        message = "A variante substituta precisa estar ativa e ter saldo suficiente.";
      } else if (estimate?.status === "ready") {
        const difference = estimate.direction === "collect"
          ? "Cliente paga " + money(estimate.differenceCents)
          : estimate.direction === "credit"
            ? "Crédito de " + money(Math.abs(estimate.differenceCents)) + " para o cliente"
            : "Troca sem diferença de valor";
        message = "Devolvida: " + money(estimate.returnedValueCents) + " · substituta: " + money(estimate.replacementValueCents) + " · " + difference + ". Nenhum pagamento ou estorno foi processado.";
      }
      estimateOutput.hidden = !message;
      estimateOutput.textContent = message;
    }
    if (!replacementSelect) return;
    replacementSelect.required = typeSelect?.value === "exchange";
    const quantity = Math.max(1, Number(quantityInput?.value) || 1);
    for (const option of replacementSelect.options) {
      if (!option.value) continue;
      const stock = Number(option.dataset.stock) || 0;
      option.disabled = option.value === itemSelect?.value || stock < quantity;
    }
    if (replacementSelect.selectedOptions[0]?.disabled) replacementSelect.value = "";
    const hasAvailableReplacement = [...replacementSelect.options].some((option) => option.value && !option.disabled);
    const hint = form.querySelector("[data-replacement-hint]");
    if (hint) {
      hint.textContent = hasAvailableReplacement
        ? "As opções consideram o saldo atual e excluem a peça devolvida."
        : "Nenhuma variante diferente tem saldo suficiente para essa quantidade.";
    }
  }

  function switchView(view) {
    if (!PAGE_RENDERERS[view]) return;
    if (ui.view === "studio" && view !== "studio") clearProductStudio();
    ui.editFitProfileId = null;
    ui.editProductId = null;
    ui.view = view;
    ui.query = "";
    ui.sidebarOpen = false;
    render();
    root.querySelector("#main-content")?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function setSidebarOpen(open, { returnFocus = false } = {}) {
    const isMobile = sidebarBreakpoint?.matches ?? window.innerWidth <= 720;
    ui.sidebarOpen = Boolean(open && isMobile);
    render();
    if (ui.sidebarOpen) {
      root.querySelector("#store-navigation .nav-item.is-active")?.focus({ preventScroll: true });
    } else if (returnFocus && isMobile) {
      root.querySelector(".mobile-menu")?.focus({ preventScroll: true });
    }
  }

  function releasePhotoReferences(references) {
    for (const photo of Object.values(references ?? {})) {
      if (photo?.url) URL.revokeObjectURL(photo.url);
    }
  }

  function releaseStudioReferences() {
    releasePhotoReferences(ui.productStudio?.references);
    releasePhotoReferences(ui.productStudio?.modelReferences);
  }

  function clearProductStudio() {
    releaseStudioReferences();
    ui.productStudio = null;
  }

  function showDialog(id) {
    const dialog = root.querySelector("#" + id);
    if (dialog && !dialog.open) dialog.showModal();
  }

  function openProductStudio(productId) {
    clearProductStudio();
    const product = snapshot.catalog.products.find((item) => item.id === productId);
    const variant = product?.variants.find((item) => item.active);
    const model = snapshot.studio.models.find((item) => item.active);
    if (!product?.fitProfile || !variant || !model) return;
    ui.editFitProfileId = null;
    ui.productStudio = {
      productId,
      variantId: variant.id,
      modelId: model.id,
      references: { front: null, detail: null, back: null },
      modelReferences: { front: null, side: null, back: null },
      report: evaluateGarmentFit({ product, variant, bodyMeasurements: model.measurements }),
      brief: null,
      selectedJobId: null,
      revisionOfJobId: null,
      revisionRequestNote: null,
    };
    ui.view = "studio";
    ui.query = "";
    ui.sidebarOpen = false;
    render();
    root.querySelector("#main-content")?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function selectedStudioInputs() {
    const session = ui.productStudio;
    if (!session) return null;
    const product = snapshot.catalog.products.find((item) => item.id === session.productId && item.active);
    const variant = product?.variants.find((item) => item.id === session.variantId && item.active);
    const model = snapshot.studio.models.find((item) => item.id === session.modelId && item.active);
    return product?.fitProfile && variant && model ? { product, variant, model } : null;
  }

  function updateStudioAnalysis() {
    const selected = selectedStudioInputs();
    if (!selected) return false;
    const { product, variant, model } = selected;
    const report = evaluateGarmentFit({ product, variant, bodyMeasurements: model.measurements });
    ui.productStudio.report = report;
    ui.productStudio.brief = report.status === "ready" ? buildTryOnBrief({ product, variant, model, report }) : null;
    ui.productStudio.selectedJobId = null;
    return report.status === "ready";
  }

  async function execute(type, payload, successMessage) {
    try {
      const result = await dataPort.execute({ type, payload });
      if (successMessage) notify(successMessage);
      else render();
      return result;
    } catch (error) {
      notify(error instanceof Error ? error.message : "Não foi possível concluir esta ação.");
      return null;
    }
  }

  function cartAdd(productId) {
    const product = snapshot.catalog.products.find((item) => item.id === productId);
    if (!product) return;
    const sku = ui.selectedVariants[productId] ?? product.variants.find((variant) => stockForSku(snapshot, variant.sku) > 0)?.sku;
    const found = sku ? productForSku(snapshot, sku) : null;
    if (!found || stockForSku(snapshot, sku) <= ui.cart.filter((line) => line.sku === sku).reduce((sum, line) => sum + line.quantity, 0)) {
      notify("Não há saldo disponível para esta variante.");
      return;
    }
    const line = ui.cart.find((item) => item.sku === sku);
    if (line && line.quantity >= MAX_CHECKOUT_LINE_QUANTITY) { notify("Cada variante aceita até 10.000 unidades por venda."); return; }
    if (!line && ui.cart.length >= MAX_CHECKOUT_LINES) { notify("O carrinho aceita até 64 variantes diferentes por venda."); return; }
    if (line) line.quantity += 1;
    else ui.cart.push({ sku, quantity: 1 });
    render();
  }

  rootEvents.add("click", async (event) => {
    const viewButton = event.target.closest("[data-view]");
    if (viewButton) {
      event.preventDefault();
      switchView(viewButton.dataset.view);
      return;
    }
    const customerButton = event.target.closest("[data-customer-id]");
    if (customerButton) {
      ui.selectedCustomerId = customerButton.dataset.customerId;
      render();
      return;
    }
    const categoryButton = event.target.closest("[data-pos-category]");
    if (categoryButton) {
      ui.category = categoryButton.dataset.posCategory;
      render();
      return;
    }
    const catalogCategoryButton = event.target.closest("[data-catalog-category]");
    if (catalogCategoryButton) {
      ui.catalogCategory = catalogCategoryButton.dataset.catalogCategory;
      render({ preserveSearch: true });
      return;
    }
    const actionButton = event.target.closest("[data-action]");
    if (!actionButton) return;
    const action = actionButton.dataset.action;
    if (action === "menu-toggle") { setSidebarOpen(!ui.sidebarOpen, { returnFocus: ui.sidebarOpen }); return; }
    if (action === "menu-close") { setSidebarOpen(false, { returnFocus: true }); return; }
    if (action === "goto-pos") { switchView("pos"); return; }
    if (action === "cart-add") { cartAdd(actionButton.dataset.productId); return; }
    if (action === "cart-remove" || action === "cart-dec" || action === "cart-inc") {
      const line = ui.cart.find((item) => item.sku === actionButton.dataset.sku);
      if (!line) return;
      if (action === "cart-remove" || (action === "cart-dec" && line.quantity <= 1)) ui.cart = ui.cart.filter((item) => item !== line);
      else if (action === "cart-dec") line.quantity -= 1;
      else if (line.quantity >= MAX_CHECKOUT_LINE_QUANTITY) { notify("Cada variante aceita até 10.000 unidades por venda."); return; }
      else if (stockForSku(snapshot, line.sku) > line.quantity) line.quantity += 1;
      else { notify("A quantidade supera o saldo disponível."); return; }
      render();
      return;
    }
    if (action === "show-checkout") { root.querySelector("#checkout-dialog")?.showModal(); return; }
    if (action === "show-product-dialog") { root.querySelector("#product-dialog")?.showModal(); return; }
    if (action === "product-edit") {
      ui.editProductId = actionButton.dataset.productId;
      render();
      showDialog("product-edit-dialog");
      return;
    }
    if (action === "show-customer-dialog") { root.querySelector("#customer-dialog")?.showModal(); return; }
    if (action === "fit-profile-open") {
      ui.editFitProfileId = actionButton.dataset.productId;
      render();
      showDialog("fit-profile-dialog");
      return;
    }
    if (action === "studio-open") { openProductStudio(actionButton.dataset.productId); return; }
    if (action === "studio-analyze") {
      if (!selectedStudioInputs()) { notify("Escolha uma peça com ficha de caimento, uma variante e um perfil ativo."); return; }
      if (!updateStudioAnalysis()) { notify(ui.productStudio.report?.message ?? "Confira a ficha da peça e as medidas do perfil."); return; }
      notify("Caimento analisado pelas medidas cadastradas no preview local.");
      return;
    }
    if (action === "studio-preview-create") {
      const selected = selectedStudioInputs();
      if (!selected) { notify("Escolha uma peça, uma variante e um perfil ativos antes de criar a prévia."); return; }
      if (ui.productStudio.report?.status !== "ready") { notify(ui.productStudio.report?.message ?? "Analise o caimento antes de criar uma prévia."); return; }
      const result = await execute("studio.preview.create", {
        productId: selected.product.id, variantId: selected.variant.id, modelId: selected.model.id,
        revisionOfJobId: ui.productStudio.revisionOfJobId ?? null,
      });
      if (result) {
        ui.productStudio.selectedJobId = result.result.id;
        ui.productStudio.revisionOfJobId = null;
        ui.productStudio.revisionRequestNote = null;
        ui.productStudio.report = result.result.contextSnapshot?.fitReport
          ?? evaluateGarmentFit({ product: selected.product, variant: selected.variant, bodyMeasurements: selected.model.measurements });
        ui.productStudio.brief = result.result.contextSnapshot?.brief
          ?? buildTryOnBrief({ ...selected, report: ui.productStudio.report });
        notify("Ilustração local registrada. Nenhum serviço de IA foi chamado.");
      }
      return;
    }
    if (action === "studio-job-open") {
      const job = snapshot.studio.jobs.find((item) => item.id === actionButton.dataset.jobId);
      const context = job?.contextSnapshot;
      const product = snapshot.catalog.products.find((item) => item.id === job?.productId) ?? context?.product;
      const model = snapshot.studio.models.find((item) => item.id === job?.modelId) ?? context?.model;
      if (!job || !product || !model || (!product.fitProfile && !context?.product?.fitProfile)) return;
      clearProductStudio();
      ui.productStudio = {
        productId: product.id, variantId: job.variantId, modelId: model.id,
        references: { front: null, detail: null, back: null },
        modelReferences: { front: null, side: null, back: null },
        report: context?.fitReport ?? null, brief: context?.brief ?? null, selectedJobId: job.id,
        revisionOfJobId: null, revisionRequestNote: null,
      };
      if (!context) updateStudioAnalysis();
      render();
      return;
    }
    if (action === "studio-revise") {
      const parent = snapshot.studio.jobs.find((item) => item.id === actionButton.dataset.jobId);
      const product = snapshot.catalog.products.find((item) => item.id === parent?.productId && item.active && item.fitProfile);
      const variant = product?.variants.find((item) => item.id === parent?.variantId && item.active)
        ?? product?.variants.find((item) => item.active);
      const model = snapshot.studio.models.find((item) => item.id === parent?.modelId && item.active)
        ?? snapshot.studio.models.find((item) => item.active);
      if (!parent || parent.reviews?.[0]?.decision !== "changes-requested" || !product || !variant || !model) {
        notify("Não foi possível iniciar uma versão. Confira se produto, variante e perfil continuam ativos.");
        return;
      }
      clearProductStudio();
      ui.productStudio = {
        productId: product.id,
        variantId: variant.id,
        modelId: model.id,
        references: { front: null, detail: null, back: null },
        modelReferences: { front: null, side: null, back: null },
        report: null,
        brief: null,
        selectedJobId: null,
        revisionOfJobId: parent.id,
        revisionRequestNote: parent.reviews[0].note,
      };
      ui.view = "studio";
      ui.query = "";
      ui.sidebarOpen = false;
      notify("Nova versão iniciada. Reanalise o caimento e gere outra ilustração para revisar.");
      return;
    }
    if (action === "studio-review-open") {
      ui.reviewJobId = actionButton.dataset.jobId;
      render();
      showDialog("studio-review-dialog");
      return;
    }
    if (action === "studio-add-model") { showDialog("studio-model-dialog"); return; }
    if (action === "close-dialog") {
      const dialog = actionButton.closest("dialog");
      if (dialog?.id === "fit-profile-dialog") ui.editFitProfileId = null;
      if (dialog?.id === "product-edit-dialog") ui.editProductId = null;
      if (dialog?.id === "studio-review-dialog") ui.reviewJobId = null;
      dialog?.close();
      if (["fit-profile-dialog", "product-edit-dialog", "studio-model-dialog", "studio-review-dialog"].includes(dialog?.id)) render();
      return;
    }
    if (action === "product-toggle") {
      const product = snapshot.catalog.products.find((item) => item.id === actionButton.dataset.productId);
      await execute("catalog.toggle", { productId: actionButton.dataset.productId }, product?.active ? "Produto arquivado do catálogo." : "Produto reativado.");
      return;
    }
    if (action === "reset-preview") {
      if (window.confirm("Restaurar os dados iniciais da Ateliê Aurora neste navegador?")) {
        ui.cart = [];
        ui.selectedCustomerId = null;
        ui.selectedSaleId = null;
        await execute("preview.reset", {}, "Dados iniciais restaurados.");
      }
      return;
    }
    if (action === "report-days") { ui.reportDays = Number(actionButton.dataset.days) === 30 ? 30 : 7; render(); }
  });

  rootEvents.add("close", (event) => {
    if (event.target?.id === "fit-profile-dialog") ui.editFitProfileId = null;
    if (event.target?.id === "product-edit-dialog") ui.editProductId = null;
    if (event.target?.id === "studio-review-dialog") ui.reviewJobId = null;
  }, true);

  rootEvents.add("input", (event) => {
    if (event.target.matches("[data-return-quantity]")) {
      syncReturnForm();
      return;
    }
    const search = event.target.closest("[data-global-search], [data-pos-search]");
    if (search) {
      ui.query = search.value;
      render({ preserveSearch: true });
      return;
    }
  });

  rootEvents.add("change", (event) => {
    const target = event.target;
    if (target.matches("[data-pos-sku]")) {
      const product = snapshot.catalog.products.find((item) => item.id === target.dataset.posSku && item.active);
      const variant = product?.variants.find((item) => item.sku === target.value && item.active && stockForSku(snapshot, item.sku) > 0);
      if (!product || !variant) return;
      ui.selectedVariants[product.id] = variant.sku;
      const price = [...root.querySelectorAll("[data-product-price]")]
        .find((item) => item.dataset.productPrice === product.id);
      if (price) price.textContent = money(variant.priceCents);
      const quantityInCart = ui.cart.filter((line) => line.sku === variant.sku)
        .reduce((sum, line) => sum + line.quantity, 0);
      const availableForSale = Math.max(0, stockForSku(snapshot, variant.sku) - quantityInCart);
      const variantSummary = [...root.querySelectorAll("[data-variant-summary]")]
        .find((item) => item.dataset.variantSummary === product.id);
      if (variantSummary) variantSummary.textContent = "SKU " + variant.sku + " · saldo para este pedido: " + availableForSale + " un.";
      const addButton = [...root.querySelectorAll('[data-action="cart-add"]')]
        .find((item) => item.dataset.productId === product.id);
      if (addButton) addButton.disabled = availableForSale < 1;
      return;
    }
    if (target.matches("[data-product-category]")) {
      const kindField = root.querySelector("[data-product-kind-field]");
      if (kindField) kindField.hidden = target.value !== "Roupas";
      return;
    }
    if (target.matches("[data-studio-product]")) {
      if (!ui.productStudio) return;
      const product = snapshot.catalog.products.find((item) => item.id === target.value && item.active && item.fitProfile);
      const variant = product?.variants.find((item) => item.active);
      if (!product || !variant) return;
      ui.productStudio.productId = product.id;
      ui.productStudio.variantId = variant.id;
      releasePhotoReferences(ui.productStudio.references);
      ui.productStudio.references = { front: null, detail: null, back: null };
      updateStudioAnalysis();
      render();
      return;
    }
    if (target.matches("[data-studio-variant]")) {
      if (!ui.productStudio) return;
      ui.productStudio.variantId = target.value;
      updateStudioAnalysis();
      render();
      return;
    }
    if (target.matches("[data-studio-model]")) {
      if (!ui.productStudio) return;
      releasePhotoReferences(ui.productStudio.modelReferences);
      ui.productStudio.modelReferences = { front: null, side: null, back: null };
      ui.productStudio.modelId = target.value;
      updateStudioAnalysis();
      render();
      return;
    }
    if (target.matches("[data-studio-photo]")) {
      const file = target.files?.[0];
      if (!file || !ui.productStudio) return;
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 12 * 1024 * 1024) {
        target.value = "";
        notify("Use uma imagem JPEG, PNG ou WebP de até 12 MB.");
        return;
      }
      const slot = target.dataset.studioPhoto;
      const previous = ui.productStudio.references[slot];
      if (previous?.url) URL.revokeObjectURL(previous.url);
      const url = URL.createObjectURL(file);
      ui.productStudio.references[slot] = { file, url };
      updateStudioAnalysis();
      render();
      return;
    }
    if (target.matches("[data-studio-model-photo]")) {
      const file = target.files?.[0];
      if (!file || !ui.productStudio) return;
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 12 * 1024 * 1024) {
        target.value = "";
        notify("Use uma imagem JPEG, PNG ou WebP de até 12 MB.");
        return;
      }
      const slot = target.dataset.studioModelPhoto;
      ui.productStudio.modelReferences = ui.productStudio.modelReferences ?? { front: null, side: null, back: null };
      const previous = ui.productStudio.modelReferences[slot];
      if (previous?.url) URL.revokeObjectURL(previous.url);
      ui.productStudio.modelReferences[slot] = { file, url: URL.createObjectURL(file) };
      updateStudioAnalysis();
      render();
      return;
    }
    if (target.matches("[data-return-sale]")) {
      ui.selectedSaleId = target.value;
      render();
      return;
    }
    if (target.matches("[data-return-sku], [data-return-quantity], [data-return-replacement]")) {
      syncReturnForm();
      return;
    }
    if (target.matches("[data-return-type]")) {
      const field = root.querySelector(".replacement-field");
      if (field) field.hidden = target.value !== "exchange";
      syncReturnForm();
      return;
    }
    if (target.matches("[data-report-days]")) {
      ui.reportDays = Number(target.value) === 30 ? 30 : 7;
      render();
      return;
    }
    if (target.matches("[data-review-decision]")) {
      const note = root.querySelector("[data-review-note]");
      const hint = root.querySelector("[data-review-note-hint]");
      const required = target.value === "changes-requested";
      if (note) note.required = required;
      if (hint) hint.textContent = required ? "obrigatório · explique o ajuste" : "opcional para aprovação";
    }
  });

  rootEvents.add("submit", async (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    event.preventDefault();
    const formType = form.dataset.form;
    if (formType === "quick-search") {
      const data = valuesOf(form);
      const query = String(data.query ?? "").trim();
      const productMatch = snapshot.catalog.products.some((product) =>
        searchMatches(query, product.name + " " + product.category + " " + product.variants.map((variant) => variant.sku + " " + variant.color + " " + variant.size).join(" ")));
      const customerMatch = snapshot.customers.records.some((customer) =>
        searchMatches(query, customer.name + " " + customer.phone + " " + customer.email));
      switchView(customerMatch && !productMatch ? "customers" : "products");
      ui.query = query;
      render();
      return;
    }
    const values = valuesOf(form);
    let result = null;
    if (formType === "studio-review") {
      ui.reviewJobId = null;
      result = await execute("studio.preview.review", {
        jobId: form.dataset.jobId,
        decision: values.decision,
        note: values.note,
      });
      if (result) notify(values.decision === "approved" ? "Conteúdo aprovado nesta revisão local." : "Ajustes registrados nesta revisão local.");
      return;
    } else if (formType === "fit-profile") {
      const product = snapshot.catalog.products.find((item) => item.id === form.dataset.productId);
      if (!product) return;
      const dimensions = fitDimensionsForKind(product.kind);
      const sizes = [...new Set(product.variants.map((variant) => variant.size))];
      const measurementsBySize = Object.fromEntries(sizes.map((size) => [size, Object.fromEntries(dimensions.map(({ key }) => [
        key, Number(values["measure__" + size + "__" + key]),
      ]))]));
      const easeByMeasurementCm = measurementsFromForm(values, "ease__", dimensions);
      result = await execute("catalog.fit-profile.save", {
        productId: product.id,
        fabric: values.fabric,
        cut: values.cut,
        stretchPercent: Number(values.stretchPercent),
        measurementsBySize,
        easeByMeasurementCm,
      }, "Ficha de tecido e caimento salva no catálogo local.");
      if (result) {
        ui.editFitProfileId = null;
        if (ui.view === "studio") updateStudioAnalysis();
        render();
      }
    } else if (formType === "checkout") {
      if (!ui.cart.length) return;
      result = await execute("sale.complete", { lines: ui.cart.map(({ sku, quantity }) => ({ sku, quantity })), customerId: values.customerId || null }, "Venda registrada e estoque atualizado.");
      if (result) { ui.cart = []; ui.view = "pos"; render(); }
    } else if (formType === "product-edit") {
      const product = snapshot.catalog.products.find((item) => item.id === form.dataset.productId);
      if (!product) { notify("Produto não encontrado no catálogo."); return; }
      let pricesByVariantId;
      try {
        pricesByVariantId = Object.fromEntries(product.variants.map((variant) => [
          variant.id, centsFromInput(values["price__" + variant.id]),
        ]));
      } catch (error) {
        notify(error instanceof Error ? error.message : "Confira os preços das variantes.");
        return;
      }
      result = await execute("catalog.update", {
        productId: product.id,
        name: values.name,
        description: values.description,
        pricesByVariantId,
      }, "Informações e preços atualizados no catálogo local.");
      if (result) { ui.editProductId = null; render(); }
    } else if (formType === "product") {
      let priceCents;
      try {
        priceCents = centsFromInput(values.price);
      } catch (error) {
        notify(error instanceof Error ? error.message : "Informe um preço válido.");
        return;
      }
      result = await execute("catalog.create", {
        name: values.name, category: values.category, description: values.description,
        kind: values.kind,
        priceCents, initialStock: Number(values.initialStock || 0),
        sizes: splitOptions(values.sizes), colors: splitOptions(values.colors),
      }, "Produto e variantes adicionados ao catálogo.");
      if (result) {
        ui.query = "";
        const product = result.result;
        ui.editFitProfileId = fitDimensionsForKind(product.kind).length ? product.id : null;
        render();
        if (ui.editFitProfileId) showDialog("fit-profile-dialog");
      }
    } else if (formType === "inventory") {
      result = await execute("inventory.receive", { sku: values.sku, quantity: Number(values.quantity) }, "Entrada registrada no saldo da variante.");
    } else if (formType === "customer") {
      result = await execute("customer.create", { name: values.name, phone: values.phone, email: values.email }, "Cliente adicionada ao cadastro.");
      if (result) { ui.selectedCustomerId = result.result.id; ui.query = ""; render(); }
    } else if (formType === "return") {
      result = await execute("return.create", {
        saleId: values.saleId, sku: values.sku, quantity: Number(values.quantity),
        type: values.type, condition: values.condition, reason: values.reason,
        replacementSku: values.replacementSku,
      }, "Atendimento registrado e movimentos aplicados.");
      if (result) { ui.selectedSaleId = values.saleId; render(); }
    } else if (formType === "studio-model") {
      const measurements = Object.fromEntries(["chest", "waist", "hip", "shoulder", "thigh"].map((key) => [key, Number(values["model__" + key])]));
      result = await execute("studio.model.create", {
        name: values.name, heightCm: Number(values.heightCm), sizeReference: values.sizeReference,
        fitPreference: values.fitPreference, measurements,
      }, "Perfil sintético adicionado ao estúdio local.");
      if (result) {
        ui.productStudio = ui.productStudio ?? { references: { front: null, detail: null, back: null }, modelReferences: { front: null, side: null, back: null } };
        releasePhotoReferences(ui.productStudio.modelReferences);
        ui.productStudio.modelId = result.result.id;
        ui.productStudio.modelReferences = { front: null, side: null, back: null };
        ui.productStudio.references = ui.productStudio.references ?? { front: null, detail: null, back: null };
        updateStudioAnalysis();
        render();
      }
    } else if (formType === "team") {
      result = await execute("team.invite", { name: values.name, email: values.email, role: values.role }, "Pessoa adicionada à equipe da loja.");
    } else if (formType === "settings") {
      result = await execute("settings.save", {
        storeName: values.storeName, unitName: values.unitName, phone: values.phone,
        address: values.address, openingHours: values.openingHours, lowStockAt: Number(values.lowStockAt),
      }, "Preferências da loja atualizadas.");
    }
    if (result) form.reset();
  });

  function handleGlobalKeydown(event) {
    if (ui.sidebarOpen && event.key === "Escape") {
      event.preventDefault();
      setSidebarOpen(false, { returnFocus: true });
      return;
    }
    if (ui.sidebarOpen && event.key === "Tab") {
      const sidebar = root.querySelector("#store-navigation");
      const focusable = Array.from(sidebar?.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])
        .filter((element) => element.getClientRects().length > 0);
      const targetIndex = sidebarFocusWrapTarget(focusable.indexOf(document.activeElement), focusable.length, event.shiftKey);
      if (targetIndex !== null) {
        event.preventDefault();
        focusable[targetIndex].focus();
      }
      return;
    }
    if (event.key === "/" && !ui.sidebarOpen && !event.ctrlKey && !event.metaKey && !event.altKey
        && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? "")) {
      event.preventDefault();
      root.querySelector(".quick-search input")?.focus();
    }
  }

  function handleSidebarBreakpointChange(event) {
    if (!event.matches && ui.sidebarOpen) setSidebarOpen(false);
  }

  document.addEventListener("keydown", handleGlobalKeydown);
  sidebarBreakpoint?.addEventListener?.("change", handleSidebarBreakpointChange);

  const boot = async () => {
    try {
      snapshot = await dataPort.initialize();
      unsubscribe = dataPort.subscribe((next) => { snapshot = next; render(); });
      render();
    } catch (error) {
      root.innerHTML = '<main class="boot-error"><span class="brand-symbol">' + icon("hanger") + '</span><h1>Não foi possível abrir o OrdaX Moda</h1><p>' + escapeHtml(error instanceof Error ? error.message : "O port local de dados não respondeu.") + '</p></main>';
    }
  };
  void boot();

  return {
    destroy() {
      ui.disposed = true;
      clearProductStudio();
      clearTimeout(ui.toastTimer);
      rootEvents.dispose();
      document.removeEventListener("keydown", handleGlobalKeydown);
      sidebarBreakpoint?.removeEventListener?.("change", handleSidebarBreakpointChange);
      unsubscribe();
      dataPort.destroy();
      root.replaceChildren();
    },
  };
}
