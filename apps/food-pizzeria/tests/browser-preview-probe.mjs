// Executed by the localhost preview host only with ORDAX_FOOD_BROWSER_SMOKE=1.
// This is a real-browser smoke proof, never a Space provider.
const parameters = new URL(location.href).searchParams;
const embedded = parameters.get("presentation") === "embedded-preview";
const view = parameters.get("view") ?? "orders";
const configureWorkflow = parameters.get("__configure_workflow");
const configureScreenCount = parameters.get("__configure_screen_count");
const browserErrors = [];
window.addEventListener("error", (event) => {
  const source = event.target?.src || event.target?.href || "";
  browserErrors.push(`JS/resource: ${event.message || event.type} ${source} ${event.filename || ""}:${event.lineno || ""}`);
}, true);
window.addEventListener("unhandledrejection", (event) => {
  browserErrors.push(`Promise: ${String(event.reason?.stack ?? event.reason)}`);
});
const expected = {
  kitchen: "Produção",
  menu: "Cardápio",
  orders: "Pedidos",
  pos: "PDV",
  tables: "Mesas",
  delivery: "Expedição",
};

function ensure(ok, message) {
  if (!ok) throw new Error(message);
}

async function eventually(check, message) {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    const result = check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 35));
  }
  throw new Error(typeof message === "function" ? message() : message);
}

function announce(status, detail) {
  const result = document.createElement("div");
  result.id = "food-browser-proof";
  result.setAttribute("data-result", status);
  result.textContent = `FOOD_BROWSER_PROOF=${status};${detail}`;
  document.body.append(result);
}

async function checkAfterPageLoad() {
try {
  const host = document.querySelector("#app");
  ensure(host, "Host de prévia ausente.");
  const content = await eventually(() => (embedded ? host.shadowRoot : host)
    ?.querySelector("#main-content"),
    () => `Prévia não montou: errors=${browserErrors.join(" | ") || "nenhum"}; ready=${document.readyState}; modules=${[...document.querySelectorAll("script")].map(x=>x.src).join(",")}; resources=${performance.getEntriesByType("resource").filter(x=>/food|preview/.test(x.name)).map(x=>`${x.name.split("/").slice(-2).join("/")}:${x.responseStatus || "?"}`).join(",")}; host=${host.innerHTML.slice(0,350)}; shadowHost=${Boolean(host.shadowRoot)}; mount=${host.shadowRoot?.querySelector(".food-preview-content-root")?.innerHTML.slice(0,850) ?? "ausente"}`);
  const root = embedded ? host.shadowRoot : document;
  const expectedHeading = parameters.has("station")
    ? `TELA ${parameters.get("station")} DE ${parameters.get("screenCount") ?? parameters.get("station")}`
    : expected[view] ?? "OrdaX";
  ensure(expectedHeading && content.textContent.includes(expectedHeading),
    `O módulo ${view} não renderizou o conteúdo esperado${expectedHeading ? `: ${expectedHeading}` : ""}.`);
  ensure(content.getBoundingClientRect().width > 100,
    "O conteúdo Food não recebeu largura visível.");
  ensure(!root.querySelector(".fatal-state"), "A montagem do Food reportou falha fatal.");

  if (view === "pos") {
    const composer = root.querySelector(".pos-composer-grid");
    const builder = root.querySelector(".pos-builder-column");
    const checkout = root.querySelector(".pos-checkout-column");
    const mobileAccess = root.querySelector("#pos-mobile-order-access");
    ensure(composer && builder && checkout,
      "O PDV precisa separar seleção de produtos e fechamento do mesmo pedido.");
    ensure(mobileAccess?.hidden === true,
      "O acesso rápido do telefone deve começar oculto enquanto o carrinho está vazio.");
    ensure(root.querySelectorAll("#add-pizza-form").length === 1
      && root.querySelectorAll("#create-order-form").length === 1,
    "O layout responsivo duplicou um formulário ou o estado do pedido.");
    const viewport = parameters.get("__viewport");
    const tracks = getComputedStyle(composer).gridTemplateColumns.trim().split(/\s+/);
    if (viewport === "notebook") {
      ensure(tracks.length === 2,
        `O PDV deveria mostrar montagem e fechamento lado a lado no notebook: ${tracks.join(" / ")}.`);
      ensure(getComputedStyle(checkout).position === "sticky",
        "O resumo e fechamento deveriam permanecer acessíveis durante a montagem no notebook.");
    } else if (viewport === "phone-portrait" || viewport === "phone-landscape") {
      ensure(tracks.length === 1,
        `O PDV deveria empilhar as áreas no telefone: ${tracks.join(" / ")}.`);
      ensure(getComputedStyle(checkout).position === "static",
        "O fechamento do PDV não deve ficar sobre o conteúdo no telefone.");
      ensure(document.documentElement.scrollWidth <= window.innerWidth + 1,
        "O PDV criou rolagem horizontal no telefone.");
      ensure(builder.scrollWidth <= builder.clientWidth + 1
        && checkout.scrollWidth <= checkout.clientWidth + 1,
      "Uma das áreas do PDV transbordou a largura do telefone.");
      if (viewport === "phone-portrait" || viewport === "phone-landscape") {
        ensure(getComputedStyle(mobileAccess).display === "none",
          "O acesso rápido não pode ocupar a tela do telefone sem itens no carrinho.");
      }
    }
  }

  if (view === "orders" && embedded) {
    const searchForm = root.querySelector("#orders-search-form");
    ensure(searchForm && root.querySelector("#orders-search"),
      "O host incorporado precisa oferecer busca dentro do módulo Pedidos.");
    const search = root.querySelector("#orders-search");
    search.value = "carla aclimacao 998127731";
    searchForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    ensure(root.querySelectorAll(".history-list .order-card").length === 1
      && root.querySelector(".history-list .order-card")?.textContent.includes("#1049"),
    "A busca com termos, endereço sem acento e telefone sem pontuação não filtrou o histórico.");
    root.querySelector("#orders-search").value = "1050";
    root.querySelector("#orders-search-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    ensure(root.querySelectorAll(".history-list .order-card").length === 1
      && root.querySelector(".history-list .order-card")?.textContent.includes("#1050"),
    "Buscar a referência do pedido não filtrou o histórico.");
    const clearFilters = root.querySelector('[data-action="reset-order-filters"]');
    ensure(clearFilters, "A busca ativa precisa oferecer limpeza dos filtros.");
    clearFilters.click();
    ensure(root.querySelector("#orders-search")?.value === ""
      && root.querySelectorAll(".history-list .order-card").length === 12,
    "Limpar filtros não restaurou a lista completa nem removeu a busca.");
    const cancelButtons = [...root.querySelectorAll('.history-list .order-card [data-action="cancel-order"]')];
    ensure(cancelButtons.length > 0 && cancelButtons.every((button) => {
      const order = button.closest(".order-card");
      return button.getAttribute("aria-label")
        === `Cancelar pedido ${order?.querySelector(".order-number")?.textContent.trim()}`;
    }), "Cada ação de cancelamento deve identificar o pedido correspondente.");
  }

  if (view === "orders" && !embedded) {
    ensure(root.querySelector("#global-search input")
      && !root.querySelector("#orders-search-form"),
    "A busca do modo standalone deve permanecer no cabeçalho sem duplicação.");
  }

  if (view === "orders") {
    const timeline = [...root.querySelectorAll(".order-history-timeline")]
      .find((details) => details.querySelectorAll("li").length > 1);
    ensure(timeline && !timeline.open,
      "O histórico deve oferecer linha do tempo recolhida nos pedidos que têm transições.");
    const summary = timeline.querySelector("summary");
    ensure(summary?.textContent.includes("registros")
      || summary?.textContent.includes("registro"),
    "A linha do tempo precisa indicar quantos registros podem ser consultados.");
    summary.click();
    ensure(timeline.open && timeline.querySelectorAll("time[datetime]").length > 1,
      "Expandir o histórico não apresentou as datas dos eventos Food.");
  }

  if (view === "delivery" && parameters.has("__verify_pickup_handoff")) {
    const readyDeliveryCall = root.querySelector('.delivery-call-link[href="tel:11988113020"]');
    ensure(readyDeliveryCall?.getAttribute("aria-label")
      === "Ligar para Lucas Ferreira antes de despachar o pedido #1056",
    "Entrega pronta deve oferecer ligação acessível antes do despacho.");
    ensure(root.querySelectorAll(".delivery-call-link").length === 1,
      "Retirada não deve oferecer ação de ligação de entrega antes do atendimento.");
    const handoff = root.querySelector('[data-action="advance-order"][data-order-id="ng-order-1052"]');
    ensure(handoff?.textContent.trim() === "Confirmar retirada"
      && handoff.getAttribute("aria-label") === "Confirmar retirada no pedido #1052"
      && handoff.getAttribute("data-next-status") === "completed",
    "Pedido de retirada pronto não oferece a confirmação de entrega ao cliente.");
    ensure(!root.querySelector('[data-action="cancel-order"][data-order-id="ng-order-1052"]'),
      "A expedição não deve disponibilizar cancelamento ao operador.");
    handoff.click();
    await eventually(
      () => !root.querySelector('[data-action="advance-order"][data-order-id="ng-order-1052"]'),
      "Confirmar a retirada não concluiu o pedido nem o removeu da fila de expedição.",
    );
  }

  if (view === "pos" && parameters.has("__exercise_cart")) {
    const flavor = root.querySelector('#add-pizza-form [name="flavor1"]');
    ensure(flavor, "O teste do carrinho precisa do seletor de sabor.");
    const firstAvailableFlavor = [...flavor.options].find((option) => option.value);
    ensure(firstAvailableFlavor, "A prévia não tem sabor disponível para o teste do carrinho.");
    flavor.value = firstAvailableFlavor.value;
    flavor.dispatchEvent(new Event("change", { bubbles: true }));
    const secondFlavor = root.querySelector('#add-pizza-form [name="flavor2"]');
    if (secondFlavor) {
      const matchingFlavor = [...secondFlavor.options].find((option) => option.value === firstAvailableFlavor.value);
      ensure(matchingFlavor?.disabled === true,
        "Um sabor já escolhido não deve continuar disponível em outro campo.");
      const distinctFlavor = [...secondFlavor.options].find((option) => option.value && option.value !== firstAvailableFlavor.value);
      ensure(distinctFlavor && !distinctFlavor.disabled,
        "Sabores diferentes devem continuar disponíveis para pizza meio a meio.");
      secondFlavor.value = distinctFlavor.value;
      secondFlavor.dispatchEvent(new Event("change", { bubbles: true }));
      ensure(root.querySelector("#pizza-price-preview")?.getAttribute("aria-live") === "polite",
        "A prévia de preço e validação deve ser anunciada de forma acessível.");
      ensure(root.querySelector('[data-action="add-pizza"]')?.disabled === false,
        "Uma combinação válida de sabores não deve bloquear a inclusão da pizza.");
    }
    root.querySelector('[data-action="add-pizza"]')?.click();
    await eventually(
      () => root.querySelector(".cart-quantity-stepper"),
      "O carrinho não mostrou os controles de quantidade depois de adicionar a pizza.",
    );
    if (parameters.get("__viewport") === "phone-portrait" || parameters.get("__viewport") === "phone-landscape") {
      const mobileAccess = root.querySelector("#pos-mobile-order-access");
      ensure(mobileAccess && !mobileAccess.hidden,
        "O acesso rápido do PDV deve aparecer no telefone depois de adicionar uma pizza.");
      ensure(root.querySelector("#pos-mobile-order-count")?.textContent === root.querySelector("#cart-count")?.textContent,
        "O acesso rápido deve reutilizar a contagem de unidades do carrinho.");
      ensure(root.querySelector("#pos-mobile-order-total")?.textContent === root.querySelector("#order-total-value")?.textContent,
        "O acesso rápido deve reutilizar o total calculado no fechamento.");
      ensure(getComputedStyle(mobileAccess).position === "fixed",
        "O acesso rápido deve acompanhar a rolagem sem empurrar a lista do cardápio.");
      mobileAccess.querySelector('[data-action="review-pos-order"]')?.click();
      await eventually(
        () => root.activeElement === root.querySelector("#pos-checkout-column")
          && root.querySelector("#pos-mobile-order-access")?.hasAttribute("data-checkout-visible"),
        "Ir para fechamento não levou o foco ao checkout nem recolheu o acesso rápido sobre os campos.",
      );
      ensure(getComputedStyle(root.querySelector("#pos-mobile-order-access")).display === "none",
        "O acesso rápido deve desaparecer enquanto o fechamento estiver visível.");
    }
    const amountInCents = (value) => {
      const digits = String(value ?? "").replace(/\D/g, "");
      return digits ? Number(digits) : null;
    };
    const subtotalValue = () => root.querySelector("#order-subtotal-value")?.textContent;
    const totalValue = () => root.querySelector("#order-total-value")?.textContent;
    const deliveryFeeRow = root.querySelector("#order-delivery-fee-row");
    const deliveryFeeInput = root.querySelector('#create-order-form [name="deliveryFee"]');
    const channelInput = root.querySelector('#create-order-form [name="channel"]');
    const phoneInput = root.querySelector('#create-order-form [name="phone"]');
    const addressInput = root.querySelector('#create-order-form [name="address"]');
    const phoneRequirementHint = root.querySelector("#phone-requirement-hint");
    ensure(deliveryFeeRow?.hidden === true
      && amountInCents(subtotalValue()) === amountInCents(totalValue()),
    "Retirada deve mostrar o subtotal sem acrescentar taxa de entrega.");
    channelInput.value = "delivery";
    channelInput.dispatchEvent(new Event("change", { bubbles: true }));
    ensure(deliveryFeeRow?.hidden === false
      && amountInCents(root.querySelector("#order-delivery-fee-value")?.textContent) === 500
      && amountInCents(totalValue()) === amountInCents(subtotalValue()) + 500,
    "Entrega deve mostrar a taxa e somá-la ao subtotal no total do pedido.");
    ensure(phoneInput.required && addressInput.required
      && phoneRequirementHint?.textContent === "obrigatório na entrega"
      && phoneRequirementHint.classList.contains("is-required")
      && phoneInput.getAttribute("aria-invalid") === "true"
      && addressInput.getAttribute("aria-invalid") === "true"
      && !root.querySelector("#delivery-phone-hint")?.hidden
      && !root.querySelector("#delivery-address-hint")?.hidden,
    "Entrega deve identificar telefone obrigatório e sinalizar contato/endereço incompletos.");
    ensure(getComputedStyle(root.querySelector("#delivery-phone-hint")).fontSize === "11px",
      "A orientação do telefone deve permanecer legível na escala de texto do formulário.");
    phoneInput.value = "119876543";
    phoneInput.dispatchEvent(new Event("input", { bubbles: true }));
    ensure(phoneInput.getAttribute("aria-invalid") === "true",
      "Telefone sem DDD e número completos deve continuar inválido.");
    phoneInput.value = "(11) 98888-7766";
    phoneInput.dispatchEvent(new Event("input", { bubbles: true }));
    ensure(!phoneInput.hasAttribute("aria-invalid") && root.querySelector("#delivery-phone-hint")?.hidden,
      "Telefone válido deve remover o erro e a orientação de correção.");
    addressInput.value = "   ";
    addressInput.dispatchEvent(new Event("input", { bubbles: true }));
    ensure(addressInput.getAttribute("aria-invalid") === "true"
      && !root.querySelector("#delivery-address-hint")?.hidden,
    "Endereço em branco deve continuar inválido mesmo com espaços.");
    addressInput.value = "Rua das Flores, 10 — Centro";
    addressInput.dispatchEvent(new Event("input", { bubbles: true }));
    ensure(!addressInput.hasAttribute("aria-invalid") && root.querySelector("#delivery-address-hint")?.hidden,
      "Endereço preenchido deve remover o erro inline.");
    ensure(root.querySelector('#create-order-form [type="submit"]')?.disabled === false,
      "Contato e endereço válidos devem liberar o registro quando os demais campos estão prontos.");
    deliveryFeeInput.value = "valor inválido";
    deliveryFeeInput.dispatchEvent(new Event("input", { bubbles: true }));
    ensure(totalValue() === "Revise a taxa"
      && root.querySelector('#create-order-form [type="submit"]')?.disabled === true,
    "Uma taxa inválida não pode mostrar total parcial nem permitir registrar o pedido.");
    deliveryFeeInput.value = "0,00";
    deliveryFeeInput.dispatchEvent(new Event("input", { bubbles: true }));
    ensure(amountInCents(root.querySelector("#order-delivery-fee-value")?.textContent) === 0
      && amountInCents(totalValue()) === amountInCents(subtotalValue()),
    "Uma entrega gratuita deve aparecer como zero sem alterar o subtotal.");
    channelInput.value = "counter";
    channelInput.dispatchEvent(new Event("change", { bubbles: true }));
    ensure(deliveryFeeRow?.hidden === true
      && amountInCents(totalValue()) === amountInCents(subtotalValue())
      && phoneRequirementHint?.textContent === "opcional, exceto entrega"
      && !phoneRequirementHint.classList.contains("is-required")
      && !phoneInput.required && !addressInput.required
      && !phoneInput.hasAttribute("aria-invalid") && !addressInput.hasAttribute("aria-invalid")
      && root.querySelector("#delivery-phone-hint")?.hidden
      && root.querySelector("#delivery-address-hint")?.hidden,
    "Balcão deve ocultar a taxa de entrega e totalizar apenas os itens.");
    const quantityControls = root.querySelector(".cart-line-controls");
    const quantityStepper = root.querySelector(".cart-quantity-stepper");
    const removeButton = root.querySelector('[data-action="remove-cart-item"]');
    ensure(getComputedStyle(quantityControls).display === "flex"
      && Math.abs(quantityStepper.getBoundingClientRect().top - removeButton.getBoundingClientRect().top) < 2,
    "Ajuste e remoção devem ficar alinhados numa única linha.");
    const cartCount = () => root.querySelector("#cart-count")?.textContent.trim();
    const quantity = () => root.querySelector(".cart-quantity-value")?.textContent.trim();
    const increase = () => root.querySelector('[data-action="increase-cart-item"]');
    ensure(cartCount() === "1 item" && quantity() === "1",
      "O carrinho deve contar a unidade da pizza recém-adicionada.");
    const totalBeforeIncrease = root.querySelector("#order-total-value")?.textContent;
    increase()?.click();
    ensure(cartCount() === "2 itens" && quantity() === "2",
      "Aumentar a quantidade deve atualizar a unidade e o contador do pedido.");
    ensure(root.querySelector("#order-total-value")?.textContent !== totalBeforeIncrease,
      "Aumentar a quantidade não atualizou o total.");
    root.querySelector('[data-action="add-pizza"]')?.click();
    ensure(root.querySelectorAll(".cart-line").length === 1
      && cartCount() === "3 itens" && quantity() === "3",
    "Adicionar novamente a mesma pizza deve agrupar suas unidades na linha existente.");
    for (let index = 0; index < 47; index += 1) increase()?.click();
    ensure(quantity() === "50" && cartCount() === "50 itens",
      "O carrinho deve aceitar o limite de 50 unidades definido pelo domínio.");
    ensure(increase()?.disabled === true,
      "O botão de aumentar deve bloquear a quantidade acima do limite.");
    root.querySelector('[data-action="decrease-cart-item"]')?.click();
    ensure(quantity() === "49" && cartCount() === "49 itens",
      "Diminuir a quantidade deve atualizar o total de unidades.");
    root.querySelector('[data-action="remove-cart-item"]')?.click();
    ensure(cartCount() === "0 itens" && root.querySelector("#cart-empty"),
      "Remover a linha deve devolver o carrinho ao estado vazio.");
    ensure(root.querySelector('#create-order-form [type="submit"]')?.disabled === true,
      "O pedido não pode ser registrado depois de remover seu único item.");
  }

  if (view === "menu" && parameters.has("__exercise_recipe")) {
    const flavorAvailabilityButtons = [...root.querySelectorAll('.flavor-card [data-action="toggle-flavor"]')];
    ensure(flavorAvailabilityButtons.length > 0 && flavorAvailabilityButtons.every((button) => {
      const flavor = button.closest(".flavor-card")?.querySelector("h3")?.textContent.trim();
      const action = button.textContent.trim();
      return button.getAttribute("aria-label") === `${action} sabor ${flavor}`;
    }), "Cada ação de disponibilidade deve identificar o sabor correspondente.");
    const batchForm = root.querySelector("#batch-plan-form");
    const firstBatchLine = root.querySelector(".batch-plan-line");
    const firstBatchLineId = firstBatchLine?.dataset.batchLineId;
    ensure(batchForm && firstBatchLineId && root.querySelectorAll('[data-action="clear-batch-plan"]').length === 1,
      "O pré-preparo deve começar com uma combinação e somente uma ação para limpar.");
    const setBatchFlavor = (lineId, flavorIndex, flavorId) => {
      const selector = root.querySelector(`[data-batch-line-id="${lineId}"][data-batch-flavor-index="${flavorIndex}"]`);
      ensure(selector, `O seletor ${flavorIndex + 1} da combinação ${lineId} não apareceu.`);
      selector.value = flavorId;
      selector.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const addBatchFlavor = async (lineId, flavorIndex) => {
      root.querySelector(`[data-action="add-batch-flavor"][data-batch-line-id="${lineId}"]`)?.click();
      await eventually(() => root.querySelector(`[data-batch-line-id="${lineId}"][data-batch-flavor-index="${flavorIndex}"]`),
        `Adicionar o sabor ${flavorIndex + 1} não criou um seletor na combinação.`);
    };
    setBatchFlavor(firstBatchLineId, 0, "ng-calabresa");
    for (const [flavorIndex, flavorId] of ["ng-frango-catupiry", "ng-marguerita", "ng-pepperoni"].entries()) {
      await addBatchFlavor(firstBatchLineId, flavorIndex + 1);
      setBatchFlavor(firstBatchLineId, flavorIndex + 1, flavorId);
    }
    const firstQuantity = root.querySelector(`[name="batch-${firstBatchLineId}-quantity"]`);
    firstQuantity.value = "2";
    firstQuantity.dispatchEvent(new Event("input", { bubbles: true }));
    root.querySelector('[data-action="add-batch-line"]')?.click();
    await eventually(() => root.querySelectorAll(".batch-plan-line").length === 2,
      "Adicionar combinação não criou a segunda linha do lote.");
    const secondBatchLineId = root.querySelectorAll(".batch-plan-line")[1].dataset.batchLineId;
    await addBatchFlavor(secondBatchLineId, 1);
    setBatchFlavor(secondBatchLineId, 1, "ng-pepperoni");
    const secondQuantity = root.querySelector(`[name="batch-${secondBatchLineId}-quantity"]`);
    secondQuantity.value = "1";
    secondQuantity.dispatchEvent(new Event("input", { bubbles: true }));
    if (["phone-portrait", "small-portrait", "phone-landscape"].includes(parameters.get("__viewport"))) {
      const batchPanel = root.querySelector(".batch-plan-panel");
      const batchLine = root.querySelector(".batch-plan-line");
      ensure(batchPanel.scrollWidth <= batchPanel.clientWidth + 1
        && batchLine.scrollWidth <= batchLine.clientWidth + 1,
      `As combinações do lote excedem a largura no viewport ${parameters.get("__viewport")}.`);
    }
    root.querySelector("#batch-plan-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await eventually(() => root.querySelector("#batch-plan-result"),
      "Calcular insumos não apresentou o resultado do lote.");
    const batchResultText = root.querySelector("#batch-plan-result")?.textContent.replace(/\s+/g, " ") ?? "";
    ensure(batchResultText.includes("3 pizzas pequena")
      && batchResultText.includes("2×Calabresa + Frango com Catupiry + Marguerita + Pepperoni")
      && batchResultText.includes("1×Calabresa + Pepperoni"),
    "O resultado deve discriminar duas composições, incluindo pizza de quatro sabores.");
    ensure(root.querySelectorAll('[data-action="clear-batch-plan"]').length === 1
      && root.querySelector('[data-action="clear-batch-plan"]')?.getAttribute("aria-label")
        === "Limpar resultado do pré-preparo",
    "O resultado não deve duplicar a ação de limpar e deve descrevê-la para leitores de tela.");
    root.querySelector('[data-action="clear-batch-plan"]').click();
    await eventually(() => !root.querySelector("#batch-plan-result")
      && root.querySelectorAll(".batch-plan-line").length === 1
      && root.querySelector(".batch-plan-line input[type=number]")?.value === "0",
    "Limpar o lote não restaurou os campos do pré-preparo.");
    ensure(root.activeElement?.matches("[data-batch-flavor-selector]") === true,
      "Limpar o lote deveria devolver o foco à primeira combinação.");

    root.querySelector('[data-action="edit-recipe"][data-flavor-id="ng-calabresa"]')?.click();
    await eventually(() => root.querySelector("#recipe-editor .recipe-line"),
      "A ficha técnica da Calabresa não abriu.");
    ensure(root.activeElement?.id === "recipe-editor-title",
      "Abrir uma ficha deve levar o foco ao título do editor.");

    const quantityInput = () => root.querySelector('[name="quantity-0-small"]');
    quantityInput().value = "137";
    quantityInput().dispatchEvent(new Event("input", { bubbles: true }));

    root.querySelector('[data-action="add-recipe-line"]')?.click();
    await eventually(() => root.querySelectorAll("#recipe-editor .recipe-line").length === 7,
      "Adicionar insumo não criou a nova linha da ficha.");
    ensure(root.activeElement?.name === "ingredient-6",
      "Adicionar um insumo deve levar o foco à nova linha.");
    ensure(quantityInput()?.value === "137",
      "Adicionar uma linha descartou a quantidade já digitada.");
    const recipeRemovalButtons = [...root.querySelectorAll('#recipe-editor .recipe-line [data-action="remove-recipe-line"]')];
    ensure(recipeRemovalButtons.length === 7 && recipeRemovalButtons.every((button) => {
      const line = button.closest(".recipe-line");
      const ingredient = line?.querySelector("select")?.selectedOptions[0]?.textContent.split(" · ")[0];
      const flavor = root.querySelector("#recipe-editor h2")?.textContent.trim();
      return button.getAttribute("aria-label") === `Remover ${ingredient} da ficha técnica de ${flavor}`;
    }), "Cada remoção deve identificar o ingrediente e o sabor da ficha técnica.");

    root.querySelector('[data-action="remove-recipe-line"][data-index="6"]')?.click();
    await eventually(() => root.querySelectorAll("#recipe-editor .recipe-line").length === 6,
      "Remover insumo não atualizou as linhas da ficha.");
    ensure(root.activeElement?.name === "ingredient-5",
      "Remover um insumo deve manter o foco numa linha próxima do editor.");
    ensure(quantityInput()?.value === "137",
      "Remover uma linha descartou a quantidade já digitada.");

    const firstIngredient = root.querySelector('[name="ingredient-0"]');
    ensure(firstIngredient?.selectedOptions[0]?.value === "farinha"
      && firstIngredient.selectedOptions[0].disabled === false,
    "A ficha deve manter selecionável o ingrediente já usado pela própria linha.");
    const duplicateOption = [...firstIngredient.options].find(({ value }) => value === "molho");
    ensure(duplicateOption?.disabled === true && duplicateOption.textContent.includes("já usado"),
      "Um ingrediente usado em outra linha ainda pode ser escolhido novamente.");

    firstIngredient.value = "tomate";
    firstIngredient.dispatchEvent(new Event("change", { bubbles: true }));
    await eventually(() => root.querySelector('[name="ingredient-0"]')?.value === "tomate",
      "Trocar o ingrediente não atualizou a ficha.");
    ensure(quantityInput()?.value === "137",
      "Trocar o ingrediente descartou a quantidade já digitada.");
    const secondIngredient = root.querySelector('[name="ingredient-1"]');
    ensure([...secondIngredient.options].find(({ value }) => value === "tomate")?.disabled === true,
      "O ingrediente recém-escolhido deve ficar indisponível nas outras linhas.");

    root.querySelector('[data-action="edit-recipe"][data-flavor-id="ng-marguerita"]')?.click();
    await eventually(() => root.querySelector("#recipe-editor h2")?.textContent.trim() === "Marguerita",
      "A ficha técnica da Marguerita não abriu ao trocar de sabor.");
    ensure(root.activeElement?.id === "recipe-editor-title",
      "Ao trocar de ficha, o foco deve acompanhar o título do novo editor.");
    root.querySelector('[data-action="close-recipe-editor"]')?.click();
    await eventually(() => !root.querySelector("#recipe-editor"),
      "Fechar a ficha técnica não recolheu o editor.");
    ensure(root.activeElement?.dataset.flavorId === "ng-marguerita",
      "Fechar o editor deve devolver o foco ao acionador da ficha.");
    root.querySelector('[data-action="edit-recipe"][data-flavor-id="ng-calabresa"]')?.click();
    await eventually(() => root.querySelector("#recipe-editor h2")?.textContent.trim() === "Calabresa",
      "Reabrir a ficha técnica da Calabresa falhou.");
    ensure(root.querySelector('[name="ingredient-0"]')?.value === "tomate"
      && root.querySelector('[name="quantity-0-small"]')?.value === "137",
    "Fechar ou trocar de sabor descartou o rascunho da Calabresa.");

    const viewport = parameters.get("__viewport");
    if (viewport === "phone-portrait" || viewport === "small-portrait" || viewport === "phone-landscape") {
      const editor = root.querySelector("#recipe-editor");
      const recipeLine = editor?.querySelector(".recipe-line");
      const sizeGrid = recipeLine?.querySelector(".recipe-size-grid");
      const removeButton = recipeLine?.querySelector('[data-action="remove-recipe-line"]');
      const sizeFields = [...(sizeGrid?.querySelectorAll("input") ?? [])];
      const page = root.querySelector("#main-content");
      ensure(editor && recipeLine && sizeGrid && removeButton && page,
        `A ficha técnica não está completa no viewport ${viewport}.`);
      const widths = [
        ["document", document.documentElement.scrollWidth, innerWidth],
        ["page", page.scrollWidth, page.clientWidth],
        ["editor", editor.scrollWidth, editor.clientWidth],
        ["ingredient row", recipeLine.scrollWidth, recipeLine.clientWidth],
      ];
      ensure(widths.every(([, scroll, client]) => scroll <= client + 1),
        `A ficha técnica excede a largura do viewport ${viewport}: ${widths.map(([name, scroll, client]) => `${name} ${scroll}/${client}`).join(", ")}.`);
      const removeBounds = removeButton.getBoundingClientRect();
      ensure(removeBounds.width >= 44 && removeBounds.height >= 44,
        `O alvo para remover insumo é pequeno no viewport ${viewport} (${removeBounds.width} × ${removeBounds.height}).`);
      ensure(sizeFields.length >= 2 && sizeFields.every((field) => {
        const bounds = field.getBoundingClientRect();
        const minimumFontSize = viewport === "phone-portrait" || viewport === "small-portrait" ? 16 : 14;
        return bounds.width >= 72 && bounds.height >= 44
          && Number.parseFloat(getComputedStyle(field).fontSize) >= minimumFontSize;
      }), `Os campos de medida não são legíveis/tocáveis no viewport ${viewport}.`);
      ensure(editor.querySelector('[data-action="close-recipe-editor"]')?.getBoundingClientRect().height >= 44
        && editor.querySelector('[type="submit"]')?.getBoundingClientRect().height >= 44,
      `As ações da ficha técnica têm alvos pequenos no viewport ${viewport}.`);
    }
  }

  if (parameters.has("__exercise_flavor")) {
    const editFlavor = (flavorId) => root.querySelector(`[data-action="edit-flavor"][data-flavor-id="${flavorId}"]`);
    const inputValue = (name) => root.querySelector(`#flavor-form [name="${name}"]`)?.value;
    const setInput = (name, value) => {
      const input = root.querySelector(`#flavor-form [name="${name}"]`);
      ensure(input, `O campo ${name} não apareceu no formulário de sabor.`);
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const toggleMarguerita = async (nextActive) => {
      const button = root.querySelector('[data-action="toggle-flavor"][data-flavor-id="ng-marguerita"]');
      ensure(button && button.dataset.active === String(nextActive),
        `A disponibilidade da Marguerita não está pronta para ${nextActive ? "desativar" : "reativar"}.`);
      button.click();
      await eventually(() => root.querySelector('[data-action="toggle-flavor"][data-flavor-id="ng-marguerita"]')
        ?.dataset.active === String(!nextActive),
      "A alteração de disponibilidade não confirmou o rerender do cardápio.");
    };

    if (view !== "menu") {
      root.querySelector('[data-view="menu"]')?.click();
      await eventually(() => root.querySelector("#main-content")?.textContent.includes("Cardápio"),
        "A navegação para Cardápio não abriu o módulo.");
    }

    editFlavor("ng-calabresa")?.click();
    await eventually(() => inputValue("name") === "Calabresa",
      "O formulário de edição da Calabresa não abriu.");
    setInput("name", "Calabresa da casa");
    setInput("description", "Rascunho ajustado pelo operador.");
    setInput("price-small", "41,50");
    await toggleMarguerita(false);
    ensure(inputValue("name") === "Calabresa da casa"
      && inputValue("description") === "Rascunho ajustado pelo operador."
      && inputValue("price-small") === "41,50",
    "Um rerender por disponibilidade descartou alterações da ficha do sabor.");

    editFlavor("ng-pepperoni")?.click();
    await eventually(() => inputValue("name") === "Pepperoni",
      "Trocar para editar outro sabor falhou.");
    editFlavor("ng-calabresa")?.click();
    await eventually(() => inputValue("name") === "Calabresa da casa"
      && inputValue("price-small") === "41,50",
    "Alternar entre sabores descartou o rascunho anterior.");

    root.querySelector('[data-view="orders"]')?.click();
    await eventually(() => root.querySelector("#main-content")?.textContent.includes("Pedidos"),
      "Navegar para Pedidos não abriu o módulo.");
    root.querySelector('[data-view="menu"]')?.click();
    await eventually(() => inputValue("name") === "Calabresa da casa"
      && inputValue("description") === "Rascunho ajustado pelo operador."
      && inputValue("price-small") === "41,50",
    "Voltar ao Cardápio descartou a edição do sabor.");

    root.querySelector('[data-action="cancel-flavor-edit"]')?.click();
    await eventually(() => inputValue("name") === "",
      "Cancelar a edição não descartou o rascunho do sabor.");
    ensure(root.activeElement?.dataset.flavorId === "ng-calabresa",
      "Cancelar a edição deveria devolver o foco ao sabor correspondente.");
    setInput("name", "Sabor em construção");
    setInput("description", "Cadastro ainda não salvo.");
    setInput("price-small", "42,50");
    await toggleMarguerita(true);
    ensure(inputValue("name") === "Sabor em construção"
      && inputValue("description") === "Cadastro ainda não salvo."
      && inputValue("price-small") === "42,50",
    "Um rerender descartou o rascunho de um novo sabor.");
    const flavorCountBeforeDiscard = root.querySelectorAll('[data-action="edit-flavor"]').length;
    root.querySelector('[data-action="cancel-flavor-create"]')?.click();
    await eventually(() => inputValue("name") === ""
      && !root.querySelector('[data-action="cancel-flavor-create"]'),
    "Descartar o novo sabor deveria limpar o formulário e remover a ação de descarte.");
    ensure(inputValue("description") === ""
      && inputValue("price-small") === ""
      && root.activeElement?.name === "name"
      && root.querySelectorAll('[data-action="edit-flavor"]').length === flavorCountBeforeDiscard,
    "Descartar o rascunho deveria limpar os campos, devolver o foco e manter o cardápio salvo inalterado.");
  }

  if (parameters.has("station")) {
    const station = parameters.get("station");
    ensure(root.querySelector(`[data-kitchen-station-screen="${station}"]`),
      "A tela dedicada da estação não foi montada.");
    ensure(root.querySelectorAll("[data-kitchen-stage]").length === 1,
      "A tela dedicada exibe mais de uma macroetapa.");
    ensure(root.querySelectorAll("[data-kitchen-current-order]").length <= 1,
      "A tela dedicada exibe mais de um pedido em foco.");
    ensure(root.querySelectorAll("[data-kitchen-upcoming-order]").length <= 5,
      "A lista da estação exibe mais de cinco próximos pedidos.");
    const stationContent = root.querySelector(`[data-kitchen-station-screen="${station}"]`);
    const focusedTicket = stationContent?.querySelector("[data-kitchen-current-order]");
    if (focusedTicket) {
      ensure(focusedTicket.querySelector('button[data-task-action="start"], button[data-task-action="complete"]'),
        "A estação não mostra como iniciar ou concluir a etapa atual.");
      ensure(focusedTicket.querySelector('button[data-task-action="pass-next"]')?.textContent.includes("Próximo"),
        "A estação não mostra a ação para passar ao próximo pedido.");
      ensure(focusedTicket.querySelectorAll(".kitchen-item-line").length > 0,
        "O pedido em foco não apresenta itens de produção.");
    } else {
      ensure(stationContent?.textContent.includes("Nenhum pedido aguardando nesta tela."),
        "A estação vazia não explica que não há pedido aguardando.");
    }
    if (parameters.has("__verify_four_flavor_sample")) {
      const sample = stationContent?.querySelector('[data-kitchen-upcoming-order="ng-order-1049"]');
      ensure(sample?.textContent.includes("4 sabores") && sample.textContent.includes("6 fatias"),
        "A fila não apresenta tamanho e fatias da pizza de quatro sabores.");
      for (const flavor of ["Marguerita", "Calabresa", "Quatro Queijos", "Frango com Catupiry"]) {
        ensure(sample.textContent.includes(flavor), `A fila não apresenta o sabor ${flavor}.`);
      }
    }
    ensure(root.querySelector(".food-embedded-preview-kitchen"),
      "A tela dedicada não ativou o layout compacto do preview.");
    ensure(root.querySelector('[data-action="fullscreen-kitchen"]'),
      "A tela dedicada não oferece o controle de tela cheia.");
    const expectedStationTitle = parameters.get("__expected_station_title");
    if (expectedStationTitle) {
      ensure(stationContent?.querySelector(".kitchen-station-header h1")?.textContent.trim() === expectedStationTitle,
        `A tela ${station} não mostra a função configurada: ${expectedStationTitle}.`);
    }
    const expectedAssignedStepCount = Number(parameters.get("__expected_assigned_step_count") ?? 0);
    if (expectedAssignedStepCount > 1) {
      ensure(stationContent?.querySelector(".kitchen-station-header")?.textContent.includes(
        expectedAssignedStepCount + " etapas nesta tela"),
      "A tela não informa quantas etapas foram agrupadas neste posto.");
    }
    const expectedQueueMode = parameters.get("__expected_queue_mode");
    if (expectedQueueMode) {
      const modeDescription = expectedQueueMode === "by-stage"
        ? "faça cada função em lote."
        : "conclua este pedido antes do próximo.";
      ensure(stationContent?.querySelector(".kitchen-station-header")?.textContent.includes(modeDescription),
        "A tela não explica a organização da fila configurada.");
    }
    const viewport = parameters.get("__viewport");
    if (viewport) {
      const current = stationContent?.querySelector(".kitchen-current-order");
      const scrolling = [...stationContent.querySelectorAll("*")].filter((element) => {
        const style = getComputedStyle(element);
        return ["auto", "scroll"].includes(style.overflowY) && element.scrollHeight > element.clientHeight + 1;
      });
      ensure(document.documentElement.scrollHeight <= innerHeight + 1 && document.body.scrollHeight <= innerHeight + 1,
        `O layout ${viewport} excede o viewport do aparelho (${document.documentElement.scrollHeight}x${innerHeight}).`);
      ensure(stationContent.scrollHeight <= stationContent.clientHeight + 1,
        `A tela ${station} está maior que o viewport (${stationContent.scrollHeight}x${stationContent.clientHeight}).`);
      ensure(current?.scrollHeight <= current?.clientHeight + 1,
        `O pedido em foco está cortado e precisaria rolar (${current?.scrollHeight}x${current?.clientHeight}).`);
      ensure(scrolling.every((element) => element.matches(".kitchen-up-next-list")) && scrolling.length <= 1,
        `Há rolagem fora da lista de pedidos seguintes: ${scrolling.map((element) => element.className).join(", ")}.`);
      const focusedTitle = focusedTicket?.querySelector(".kitchen-item-content > strong");
      const focusedDetail = focusedTicket?.querySelector(".kitchen-item-detail");
      const focusedModifier = focusedTicket?.querySelector(".kitchen-item-modifiers li");
      const upcomingTitle = stationContent.querySelector(".kitchen-up-next-items .kitchen-item-content > strong");
      const upcomingModifier = stationContent.querySelector(".kitchen-up-next-items .kitchen-item-modifiers li");
      if (focusedTicket) {
        ensure(focusedTitle && Number.parseFloat(getComputedStyle(focusedTitle).fontSize) >= 12,
          `O nome do item em foco está pequeno demais para leitura rápida (${focusedTitle && getComputedStyle(focusedTitle).fontSize}).`);
        ensure(focusedDetail && Number.parseFloat(getComputedStyle(focusedDetail).fontSize) >= 9,
          `Os detalhes do item em foco precisam ter pelo menos 9 px (${focusedDetail && getComputedStyle(focusedDetail).fontSize}).`);
        ensure(focusedModifier && Number.parseFloat(getComputedStyle(focusedModifier).fontSize) >= 9,
          `Os sabores do pedido atual precisam ter pelo menos 9 px (${focusedModifier && getComputedStyle(focusedModifier).fontSize}).`);
      }
      if (upcomingTitle) {
        ensure(Number.parseFloat(getComputedStyle(upcomingTitle).fontSize) >= 9,
          `Os itens dos próximos pedidos precisam ter pelo menos 9 px (${getComputedStyle(upcomingTitle).fontSize}).`);
      }
      if (upcomingModifier) {
        ensure(Number.parseFloat(getComputedStyle(upcomingModifier).fontSize) >= 8,
          `Os sabores dos próximos pedidos precisam ter pelo menos 8 px (${getComputedStyle(upcomingModifier).fontSize}).`);
      }
      if (viewport === "portrait" && focusedTicket) {
        const ticketCard = focusedTicket.querySelector(".order-card-kitchen");
        const upcoming = stationContent.querySelector(".kitchen-up-next");
        ensure(ticketCard && upcoming
          && upcoming.getBoundingClientRect().height >= ticketCard.getBoundingClientRect().height,
        "No telefone vertical, a lista dos próximos pedidos deve aproveitar o espaço abaixo do ticket atual.");
      }
    }
    ensure(!root.querySelector(".kitchen-summary, .kitchen-toolbar, .kitchen-display-setup"),
      "A tela dedicada mantém controles do quadro geral.");
    const display = root.querySelector(`[data-kitchen-station-screen="${station}"]`);
    const fullscreenButton = root.querySelector('[data-action="fullscreen-kitchen"]');
    Object.defineProperty(display, "requestFullscreen", { configurable: true, value: undefined });
    fullscreenButton.click();
    const mount = host.shadowRoot.querySelector(".food-preview-content-root");
    ensure(mount.classList.contains("kitchen-display-fullscreen-fallback"),
      "A tela dedicada não ativou o modo de viewport quando a Fullscreen API não está disponível.");
    ensure(fullscreenButton.textContent.includes("Sair da tela cheia"),
      "O controle de tela cheia não oferece uma ação para sair do modo alternativo.");
    fullscreenButton.click();
    ensure(!mount.classList.contains("kitchen-display-fullscreen-fallback"),
      "O modo alternativo de tela cheia não pode ser encerrado pelo mesmo controle.");
    if (parameters.has("__exercise_solo")) {
      const start = stationContent.querySelector('button[data-task-action="start"]');
      const ticketNumber = stationContent.querySelector(".kitchen-ticket-identity strong")?.textContent.trim();
      ensure(start?.textContent.trim() === "Iniciar preparo", "O fluxo solo deve identificar claramente o início do preparo.");
      ensure(start?.getAttribute("aria-label")?.includes(ticketNumber),
        "A ação acessível para iniciar o preparo deve identificar o pedido em foco.");
      const passNext = stationContent.querySelector('button[data-task-action="pass-next"]');
      ensure(passNext?.getAttribute("aria-label")?.includes(ticketNumber),
        "A ação acessível para passar a fila deve identificar o pedido em foco.");
      start.click();
      const sendToOven = await eventually(() => root.querySelector(
        `[data-kitchen-station-screen="${station}"] button[data-task-action="complete"]`),
      "Iniciar não ativou a preparação do pedido.");
      ensure(sendToOven.textContent.includes("Enviar para o forno"),
        "Ao terminar o preparo, a ação deve enviar o pedido ao forno.");
      sendToOven.click();
      await eventually(() => root.querySelector(
        `[data-kitchen-station-screen="${station}"] .kitchen-task-progress > div > strong`)?.textContent.trim() === "Forno",
      "Concluir o preparo não encaminhou o pedido à etapa Forno.");
    }
  }

  if (configureWorkflow) {
    const setup = root.querySelector(".kitchen-display-setup");
    if (setup && !setup.open) setup.querySelector("summary")?.click();
    const preset = root.querySelector(`[data-action="apply-kitchen-preset"][data-preset="${configureWorkflow}"]`);
    ensure(preset, `O modelo de produção ${configureWorkflow} não está disponível.`);
    const expectedPresetTitle = parameters.get("__expected_preset_title");
    if (expectedPresetTitle) ensure(preset.querySelector("strong")?.textContent.trim() === expectedPresetTitle,
      `O botão de preset não identifica o fluxo ${expectedPresetTitle}.`);
    preset.click();
    const form = root.querySelector("#kitchen-layout-form");
    const expected = configureWorkflow === "single-pizzaiolo"
      ? { steps: "2", screens: "1", labels: ["Preparar pedido", "Forno"] }
      : { steps: "4", screens: "4", labels: ["Abrir massa", "Montagem", "Forno", "Finalização e embalagem"] };
    ensure(form?.elements.stepCount.value === expected.steps && form?.elements.screenCount.value === expected.screens,
      `O modelo ${configureWorkflow} configurou quantidade de etapas ou telas incorreta.`);
    expected.labels.forEach((label, index) => ensure(form.elements[`step-label-${index + 1}`].value === label,
      `O modelo ${configureWorkflow} não aplicou a etapa ${label}.`));
    form.requestSubmit();
    await eventually(() => root.textContent.includes("Fluxo e telas da cozinha salvos."),
      `O modelo ${configureWorkflow} não foi salvo.`);
  }

  if (configureScreenCount) {
    const setup = root.querySelector(".kitchen-display-setup");
    if (setup && !setup.open) setup.querySelector("summary")?.click();
    const form = root.querySelector("#kitchen-layout-form");
    ensure(form, "O formulário para configurar as telas não está disponível.");
    form.elements.screenCount.value = configureScreenCount;
    form.elements.screenCount.dispatchEvent(new Event("change", { bubbles: true }));
    const updatedForm = await eventually(() => root.querySelector("#kitchen-layout-form"),
      "A configuração não redesenhou as etapas para a quantidade de telas selecionada.");
    const assignments = Array.from({ length: Number(updatedForm.elements.stepCount.value) }, (_, index) =>
      Number(updatedForm.elements["step-screen-" + (index + 1)].value));
    ensure(updatedForm.elements.screenCount.value === configureScreenCount
      && assignments.join(",") === "1,1,2,2",
    "Quatro etapas em duas telas devem agrupar as etapas em sequência: " + assignments.join(",") + ".");
    const screenLabels = [...root.querySelectorAll(".kitchen-screen-assignment span")]
      .map((element) => element.textContent.trim());
    ensure(screenLabels[0] === "Abrir massa · Montagem"
      && screenLabels[1] === "Forno · Finalização e embalagem",
    "Os links não refletem as funções agrupadas por tela: " + screenLabels.join(" / ") + ".");
    const screenActions = [...root.querySelectorAll(".kitchen-display-row")];
    ensure(screenActions.length === 2 && screenActions.every((row, index) => {
      const screenNumber = String(index + 1);
      return row.querySelector(".kitchen-open-display")?.getAttribute("aria-label")
          === `Abrir tela ${screenNumber} em nova aba`
        && row.querySelector('[data-action="copy-kitchen-link"]')?.getAttribute("aria-label")
          === `Copiar link da tela ${screenNumber}`;
    }), "Cada aparelho precisa ter ações de abrir e copiar identificadas pelo número da tela.");
    const configureQueueMode = parameters.get("__configure_queue_mode");
    if (configureQueueMode) {
      ensure(["by-order", "by-stage"].includes(configureQueueMode),
        "O modo de organização da fila solicitado não é válido.");
      updatedForm.elements.queueMode.value = configureQueueMode;
    }
    updatedForm.requestSubmit();
    await eventually(() => root.textContent.includes("Fluxo e telas da cozinha salvos."),
      "O fluxo de duas telas não foi salvo.");
  }

  if (embedded) {
    ensure(root.querySelector(".food-embedded-preview")?.dataset.previewOnly === "true",
      "A apresentação incorporável perdeu sua marcação interna de segurança.");
    ensure(!/prévia|preview|fictíci|amostra|dados de teste|registros de teste|sem autenticação/i.test(root.textContent ?? ""),
      "A interface incorporável exibe um aviso de demonstração desnecessário.");
    ensure(!root.querySelector(".sidebar") && !root.querySelector(".topbar"),
      "A incorporação duplicou a navegação do Space.");
    ensure(document.querySelector('link[data-food-preview-stylesheet]') === null,
      "CSS Food ainda está aplicado globalmente no documento.");
    const style = await eventually(() =>
      root.querySelector('link[data-food-preview-stylesheet]')?.sheet,
      "O navegador não carregou CSS do Food no Shadow DOM.");
    ensure(style.cssRules.length > 0, "A folha de estilos do Food chegou vazia.");
    ensure(getComputedStyle(host).getPropertyValue("--ink").trim() !== "",
      "Os tokens do tema não estão disponíveis no Shadow DOM.");
    for (const id of ["cancel-dialog", "table-open-dialog"]) {
      ensure(root.getElementById(id), `Diálogo Food ${id} ausente no Shadow DOM.`);
      ensure(!document.getElementById(id), `Diálogo Food ${id} vazou para o host.`);
    }
    if (view === "tables") {
      const tableActions = [...root.querySelectorAll('.table-card-open [data-action="add-command-order"], .table-card-open [data-action="close-table-command"]')];
      ensure(tableActions.length >= 2 && tableActions.every((button) =>
        /Mesa \d{2}$/.test(button.getAttribute("aria-label") ?? "")),
      "As ações de comanda devem identificar a mesa correspondente.");
      const open = root.querySelector('[data-action="open-table-command"]');
      ensure(open, "Botão real de abertura de mesa não renderizado.");
      open.click();
      const dialog = root.getElementById("table-open-dialog");
      ensure(dialog.open, "O navegador não abriu o diálogo nativo da mesa.");
      ensure(root.getElementById("table-open-form").elements.guestCount.value !== "",
        "Formulário de comanda foi aberto sem número de pessoas.");
      dialog.close();
    }
  } else {
    ensure(host.querySelector(".app-shell") && host.querySelector(".sidebar"),
      "O modo standalone perdeu a navegação própria.");
    ensure(document.querySelector('link[data-food-preview-stylesheet]')?.sheet,
      "O modo standalone perdeu sua folha de estilos.");
    ensure(document.getElementById("cancel-dialog"),
      "O modo standalone perdeu os diálogos existentes.");
    ensure(host.shadowRoot === null, "Standalone criou Shadow DOM indevido.");
  }
  announce("PASS", `${embedded ? "embedded" : "standalone"}:${view}`);
} catch (error) {
  announce("FAIL", String(error?.stack ?? error).replaceAll("<", "(").slice(0,2300));
}
}

// Module imports can still be loading while virtual time advances in headless
// Chromium. Begin assertions after the entire preview module graph settles.
if (document.readyState === "complete") {
  void checkAfterPageLoad();
} else {
  window.addEventListener("load", () => { void checkAfterPageLoad(); }, { once: true });
}
