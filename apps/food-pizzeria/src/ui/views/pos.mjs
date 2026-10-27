import { renderOrderComposer } from "./order-composer.mjs";

// The POS is the entry point for Food orders; payment remains a separate owner.
export function renderPosPage(viewModel) {
  return `<section class="page-section pos-page">
    <div class="page-heading"><div><p class="eyebrow">VENDAS DA CASA</p><h1>PDV</h1><p>Monte um pedido de retirada, balcão, salão ou entrega.</p></div><button class="button button-quiet" type="button" data-view="orders">Ver pedidos <span aria-hidden="true">→</span></button></div>
    <div id="pos-mobile-order-access" class="pos-mobile-order-access" hidden aria-label="Resumo rápido do pedido">
      <span class="pos-mobile-order-summary"><span id="pos-mobile-order-count" aria-live="polite" aria-atomic="true">0 itens</span><strong id="pos-mobile-order-total">R$ 0,00</strong></span>
      <button class="button button-primary" type="button" data-action="review-pos-order" aria-controls="pos-checkout-column">Ir para fechamento <span aria-hidden="true">→</span></button>
    </div>
    <div class="pos-page-layout">${renderOrderComposer(viewModel)}</div>
  </section>`;
}
