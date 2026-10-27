import assert from "node:assert/strict";
import test from "node:test";
import { renderPosPage } from "../src/ui/views/pos.mjs";
import { createSeedFoodState, PREVIEW_CATALOG_PRODUCTS } from "../src/fixtures/mock-data.mjs";

function renderPos({ deliveryFeeCents = 500, products = PREVIEW_CATALOG_PRODUCTS } = {}) {
  const snapshot = createSeedFoodState();
  return renderPosPage({
    PIZZERIA_TABLES: snapshot.settings.tables,
    PREVIEW_CATALOG_PRODUCTS: products,
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
  assert.match(html, /id="add-pizza-form"/);
  assert.match(html, /id="create-order-form"/);
  assert.match(html, /data-action="add-catalog-product" data-product-id="b-cola"/);
  assert.match(html, /Refrigerante 2L/);
  assert.match(html, /id="order-total-value"/);
  assert.match(html, /Registrar pedido/);
  assert.doesNotMatch(html, /data-order-id=/);
});

test("taxa de entrega local entra no formulário do PDV sem sugerir pagamento recebido", () => {
  const html = renderPos({ deliveryFeeCents: 875, products: [] });

  assert.match(html, /name="deliveryFee"[^>]*value="8,75"/);
  assert.match(html, /O valor não representa pagamento recebido/);
  assert.doesNotMatch(html, /Valor inicial fictício/);
});
