import { renderOrderComposer } from "./order-composer.mjs";

// The POS is the entry point for Food orders; payment remains a separate owner.
export function renderPosPage(viewModel) {
  return `<section class="page-section pos-page">
    <div class="page-heading"><div><p class="eyebrow">VENDAS DA CASA</p><h1>PDV</h1><p>Monte um pedido de retirada, balcão, salão ou entrega.</p></div><button class="button button-quiet" type="button" data-view="orders">Ver pedidos <span aria-hidden="true">→</span></button></div>
    <div class="pos-page-layout">${renderOrderComposer(viewModel)}</div>
  </section>`;
}
