import * as shared from "/shared.mjs";

export function mountFeature(host = {}) {
  const { escapeHtml, stat } = shared;
  if (typeof host.mountShell !== "function" || typeof host.technicalJobs?.list !== "function") throw new TypeError("A estimativa precisa do serviço compartilhado de jobs técnicos do OrdaX 3D.");
  const jobsService = host.technicalJobs;
  let view = "materials";
  const nav = [{ id: "materials", label: "Consumo previsto", icon: "box" }, { id: "missing", label: "Sem estimativa", icon: "check" }];
  const shell = host.mountShell({ title: "Estimativa de materiais", subtitle: "CONSUMO TÉCNICO PREVISTO", nav, status: "Sem acesso ao Inventory", content: `<div class="material-overview" data-stats></div><section class="surface"><div class="material-toolbar"><div><h2>Consumo por material</h2><p>Agregado dos jobs técnicos ativos neste protótipo</p></div><select class="inline-select" data-filter aria-label="Filtrar consumo"><option value="active">Ativos</option><option value="all">Incluir concluídos</option></select></div><div class="spool-grid" data-grid></div><p class="stock-note">Estimativa local baseada nos jobs técnicos. Estoque, saldo e movimentações pertencem ao owner Inventory; nenhum desses dados é consultado ou alterado aqui.</p></section>` });
  function render() {
    const jobs = jobsService.list();
    const filter = shell.content.querySelector("[data-filter]").value;
    const selected = jobs.filter(job => filter === "all" || job.status !== "done");
    const known = selected.filter(job => job.estimatedGrams !== null);
    const unknown = selected.filter(job => job.estimatedGrams === null);
    const byMaterial = new Map();
    for (const job of known) {
      const material = job.material || "Material a definir";
      const group = byMaterial.get(material) ?? { jobs: [], grams: 0 };
      group.jobs.push(job);
      group.grams += job.estimatedGrams;
      byMaterial.set(material, group);
    }
    const grams = known.reduce((sum, job) => sum + job.estimatedGrams, 0);
    shell.root.querySelector('[data-nav="materials"] b')?.replaceChildren(String(byMaterial.size));
    shell.root.querySelector('[data-nav="missing"] b')?.replaceChildren(String(unknown.length));
    shell.content.querySelector("[data-stats]").innerHTML = [
      stat("Jobs considerados", String(selected.length), "Estado do job técnico"),
      stat("Consumo previsto", `${grams.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} g`, "Não representa saldo"),
      stat("Materiais", String(byMaterial.size), "Agrupamento por perfil"),
      stat("Sem peso estimado", String(unknown.length), "Aguardam resultado técnico"),
    ].join("");
    shell.root.querySelector('[data-nav="materials"]')?.classList.toggle("active", view === "materials");
    shell.root.querySelector('[data-nav="missing"]')?.classList.toggle("active", view === "missing");
    const groups = [...byMaterial].sort(([a], [b]) => a.localeCompare(b, "pt-BR"));
    const grid = shell.content.querySelector("[data-grid]");
    if (view === "missing") {
      grid.innerHTML = unknown.length ? unknown.map(job => `<article class="spool-card"><div class="spool-info"><strong>${escapeHtml(job.name)}</strong><small>${escapeHtml(job.model)} · ${escapeHtml(job.material)}</small></div><p class="stock-note">O motor ainda não forneceu consumo para este job técnico.</p></article>`).join("") : `<div class="empty-spools"><strong>Todos os jobs têm uma estimativa</strong>Nenhum job está aguardando dados de consumo.</div>`;
    } else {
      grid.innerHTML = groups.length ? groups.map(([material, group]) => `<article class="spool-card"><div class="spool-head"><span class="spool-swatch material-estimate-icon">${group.jobs.length}</span><div class="spool-info"><strong>${escapeHtml(material)}</strong><small>${group.jobs.length} job${group.jobs.length === 1 ? "" : "s"} · estimativa local</small></div></div><div class="spool-meta"><div><span>Consumo previsto total</span><strong>${group.grams.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} g</strong></div><div><span>Origem</span><strong>Jobs técnicos do OrdaX 3D</strong></div></div><ul class="material-job-list">${group.jobs.slice(0, 5).map(job => `<li><span>${escapeHtml(job.name)}</span><strong>${job.estimatedGrams.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} g</strong></li>`).join("")}${group.jobs.length > 5 ? `<li><span>Mais ${group.jobs.length - 5} jobs</span><strong>…</strong></li>` : ""}</ul></article>`).join("") : `<div class="empty-spools"><strong>Nenhum consumo estimado</strong>Adicione um job técnico ou fatie um modelo para gerar uma estimativa.</div>`;
    }
  }
  shell.content.querySelector("[data-filter]").addEventListener("change", render);
  shell.root.addEventListener("app:navigate", event => {
    view = event.detail === "missing" ? "missing" : "materials";
    render();
  });
  const unsubscribe = jobsService.subscribe(render);
  host.onDestroy?.(unsubscribe);
  render();
  return { root: shell.root, content: shell.content };
}
