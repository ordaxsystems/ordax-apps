import * as shared from "/shared.mjs";

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
  return `<div class="field"><label>${label}</label><div class="${currency ? `currency-input${unitName.length > 6 ? " currency-input--wide" : ""}` : "unit-input"}">${currency ? `<span>${unitName}</span>${input}` : `${input}<span>${unitName}</span>`}</div></div>`;
}

export function mountFeature(host = {}) {
  const { escapeHtml, toast, icon, button } = shared;
  const costs = host.manufacturingCosts;
  if (typeof host.mountShell !== "function" || typeof costs?.settings !== "function" || typeof costs?.calculate !== "function" || typeof costs?.saveEstimate !== "function" || typeof costs?.materialPriceFor !== "function" || typeof costs?.updateMaterialPrice !== "function") {
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
              <div class="field"><label for="printer-name">Impressora de referência</label><input class="input" id="printer-name" data-input="printer" placeholder="Ex.: Bambu Lab A1"/></div>
              <div class="field"><label for="quantity">Quantidade de peças ou lotes</label><input class="input" id="quantity" data-input="quantity" type="number" min="1" step="1" value="1"/></div>
            </div>
          </div>

          <section class="last-slice" aria-live="polite">
            <div class="last-slice-copy"><span class="panel-kicker">INTEGRAÇÃO COM O FATIADOR</span><strong data-last-slice-title>Nenhum fatiamento nesta sessão</strong><small data-last-slice-detail>Depois de fatiar, traga peso e tempo reais do Orca para este orçamento.</small></div>
            <button class="button secondary" type="button" data-use-slice disabled>${icon("layers", 14)}<span>Usar resultado</span></button>
          </section>

          <div class="cost-section">
            <div class="cost-section-head">${icon("layers", 16)}<h2>Consumo e tempo por unidade</h2></div>
            <div class="form-grid">
              <div class="field"><label for="grams" data-grams-label>Peso por peça</label><div class="unit-input"><input class="input" id="grams" data-input="gramsPerUnit" type="number" min="0.01" step="0.1" placeholder="Ex.: 28,6"/><span>g</span></div></div>
              <div class="field"><label for="price-kg">Preço deste material</label><div class="currency-input"><span>R$/kg</span><input class="input" id="price-kg" data-material-price type="number" min="0" step="0.01" value="${costs.materialPriceFor("PLA")}"/></div><small class="muted">Salvo como premissa local por material/perfil. O Inventory continua sendo dono de saldo e movimentações.</small></div>
              <div class="field"><label for="hours" data-hours-label>Tempo por peça</label><div class="unit-input"><input class="input" id="hours" data-input="hoursPerUnit" type="number" min="0.01" step="0.01" placeholder="Ex.: 2,6"/><span>h</span></div></div>
            </div>
          </div>

          <section class="cost-section cost-settings" data-params>
            <div class="cost-section-head">${icon("settings", 16)}<h2>Energia, impressora e operação</h2></div>
            <p class="section-help">A depreciação é rateada pelas horas produtivas: (aquisição − valor residual) ÷ vida útil.</p>
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
          <div class="quote-hero"><span data-estimate-status>AGUARDANDO DADOS</span><strong data-unit-cost>—</strong><small data-unit-label>Custo estimado por peça</small></div>
          <div class="quote-breakdown">
            <div class="breakdown-row emphasis"><span>Preço de referência por unidade</span><strong data-unit-price>—</strong></div>
            <div class="breakdown-row"><span>Material com perda</span><strong data-material>R$ 0,00</strong></div>
            <div class="breakdown-row"><span>Energia</span><strong data-energy>R$ 0,00</strong></div>
            <div class="breakdown-row"><span>Depreciação da impressora</span><strong data-depreciation>Não configurada</strong></div>
            <div class="breakdown-row"><span>Manutenção e desgaste</span><strong data-maintenance>R$ 0,00</strong></div>
            <div class="breakdown-row"><span>Outros custos da máquina</span><strong data-machine-overhead>R$ 0,00</strong></div>
            <div class="breakdown-row"><span>Mão de obra e acabamento</span><strong data-labor>R$ 0,00</strong></div>
            <div class="breakdown-row"><span>Embalagem e outros</span><strong data-extra>R$ 0,00</strong></div>
            <div class="breakdown-row total"><span>Custo do lote</span><strong data-batch-cost>R$ 0,00</strong></div>
            <div class="breakdown-row"><span>Tributos e taxa de canal/pagamento</span><strong data-variable-sales-expenses>R$ 0,00</strong></div>
            <div class="breakdown-row"><span>Taxa fixa e frete absorvido</span><strong data-fixed-sales-expenses>R$ 0,00</strong></div>
            <div class="breakdown-row"><span>Preço de referência do lote</span><strong data-batch-price>R$ 0,00</strong></div>
            <div class="breakdown-row"><span>Resultado estimado do lote</span><strong data-profit>R$ 0,00</strong></div>
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
      return `<div class="history-row"><div><strong>${escapeHtml(item.name)}</strong><small>${item.quantity} ${scope}${item.quantity === 1 ? "" : "s"} · ${escapeHtml(item.material)} · ${escapeHtml(new Date(item.savedAt).toLocaleString("pt-BR"))}${completeness} · local</small></div><div class="history-values"><b>${money(Number(item.suggestedPriceTotal ?? item.totalEstimate ?? item.order ?? 0))}</b><small>preço de referência</small></div></div>`;
    }).join("") : `<div class="empty-state">Nenhum orçamento salvo ainda.</div>`;
  }

  function renderLatestSlice() {
    const latest = costs.latestSlice();
    const title = shell.content.querySelector("[data-last-slice-title]");
    const detail = shell.content.querySelector("[data-last-slice-detail]");
    const useButton = shell.content.querySelector("[data-use-slice]");
    if (!latest) {
      title.textContent = "Nenhum fatiamento nesta sessão";
      detail.textContent = "Depois de fatiar, traga peso e tempo reais do Orca para este orçamento.";
      useButton.disabled = true;
      return;
    }
    title.textContent = latest.name;
    const grams = latest.grams === null ? "peso não informado" : `${unit(latest.grams)} g`;
    const time = latest.timeSeconds === null ? "tempo não informado" : `${unit(latest.timeSeconds / 3600, 2)} h`;
    detail.textContent = `${latest.material} · ${latest.printer} · ${grams} · ${time}${latest.engine ? ` · ${latest.engine} ${latest.engineVersion}` : ""}`;
    useButton.disabled = latest.grams === null || latest.timeSeconds === null;
  }

  function render() {
    renderLatestSlice();
    renderHistory();
    const result = costs.calculate(estimateInput());
    const settingsNow = costs.settings();
    shell.content.querySelector("[data-estimate-status]").textContent = result.available ? !result.pricingValid ? "REVISE MARGEM E TAXAS" : result.complete ? "ESTIMATIVA TÉCNICA COMPLETA" : "CUSTO PARCIAL · DEPRECIAÇÃO PENDENTE" : "INFORME PESO E TEMPO";
    shell.content.querySelector("[data-unit-cost]").textContent = result.available ? money(result.costPerUnit) : "—";
    shell.content.querySelector("[data-unit-label]").textContent = `Custo estimado por ${formScope === "plate" ? "lote" : "peça"}`;
    shell.content.querySelector("[data-unit-price]").textContent = result.available ? result.pricingValid ? money(result.suggestedPricePerUnit) : "Revise margem/taxas" : "—";
    shell.content.querySelector("[data-material]").textContent = result.available ? money(result.components.material) : "—";
    shell.content.querySelector("[data-energy]").textContent = result.available ? money(result.components.energy) : "—";
    shell.content.querySelector("[data-depreciation]").textContent = result.available && result.components.depreciationPerHour !== null ? money(result.components.depreciation) : "Configure aquisição e vida útil";
    shell.content.querySelector("[data-maintenance]").textContent = result.available ? money(result.components.maintenance) : "—";
    shell.content.querySelector("[data-machine-overhead]").textContent = result.available ? money(result.components.machineOverhead) : "—";
    shell.content.querySelector("[data-labor]").textContent = result.available ? money(result.components.labor) : "—";
    shell.content.querySelector("[data-extra]").textContent = result.available ? money(result.components.packaging + result.components.other) : "—";
    shell.content.querySelector("[data-batch-cost]").textContent = result.available ? money(result.totalCost) : "—";
    shell.content.querySelector("[data-variable-sales-expenses]").textContent = result.available && result.pricingValid ? money(result.components.taxes + result.components.salesFee) : result.available ? "Revise margem/taxas" : "—";
    shell.content.querySelector("[data-fixed-sales-expenses]").textContent = result.available ? money(result.components.fixedSaleFee * result.quantity + result.components.absorbedShipping * result.quantity) : "—";
    shell.content.querySelector("[data-batch-price]").textContent = result.available ? result.pricingValid ? money(result.suggestedPriceTotal) : "Revise margem/taxas" : "—";
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
        ? "Estimativa técnica local com as premissas configuradas. Não cria pedido comercial, preço aprovado, cobrança, lançamento contábil nem movimentação de estoque."
        : "O custo inclui os itens preenchidos, mas não inclui depreciação até informar aquisição, residual e vida útil da impressora. Tributos e taxas são apenas premissas informadas, não apuração fiscal.";
    shell.content.querySelectorAll("[data-save], [data-export]").forEach(item => { item.disabled = !result.available || !result.pricingValid; });
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
      ["Material", result.material],
      ["Preço informado do material (R$/kg)", String(result.materialPricePerKg)],
      ["Impressora", result.printer],
      ["Quantidade", String(result.quantity)],
      ["Peso por unidade-base (g)", String(result.gramsPerUnit)],
      ["Tempo por unidade-base (h)", String(result.hoursPerUnit)],
      ["Material com perdas", money(result.components.material)],
      ["Energia", money(result.components.energy)],
      ["Depreciação", result.components.depreciationPerHour === null ? "Não configurada" : money(result.components.depreciation)],
      ["Manutenção e desgaste", money(result.components.maintenance)],
      ["Outros custos da máquina", money(result.components.machineOverhead)],
      ["Mão de obra e acabamento", money(result.components.labor)],
      ["Embalagem e outros", money(result.components.packaging + result.components.other)],
      ["Tributos estimados", money(result.components.taxes)],
      ["Taxa de canal ou pagamento", money(result.components.salesFee)],
      ["Taxa fixa por pedido", money(result.settings.fixedSaleFeePerOrder)],
      ["Frete absorvido por pedido", money(result.settings.shippingAbsorbedPerOrder)],
      ["Custo estimado por unidade-base", money(result.costPerUnit)],
      ["Custo estimado do lote", money(result.totalCost)],
      ["Preço de referência por unidade-base", money(result.suggestedPricePerUnit)],
      ["Preço de referência do lote", money(result.suggestedPriceTotal)],
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
  fields.material.addEventListener("change", () => { materialPriceField.value = String(costs.materialPriceFor(fields.material.value)); });
  materialPriceField.addEventListener("input", () => {
    if (materialPriceField.value === "") return;
    try { costs.updateMaterialPrice(fields.material.value, readNumber(materialPriceField.value)); render(); }
    catch (error) { toast(error?.message || "Não foi possível salvar o preço do material."); }
  });
  shell.content.querySelectorAll("[data-input]").forEach(input => input.addEventListener("input", () => { formSource = "manual"; formScope = "piece"; formEngine = ""; formEngineVersion = ""; render(); }));
  shell.content.querySelectorAll("[data-setting]").forEach(input => {
    const saveSetting = () => {
      const value = input.dataset.setting === "pricingMode" ? input.value : readNumber(input.value);
      const saved = costs.updateSettings({ [input.dataset.setting]: value });
      const normalized = saved[input.dataset.setting];
      if (input.tagName === "SELECT" || input.value !== "" && Number(input.value) !== normalized) input.value = String(normalized);
      if (["printerPurchasePrice", "printerResidualValue"].includes(input.dataset.setting)) {
        for (const key of ["printerPurchasePrice", "printerResidualValue"]) {
          const dependent = shell.content.querySelector(`[data-setting="${key}"]`);
          dependent.value = String(saved[key]);
        }
      }
      render();
    };
    input.addEventListener("input", saveSetting);
  });
  shell.content.querySelectorAll("[data-save]").forEach(item => item.addEventListener("click", save));
  shell.actions.querySelector("[data-save]").addEventListener("click", save);
  shell.content.querySelector("[data-export]").addEventListener("click", exportEstimate);
  shell.content.querySelector("[data-use-slice]").addEventListener("click", () => {
    const latest = costs.latestSlice();
    if (!latest || latest.grams === null || latest.timeSeconds === null) return;
    fields.name.value = latest.name;
    fields.material.value = latest.material;
    materialPriceField.value = String(costs.materialPriceFor(latest.material));
    fields.printer.value = latest.printer;
    fields.quantity.value = "1";
    fields.gramsPerUnit.value = String(latest.grams);
    fields.hoursPerUnit.value = String(latest.timeSeconds / 3600);
    formSource = "slicer";
    formScope = latest.scope;
    formEngine = latest.engine;
    formEngineVersion = latest.engineVersion;
    render();
    shell.content.querySelector("[data-grams-label]").scrollIntoView({ behavior: "smooth", block: "center" });
    toast("Peso e tempo do fatiador carregados; revise a quantidade e as premissas.");
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
