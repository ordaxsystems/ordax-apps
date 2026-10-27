// Shared order-entry form used by the POS and table-command flows.
// It renders one UI over the existing Food order state; it owns no data.
export function renderOrderComposer(viewModel) {
  const {
    PIZZERIA_TABLES,
    PREVIEW_CATALOG_PRODUCTS = [],
    deliveryFeeCents,
    snapshot,
    activeCommandId,
    cart,
    busy,
    commandById,
    sizeOptions,
    flavorOptions,
    cartHtml,
    emptyState,
    button,
    money,
    escapeHtml,
  } = viewModel;
  const activeFlavors = snapshot.flavors.filter(({ id, active }) =>
    active && snapshot.recipes.some((recipe) => recipe.flavorId === id));
  const activeWithoutRecipe = snapshot.flavors.some(({ id, active }) =>
    active && !snapshot.recipes.some((recipe) => recipe.flavorId === id));
  const selectedCommand = activeCommandId ? commandById(activeCommandId) : null;
  const tableCommand = selectedCommand?.closedAt === null ? selectedCommand : null;

  return `<section class="panel order-create-panel"><div class="panel-heading"><div><p class="eyebrow">NOVO ATENDIMENTO</p><h2>Montar pedido</h2></div><span class="step-number">01</span></div>
    ${activeFlavors.length ? `<form id="add-pizza-form" class="pizza-builder">
    <div class="builder-title"><span class="builder-icon" aria-hidden="true">✦</span><div><strong>Pizza</strong><small>Escolha tamanho e até ${snapshot.settings.maxFlavorsPerPizza} sabores.</small></div></div>
    <div class="builder-grid"><label>Tamanho<select name="size">${sizeOptions()}</select></label>${Array.from({ length: snapshot.settings.maxFlavorsPerPizza }, (_, index) => `<label class="${index ? "second-flavor" : ""}">${index ? `Sabor ${index + 1} <span class="optional-tag">opcional</span>` : "Primeiro sabor"}<select name="flavor${index + 1}" ${index === 0 ? "required" : ""}>${index ? `<option value="">Sem sabor adicional</option>` : ""}${flavorOptions()}</select></label>`).join("")}<label>Quantidade<input name="quantity" type="number" min="1" max="50" value="1" required></label></div>
      <div class="builder-bottom"><span id="pizza-price-preview">Selecione um sabor para ver o preço.</span><button class="button button-dark" type="button" data-action="add-pizza">Adicionar pizza <span aria-hidden="true">＋</span></button></div>
    </form>` : PREVIEW_CATALOG_PRODUCTS.length
      ? `<div class="catalog-only-note">${activeWithoutRecipe ? "As pizzas aguardam ficha técnica. Bebidas e acompanhamentos continuam disponíveis abaixo." : "Nenhum sabor de pizza está disponível. Você ainda pode registrar outros produtos."}</div>`
      : emptyState({ icon: "◉", title: activeWithoutRecipe ? "Fichas técnicas pendentes" : "Seu cardápio ainda está vazio", text: activeWithoutRecipe ? "Cadastre as receitas dos sabores no Cardápio antes de receber pedidos para preparo." : "Cadastre sabores e preços para começar a receber pedidos.", action: activeWithoutRecipe ? "Abrir cardápio" : "Cadastrar sabores", view: "menu" })}
    ${PREVIEW_CATALOG_PRODUCTS.length ? `<section class="order-products" aria-label="Bebidas e acompanhamentos"><div class="order-products-heading"><div><strong>Mais itens</strong><span>Bebidas, combos e acompanhamentos</span></div><span>${PREVIEW_CATALOG_PRODUCTS.length} opções</span></div><div class="order-products-grid">${PREVIEW_CATALOG_PRODUCTS.map((product) => `<article class="order-product"><div class="order-product-copy"><strong>${escapeHtml(product.name)}</strong><span>${escapeHtml(product.category)} · ${money(product.priceCents)}</span></div><button class="button button-quiet" type="button" data-action="add-catalog-product" data-product-id="${escapeHtml(product.id)}" aria-label="Adicionar ${escapeHtml(product.name)} ao pedido">Adicionar <span aria-hidden="true">＋</span></button></article>`).join("")}</div></section>` : ""}
    <div class="cart-section"><div class="cart-heading"><strong>Itens do pedido</strong><span id="cart-count">${cart.length} ${cart.length === 1 ? "item" : "itens"}</span></div><div id="cart-content">${cartHtml()}</div></div>
    <form id="create-order-form" class="customer-form">
      <div class="cart-heading"><strong>Dados para atendimento</strong><span class="step-number step-small">02</span></div>
      <input type="hidden" name="tableCommandId" value="${escapeHtml(tableCommand?.id ?? "")}">
    ${tableCommand ? `<div class="table-order-context"><div><strong>Comanda da Mesa ${String(tableCommand.tableId).padStart(2, "0")}</strong><span>${escapeHtml(tableCommand.customerName)} · ${tableCommand.guestCount} pessoas</span></div><small>Este pedido entrará na mesma fila da cozinha e será somado à comanda do salão.</small>${button("Sair da comanda", "leave-command-context", { disabled: cart.length > 0 })}</div><label>Grupo da mesa<input name="customerName" maxlength="80" value="${escapeHtml(tableCommand.customerName)}" readonly required></label><input type="hidden" name="channel" value="dine-in"><input type="hidden" name="phone" value="">` : `<label>Nome do cliente<input name="customerName" maxlength="80" placeholder="Nome para identificar o pedido" required></label><div class="builder-grid customer-grid"><label>Canal<select name="channel"><option value="pickup">Retirada</option><option value="delivery">Entrega</option><option value="counter">Balcão</option></select></label><label>Telefone <span class="optional-tag">opcional, exceto entrega</span><input name="phone" maxlength="32" inputmode="tel" placeholder="(11) 99999-9999"></label></div>`}
      <div id="delivery-fields" class="delivery-fields" hidden><label>Endereço de entrega<textarea name="address" maxlength="240" rows="2" placeholder="Rua, número, bairro e referência"></textarea></label><label>Taxa de entrega<input name="deliveryFee" inputmode="decimal" placeholder="0,00" value="${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(deliveryFeeCents / 100)}"><small>Taxa padrão; ajuste neste pedido se necessário. Sem cálculo por distância.</small></label></div>
      <label>Observações do pedido<textarea name="notes" maxlength="240" rows="2" placeholder="Ex.: sem cebola, tocar o interfone…"></textarea></label>
      <div class="order-total"><div><span>Total do pedido</span><small>O valor não representa pagamento recebido.</small></div><strong id="order-total-value">${money(0)}</strong></div>
      <button class="button button-primary button-wide" type="submit" ${busy || cart.length === 0 ? "disabled" : ""}>Registrar pedido <span aria-hidden="true">→</span></button>
    </form>
  </section>`;
}
