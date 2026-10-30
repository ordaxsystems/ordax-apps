import * as shared from "/shared.mjs";

export function mountFeature(host = {}) {
  const { escapeHtml, number, money, bytes, toast, showModal, icon, button, stat, initials } = shared;
  if (typeof host.mountShell !== "function") throw new TypeError("A 3D feature must be mounted by its product app");
  if (typeof host.data?.read !== "function" || typeof host.data?.write !== "function") throw new TypeError("A 3D feature requires the public App Data port");
  const mountShell = host.mountShell;
  const readState = host.data.read.bind(host.data);
  const writeState = host.data.write.bind(host.data);

const acceptedUnits = ["mm", "cm", "in"];
const preferences = readState("inspecao-malha-preferencias", { unit: "mm" });
let unit = acceptedUnits.includes(preferences.unit) ? preferences.unit : "mm";
let recent = readState("inspecao-malha-recentes", []);
const demo = { name: "suporte_articulado.stl", size: "18,4 MB", vertices: "24.816", triangles: "8.272", dimensions: [142, 88, 64], rawVolume: 186400, closed: true, format: "STL", unit, isDemo: true };
let current = { ...demo };
const nav = [
  { id: "inspect", label: "Inspecionar", icon: "cube" },
  { id: "recent", label: "Análises recentes", icon: "clock", count: String(recent.length) },
  { id: "settings", label: "Unidades e análise", icon: "tune" },
];
const shell = mountShell({ title: "Inspeção de Malha", subtitle: "ANÁLISE DO MODELO 3D", nav, content: `<div class="inspector-grid"><section class="surface preview-panel"><div class="surface-head"><div><h2 data-file-name>${escapeHtml(current.name)}</h2><p data-file-meta></p></div><span class="pill green dot" data-health></span></div><div class="preview-canvas"><span class="axis-label">X · Y · Z</span><svg viewBox="0 0 220 220" aria-label="Prévia geométrica da malha"><g transform="translate(31 22)"><path class="mesh-shape" d="m80 2 70 40v83l-70 41-70-41V42z"/><path d="m10 42 70 41 70-41M80 83v83m-70-41 70-41 70 41" fill="none" stroke="#58734e" stroke-opacity=".5" stroke-width="1.7"/><path d="m80 2 70 40v83l-70 41-70-41V42z" fill="none" stroke="#58734e" stroke-width="2"/></g></svg><span class="preview-label">Visualização esquemática · sem escala de impressão</span></div><div class="metric-list"><div class="metric-box"><span>Dimensão X</span><strong data-dim="0"></strong></div><div class="metric-box"><span>Dimensão Y</span><strong data-dim="1"></strong></div><div class="metric-box"><span>Dimensão Z</span><strong data-dim="2"></strong></div><div class="metric-box"><span>Volume estimado</span><strong data-volume></strong></div></div></section><aside class="surface"><div class="surface-head"><div><h2>Diagnóstico da malha</h2><p>Verificações para preparar a impressão</p></div>${icon("tune",17)}</div><div class="check-list" data-checks></div><div class="surface-head"><div><h2>Dimensões da peça</h2><p>Caixa delimitadora · unidade presumida <select class="inline-select" data-unit aria-label="Unidade presumida"><option value="mm">mm</option><option value="cm">cm</option><option value="in">pol.</option></select></p></div></div><div class="dimension-bars"><div class="dimension-bar"><span>X</span><svg class="dimension-progress" data-bar="0" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true"></svg><strong data-bar-label="0"></strong></div><div class="dimension-bar"><span>Y</span><svg class="dimension-progress" data-bar="1" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true"></svg><strong data-bar-label="1"></strong></div><div class="dimension-bar"><span>Z</span><svg class="dimension-progress" data-bar="2" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true"></svg><strong data-bar-label="2"></strong></div></div><p class="format-note">STL e OBJ não definem escala. As medidas usam a unidade presumida selecionada; confirme-a no CAD ou slicer antes de fabricar.</p><div class="inspector-actions"><button class="button primary" type="button" data-open>${icon("upload",15)}<span>Abrir STL ou OBJ</span></button><button class="button secondary" type="button" data-report>Relatório</button></div></aside></div><input data-file type="file" accept=".stl,.obj" hidden/>` });
shell.actions.innerHTML = button("Abrir arquivo", 'data-open', "primary", "upload");

function vectorData(buffer, filename) {
  const lower = filename.toLowerCase();
  let vertices = [], triangles = [];
  if (lower.endsWith(".obj")) {
    const text = new TextDecoder().decode(buffer);
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      const vertex = trimmed.match(/^v\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)/);
      if (vertex) { vertices.push(vertex.slice(1).map(Number)); continue; }
      const face = trimmed.match(/^f\s+(.+)/);
      if (!face) continue;
      const indices = face[1].trim().split(/\s+/).map(token => Number(token.split("/")[0])).map(index => index < 0 ? vertices.length + index : index - 1);
      for (let i = 1; i < indices.length - 1; i++) { const points = [indices[0], indices[i], indices[i + 1]].map(index => vertices[index]); if (points.every(Boolean)) triangles.push(points); }
    }
  } else if (buffer.byteLength >= 84) {
    const view = new DataView(buffer), faceCount = view.getUint32(80, true), expected = 84 + faceCount * 50;
    if (expected === buffer.byteLength && faceCount < 10000000) {
      let offset = 84;
      for (let face = 0; face < faceCount; face++, offset += 50) {
        const points = [];
        for (let corner = 0; corner < 3; corner++) { const base = offset + 12 + corner * 12; points.push([view.getFloat32(base, true), view.getFloat32(base + 4, true), view.getFloat32(base + 8, true)]); }
        triangles.push(points); vertices.push(...points);
      }
    } else {
      const text = new TextDecoder().decode(buffer), regex = /vertex\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)/gi;
      let match;
      while ((match = regex.exec(text))) vertices.push(match.slice(1).map(Number));
      for (let i = 0; i + 2 < vertices.length; i += 3) triangles.push(vertices.slice(i, i + 3));
    }
  }
  if (!vertices.length || vertices.some(point => point.some(value => !Number.isFinite(value)))) throw new Error("Não encontrei vértices válidos nesse arquivo.");
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const point of vertices) point.forEach((value, axis) => { min[axis] = Math.min(min[axis], value); max[axis] = Math.max(max[axis], value); });
  const dimensions = min.map((value, axis) => max[axis] - value), edgeData = new Map();
  const key = point => point.map(value => Number(value).toFixed(5)).join(",");
  for (const triangle of triangles) for (let i = 0; i < 3; i++) {
    const a = key(triangle[i]), b = key(triangle[(i + 1) % 3]), edge = [a, b].sort().join("|");
    const data = edgeData.get(edge) || { count: 0, direction: 0 };
    data.count++;
    data.direction += a < b ? 1 : -1;
    edgeData.set(edge, data);
  }
  const closed = triangles.length > 0 && edgeData.size > 0 && [...edgeData.values()].every(edge => edge.count === 2 && edge.direction === 0);
  const signedVolume = triangles.reduce((sum, [a, b, c]) => sum + (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6, 0);
  return { vertices: vertices.length.toLocaleString("pt-BR"), triangles: triangles.length.toLocaleString("pt-BR"), dimensions, rawVolume: closed ? Math.abs(signedVolume) : null, closed };
}

function formatNumber(value, digits = 1) { return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value); }
function volumeLabel() {
  if (current.rawVolume === null) return "Não confiável";
  const value = current.isDemo
    ? current.unit === "in" ? current.rawVolume / 16387.064 : current.rawVolume / 1000
    : current.unit === "mm" ? current.rawVolume / 1000 : current.rawVolume;
  return `${formatNumber(value)} ${current.unit === "mm" ? "cm³" : current.unit === "cm" ? "cm³" : "pol.³"}`;
}
function refreshNav() { shell.root.querySelector('[data-nav="recent"] b')?.replaceChildren(String(recent.length)); }
function rememberAnalysis() {
  const record = { id: `mesh-${Date.now()}`, name: current.name, size: current.size, vertices: current.vertices, triangles: current.triangles, dimensions: current.dimensions, rawVolume: current.rawVolume, closed: current.closed, format: current.format, unit: current.unit, analyzedAt: new Date().toISOString() };
  recent = [record, ...recent.filter(item => item.name !== record.name)].slice(0, 10);
  writeState("inspecao-malha-recentes", recent);
  refreshNav();
}
function updateView() {
  const unitLabel = current.unit === "in" ? "pol." : current.unit;
  shell.content.querySelector("[data-file-name]").textContent = current.name;
  shell.content.querySelector("[data-file-meta]").textContent = `${current.format} · ${current.size} · Unidade presumida: ${unitLabel}${current.isDemo ? " · demonstração" : ""}`;
  shell.content.querySelector("[data-health]").textContent = current.isDemo ? "Demonstração" : current.closed ? "Topologia consistente" : "Revisar geometria";
  shell.content.querySelector("[data-health]").className = `pill ${!current.isDemo && current.closed ? "green" : "amber"} dot`;
  shell.content.querySelector("[data-unit]").value = current.unit;
  current.dimensions.forEach((value, axis) => {
    const displayed = current.isDemo ? value * (current.unit === "cm" ? 0.1 : current.unit === "in" ? 1 / 25.4 : 1) : value;
    const label = `${formatNumber(displayed)} ${unitLabel}`;
    shell.content.querySelector(`[data-dim="${axis}"]`).textContent = label;
    shell.content.querySelector(`[data-bar-label="${axis}"]`).textContent = label;
  });
  shell.content.querySelector("[data-volume]").textContent = volumeLabel();
  shell.content.querySelectorAll("[data-bar]").forEach(bar => { const pct = Math.max(7, current.dimensions[Number(bar.dataset.bar)] / Math.max(...current.dimensions) * 100); bar.innerHTML = `<rect class="progress-track" width="100" height="6" rx="3"/><rect class="progress-fill" width="${pct.toFixed(1)}" height="6" rx="3"/>`; });
  shell.content.querySelector("[data-checks]").innerHTML = `<div class="check-row"><span class="check-icon${!current.isDemo && current.closed ? "" : " warn"}">${!current.isDemo && current.closed ? icon("check", 13) : "!"}</span><div><strong>${current.isDemo ? "Exemplo ilustrativo" : current.closed ? "Arestas consistentes" : "Topologia precisa de revisão"}</strong><small>${current.isDemo ? "Os números de exemplo não vieram de um arquivo." : current.closed ? "Cada aresta aparece em duas faces com orientação consistente; confirme no CAD." : "Há arestas abertas, não-manifold ou com orientação inconsistente."}</small></div></div><div class="check-row"><span class="check-icon">${icon("check", 13)}</span><div><strong>${current.triangles} triângulos</strong><small>${current.isDemo ? "Dados ilustrativos do protótipo" : `${current.vertices} vértices lidos no arquivo`}</small></div></div><div class="check-row"><span class="check-icon warn">!</span><div><strong>Escala não declarada</strong><small>Exibindo coordenadas como ${unitLabel}; confirme a escala no CAD ou slicer.</small></div></div>`;
}
function applyAnalysis(metrics, name, size, format) {
  current = { ...metrics, name, size, format, unit, isDemo: false };
  rememberAnalysis();
  updateView();
}
function showRecent() {
  const modal = showModal({ title: "Análises recentes", saveLabel: "Fechar", content: recent.length ? `<p class="muted">O histórico guarda resultados e metadados, não os arquivos originais.</p><div class="detail-list">${recent.map(item => `<button type="button" class="button secondary" data-open-recent="${escapeHtml(item.id)}">${escapeHtml(item.name)} · ${escapeHtml(new Date(item.analyzedAt).toLocaleDateString("pt-BR"))} · ${escapeHtml(item.format)}</button>`).join("")}</div>` : `<p class="muted">Nenhuma análise foi salva neste navegador. Abra um STL ou OBJ para começar.</p>` });
  modal.addEventListener("click", event => {
    const choice = event.target.closest("[data-open-recent]");
    if (!choice) return;
    const item = recent.find(entry => entry.id === choice.dataset.openRecent);
    if (!item) return;
    current = { ...item, isDemo: false };
    unit = acceptedUnits.includes(item.unit) ? item.unit : unit;
    updateView();
    modal.remove();
  });
}

shell.content.querySelectorAll("[data-open]").forEach(button => button.addEventListener("click", () => shell.content.querySelector("[data-file]").click()));
shell.actions.querySelector("[data-open]").addEventListener("click", () => shell.content.querySelector("[data-file]").click());
shell.content.querySelector("[data-file]").addEventListener("change", async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { toast("O limite desta análise é 10 MB para manter o navegador responsivo."); event.target.value = ""; return; }
  try { applyAnalysis(vectorData(await file.arrayBuffer(), file.name), file.name, bytes(file.size), file.name.split(".").pop().toUpperCase()); toast("Malha analisada no navegador."); }
  catch (error) { toast(error.message || "Não foi possível analisar o arquivo."); }
  finally { event.target.value = ""; }
});
const unsubscribeMesh = host.files?.subscribe("mesh", async ({ filename, file }) => {
  if (!(file instanceof Blob) || file.size > 10 * 1024 * 1024) return;
  try { const name = String(filename || "modelo.stl"); applyAnalysis(vectorData(await file.arrayBuffer(), name), name, bytes(file.size), name.split(".").pop().toUpperCase()); toast("Modelo recebido da Biblioteca 3D e analisado nesta sessão."); }
  catch (error) { toast(error.message || "Não foi possível analisar o modelo recebido."); }
});
host.onDestroy?.(unsubscribeMesh);
shell.content.querySelector("[data-unit]").addEventListener("change", event => {
  const value = event.target.value;
  if (!acceptedUnits.includes(value)) return;
  unit = value;
  current.unit = value;
  writeState("inspecao-malha-preferencias", { unit });
  updateView();
});
shell.content.querySelector("[data-report]").addEventListener("click", () => {
  const unitLabel = current.unit === "in" ? "pol." : current.unit;
  const text = `Inspeção de malha\nArquivo: ${current.name}\nFormato: ${current.format}\nUnidade presumida: ${unitLabel}\nDimensões: ${current.dimensions.map(value => formatNumber(value)).join(" × ")} ${unitLabel}\nTriângulos: ${current.triangles}\nVolume estimado da malha: ${volumeLabel()}\n\nA escala não é declarada em STL/OBJ. Confirme as estimativas no CAD ou slicer antes da fabricação.`;
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" })), link = document.createElement("a");
  link.href = url; link.download = `${current.name.replace(/\.[^.]+$/, "")}-inspecao.txt`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast("Relatório de inspeção exportado.");
});
shell.root.addEventListener("app:navigate", event => {
  if (event.detail === "settings") { shell.content.querySelector("[data-unit]").scrollIntoView({ behavior: "smooth", block: "center" }); shell.content.querySelector("[data-unit]").focus(); }
  else if (event.detail === "recent") showRecent();
  else if (event.detail === "inspect") shell.content.querySelector("[data-file-name]").scrollIntoView({ behavior: "smooth", block: "center" });
});
updateView();
refreshNav();

  return { root: shell.root, content: shell.content };
}
