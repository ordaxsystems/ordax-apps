// Settings page renderer. Draft rows belong to the app's transient view state until saved.
export function renderSettingsPage(viewModel) {
  const { snapshot, busy, iconSvg, escapeHtml, money, deliveryFeeCents, settingsSizesDraft, settingsTablesDraft } = viewModel;
  return `<section class="page-section settings-page">
    <div class="page-heading"><div><p class="eyebrow">CONFIGURAÇÃO DA LOJA</p><h1>Configurações</h1><p>Configure tamanhos, montagem, mesas e regra de preço.</p></div></div>
    <div class="settings-layout">
      <form id="settings-form" class="panel settings-form">
      <div class="panel-heading"><div><p class="eyebrow">OPERAÇÃO DA PIZZARIA</p><h2>Preferências e estrutura</h2></div><span class="step-number">⚙</span></div>
      <label>Nome da pizzaria<input name="storeName" maxlength="80" required value="${escapeHtml(snapshot.settings.storeName)}"></label>
      <label>Regra para pizzas com vários sabores<select name="halfPricePolicy"><option value="highest" ${snapshot.settings.halfPricePolicy === "highest" ? "selected" : ""}>Cobrar pelo sabor de maior preço</option><option value="average" ${snapshot.settings.halfPricePolicy === "average" ? "selected" : ""}>Usar a média dos sabores</option></select><small>A regra aplicada fica registrada em cada pedido.</small></label>
      <label>Máximo de sabores por pizza<select name="maxFlavorsPerPizza">${Array.from({ length: 12 }, (_, index) => index + 1).map((value) => `<option value="${value}" ${snapshot.settings.maxFlavorsPerPizza === value ? "selected" : ""}>${value} ${value === 1 ? "sabor" : "sabores"}</option>`).join("")}</select></label>
      <section class="settings-config-group" aria-labelledby="pizza-sizes-heading"><div class="panel-heading"><div><p class="eyebrow">CARDÁPIO</p><h2 id="pizza-sizes-heading">Tamanhos de pizza</h2></div><button class="button button-quiet" type="button" data-action="add-pizza-size">＋ Adicionar tamanho</button></div>
        <p class="field-hint">Tamanhos novos começam desativados. Cadastre o preço e a ficha técnica de todos os sabores antes de ativá-los.</p>
        <div class="settings-config-list">${settingsSizesDraft.map((size) => `<div class="settings-config-row"><input type="hidden" name="size-id-${size.id}" value="${escapeHtml(size.id)}"><label>Nome<input name="size-label-${size.id}" maxlength="32" value="${escapeHtml(size.label)}" required></label><label>Fatias<input name="size-slices-${size.id}" type="number" min="1" max="48" value="${size.slices}" required></label><label class="settings-toggle"><input name="size-active-${size.id}" type="checkbox" value="true" ${size.active ? "checked" : ""}> Disponível para pedidos</label>${size.isDraft ? `<button class="button button-quiet" type="button" data-action="remove-pizza-size" data-size-id="${escapeHtml(size.id)}">Remover</button>` : ""}</div>`).join("")}</div>
      </section>
      <section class="settings-config-group" aria-labelledby="tables-config-heading"><div class="panel-heading"><div><p class="eyebrow">ATENDIMENTO PRESENCIAL</p><h2 id="tables-config-heading">Mesas do salão</h2></div><button class="button button-quiet" type="button" data-action="add-pizzeria-table">＋ Adicionar mesa</button></div>
        <p class="field-hint">Balcão é um canal separado. Pedidos do salão ficam vinculados a uma comanda e mesa ativa.</p>
        <div class="settings-config-list">${settingsTablesDraft.map((table) => `<div class="settings-config-row"><input type="hidden" name="table-id-${table.id}" value="${table.id}"><label>Mesa<input value="${String(table.id).padStart(2, "0")}" readonly></label><label>Lugares<input name="table-seats-${table.id}" type="number" min="1" max="100" value="${table.seats}" required></label><label class="settings-toggle"><input name="table-active-${table.id}" type="checkbox" value="true" ${table.active ? "checked" : ""}> Disponível no salão</label>${table.isDraft ? `<button class="button button-quiet" type="button" data-action="remove-pizzeria-table" data-table-id="${table.id}">Remover</button>` : ""}</div>`).join("")}</div>
      </section>
      <button class="button button-primary" type="submit" ${busy ? "disabled" : ""}>Salvar ajustes <span aria-hidden="true">→</span></button>
      </form>
      <aside class="settings-side-column" aria-label="Preferências locais e integrações pendentes">
        <form id="preview-delivery-fee-form" class="panel settings-form">
          <div class="panel-heading"><div><p class="eyebrow">PREFERÊNCIA LOCAL</p><h2>Taxa padrão de entrega</h2></div><span class="step-number">↗</span></div>
          <label>Taxa padrão de entrega<input id="delivery-fee-default" name="deliveryFee" inputmode="decimal" autocomplete="off" value="${escapeHtml(money(deliveryFeeCents))}"><small>Preenche os próximos pedidos e pode ser ajustada em cada pedido. Fica salva neste navegador; não calcula distância nem altera o estado dos pedidos.</small></label>
          <button class="button button-secondary" type="submit" ${busy ? "disabled" : ""}>Salvar taxa padrão</button>
        </form>
        <section class="panel capability-pending"><span class="capability-pending-mark" aria-hidden="true">${iconSvg("settings")}</span><div><strong>Horários e políticas externas ainda não estão integrados</strong><p>Esta área configura os dados operacionais do Food. Pagamentos, estoque e providers do Space dependem de suas integrações próprias.</p></div></section>
      </aside>
    </div>
  </section>`;
}
