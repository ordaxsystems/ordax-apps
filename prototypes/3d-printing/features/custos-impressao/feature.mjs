import * as shared from "/shared.mjs";

export function mountFeature(host = {}) {
  const { escapeHtml, number, money, bytes, toast, showModal, icon, button, stat, initials } = shared;
  if (typeof host.mountShell !== "function") throw new TypeError("A 3D feature must be mounted by its product app");
  if (typeof host.data?.read !== "function" || typeof host.data?.write !== "function") throw new TypeError("A 3D feature requires the public App Data port");
  const mountShell = host.mountShell;
  const readState = host.data.read.bind(host.data);
  const writeState = host.data.write.bind(host.data);

const nav = [{ id: "estimate", label: "Novo orçamento", icon: "grid" }, { id: "history", label: "Orçamentos salvos", icon: "clock" }, { id: "settings", label: "Parâmetros", icon: "settings" }];
let history = readState("custos-impressao", []);
let spools = readState("materiais", []);
const shell = mountShell({ title: "Custos de Impressão", subtitle: "ESTIMATIVA E ORÇAMENTOS", nav, status: "Cálculo local", content: `<div class="cost-grid"><section class="surface cost-form"><div class="cost-section"><h2>Trabalho</h2><div class="form-grid"><div class="field"><label for="job-name">Nome do trabalho</label><input class="input" id="job-name" data-input="name" value="Suporte articulado"/></div><div class="field"><label for="quantity">Quantidade de peças</label><input class="input" id="quantity" data-input="quantity" type="number" min="1" value="1"/></div></div></div><div class="cost-section"><div class="cost-section-head">${icon("layers", 16)}<h2>Material e tempo</h2></div><div class="form-grid"><div class="field"><label for="grams">Filamento por peça</label><div class="unit-input"><input class="input" id="grams" data-input="grams" type="number" min="0" step="0.1" value="28.6"/><span>g</span></div></div><div class="field"><label for="spool">Bobina do estoque</label><select class="select" id="spool" data-spool aria-describedby="stock-note"></select></div><div class="field"><label for="price-kg">Preço calculado por kg</label><div class="currency-input"><span>R$</span><input class="input" id="price-kg" data-input="priceKg" type="number" min="0" step="0.01" value="119.90"/></div></div><div class="field"><label for="hours">Tempo de impressão por peça</label><div class="unit-input"><input class="input" id="hours" data-input="hours" type="number" min="0" step="0.1" value="2.6"/><span>h</span></div></div><div class="field"><label for="waste">Perda estimada de material</label><div class="unit-input"><input class="input" id="waste" data-input="waste" type="number" min="0" max="100" value="8"/><span>%</span></div></div></div><p class="cost-note" data-stock-note></p></div><div class="cost-section" data-params><div class="cost-section-head">${icon("settings", 16)}<h2>Operação e preço</h2></div><div class="form-grid"><div class="field"><label for="power">Potência média da impressora</label><div class="unit-input"><input class="input" id="power" data-input="power" type="number" min="0" value="120"/><span>W</span></div></div><div class="field"><label for="energy">Tarifa de energia</label><div class="currency-input"><span>R$</span><input class="input" id="energy" data-input="energy" type="number" min="0" step="0.01" value="0.95"/></div></div><div class="field"><label for="labor">Mão de obra por hora</label><div class="currency-input"><span>R$</span><input class="input" id="labor" data-input="labor" type="number" min="0" step="0.01" value="25"/></div></div><div class="field"><label for="margin">Acréscimo sobre o custo (markup)</label><div class="unit-input"><input class="input" id="margin" data-input="margin" type="number" min="0" max="1000" value="35"/><span>%</span></div></div></div></div></section><aside class="surface cost-result"><div class="quote-hero"><span>PREÇO SUGERIDO · POR PEÇA</span><strong data-total>R$ 0,00</strong><small data-quantity>1 unidade · estimativa local</small></div><div class="quote-breakdown"><div class="breakdown-row"><span>Custo do material</span><strong data-material>R$ 0,00</strong></div><div class="breakdown-row"><span>Energia estimada</span><strong data-electricity>R$ 0,00</strong></div><div class="breakdown-row"><span>Mão de obra estimada</span><strong data-labor>R$ 0,00</strong></div><div class="breakdown-row"><span>Base por peça</span><strong data-base>R$ 0,00</strong></div><div class="breakdown-row"><span>Markup sobre custo</span><strong data-margin>35%</strong></div><div class="breakdown-row total"><span>Total do pedido</span><strong data-order>R$ 0,00</strong></div></div><div class="quote-actions"><button class="button primary" type="button" data-save>${icon("check", 14)}<span>Salvar orçamento</span></button><button class="button secondary" type="button" data-export>${icon("file", 14)}<span>Exportar resumo</span></button></div><p class="cost-note">Estimativa simplificada. Inclua embalagem, depreciação, impostos, acabamento e perdas reais antes de fechar um preço comercial.</p></aside></div><section class="surface cost-history"><div class="surface-head"><div><h2>Orçamentos recentes</h2><p>Salvos neste navegador</p></div></div><div data-history></div></section>` });
shell.actions.innerHTML = button("Salvar orçamento", 'data-save', "primary", "check");
const fields = Object.fromEntries([...shell.content.querySelectorAll("[data-input]")].map(input => [input.dataset.input, input]));
const spoolSelect = shell.content.querySelector("[data-spool]");

function syncSpools() {
  const selected = spoolSelect.value;
  spools = readState("materiais", []);
  spoolSelect.innerHTML = `<option value="">Preço manual</option>${spools.map(spool => `<option value="${escapeHtml(spool.id)}">${escapeHtml(`${spool.material} · ${spool.colorName} · ${spool.brand}`)}</option>`).join("")}`;
  spoolSelect.value = spools.some(spool => String(spool.id) === selected) ? selected : (spools[0] ? String(spools[0].id) : "");
  updateSpoolPrice();
}
function selectedSpool() { return spools.find(spool => String(spool.id) === spoolSelect.value) ?? null; }
function updateSpoolPrice() {
  const spool = selectedSpool();
  fields.priceKg.readOnly = Boolean(spool);
  if (spool) fields.priceKg.value = (Number(spool.price || 0) / Math.max(1, Number(spool.total || 1000)) * 1000).toFixed(2);
  shell.content.querySelector("[data-stock-note]").textContent = spool
    ? `${spool.material} · ${spool.colorName}: ${Number(spool.remaining).toLocaleString("pt-BR")} g disponíveis. O orçamento consulta o estoque, mas não baixa o saldo.`
    : "Sem bobina selecionada: informe o preço manual por kg. O cálculo não altera o estoque.";
}
function calc() {
  const quantity = Math.max(1, Number(fields.quantity.value) || 1), grams = Math.max(0, Number(fields.grams.value) || 0), priceKg = Math.max(0, Number(fields.priceKg.value) || 0), hours = Math.max(0, Number(fields.hours.value) || 0), waste = Math.max(0, Number(fields.waste.value) || 0) / 100, power = Math.max(0, Number(fields.power.value) || 0), energy = Math.max(0, Number(fields.energy.value) || 0), laborRate = Math.max(0, Number(fields.labor.value) || 0), margin = Math.max(0, Number(fields.margin.value) || 0) / 100;
  const spool = selectedSpool(), material = grams * (1 + waste) * priceKg / 1000, electricity = hours * power / 1000 * energy, labor = hours * laborRate, base = material + electricity + labor, total = base * (1 + margin);
  return { quantity, grams, priceKg, hours, waste, power, energy, laborRate, margin, material, electricity, labor, base, total, order: total * quantity, name: fields.name.value.trim() || "Trabalho sem nome", spoolId: spool?.id ?? null, materialSource: spool ? `${spool.material} · ${spool.colorName}` : "Preço manual", stockRequired: grams * (1 + waste) * quantity, stockRemaining: spool ? Number(spool.remaining) : null };
}
function renderHistory() {
  const host = shell.content.querySelector("[data-history]");
  host.innerHTML = history.length ? history.slice(0, 5).map(item => `<div class="history-row"><div><strong>${escapeHtml(item.name)}</strong><small>${item.quantity} un. · ${escapeHtml(item.materialSource || "Preço manual")} · ${new Date(item.savedAt).toLocaleString("pt-BR")}</small></div><b>${money(item.order)}</b></div>`).join("") : `<div class="empty-state">Nenhum orçamento salvo ainda.</div>`;
}
function render() {
  const result = calc();
  shell.content.querySelector("[data-total]").textContent = money(result.total);
  shell.content.querySelector("[data-quantity]").textContent = `${result.quantity} ${result.quantity === 1 ? "unidade" : "unidades"} · estimativa local`;
  shell.content.querySelector("[data-material]").textContent = money(result.material);
  shell.content.querySelector("[data-electricity]").textContent = money(result.electricity);
  shell.content.querySelector("[data-labor]").textContent = money(result.labor);
  shell.content.querySelector("[data-base]").textContent = money(result.base);
  shell.content.querySelector("[data-margin]").textContent = `${(result.margin * 100).toLocaleString("pt-BR")} %`;
  shell.content.querySelector("[data-order]").textContent = money(result.order);
  if (result.stockRemaining !== null) {
    const shortage = result.stockRequired > result.stockRemaining;
    shell.content.querySelector("[data-stock-note]").textContent = `${result.materialSource}: ${result.stockRemaining.toLocaleString("pt-BR")} g disponíveis; orçamento requer ${result.stockRequired.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} g${shortage ? " — saldo insuficiente para esta quantidade" : ""}. O orçamento não baixa o saldo.`;
  }
}
function save() {
  const result = calc();
  history.unshift({ ...result, savedAt: new Date().toISOString() });
  history = history.slice(0, 30);
  writeState("custos-impressao", history);
  renderHistory();
  toast("Orçamento salvo neste navegador.");
}
function exportQuote() {
  const result = calc();
  const rows = [["Item", "Valor"], ["Trabalho", result.name], ["Quantidade", String(result.quantity)], ["Material", result.materialSource], ["Material por peça", money(result.material)], ["Energia por peça", money(result.electricity)], ["Mão de obra por peça", money(result.labor)], ["Markup sobre custo", `${(result.margin * 100).toLocaleString("pt-BR")} %`], ["Preço sugerido por peça", money(result.total)], ["Total do pedido", money(result.order)], ["Observação", "Estimativa simplificada; revise custos indiretos antes de cotar."]];
  const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = "orcamento-impressao-3d.csv"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("Resumo CSV exportado.");
}

syncSpools();
shell.content.querySelectorAll("[data-input]").forEach(input => input.addEventListener("input", render));
spoolSelect.addEventListener("change", () => { updateSpoolPrice(); render(); });
shell.content.querySelectorAll("[data-save]").forEach(button => button.addEventListener("click", save));
shell.actions.querySelector("[data-save]").addEventListener("click", save);
shell.content.querySelector("[data-export]").addEventListener("click", exportQuote);
shell.root.addEventListener("app:navigate", event => { if (event.detail === "history") shell.content.querySelector(".cost-history").scrollIntoView({ behavior: "smooth", block: "start" }); else if (event.detail === "settings") shell.content.querySelector("[data-params]").scrollIntoView({ behavior: "smooth", block: "center" }); });
render(); renderHistory();

  return { root: shell.root, content: shell.content };
}