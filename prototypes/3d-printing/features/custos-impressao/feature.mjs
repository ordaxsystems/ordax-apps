import * as shared from "/shared.mjs";

export function mountFeature(host = {}) {
  const { escapeHtml, money, toast, icon, button } = shared;
  if (typeof host.mountShell !== "function" || typeof host.data?.read !== "function" || typeof host.data?.write !== "function") throw new TypeError("A estimativa precisa da porta App Data do host OrdaX 3D.");
  const nav = [{ id: "estimate", label: "Nova estimativa", icon: "grid" }, { id: "history", label: "Histórico local", icon: "clock" }, { id: "settings", label: "Parâmetros", icon: "settings" }];
  let history = host.data.read("manufacturing-estimates", []);
  if (!Array.isArray(history)) history = [];
  history = history.map(({ spoolId, stockRemaining, stockRequired, ...estimate }) => estimate);
  const shell = host.mountShell({ title: "Estimativa de fabricação", subtitle: "CÁLCULO TÉCNICO · SEM PEDIDO COMERCIAL", nav, status: "Cálculo local", content: `<div class="cost-grid"><section class="surface cost-form"><div class="cost-section"><h2>Trabalho técnico</h2><div class="form-grid"><div class="field"><label for="job-name">Nome do trabalho</label><input class="input" id="job-name" data-input="name" value="Suporte articulado"/></div><div class="field"><label for="quantity">Quantidade de peças</label><input class="input" id="quantity" data-input="quantity" type="number" min="1" value="1"/></div></div></div><div class="cost-section"><div class="cost-section-head">${icon("layers",16)}<h2>Material e tempo estimados</h2></div><div class="form-grid"><div class="field"><label for="grams">Filamento estimado por peça</label><div class="unit-input"><input class="input" id="grams" data-input="grams" type="number" min="0" step="0.1" value="28.6"/><span>g</span></div></div><div class="field"><label for="price-kg">Preço de referência do material</label><div class="currency-input"><span>R$</span><input class="input" id="price-kg" data-input="priceKg" type="number" min="0" step="0.01" value="119.90"/></div><small class="muted">Informe o valor manualmente; não consulta saldo nem cadastro do Inventory.</small></div><div class="field"><label for="hours">Tempo por peça</label><div class="unit-input"><input class="input" id="hours" data-input="hours" type="number" min="0" step="0.1" value="2.6"/><span>h</span></div></div><div class="field"><label for="waste">Perda estimada de material</label><div class="unit-input"><input class="input" id="waste" data-input="waste" type="number" min="0" max="100" value="8"/><span>%</span></div></div></div></div><div class="cost-section" data-params><div class="cost-section-head">${icon("settings",16)}<h2>Custos operacionais de referência</h2></div><div class="form-grid"><div class="field"><label for="power">Potência média</label><div class="unit-input"><input class="input" id="power" data-input="power" type="number" min="0" value="120"/><span>W</span></div></div><div class="field"><label for="energy">Tarifa de energia</label><div class="currency-input"><span>R$</span><input class="input" id="energy" data-input="energy" type="number" min="0" step="0.01" value="0.95"/></div></div><div class="field"><label for="labor">Mão de obra por hora</label><div class="currency-input"><span>R$</span><input class="input" id="labor" data-input="labor" type="number" min="0" step="0.01" value="25"/></div></div><div class="field"><label for="margin">Markup de referência</label><div class="unit-input"><input class="input" id="margin" data-input="margin" type="number" min="0" max="1000" value="35"/><span>%</span></div></div></div></div></section><aside class="surface cost-result"><div class="quote-hero"><span>ESTIMATIVA TÉCNICA · POR PEÇA</span><strong data-total>R$ 0,00</strong><small data-quantity>1 unidade · cálculo local</small></div><div class="quote-breakdown"><div class="breakdown-row"><span>Material</span><strong data-material>R$ 0,00</strong></div><div class="breakdown-row"><span>Energia estimada</span><strong data-electricity>R$ 0,00</strong></div><div class="breakdown-row"><span>Mão de obra estimada</span><strong data-labor>R$ 0,00</strong></div><div class="breakdown-row"><span>Base calculada</span><strong data-base>R$ 0,00</strong></div><div class="breakdown-row"><span>Markup aplicado</span><strong data-margin>35%</strong></div><div class="breakdown-row total"><span>Total estimado</span><strong data-order>R$ 0,00</strong></div></div><div class="quote-actions"><button class="button primary" type="button" data-save>${icon("check",14)}<span>Salvar estimativa</span></button><button class="button secondary" type="button" data-export>${icon("file",14)}<span>Exportar resumo</span></button></div><p class="cost-note">Este cálculo é uma referência técnica local. Não cria pedido, preço comercial aprovado, cobrança ou pagamento; o owner Vendas é responsável pelo pedido comercial.</p></aside></div><section class="surface cost-history"><div class="surface-head"><div><h2>Estimativas salvas</h2><p>Histórico deste protótipo local</p></div></div><div data-history></div></section>` });
  shell.actions.innerHTML = button("Salvar estimativa", "data-save", "primary", "check");
  const fields = Object.fromEntries([...shell.content.querySelectorAll("[data-input]")].map(input => [input.dataset.input, input]));
  function calc() {
    const quantity = Math.max(1, Math.round(Number(fields.quantity.value) || 1));
    const grams = Math.max(0, Number(fields.grams.value) || 0), priceKg = Math.max(0, Number(fields.priceKg.value) || 0);
    const hours = Math.max(0, Number(fields.hours.value) || 0), waste = Math.max(0, Number(fields.waste.value) || 0) / 100;
    const power = Math.max(0, Number(fields.power.value) || 0), energy = Math.max(0, Number(fields.energy.value) || 0);
    const laborRate = Math.max(0, Number(fields.labor.value) || 0), margin = Math.max(0, Number(fields.margin.value) || 0) / 100;
    const material = grams * (1 + waste) * priceKg / 1000, electricity = hours * power / 1000 * energy, labor = hours * laborRate;
    const base = material + electricity + labor, unitEstimate = base * (1 + margin);
    return { quantity, grams, priceKg, hours, waste, power, energy, laborRate, margin, material, electricity, labor, base, unitEstimate, totalEstimate: unitEstimate * quantity, name: fields.name.value.trim() || "Trabalho sem nome", origin: "local-preview" };
  }
  function renderHistory() {
    const host = shell.content.querySelector("[data-history]");
    host.innerHTML = history.length ? history.slice(0, 12).map(item => `<div class="history-row"><div><strong>${escapeHtml(item.name)}</strong><small>${item.quantity} un. · ${escapeHtml(new Date(item.savedAt).toLocaleString("pt-BR"))} · estimativa local</small></div><b>${money(Number(item.totalEstimate ?? item.order ?? 0))}</b></div>`).join("") : `<div class="empty-state">Nenhuma estimativa salva ainda.</div>`;
  }
  function render() {
    const result = calc();
    shell.content.querySelector("[data-total]").textContent = money(result.unitEstimate);
    shell.content.querySelector("[data-quantity]").textContent = `${result.quantity} ${result.quantity === 1 ? "unidade" : "unidades"} · cálculo local`;
    shell.content.querySelector("[data-material]").textContent = money(result.material);
    shell.content.querySelector("[data-electricity]").textContent = money(result.electricity);
    shell.content.querySelector("[data-labor]").textContent = money(result.labor);
    shell.content.querySelector("[data-base]").textContent = money(result.base);
    shell.content.querySelector("[data-margin]").textContent = `${(result.margin * 100).toLocaleString("pt-BR")} %`;
    shell.content.querySelector("[data-order]").textContent = money(result.totalEstimate);
  }
  function save() {
    const estimate = { ...calc(), savedAt: new Date().toISOString() };
    history = [estimate, ...history].slice(0, 30);
    host.data.write("manufacturing-estimates", history);
    renderHistory();
    toast("Estimativa técnica salva localmente.");
  }
  function exportEstimate() {
    const result = calc();
    const rows = [["Campo", "Valor"], ["Trabalho técnico", result.name], ["Quantidade", String(result.quantity)], ["Material informado", `${result.grams} g por peça · R$ ${result.priceKg}/kg`], ["Material estimado por peça", money(result.material)], ["Energia estimada por peça", money(result.electricity)], ["Mão de obra estimada por peça", money(result.labor)], ["Markup de referência", `${result.margin * 100}%`], ["Estimativa por peça", money(result.unitEstimate)], ["Estimativa total", money(result.totalEstimate)], ["Natureza", "Cálculo técnico local; não é pedido comercial nem lançamento financeiro."]];
    const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "estimativa-fabricacao-3d.csv"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Resumo de estimativa exportado.");
  }
  shell.content.querySelectorAll("[data-input]").forEach(input => input.addEventListener("input", render));
  shell.content.querySelectorAll("[data-save]").forEach(item => item.addEventListener("click", save));
  shell.actions.querySelector("[data-save]").addEventListener("click", save);
  shell.content.querySelector("[data-export]").addEventListener("click", exportEstimate);
  shell.root.addEventListener("app:navigate", event => { if (event.detail === "history") shell.content.querySelector(".cost-history").scrollIntoView({ behavior: "smooth", block: "start" }); else if (event.detail === "settings") shell.content.querySelector("[data-params]").scrollIntoView({ behavior: "smooth", block: "center" }); });
  render(); renderHistory();
  return { root: shell.root, content: shell.content };
}
