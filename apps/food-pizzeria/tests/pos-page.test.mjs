import assert from "node:assert/strict";
import test from "node:test";
import { renderPosPage } from "../src/ui/views/pos.mjs";
import { createSeedFoodState, PREVIEW_CATALOG_PRODUCTS } from "../src/fixtures/mock-data.mjs";
import { MAX_ORDER_ITEM_QUANTITY } from "../src/domain/domain.mjs";

function renderPos({ deliveryFeeCents = 500, products = PREVIEW_CATALOG_PRODUCTS } = {}) {
  const snapshot = createSeedFoodState();
  return renderPosPage({
    PIZZERIA_TABLES: snapshot.settings.tables,
    PREVIEW_CATALOG_PRODUCTS: products,
    MAX_ORDER_ITEM_QUANTITY,
    deliveryFeeCents,
    snapshot,
    activeCommandId: null,
    cart: [],
    busy: false,
    commandById: () => null,
    sizeOptions: () => `<option value="medium">Média</option>`,
    flavorOptions: () => `<option value="ng-calabresa">Calabresa</option>`,
    cartHtml: () => `<div class="cart-empty">Carrinho vazio</div>`,
    emptyState: () => `<div class="empty-state">Cardápio vazio</div>`,
    button: (label, action) => `<button data-action="${action}">${label}</button>`,
    money: (cents) => `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`,
    escapeHtml: (value) => String(value),
  });
}

test("PDV reúne criação de pedido e itens adicionais numa tela própria", () => {
  const html = renderPos();

  assert.match(html, /<h1>PDV<\/h1>/);
  assert.match(html, /data-view="orders">Ver pedidos/);
  assert.match(html, /class="pos-composer-grid"/);
  assert.match(html, /class="pos-builder-column" aria-label="Escolha os itens do pedido"/);
  assert.match(html, /class="pos-checkout-column" aria-label="Carrinho e fechamento do pedido"/);
  assert.match(html, /id="add-pizza-form"/);
  assert.equal((html.match(/name="flavor\d+"/g) ?? []).length, 4, "A nova configuração oferece quatro seletores de sabor no PDV.");
  assert.match(html, /id="pizza-price-preview" role="status" aria-live="polite"/);
  assert.match(html, /id="create-order-form"/);
  assert.match(html, /pos-checkout-column[\s\S]*?class="cart-section"[\s\S]*?id="create-order-form"/);
  assert.match(html, /data-action="add-catalog-product" data-product-id="b-cola"/);
  assert.match(html, /Refrigerante 2L/);
  assert.match(html, /id="order-total-value"/);
  assert.match(html, /Registrar pedido/);
  assert.ok(html.includes('max="' + MAX_ORDER_ITEM_QUANTITY + '"'), "A quantidade usa o limite do domínio Food.");
  assert.doesNotMatch(html, /data-order-id=/);
});

test("taxa de entrega local entra no formulário do PDV sem sugerir pagamento recebido", () => {
  const html = renderPos({ deliveryFeeCents: 875, products: [] });

  assert.match(html, /name="deliveryFee"[^>]*value="8,75"/);
  assert.match(html, /id="order-subtotal-value">R\$ 0,00/);
  assert.match(html, /id="order-delivery-fee-row" hidden/);
  assert.match(html, /id="order-delivery-fee-value">R\$ 8,75/);
  assert.match(html, /id="order-total-value" aria-live="polite" aria-atomic="true">R\$ 0,00/);
  assert.match(html, /name="phone"[^>]*aria-describedby="delivery-phone-hint"/);
  assert.match(html, /id="phone-requirement-hint"[^>]*>opcional, exceto entrega/);
  assert.match(html, /id="delivery-phone-hint"[^>]*hidden/);
  assert.match(html, /name="address"[^>]*aria-describedby="delivery-address-hint"/);
  assert.match(html, /id="delivery-address-hint"[^>]*hidden/);
  assert.match(html, /O valor não representa pagamento recebido/);
  assert.doesNotMatch(html, /Valor inicial fictício/);
});

test("CSS do PDV muda para uma coluna no telefone e mantém a área de fechamento acessível", async () => {
  const { readFile } = await import("node:fs/promises");
  const css = await readFile(new URL("../assets/food-pizzeria.css", import.meta.url), "utf8");

  assert.match(css, /\.pos-composer-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1\.16fr\)\s+minmax\(340px,\s*\.84fr\)/);
  assert.match(css, /@media\s*\(max-width:\s*980px\)\s*\{[^}]*\.pos-composer-grid\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
  assert.match(css, /\.pos-checkout-column\s*\{[^}]*position:\s*sticky/);
  assert.match(css, /\.pos-checkout-column\s*\{\s*position:\s*static/);
});
