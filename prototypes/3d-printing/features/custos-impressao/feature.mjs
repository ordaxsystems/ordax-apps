import * as shared from "/shared.mjs";
import { canChangeEstimateScope, updateEstimateOriginForEdit } from "/features/custos-impressao/estimate-origin.mjs";

const settingFields = [
  ["materialWastePercent", "Perda de material", "%", "number"],
  ["printerPowerWatts", "Potência média da impressora", "W", "number"],
  ["energyPricePerKwh", "Tarifa de energia", "R$/kWh", "currency"],
  ["laborPricePerHour", "Mão de obra", "R$/h", "currency"],
  ["printerPurchasePrice", "Valor de aquisição da impressora", "R$", "currency"],
  ["printerResidualValue", "Valor residual estimado", "R$", "currency"],
  ["printerUsefulHours", "Vida útil produtiva", "h", "number"],
  ["maintenancePerHour", "Manutenção e desgaste", "R$/h", "currency"],
  ["machineOverheadPerHour", "Outros custos da máquina", "R$/h", "currency"],
  ["laborAttentionPercent", "Acompanhamento durante a impressão", "%", "number"],
  ["setupMinutesPerBatch", "Preparação do lote", "min/lote", "number"],
  ["finishingMinutesPerUnit", "Acabamento por unidade", "min/un", "number"],
  ["packagingPerUnit", "Embalagem por unidade", "R$/un", "currency"],
  ["otherCostPerUnit", "Outros custos por unidade", "R$/un", "currency"],
  ["taxPercent", "Tributos estimados sobre a venda", "%", "number"],
  ["salesFeePercent", "Taxa de canal ou pagamento", "%", "number"],
  ["fixedSaleFeePerOrder", "Taxa fixa por pedido", "R$/pedido", "currency"],
  ["shippingAbsorbedPerOrder", "Frete absorvido no pedido", "R$/pedido", "currency"],
];

const printerSettingKeys = Object.freeze([
  "printerPowerWatts",
  "printerPurchasePrice",
  "printerResidualValue",
  "printerUsefulHours",
  "maintenancePerHour",
  "machineOverheadPerHour",
]);

function readNumber(value) {
  if (value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value) {
  return shared.money(Number(value) || 0);
}

function unit(value, digits = 1) {
  return Number(value).toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function settingField([key, label, unitName, kind], value) {
  const input = `<input class="input" data-setting="${key}" type="number" min="0" step="${kind === "currency" ? "0.01" : "0.1"}" value="${value}" aria-label="${label}"/>`;
  const currency = kind === "currency" || unitName.startsWith("R$/") || unitName === "R$";
  const help = key === "laborAttentionPercent"
    ? `<small class="muted">0% cobra apenas preparação e acabamento; 100% considera uma pessoa acompanhando toda a impressão.</small>`
    : "";
  return `<div class="field"><label>${label}</label><div class="${currency ? `currency-input${unitName.length > 6 ? " currency-input--wide" : ""}` : "unit-input"}">${currency ? `<span>${unitName}</span>${input}` : `${input}<span>${unitName}</span>`}</div>${help}</div>`;
}

export function mountFeature(host = {}) {
  const { escapeHtml, toast, icon, button } = shared;
  const costs = host.manufacturingCosts;
  if (typeof host.mountShell !== "function" || typeof costs?.settings !== "function" || typeof costs?.settingsForPrinter !== "function" || typeof costs?.updatePrinterCostProfile !== "function" || typeof costs?.listPrinterCostProfiles !== "function" || typeof costs?.hasPrinterCostProfile !== "function" || typeof costs?.calculate !== "function" || typeof costs?.normalizeQuantity !== "function" || typeof costs?.saveEstimate !== "function" || typeof costs?.materialPriceFor !== "function" || typeof costs?.updateMaterialPrice !== "function") {
    throw new TypeError("A estimativa precisa do serviço compartilhado de custos do OrdaX 3D.");
  }

  const nav = [
    { id: "estimate", label: "Novo orçamento", icon: "grid" },
    { id: "history", label: "Histórico local", icon: "clock" },
    { id: "settings", label: "Custos e taxas", icon: "settings" },
  ];
  const settings = costs.settings();
  const shell = host.mountShell({
    title: "Custos e orçamento técnico",
    subtitle: "CUSTO DE FABRICAÇÃO · REFERÊNCIA DE PREÇO",
    nav,
    status: "Parâmetros locais",
    content: `
      <div class="cost-grid">
        <section class="surface cost-form">
          <div class="cost-section">
            <div class="cost-section-head">${icon("grid", 16)}<h2>Trabalho e quantidade</h2></div>
            <div class="form-grid">
              <div class="field"><label for="job-name">Nome do trabalho</label><input class="input" id="job-name" data-input="name" placeholder="Ex.: Suporte articulado"/></div>
              <div class="field"><label for="material-name">Material ou perfil de filamento</label><input class="input" id="material-name" data-input="material" list="material-options" value="PLA"/><datalist id="material-options"><option value="PLA"></option><option value="PETG"></option><option value="ABS"></option><option value="ASA"></option><option value="TPU"></option><option value="Nylon"></option><option value="PC"></option></datalist></div>
              <div class="field"><label for="printer-name">Impressora de referência</label><input class="input" id="printer-name" data-input="printer" list="printer-cost-options" placeholder="Ex.: Bambu Lab A1"/><datalist id="printer-cost-options" data-printer-options></datalist><small class="muted" data-printer-profile-status>Sem nome de impressora, o cálculo usa as premissas padrão da oficina.</small></div>
              <div class="field"><label for="calculation-scope">Base do peso e do tempo</label><select class="input" id="calculation-scope" data-scope><option value="piece">Uma peça individual</option><option value="plate">Um lote ou prato completo</option></select><small class="muted" data-scope-help>Use os dados de uma unidade. Para orçamento de lote, selecione o lote/prato e informe o consumo e o tempo totais dele.</small></div>
              <div class="field"><label for="quantity" data-quantity-label>Quantidade de peças</label><input class="input" id="quantity" data-input="quantity" type="number" min="1" max="100000" step="1" value="1" required/><small class="muted" data-quantity-help>Quantas unidades com o mesmo peso e tempo serão produzidas.</small></div>
            </div>
          </div>

          <section class="last-slice" aria-live="polite">
            <div class="last-slice-copy"><span class="panel-kicker">INTEGRAÇÃO COM O FATIADOR</span><strong data-last-slice-title>Nenhum fatiamento nesta sessão</strong><small data-last-slice-detail>Depois de fatiar, traga peso e tempo reais do Orca para este orçamento.</small><small class="muted" data-last-slice-scope></small></div>
            <button class="button secondary" type="button" data-use-slice disabled>${icon("layers", 14)}<span>Usar resultado</span></button>
          </section>

          <div class="cost-section">
            <div class="cost-section-head">${icon("layers", 16)}<h2>Consumo e tempo por unidade</h2></div>
            <div class="form-grid">
              <div class="field"><label for="grams" data-grams-label>Peso por peça</label><div class="unit-input"><input class="input" id="grams" data-input="gramsPerUnit" type="number" min="0.01" step="0.1" placeholder="Ex.: 28,6"/><span>g</span></div></div>
              <div class="field"><label for="price-kg">Preço deste material</label><div class="currency-input"><span>R$/kg</span><input class="input" id="price-kg" data-material-price type="number" min="0" step="0.01" value="${costs.materialPriceFor("PLA")}"/></div><small class="muted">Salvo como premissa local por material/perfil. O Inventory continua sendo dono de saldo e movimentações.</small></div>
              <div class="field"><label for="hours" data-hours-label>Tempo por peça</label><div class="unit-input"><input class="input" id="hours" data-input="hoursPerUnit" type="number" min="0.01" step="0.01" placeholder="Ex.: 2,5"/><span>h</span></div><small class="muted">Informe horas decimais: 2,5 h = 2 h 30 min. O fatiador converte o tempo automaticamente.</small></div>
            </div>
          </div>

          <section class="cost-section cost-settings" data-params>
            <div class="cost-section-head">${icon("settings", 16)}<h2>Energia, impressora e operação</h2></div>
            <p class="section-help">A depreciação é rateada pelas horas produtivas: (aquisição − valor residual) ÷ vida útil. Potência, aquisição, residual, vida útil e manutenção são próprios da impressora selecionada; tarifa de energia e mão de obra são gerais da oficina.</p>
            <div class="form-grid">${settingFields.slice(0, 9).map(field => settingField(field, settings[field[0]])).join("")}</div>
          </section>

          <section class="cost-section">
            <div class="cost-section-head">${icon("tune", 16)}<h2>Mão de obra, acabamento e embalagem</h2></div>
            <div class="form-grid">${settingFields.slice(9, 14).map(field => settingField(field, settings[field[0]])).join("")}</div>
          </section>

          <section class="cost-section">
            <div class="cost-section-head">${icon("grid", 16)}<h2>Impostos, canal e frete do orçamento</h2></div>
            <p class="section-help">Use percentuais de referência do seu cenário. Estes valores não são apurados pelo app nem viram lançamento fiscal ou cobrança.</p>
            <div class="form-grid">${settingFields.slice(14).map(field => settingField(field, settings[field[0]])).join("")}</div>
          </section>

          <section class="cost-section">
            <div class="cost-section-head">${icon("grid", 16)}<h2>Preço de referência</h2></div>
            <div class="form-grid">
              <div class="field"><label for="pricing-mode">Como calcular o preço</label><select class="input" id="pricing-mode" data-setting="pricingMode"><option value="markup" ${settings.pricingMode === "markup" ? "selected" : ""}>Markup sobre o custo</option><option value="margin" ${settings.pricingMode === "margin" ? "selected" : ""}>Margem sobre o preço</option></select></div>
              <div class="field"><label for="pricing-percent" data-pricing-label>Markup</label><div class="unit-input"><input class="input" id="pricing-percent" data-setting="pricingPercent" type="number" min="0" max="1000" step="0.1" value="${settings.pricingPercent}"/><span>%</span></div></div>
            </div>
            <small class="muted" data-pricing-help>O markup é aplicado ao custo técnico; o valor é uma referência, não um preço aprovado por Vendas.</small>
          </section>
        </section>

        <aside class="surface cost-result">
          <div class="quote-hero"><span data-estimate-status>AGUARDANDO DADOS</span><strong data-unit-cost>—</strong><small data-unit-label>Custo estimado por peça</small><small class="quote-source" data-estimate-source>Entrada manual · informe peso e tempo</small></div>
          <div class="quote-breakdown">
            <div class="breakdown-row emphasis"><span data-unit-price-label>Preço de referência por peça</span><strong data-unit-price>—</strong></div>
            <div class="breakdown-row"><span>Material por unidade-base</span><strong data-material>R$ 0,00</strong></div>
            <div class="breakdown-row"><span>Filamento no total do lote</span><strong data-total-filament>—</strong></div>
            <div class="breakdown-row"><span>Energia por unidade-base</span><strong data-energy>R$ 0,00</strong></div>
            <div class="breakdown-row"><span>Tempo total da impressora</span><strong data-total-print-time>—</strong></div>
            <div class="breakdown-row"><span>Depreciação da impressora</span><strong data-depreciation>Não configurada</strong></div>
            <div class="breakdown-row"><span>Manutenção e desgaste por unidade-base</span><strong data-maintenance>R$ 0,00</strong></div>
            <div class="breakdown-row"><span>Outros custos da máquina por unidade-base</span><strong data-machine-overhead>R$ 0,00</strong></div>
            <div class="breakdown-row"><span>Mão de obra e acabamento por unidade-base</span><strong data-labor>R$ 0,00</strong></div>
            <div class="breakdown-row"><span>Embalagem e outros por unidade-base</span><strong data-extra>R$ 0,00</strong></div>
            <div class="breakdown-row total"><span data-batch-cost-label>Custo total do lote</span><strong data-batch-cost>R$ 0,00</strong></div>
            <div class="breakdown-row"><span data-minimum-price-label>Preço mínimo sem lucro por peça</span><strong data-minimum-price>—</strong></div>
            <div class="breakdown-row"><span data-minimum-total-label>Preço mínimo sem lucro do lote</span><strong data-minimum-total>—</strong></div>
            <div class="breakdown-row"><span>Tributos e taxa de canal/pagamento</span><strong data-variable-sales-expenses>R$ 0,00</strong></div>
            <div class="breakdown-row"><span>Taxa fixa e frete absorvido</span><strong data-fixed-sales-expenses>R$ 0,00</strong></div>
            <div class="breakdown-row"><span data-batch-price-label>Preço de referência do lote</span><strong data-batch-price>R$ 0,00</strong></div>
            <div class="breakdown-row"><span data-unit-profit-label>Resultado estimado por peça</span><strong data-unit-profit>—</strong></div>
            <div class="breakdown-row"><span data-batch-profit-label>Resultado estimado do lote</span><strong data-profit>R$ 0,00</strong></div>
          </div>
          <div class="quote-actions"><button class="button primary" type="button" data-save>${icon("check", 14)}<span>Salvar orçamento</span></button><button class="button secondary" type="button" data-export>${icon("file", 14)}<span>Exportar CSV</span></button></div>
          <p class="cost-note" data-cost-note>O cálculo técnico fica no OrdaX 3D. Não cria pedido, preço aprovado, cobrança ou movimentação de estoque.</p>
        </aside>
      </div>
      <section class="surface cost-history"><div class="surface-head"><div><h2>Orçamentos técnicos salvos</h2><p>Histórico local com as premissas usadas em cada cálculo</p></div></div><div data-history></div></section>
    `,
  });
  shell.actions.innerHTML = button("Salvar orçamento", "data-save", "primary", "check");

  const fields = Object.fromEntries([...shell.content.querySelectorAll("[data-input]")].map(input => [input.dataset.input, input]));
  let formSource = "manual";
  let formScope = "piece";
  let formEngine = "";
  let formEngineVersion = "";
  let importedSliceScopePending = false;
  const reviewedMeasurements = new Set();

  function estimateInput() {
    return {
      name: fields.name.value,
      material: fields.material.value,
      printer: fields.printer.value,
      quantity: fields.quantity.value,
      gramsPerUnit: fields.gramsPerUnit.value,
      hoursPerUnit: fields.hoursPerUnit.value,
      source: formSource,
      scope: formScope,
      engine: formEngine,
      engineVersion: formEngineVersion,
    };
  }

  function renderHistory() {
    const history = costs.listEstimates();
    const target = shell.content.querySelector("[data-history]");
    target.innerHTML = history.length ? history.slice(0, 12).map(item => {
      const scope = item.scope === "plate" ? "lote" : "peça";
      const completeness = item.complete === false ? " · depreciação pendente" : "";
      const quantity = Math.max(1, Number(item.quantity) || 1);
      const settings = item.settings ?? {};
      const components = item.components ?? {};
      const grams = Number(item.gramsPerUnit) || 0;
      const hours = Number(item.hoursPerUnit) || 0;
      const totalFilament = grams * (1 + (Number(settings.materialWastePercent) || 0) / 100) * quantity;
      const source = item.source === "slicer"
        ? `Fatiador${item.engine ? ` · ${item.engine} ${item.engineVersion ?? ""}` : ""}`
        : "Entrada manual";
      const savedAt = Number.isFinite(Date.parse(item.savedAt))
        ? new Date(item.savedAt).toLocaleString("pt-BR")
        : "data não informada";
      const componentRows = [
        ["Material por unidade-base", components.material],
        ["Energia por unidade-base", components.energy],
        ["Depreciação por unidade-base", components.depreciation],
        ["Manutenção e desgaste por unidade-base", components.maintenance],
        ["Outros custos da máquina por unidade-base", components.machineOverhead],
        ["Mão de obra e acabamento por unidade-base", components.labor],
        ["Embalagem e outros por unidade-base", Number(components.packaging ?? 0) + Number(components.other ?? 0)],
        ["Tributos e taxa variável por unidade-base", Number(components.taxes ?? 0) + Number(components.salesFee ?? 0)],
        ["Taxa fixa e frete absorvido por unidade-base", Number(components.fixedSaleFee ?? 0) + Number(components.absorbedShipping ?? 0)],
      ];
      const assumptionRows = [
        ["Perda de material", `${unit(Number(settings.materialWastePercent) || 0, 1)}%`],
        ["Potência · tarifa", `${unit(Number(settings.printerPowerWatts) || 0)} W · ${money(Number(settings.energyPricePerKwh) || 0)}/kWh`],
        ["Impressora · vida útil", `${money(Number(settings.printerPurchasePrice) || 0)} aquisição · ${money(Number(settings.printerResidualValue) || 0)} residual · ${unit(Number(settings.printerUsefulHours) || 0)} h`],
        ["Manutenção · outros custos da máquina", `${money(Number(settings.maintenancePerHour) || 0)}/h · ${money(Number(settings.machineOverheadPerHour) || 0)}/h`],
        ["Mão de obra · acompanhamento", `${money(Number(settings.laborPricePerHour) || 0)}/h · ${unit(Number(settings.laborAttentionPercent) || 0, 1)}%`],
        ["Preparação · acabamento", `${unit(Number(settings.setupMinutesPerBatch) || 0, 1)} min/lote · ${unit(Number(settings.finishingMinutesPerUnit) || 0, 1)} min/un`],
        ["Embalagem · outros custos", `${money(Number(settings.packagingPerUnit) || 0)}/un · ${money(Number(settings.otherCostPerUnit) || 0)}/un`],
        ["Tributos · taxa variável", `${unit(Number(settings.taxPercent) || 0, 1)}% · ${unit(Number(settings.salesFeePercent) || 0, 1)}%`],
        ["Taxa fixa · frete absorvido", `${money(Number(settings.fixedSaleFeePerOrder) || 0)}/pedido · ${money(Number(settings.shippingAbsorbedPerOrder) || 0)}/pedido`],
      ].map(([label, value]) => `<div><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
      const price = Number(item.suggestedPriceTotal ?? item.totalEstimate ?? item.order ?? 0);
      return `<article class="history-item"><div class="history-row"><div><strong>${escapeHtml(item.name)}</strong><small>${item.quantity} ${scope}${item.quantity === 1 ? "" : "s"} · ${escapeHtml(item.material)} · ${escapeHtml(savedAt)}${completeness} · local</small></div><div class="history-values"><b>${money(price)}</b><small>preço de referência</small></div></div><details class="history-detail"><summary>Ver memória do orçamento</summary><div class="history-detail-grid"><div><span>Origem</span><strong>${escapeHtml(source)}</strong></div><div><span>Impressora</span><strong>${escapeHtml(item.printer ?? "Não informada")}</strong></div><div><span>Consumo por ${scope}</span><strong>${unit(grams)} g</strong></div><div><span>Tempo por ${scope}</span><strong>${unit(hours, 2)} h</strong></div><div><span>Filamento total com perda</span><strong>${unit(totalFilament)} g</strong></div><div><span>Tempo total da máquina</span><strong>${unit(hours * quantity, 2)} h</strong></div><div><span>Preço do material</span><strong>${money(Number(item.materialPricePerKg) || 0)}/kg</strong></div><div><span>Custo por unidade-base</span><strong>${money(Number(item.costPerUnit) || 0)}</strong></div><div><span>Custo do lote</span><strong>${money(Number(item.totalCost) || 0)}</strong></div>${assumptionRows}${componentRows.map(([label, value]) => `<div><span>${label}</span><strong>${money(Number(value) || 0)}</strong></div>`).join("")}<div><span>Preço mínimo sem lucro por ${scope}</span><strong>${item.minimumPricePerUnit == null ? "Não registrado neste orçamento" : money(Number(item.minimumPricePerUnit))}</strong></div><div><span>Preço mínimo do lote</span><strong>${item.minimumPriceTotal == null ? "Não registrado neste orçamento" : money(Number(item.minimumPriceTotal))}</strong></div><div><span>Preço de referência por ${scope}</span><strong>${money(Number(item.suggestedPricePerUnit) || 0)}</strong></div><div><span>Preço de referência do lote</span><strong>${money(price)}</strong></div><div><span>Resultado estimado por unidade</span><strong>${money(Number(item.estimatedProfitPerUnit) || 0)}</strong></div><div><span>Resultado estimado do lote</span><strong>${money(Number(item.estimatedProfitTotal) || 0)}</strong></div><div><span>Precificação</span><strong>${item.pricingMode === "margin" ? "Margem" : "Markup"} · ${unit(Number(item.pricingPercent) || 0, 1)}%</strong></div></div></details></article>`;
    }).join("") : `<div class="empty-state">Nenhum orçamento salvo ainda.</div>`;
  }

  function renderPrinterProfileControls() {
    const name = fields.printer.value.trim();
    const datalist = shell.content.querySelector("[data-printer-options]");
    datalist.innerHTML = costs.listPrinterCostProfiles()
      .map(profile => `<option value="${escapeHtml(profile.name)}"></option>`)
      .join("");
    const status = shell.content.querySelector("[data-printer-profile-status]");
    if (!name) {
      status.textContent = "Sem nome de impressora, o cálculo usa as premissas padrão da oficina.";
    } else if (costs.hasPrinterCostProfile(name)) {
      status.textContent = `Premissas locais de potência, aquisição, vida útil e manutenção salvas para ${name}.`;
    } else {
      status.textContent = "Esta impressora ainda herda as premissas padrão. Ao editar um campo da máquina, um perfil local será salvo.";
    }
  }

  function loadPrinterCostProfile() {
    const profile = costs.settingsForPrinter(fields.printer.value);
    for (const key of printerSettingKeys) {
      const input = shell.content.querySelector(`[data-setting="${key}"]`);
      input.value = String(profile[key]);
    }
  }

  function renderLatestSlice() {
    const latest = costs.latestSlice();
    const title = shell.content.querySelector("[data-last-slice-title]");
    const detail = shell.content.querySelector("[data-last-slice-detail]");
    const scopeNote = shell.content.querySelector("[data-last-slice-scope]");
    const useButton = shell.content.querySelector("[data-use-slice]");
    if (!latest) {
      title.textContent = "Nenhum fatiamento nesta sessão";
      detail.textContent = "Depois de fatiar, traga peso e tempo reais do Orca para este orçamento.";
      scopeNote.textContent = "";
      useButton.disabled = true;
      return;
    }
    title.textContent = latest.name;
    const grams = latest.grams === null ? "peso não informado" : `${unit(latest.grams)} g`;
    const time = latest.timeSeconds === null ? "tempo não informado" : `${unit(latest.timeSeconds / 3600, 2)} h`;
    detail.textContent = `${latest.material} · ${latest.printer} · ${grams} · ${time}${latest.engine ? ` · ${latest.engine} ${latest.engineVersion}` : ""}`;
    scopeNote.textContent = latest.scope === "plate"
      ? `Total do prato com ${latest.objectCount} objetos; o motor não informa o custo individual de cada objeto.`
      : "Resultado de uma peça individual; o orçamento usará o peso e tempo do motor.";
    useButton.disabled = latest.grams === null || latest.timeSeconds === null;
  }

  function render() {
    renderLatestSlice();
    renderHistory();
    renderPrinterProfileControls();
    const result = costs.calculate(estimateInput());
    const settingsNow = costs.settings();
    const isPlateScope = formScope === "plate";
    const isSlicerResult = formSource === "slicer";
    const baseUnit = isPlateScope ? (isSlicerResult ? "prato" : "lote/prato") : "peça";
    const aggregateName = isPlateScope && isSlicerResult ? "prato" : "lote";
    const baseQuantityLabel = isPlateScope ? (isSlicerResult ? "Quantidade de pratos" : "Quantidade de lotes/pratos") : "Quantidade de peças";
    shell.content.querySelector("[data-scope]").value = formScope;
    const scopeCanChange = canChangeEstimateScope({ importedSlice: importedSliceScopePending, reviewedFields: reviewedMeasurements });
    shell.content.querySelector("[data-scope]").disabled = !scopeCanChange;
    shell.content.querySelector("[data-quantity-label]").textContent = baseQuantityLabel;
    shell.content.querySelector("[data-quantity-help]").textContent = formScope === "plate"
      ? "Quantos lotes/pratos completos com o mesmo peso e tempo serão produzidos."
      : "Quantas peças com o mesmo peso e tempo serão produzidas.";
    shell.content.querySelector("[data-scope-help]").textContent = !scopeCanChange
      ? "Escopo trazido pelo fatiador. Revise manualmente peso e tempo para escolher outra base; assim o total do prato não vira custo por peça por engano."
      : "Use os dados de uma unidade. Para orçamento de lote, selecione o lote/prato e informe o consumo e o tempo totais dele.";
    shell.content.querySelector("[data-estimate-status]").textContent = result.available ? !result.pricingValid ? "REVISE MARGEM E TAXAS" : result.complete ? "DEPRECIAÇÃO INCLUÍDA" : "CUSTO PARCIAL · DEPRECIAÇÃO PENDENTE" : "INFORME PESO E TEMPO";
    shell.content.querySelector("[data-unit-cost]").textContent = result.available ? money(result.costPerUnit) : "—";
    shell.content.querySelector("[data-unit-label]").textContent = `Custo estimado por ${baseUnit}`;
    shell.content.querySelector("[data-unit-price-label]").textContent = `Preço de referência por ${baseUnit}`;
    shell.content.querySelector("[data-batch-cost-label]").textContent = `Custo total do ${aggregateName}`;
    shell.content.querySelector("[data-minimum-price-label]").textContent = `Preço mínimo sem lucro por ${baseUnit}`;
    shell.content.querySelector("[data-minimum-total-label]").textContent = `Preço mínimo sem lucro do ${aggregateName}`;
    shell.content.querySelector("[data-batch-price-label]").textContent = `Preço de referência do ${aggregateName}`;
    shell.content.querySelector("[data-unit-profit-label]").textContent = `Resultado estimado por ${baseUnit}`;
    shell.content.querySelector("[data-batch-profit-label]").textContent = `Resultado estimado do ${aggregateName}`;
    shell.content.querySelector("[data-estimate-source]").textContent = result.source === "slicer"
      ? `Fatiador${result.engine ? ` · ${result.engine} ${result.engineVersion}` : ""} · ${formScope === "plate" ? "mesa inteira" : "peça individual"}`
      : "Entrada manual · valores editáveis";
    shell.content.querySelector("[data-unit-price]").textContent = result.available ? result.pricingValid ? money(result.suggestedPricePerUnit) : "Revise margem/taxas" : "—";
    shell.content.querySelector("[data-material]").textContent = result.available ? money(result.components.material) : "—";
    shell.content.querySelector("[data-total-filament]").textContent = result.available ? `${unit(result.gramsPerUnit * (1 + settingsNow.materialWastePercent / 100) * result.quantity)} g` : "—";
    shell.content.querySelector("[data-energy]").textContent = result.available ? money(result.components.energy) : "—";
    shell.content.querySelector("[data-total-print-time]").textContent = result.available ? `${unit(result.hoursPerUnit * result.quantity, 2)} h` : "—";
    shell.content.querySelector("[data-depreciation]").textContent = result.available && result.components.depreciationPerHour !== null ? money(result.components.depreciation) : "Configure aquisição e vida útil";
    shell.content.querySelector("[data-maintenance]").textContent = result.available ? money(result.components.maintenance) : "—";
    shell.content.querySelector("[data-machine-overhead]").textContent = result.available ? money(result.components.machineOverhead) : "—";
    shell.content.querySelector("[data-labor]").textContent = result.available ? money(result.components.labor) : "—";
    shell.content.querySelector("[data-extra]").textContent = result.available ? money(result.components.packaging + result.components.other) : "—";
    shell.content.querySelector("[data-batch-cost]").textContent = result.available ? money(result.totalCost) : "—";
    shell.content.querySelector("[data-minimum-price]").textContent = result.available ? result.minimumPricePerUnit === null ? "Revise taxas" : money(result.minimumPricePerUnit) : "—";
    shell.content.querySelector("[data-minimum-total]").textContent = result.available ? result.minimumPriceTotal === null ? "Revise taxas" : money(result.minimumPriceTotal) : "—";
    shell.content.querySelector("[data-variable-sales-expenses]").textContent = result.available && result.pricingValid ? money((result.components.taxes + result.components.salesFee) * result.quantity) : result.available ? "Revise margem/taxas" : "—";
    shell.content.querySelector("[data-fixed-sales-expenses]").textContent = result.available ? money(result.components.fixedSaleFee * result.quantity + result.components.absorbedShipping * result.quantity) : "—";
    shell.content.querySelector("[data-batch-price]").textContent = result.available ? result.pricingValid ? money(result.suggestedPriceTotal) : "Revise margem/taxas" : "—";
    shell.content.querySelector("[data-unit-profit]").textContent = result.available && result.pricingValid ? money(result.estimatedProfitPerUnit) : result.available ? "Revise margem/taxas" : "—";
    shell.content.querySelector("[data-profit]").textContent = result.available && result.pricingValid ? money(result.estimatedProfitTotal) : "—";
    shell.content.querySelector("[data-grams-label]").textContent = `Peso por ${formScope === "plate" ? "lote" : "peça"}`;
    shell.content.querySelector("[data-hours-label]").textContent = `Tempo por ${formScope === "plate" ? "lote" : "peça"}`;
    shell.content.querySelector("[data-pricing-label]").textContent = settingsNow.pricingMode === "margin" ? "Margem desejada sobre o preço" : "Markup sobre o custo";
    shell.content.querySelector("[data-pricing-help]").textContent = settingsNow.pricingMode === "margin"
      ? `A margem considera tributos/taxas informados (${unit(settingsNow.taxPercent + settingsNow.salesFeePercent, 1)}% sobre o preço). A soma precisa ficar abaixo de 100%. Não é preço aprovado por Vendas.`
      : `Markup aplicado ao custo e ajustado para tributos/taxas informados (${unit(settingsNow.taxPercent + settingsNow.salesFeePercent, 1)}% sobre o preço). É uma referência, não preço aprovado por Vendas.`;
    shell.content.querySelector("[data-cost-note]").textContent = !result.available
      ? "Informe peso e tempo por unidade para calcular. Os valores vêm do usuário ou das estatísticas do OrcaSlicer, quando disponíveis."
      : !result.pricingValid
      ? result.pricingError
      : result.complete
        ? "Estimativa técnica local. O preço mínimo considera custos e taxas informadas, sem lucro; o preço de referência inclui markup ou margem. Não cria pedido comercial, preço aprovado, cobrança, lançamento contábil nem movimentação de estoque."
        : "O custo inclui os itens preenchidos, mas não inclui depreciação até informar aquisição, residual e vida útil da impressora. Tributos e taxas são apenas premissas informadas, não apuração fiscal.";
    const canSaveEstimate = result.available && result.pricingValid;
    shell.content.querySelectorAll("[data-save], [data-export]").forEach(item => { item.disabled = !canSaveEstimate; });
    const headerSave = shell.actions.querySelector("[data-save]");
    if (headerSave) {
      headerSave.disabled = !canSaveEstimate;
      headerSave.title = !result.available
        ? "Informe o peso e o tempo para salvar o orçamento."
        : !result.pricingValid
          ? result.pricingError
          : "Salvar orçamento técnico local";
    }
  }

  function save() {
    try {
      const estimate = costs.saveEstimate(estimateInput());
      toast(`Orçamento técnico salvo localmente: ${money(estimate.suggestedPriceTotal)} de referência.`);
    } catch (error) {
      toast(error?.message || "Não foi possível salvar o orçamento técnico.");
    }
  }

  function exportEstimate() {
    const result = costs.calculate(estimateInput());
    if (!result.available) { toast("Informe peso e tempo antes de exportar."); return; }
    if (!result.pricingValid) { toast(result.pricingError); return; }
    const rows = [
      ["Campo", "Valor"],
      ["Trabalho técnico", result.name],
      ["Origem do peso e tempo", result.source === "slicer" ? "Estatísticas do fatiador" : "Entrada manual"],
      ["Escopo do peso e tempo", result.scope === "plate" ? result.source === "slicer" ? "Prato completo" : "Lote/prato completo" : "Peça individual"],
      ["Motor de fatiamento", result.source === "slicer" ? result.engine || "Não informado" : "Não se aplica"],
      ["Versão do motor", result.source === "slicer" ? result.engineVersion || "Não informada" : "Não se aplica"],
      ["Material", result.material],
      ["Preço informado do material (R$/kg)", String(result.materialPricePerKg)],
      ["Impressora", result.printer],
      ["Quantidade", String(result.quantity)],
      ["Peso por unidade-base (g)", String(result.gramsPerUnit)],
      ["Tempo por unidade-base (h)", String(result.hoursPerUnit)],
      ["Consumo total de filamento com perda (g)", String(result.gramsPerUnit * (1 + result.settings.materialWastePercent / 100) * result.quantity)],
      ["Tempo total de máquina (h)", String(result.hoursPerUnit * result.quantity)],
      ["Perda de material (%)", String(result.settings.materialWastePercent)],
      ["Potência média (W)", String(result.settings.printerPowerWatts)],
      ["Tarifa de energia (R$/kWh)", String(result.settings.energyPricePerKwh)],
      ["Mão de obra (R$/h)", String(result.settings.laborPricePerHour)],
      ["Acompanhamento da impressão (%)", String(result.settings.laborAttentionPercent)],
      ["Aquisição da impressora (R$)", String(result.settings.printerPurchasePrice)],
      ["Valor residual (R$)", String(result.settings.printerResidualValue)],
      ["Vida útil produtiva da impressora (h)", String(result.settings.printerUsefulHours)],
      ["Manutenção e desgaste (R$/h)", String(result.settings.maintenancePerHour)],
      ["Outros custos da máquina (R$/h)", String(result.settings.machineOverheadPerHour)],
      ["Preparação do lote (min)", String(result.settings.setupMinutesPerBatch)],
      ["Acabamento por unidade (min)", String(result.settings.finishingMinutesPerUnit)],
      ["Embalagem por unidade (R$)", String(result.settings.packagingPerUnit)],
      ["Outros custos por unidade (R$)", String(result.settings.otherCostPerUnit)],
      ["Tributos estimados (%)", String(result.settings.taxPercent)],
      ["Taxa de canal/pagamento (%)", String(result.settings.salesFeePercent)],
      ["Material com perdas (por unidade-base)", money(result.components.material)],
      ["Material com perdas (total do lote)", money(result.components.material * result.quantity)],
      ["Energia (por unidade-base)", money(result.components.energy)],
      ["Energia (total do lote)", money(result.components.energy * result.quantity)],
      ["Depreciação (por unidade-base)", result.components.depreciationPerHour === null ? "Não configurada" : money(result.components.depreciation)],
      ["Depreciação (total do lote)", result.components.depreciationPerHour === null ? "Não configurada" : money(result.components.depreciation * result.quantity)],
      ["Manutenção e desgaste (total do lote)", money(result.components.maintenance * result.quantity)],
      ["Outros custos da máquina (total do lote)", money(result.components.machineOverhead * result.quantity)],
      ["Mão de obra e acabamento (total do lote)", money(result.components.labor * result.quantity)],
      ["Embalagem e outros (total do lote)", money((result.components.packaging + result.components.other) * result.quantity)],
      ["Tributos estimados (total do lote)", money(result.components.taxes * result.quantity)],
      ["Taxa de canal ou pagamento (total do lote)", money(result.components.salesFee * result.quantity)],
      ["Taxa fixa por pedido", money(result.settings.fixedSaleFeePerOrder)],
      ["Frete absorvido por pedido", money(result.settings.shippingAbsorbedPerOrder)],
      ["Custo estimado por unidade-base", money(result.costPerUnit)],
      ["Custo estimado do lote", money(result.totalCost)],
      ["Preço mínimo sem lucro por unidade-base", result.minimumPricePerUnit === null ? "Indisponível: revise as taxas variáveis" : money(result.minimumPricePerUnit)],
      ["Preço mínimo sem lucro do lote", result.minimumPriceTotal === null ? "Indisponível: revise as taxas variáveis" : money(result.minimumPriceTotal)],
      ["Preço de referência por unidade-base", money(result.suggestedPricePerUnit)],
      ["Preço de referência do lote", money(result.suggestedPriceTotal)],
      ["Resultado estimado por unidade", money(result.estimatedProfitPerUnit)],
      ["Resultado estimado", money(result.estimatedProfitTotal)],
      ["Precificação", `${result.pricingMode === "margin" ? "Margem" : "Markup"} ${result.pricingPercent}%`],
      ["Depreciação configurada", result.complete ? "Sim" : "Não; custo parcial"],
      ["Natureza", "Estimativa local; tributos e taxas são premissas do usuário, não apuração fiscal, pedido comercial ou movimentação de Inventory."],
    ];
    const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "orcamento-tecnico-3d.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Resumo do orçamento técnico exportado.");
  }

  const materialPriceField = shell.content.querySelector("[data-material-price]");
  fields.printer.addEventListener("change", () => { loadPrinterCostProfile(); render(); });
  fields.material.addEventListener("change", () => {
    materialPriceField.value = String(costs.materialPriceFor(fields.material.value));
    render();
  });
  materialPriceField.addEventListener("input", () => {
    if (materialPriceField.value === "") return;
    try { costs.updateMaterialPrice(fields.material.value, readNumber(materialPriceField.value)); render(); }
    catch (error) { toast(error?.message || "Não foi possível salvar o preço do material."); }
  });
  shell.content.querySelectorAll("[data-input]").forEach(input => input.addEventListener("input", () => {
    if (input.dataset.input === "gramsPerUnit" || input.dataset.input === "hoursPerUnit") reviewedMeasurements.add(input.dataset.input);
    const origin = updateEstimateOriginForEdit({ source: formSource, scope: formScope, engine: formEngine, engineVersion: formEngineVersion }, input.dataset.input);
    formSource = origin.source;
    formScope = origin.scope;
    formEngine = origin.engine;
    formEngineVersion = origin.engineVersion;
    render();
  }));
  fields.quantity.addEventListener("change", () => {
    fields.quantity.value = String(costs.normalizeQuantity(fields.quantity.value));
    render();
  });
  shell.content.querySelector("[data-scope]").addEventListener("change", event => {
    formScope = event.currentTarget.value === "plate" ? "plate" : "piece";
    render();
  });
  shell.content.querySelectorAll("[data-setting]").forEach(input => {
    const saveSetting = () => {
      const key = input.dataset.setting;
      const value = key === "pricingMode" ? input.value : readNumber(input.value);
      const isPrinterSetting = printerSettingKeys.includes(key);
      const printer = fields.printer.value.trim();
      const saved = isPrinterSetting && printer
        ? costs.updatePrinterCostProfile(printer, { [key]: value })
        : costs.updateSettings({ [key]: value });
      const normalized = saved[key];
      if (input.tagName === "SELECT" || input.value !== "" && Number(input.value) !== normalized) input.value = String(normalized);
      if (isPrinterSetting) {
        const effective = costs.settingsForPrinter(printer);
        for (const machineKey of printerSettingKeys) {
          shell.content.querySelector(`[data-setting="${machineKey}"]`).value = String(effective[machineKey]);
        }
      }
      render();
    };
    input.addEventListener("input", saveSetting);
  });
  shell.content.querySelectorAll("[data-save]").forEach(item => item.addEventListener("click", save));
  shell.actions.querySelector("[data-save]").addEventListener("click", save);
  shell.content.querySelector("[data-export]").addEventListener("click", exportEstimate);
  function loadSlice(slice = costs.latestSlice()) {
    const latest = slice;
    if (!latest || latest.grams === null || latest.timeSeconds === null) {
      toast("O resultado do motor precisa informar peso e tempo para preencher este orçamento.");
      return false;
    }
    if (slice !== costs.latestSlice()) costs.setLatestSlice(latest);
    fields.name.value = latest.name;
    fields.material.value = latest.material;
    materialPriceField.value = String(costs.materialPriceFor(latest.material));
    fields.printer.value = latest.printer;
    loadPrinterCostProfile();
    fields.quantity.value = "1";
    fields.gramsPerUnit.value = String(latest.grams);
    fields.hoursPerUnit.value = String(latest.timeSeconds / 3600);
    formSource = "slicer";
    formScope = latest.scope;
    formEngine = latest.engine;
    formEngineVersion = latest.engineVersion;
    importedSliceScopePending = true;
    reviewedMeasurements.clear();
    render();
    shell.content.querySelector("[data-grams-label]").scrollIntoView({ behavior: "smooth", block: "center" });
    toast(latest.scope === "plate"
      ? `Total do prato com ${latest.objectCount} objetos carregado. O motor não dividiu peso e tempo por peça; o orçamento permanece por prato.`
      : "Peso e tempo desta peça carregados a partir de um fatiamento isolado. Revise as premissas antes de salvar.");
    return true;
  }
  const loadLatestSlice = () => loadSlice();
  shell.content.querySelector("[data-use-slice]").addEventListener("click", loadLatestSlice);
  shell.root.addEventListener("app:activate", event => {
    if (event.detail?.action === "load-latest-slice") loadLatestSlice();
    else if (event.detail?.action === "load-slice") loadSlice(event.detail.slice);
  });
  shell.root.addEventListener("app:navigate", event => {
    if (event.detail === "history") shell.content.querySelector(".cost-history").scrollIntoView({ behavior: "smooth", block: "start" });
    else if (event.detail === "settings") shell.content.querySelector("[data-params]").scrollIntoView({ behavior: "smooth", block: "center" });
    else if (event.detail === "estimate") shell.content.querySelector("#job-name").focus();
  });
  const unsubscribe = costs.subscribe(render);
  host.onDestroy?.(unsubscribe);
  render();
  return { root: shell.root, content: shell.content };
}

