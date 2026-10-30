import * as shared from "/shared.mjs";

export function mountFeature(host = {}) {
  const { escapeHtml, number, money, bytes, toast, showModal, icon, button, stat, initials } = shared;
  if (typeof host.mountShell !== "function") throw new TypeError("A 3D feature must be mounted by its product app");
  if (typeof host.data?.read !== "function" || typeof host.data?.write !== "function") throw new TypeError("A 3D feature requires the public App Data port");
  const mountShell = host.mountShell;
  const readState = host.data.read.bind(host.data);
  const writeState = host.data.write.bind(host.data);

const seed = [
  { id: "m1", name: "Suporte articulado", format: "3MF", category: "Organização", collectionId: "workshop", size: "18,4 MB", updated: "Hoje, 10:42", dimensions: "142 × 88 × 64 mm", favorite: true, color: "#8fa77f" },
  { id: "m2", name: "Vaso geométrico", format: "STL", category: "Casa", collectionId: "useful", size: "6,2 MB", updated: "Ontem", dimensions: "112 × 112 × 180 mm", favorite: false, color: "#c69e71" },
  { id: "m3", name: "Organizador modular", format: "3MF", category: "Oficina", collectionId: "workshop", size: "24,1 MB", updated: "18 out, 16:20", dimensions: "220 × 160 × 42 mm", favorite: true, color: "#839bab" },
  { id: "m4", name: "Clipe para cabos", format: "STL", category: "Acessórios", collectionId: "useful", size: "840 KB", updated: "16 out, 09:12", dimensions: "38 × 22 × 15 mm", favorite: false, color: "#a795ad" },
  { id: "m5", name: "Peça de reposição A7", format: "STEP", category: "Reparos", collectionId: "workshop", size: "3,8 MB", updated: "12 out, 14:05", dimensions: "76 × 52 × 31 mm", favorite: false, color: "#ca8175" },
];
const collectionSeed = [{ id: "workshop", name: "Projetos da oficina", note: "Modelos para trabalhos ativos." }, { id: "useful", name: "Peças úteis", note: "Peças e melhorias para impressão." }];
let models = readState("biblioteca-3d", seed);
let collections = readState("biblioteca-3d-collections", collectionSeed);
let filter = "all";
const nav = [{ id: "all", label: "Todos os modelos", icon: "grid" }, { id: "recent", label: "Recentes", icon: "clock" }, { id: "favorites", label: "Favoritos", icon: "check" }, { id: "collections", label: "Coleções", icon: "layers" }];
const shell = mountShell({ title: "Biblioteca 3D", subtitle: "SEUS ARQUIVOS DE IMPRESSÃO", nav, content: `<div class="stat-grid">${["Modelos", "Coleções", "Favoritos", "Espaço usado"].map(label => `<article class="stat-card"><span>${label}</span><strong data-stat="${label}">—</strong><small>${({ "Modelos": "Na biblioteca", "Coleções": "Organize por projeto", "Favoritos": "Acesso rápido", "Espaço usado": "Tamanho informado dos arquivos" })[label]}</small></article>`).join("")}</div><div class="library-toolbar"><div class="library-summary"><span class="status-dot"></span><span data-count></span></div><div class="toolbar"><label class="search-box">${icon("search", 16)}<input data-search placeholder="Buscar modelo ou coleção" aria-label="Buscar modelo" /></label><select class="inline-select" data-sort aria-label="Ordenar modelos"><option value="recent">Mais recentes</option><option value="name">Nome A–Z</option><option value="size">Tamanho</option></select><button class="button primary" type="button" data-import>${icon("upload", 16)}<span>Importar modelo</span></button></div></div><div data-collection-heading hidden></div><div class="library-tabs"><button class="library-tab active" type="button" data-filter="all">Todos</button><button class="library-tab" type="button" data-filter="favorites">Favoritos</button><button class="library-tab" type="button" data-filter="recent">Recentes</button></div><div class="library-grid" data-grid></div><input type="file" data-file accept=".stl,.3mf,.step,.stp,.obj" hidden />` });
shell.actions.innerHTML = button("Nova coleção", 'data-collection', "secondary", "plus");
const grid = shell.content.querySelector("[data-grid]");
const collectionHeading = shell.content.querySelector("[data-collection-heading]");
function sizeInBytes(item) {
  if (Number.isFinite(Number(item.sizeBytes))) return Number(item.sizeBytes);
  const match = String(item.size ?? "").match(/([\d.,]+)\s*(B|KB|MB|GB)/i);
  if (!match) return 0;
  const unit = match[2].toUpperCase(), factor = unit === "GB" ? 1024 ** 3 : unit === "MB" ? 1024 ** 2 : unit === "KB" ? 1024 : 1;
  return Number(match[1].replace(",", ".")) * factor;
}
function isRecent(item) {
  if (item.createdAt && Date.now() - Date.parse(item.createdAt) <= 7 * 24 * 60 * 60 * 1000) return true;
  return /^(agora|hoje|ontem)\b/i.test(String(item.updated));
}

function modelSvg(color) {
  return `<svg viewBox="0 0 120 120" aria-hidden="true"><g transform="translate(15 18)"><path d="m45 4 38 21v46L45 93 7 71V25z" fill="${color}" opacity=".32"/><path d="m45 4 38 21-38 22L7 25z" fill="${color}"/><path d="M7 25v46l38 22V47z" fill="${color}" opacity=".77"/><path d="m45 47 38-22v46L45 93z" fill="${color}" opacity=".56"/><path d="m45 4 38 21-38 22L7 25zM45 47v46M7 25v46l38 22 38-22V25" fill="none" stroke="#4e6750" stroke-opacity=".38" stroke-width="1.3"/></g></svg>`;
}
function render() {
  const query = shell.content.querySelector("[data-search]").value.trim().toLowerCase();
  const totalSize = models.reduce((sum, item) => sum + sizeInBytes(item), 0);
  const stats = { "Modelos": models.length, "Coleções": collections.length, "Favoritos": models.filter(item => item.favorite).length, "Espaço usado": bytes(totalSize) };
  for (const [label, value] of Object.entries(stats)) shell.content.querySelector(`[data-stat="${label}"]`).textContent = value;
  shell.content.querySelector("[data-count]").textContent = `${models.length} modelos · ${collections.length} coleções`;
  shell.root.querySelector('[data-nav="all"] b')?.replaceChildren(String(models.length));
  shell.root.querySelector('[data-nav="favorites"] b')?.replaceChildren(String(stats.Favoritos));
  shell.root.querySelector('[data-nav="collections"] b')?.replaceChildren(String(collections.length));
  if (filter === "collections") {
    collectionHeading.hidden = true;
    const visible = collections.filter(item => `${item.name} ${item.note}`.toLowerCase().includes(query));
    grid.innerHTML = visible.length ? visible.map(item => { const count = models.filter(model => model.collectionId === item.id).length; return `<button class="collection-card" type="button" data-open-collection="${escapeHtml(item.id)}"><span>${icon("layers", 28)}<strong>${escapeHtml(item.name)}</strong><p>${escapeHtml(item.note || "Coleção de modelos.")}<br/>${count} modelo${count === 1 ? "" : "s"}</p></span></button>`; }).join("") + `<button class="collection-card" type="button" data-collection><span>${icon("plus", 24)}<strong>Criar coleção</strong><p>Organize modelos por projeto,<br/>cliente ou uso.</p></span></button>` : `<div class="empty-state">Nenhuma coleção encontrada.</div>`;
    return;
  }
  const activeCollection = collections.find(item => item.id === filter.slice("collection:".length));
  collectionHeading.hidden = !activeCollection;
  collectionHeading.innerHTML = activeCollection ? `<button class="button ghost" type="button" data-back-collections>← Coleções</button><strong>${escapeHtml(activeCollection.name)}</strong>` : "";
  let items = models.filter(item => filter === "favorites" ? item.favorite : filter === "recent" ? isRecent(item) : activeCollection ? item.collectionId === activeCollection.id : true).filter(item => `${item.name} ${item.category} ${item.format}`.toLowerCase().includes(query));
  const sort = shell.content.querySelector("[data-sort]").value;
  items = [...items].sort(sort === "name" ? (a, b) => a.name.localeCompare(b.name) : sort === "size" ? (a, b) => sizeInBytes(a) - sizeInBytes(b) : (a, b) => a.createdAt && b.createdAt ? Date.parse(b.createdAt) - Date.parse(a.createdAt) : a.createdAt ? -1 : b.createdAt ? 1 : models.indexOf(a) - models.indexOf(b));
  grid.innerHTML = items.length ? items.map(item => `<article class="model-card"><div class="model-visual">${modelSvg(item.color)}<span class="pill format-tag">${escapeHtml(item.format)}</span></div><div class="model-meta"><div class="model-name-line"><div><h3 class="card-title">${escapeHtml(item.name)}</h3><p class="card-subtitle">${escapeHtml(item.category)}</p></div><button class="favorite${item.favorite ? " on" : ""}" type="button" data-favorite="${escapeHtml(item.id)}" aria-label="${item.favorite ? "Remover dos" : "Adicionar aos"} favoritos">${icon("check", 17)}</button></div><div class="model-sub"><span>${escapeHtml(item.size)}</span><span>${escapeHtml(item.updated)}</span></div><div class="model-foot"><small>${escapeHtml(item.dimensions)}</small><button class="button ghost small-actions" type="button" data-detail="${escapeHtml(item.id)}">Detalhes ${icon("chevron", 14)}</button></div></div></article>`).join("") : `<div class="empty-state"><strong>Nenhum modelo encontrado</strong>Importe um modelo ou ajuste sua busca.</div>`;
}
function persist() { writeState("biblioteca-3d", models); }
function persistCollections() { writeState("biblioteca-3d-collections", collections); }
function openImport() { shell.content.querySelector("[data-file]").click(); }
function addCollection() {
  showModal({ title: "Nova coleção", content: `<div class="field"><label for="collection-name">Nome da coleção</label><input id="collection-name" name="name" class="input" placeholder="Ex.: Peças para cliente" required /></div><div class="field"><label for="collection-note">Descrição (opcional)</label><input id="collection-note" name="note" class="input" placeholder="O que será organizado aqui?" /></div>`, saveLabel: "Criar coleção", onSave: form => { const name = String(form.get("name") || "").trim(); if (!name) return false; collections.push({ id: `collection-${Date.now()}`, name, note: String(form.get("note") || "").trim() }); persistCollections(); filter = "collections"; render(); toast(`Coleção “${name}” criada.`); } });
}
shell.content.querySelector("[data-import]").addEventListener("click", openImport);
shell.content.querySelector("[data-file]").addEventListener("change", async event => {
  const file = event.target.files?.[0]; if (!file) return;
  const ext = file.name.split(".").pop().toUpperCase();
  models.unshift({ id: `local-${Date.now()}`, name: file.name.replace(/\.[^.]+$/, ""), format: ext, category: "Importado", size: bytes(file.size), sizeBytes: file.size, createdAt: new Date().toISOString(), updated: "Agora", dimensions: "Aguardando inspeção", favorite: false, color: "#8fa77f" });
  persist(); render();
  const transferred = ["STL", "OBJ"].includes(ext) && file.size <= 10 * 1024 * 1024 && host.files?.publish("mesh", { filename: file.name, file });
  toast(transferred ? "Modelo adicionado e pronto para Inspeção de Malha nesta sessão." : "Referência adicionada; abra novamente o STL ou OBJ na Inspeção de Malha.");
  event.target.value = "";
});
shell.content.querySelector("[data-search]").addEventListener("input", render);
shell.content.querySelector("[data-sort]").addEventListener("change", render);
shell.content.querySelectorAll("[data-filter]").forEach(tab => tab.addEventListener("click", () => { filter = tab.dataset.filter; shell.content.querySelectorAll("[data-filter]").forEach(item => item.classList.toggle("active", item === tab)); render(); }));
shell.content.addEventListener("click", event => {
  if (event.target.closest("[data-collection]")) { addCollection(); return; }
  const openCollection = event.target.closest("[data-open-collection]");
  if (openCollection) { filter = `collection:${openCollection.dataset.openCollection}`; render(); return; }
  if (event.target.closest("[data-back-collections]")) { filter = "collections"; render(); return; }
  const favorite = event.target.closest("[data-favorite]");
  if (favorite) { models = models.map(item => item.id === favorite.dataset.favorite ? { ...item, favorite: !item.favorite } : item); persist(); render(); return; }
  const detail = event.target.closest("[data-detail]");
  if (detail) { const item = models.find(entry => entry.id === detail.dataset.detail); if (!item) return; showModal({ title: item.name, saveLabel: "Salvar alterações", content: `<div class="model-detail"><div class="detail-visual">${modelSvg(item.color)}</div><div class="detail-list"><div><small>Formato</small><strong>${escapeHtml(item.format)}</strong></div><div><small>Tamanho</small><strong>${escapeHtml(item.size)}</strong></div><div><small>Dimensões</small><strong>${escapeHtml(item.dimensions)}</strong></div><div><small>Categoria</small><strong>${escapeHtml(item.category)}</strong></div></div></div><div class="field"><label for="model-collection">Coleção</label><select class="select" id="model-collection" name="collectionId"><option value="">Sem coleção</option>${collections.map(collection => `<option value="${escapeHtml(collection.id)}" ${item.collectionId === collection.id ? "selected" : ""}>${escapeHtml(collection.name)}</option>`).join("")}</select></div><p class="muted">Esta tela guarda apenas a referência do arquivo. Para analisar a geometria, abra o arquivo em Inspeção de Malha.</p>`, onSave: form => { item.collectionId = String(form.get("collectionId") || "") || null; persist(); render(); toast("Modelo atualizado na biblioteca."); } }); }
});
shell.actions.querySelector("[data-collection]").addEventListener("click", addCollection);
shell.root.addEventListener("app:navigate", event => { filter = event.detail === "favorites" ? "favorites" : event.detail === "recent" ? "recent" : event.detail === "collections" ? "collections" : "all"; render(); });
render();

  return { root: shell.root, content: shell.content };
}