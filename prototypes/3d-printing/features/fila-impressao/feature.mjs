import * as shared from "/shared.mjs";
import { summarizeTechnicalJobCost } from "/apps/ordax-3d/src/application/technical-jobs-service.mjs";

export function mountFeature(host = {}) {
  const { escapeHtml, money, toast, showModal, icon, button, stat } = shared;
  if (typeof host.mountShell !== "function" || typeof host.technicalJobs?.list !== "function") throw new TypeError("A fila precisa do serviço compartilhado de jobs técnicos do OrdaX 3D.");
  const jobsService = host.technicalJobs;
  const nav = [
    { id: "queue", label: "Fila ativa", icon: "layers" },
    { id: "completed", label: "Concluídos", icon: "check" },
    { id: "planning", label: "Planejamento", icon: "clock" },
  ];
  const shell = host.mountShell({ title: "Fila de trabalhos técnicos", subtitle: "ORDAx 3D · JOBS DE IMPRESSÃO", nav, status: "Estado local deste protótipo", content: `<div class="queue-overview" data-stats></div><div class="queue-layout"><section class="surface queue-panel"><div class="queue-toolbar"><div><h2>Jobs técnicos</h2><p>Estimativas compartilhadas entre os módulos OrdaX 3D</p></div><div class="toolbar"><select class="inline-select" data-filter aria-label="Filtrar fila"><option value="active">Fila ativa</option><option value="all">Todos</option><option value="done">Concluídos</option></select><button type="button" class="button primary" data-add>${icon("plus",15)}<span>Novo job técnico</span></button></div></div><div data-jobs></div></section><aside class="queue-side"><section class="surface printer-capacity" data-capacity-panel><h2>Capacidade local estimada</h2><div data-capacity></div></section><div class="queue-note">Os estados “Iniciar demo” e “Concluir demo” alteram somente este protótipo. Nenhuma impressora recebe comandos; pedidos comerciais pertencem ao owner Vendas.</div></aside></div>` });
  shell.actions.innerHTML = button("Novo job técnico", "data-add", "primary", "plus");
  const durationMinutes = value => Number.isFinite(Number(value)) ? Math.max(0, Math.round(Number(value))) : 0;
  const formatDuration = value => { const mins = durationMinutes(value); if (!mins) return "A definir"; const hours = Math.floor(mins / 60), remaining = mins % 60; return hours ? `${hours} h${remaining ? ` ${remaining} min` : ""}` : `${remaining} min`; };
  const printerRecords = () => host.data.read("central-impressoras", []);
  const printerNames = jobs => [...new Set([...(Array.isArray(printerRecords()) ? printerRecords().map(printer => printer.name) : []), ...jobs.map(job => job.printer).filter(name => name && name !== "A definir")])];
  const statusLabel = status => status === "ready" ? "Preparado localmente" : status === "printing" ? "Em execução · demo" : status === "done" ? "Concluído · demo" : status === "blocked" ? "Bloqueado" : "Na fila";
  const formatCostSummary = estimate => {
    const summary = summarizeTechnicalJobCost(estimate);
    if (!summary) return "";
    const qualification = summary.complete ? "" : "estimativa parcial · ";
    if (summary.scope === "plate") return `Prato · ${qualification}custo ${money(summary.totalCost)} · referência ${money(summary.suggestedPriceTotal)}`;
    const unitSummary = `Por peça · ${qualification}custo ${money(summary.costPerUnit)} · referência ${money(summary.suggestedPricePerUnit)}`;
    return summary.quantity === 1 ? unitSummary : `${unitSummary} · lote de ${summary.quantity}: custo ${money(summary.totalCost)} · referência ${money(summary.suggestedPriceTotal)}`;
  };
  function render() {
    const jobs = jobsService.list();
    const active = jobs.filter(job => job.status !== "done");
    shell.root.querySelector('[data-nav="queue"] b')?.replaceChildren(String(active.length));
    shell.content.querySelector("[data-stats]").innerHTML = [
      stat("Na fila", String(active.filter(job => job.status === "queued").length), "Jobs técnicos locais"),
      stat("Preparados", String(active.filter(job => job.status === "ready").length), "Sem envio ao hardware"),
      stat("Tempo estimado", formatDuration(active.reduce((sum, job) => sum + (job.estimatedMinutes ?? 0), 0)), "Resultado salvo por job"),
      stat("Concluídos", String(jobs.filter(job => job.status === "done").length), "Estado local"),
    ].join("");
    const selected = shell.content.querySelector("[data-filter]").value;
    const shown = jobs.filter(job => selected === "all" || selected === "done" ? selected === "all" || job.status === "done" : job.status !== "done");
    shell.content.querySelector("[data-jobs]").innerHTML = shown.length ? shown.map((job, index) => {
      const action = job.status === "queued" ? "Preparar" : job.status === "ready" ? "Iniciar demo" : job.status === "printing" ? "Concluir demo" : "Reabrir";
      const local = job.origin === "local-preview" ? " · fictício" : " · local";
      const detail = [formatDuration(job.estimatedMinutes), job.estimatedGrams === null ? "material a definir" : `${job.estimatedGrams.toLocaleString("pt-BR")} g`];
      const costSummary = formatCostSummary(job.costEstimate);
      return `<article class="queue-row"><span class="queue-index">${String(index + 1).padStart(2, "0")}</span><div class="job-title"><strong>${escapeHtml(job.name)}</strong><small>${escapeHtml(job.model)} · ${escapeHtml(job.material)}${local}</small>${costSummary ? `<small class="job-cost-summary">${escapeHtml(costSummary)}</small>` : ""}</div><div class="job-meta">${escapeHtml(job.printer)}<small>${escapeHtml(detail.join(" · "))}</small></div><span class="status-chip ${escapeHtml(job.status)}">${escapeHtml(statusLabel(job.status))}</span><div class="queue-row-actions"><button class="mini-button" data-move="up" data-id="${escapeHtml(job.id)}" aria-label="Mover para cima" ${index === 0 ? "disabled" : ""}>↑</button><button class="mini-button" data-move="down" data-id="${escapeHtml(job.id)}" aria-label="Mover para baixo" ${index === jobs.length - 1 ? "disabled" : ""}>↓</button><button class="button secondary stage-button" data-stage="${escapeHtml(job.id)}">${action}</button></div></article>`;
    }).join("") : `<div class="queue-empty"><strong>Nenhum job nesta lista</strong>Fatie um modelo ou adicione um job técnico local.</div>`;
    const printers = printerNames(jobs);
    shell.content.querySelector("[data-capacity]").innerHTML = printers.length ? printers.map(printer => {
      const items = active.filter(job => job.printer === printer);
      const minutes = items.reduce((sum, job) => sum + (job.estimatedMinutes ?? 0), 0);
      const pct = Math.min(100, minutes / (8 * 60) * 100);
      return `<div class="capacity-row"><div class="capacity-head"><strong>${escapeHtml(printer)}</strong><span>${items.length} job${items.length === 1 ? "" : "s"} · ${formatDuration(minutes)}</span></div><svg class="progress-visual" viewBox="0 0 100 6" preserveAspectRatio="none" role="img" aria-label="${pct.toFixed(0)}% da capacidade diária estimada"><rect class="progress-track" width="100" height="6" rx="3"/><rect class="progress-fill" width="${pct.toFixed(1)}" height="6" rx="3"/></svg></div>`;
    }).join("") : `<div class="queue-empty">Cadastre uma impressora neste protótipo para agrupar as estimativas.</div>`;
  }
  function addJob() {
    const jobs = jobsService.list();
    const printers = printerNames(jobs);
    const printerOptions = [`<option value="A definir">A definir</option>`, ...printers.map(name => `<option>${escapeHtml(name)}</option>`)].join("");
    showModal({ title: "Adicionar job técnico", content: `<div class="field"><label for="job-name">Nome do job</label><input class="input" name="name" id="job-name" placeholder="Ex.: Suporte de parede" required/></div><div class="field"><label for="job-file">Modelo</label><input class="input" name="model" id="job-file" placeholder="arquivo.3mf" required/></div><div class="form-grid"><div class="field"><label for="job-printer">Impressora de referência</label><select class="select" name="printer" id="job-printer">${printerOptions}</select></div><div class="field"><label for="job-material">Material de referência</label><input class="input" name="material" id="job-material" value="PLA · definir"/></div></div><div class="form-grid"><div class="field"><label for="job-time">Tempo estimado (h)</label><input class="input" type="number" min="0" step="0.1" name="hours" id="job-time" value="1.5" required/></div><div class="field"><label for="job-grams">Consumo estimado (g)</label><input class="input" type="number" min="0" step="0.1" name="grams" id="job-grams" value="25" required/></div></div><p class="muted">Este cadastro cria somente um job técnico local; não cria pedido de venda nem movimentação de filamento.</p>`, saveLabel: "Adicionar job", onSave: form => {
      const name = String(form.get("name") ?? "").trim(), model = String(form.get("model") ?? "").trim();
      const hours = Number(form.get("hours")), grams = Number(form.get("grams"));
      if (!name || !model || !Number.isFinite(hours) || hours < 0 || !Number.isFinite(grams) || grams < 0) return false;
      jobsService.add({ name, model, printer: String(form.get("printer") || "A definir"), material: String(form.get("material") || "A definir").trim(), estimatedMinutes: Math.round(hours * 60), estimatedGrams: grams, status: "queued", due: "Sem prazo", origin: "local-entry" });
      toast("Job técnico salvo localmente.");
    } });
  }
  shell.content.querySelectorAll("[data-add]").forEach(item => item.addEventListener("click", addJob));
  shell.actions.querySelector("[data-add]").addEventListener("click", addJob);
  shell.content.querySelector("[data-filter]").addEventListener("change", render);
  shell.content.addEventListener("click", event => {
    const move = event.target.closest("[data-move]");
    if (move) { jobsService.move(move.dataset.id, move.dataset.move); return; }
    const stage = event.target.closest("[data-stage]");
    if (!stage) return;
    const job = jobsService.list().find(item => item.id === stage.dataset.stage);
    if (!job) return;
    const next = job.status === "queued" ? "ready" : job.status === "ready" ? "printing" : job.status === "printing" ? "done" : "queued";
    jobsService.setStatus(job.id, next);
    toast(next === "printing" ? "Estado de demonstração iniciado; nenhum comando foi enviado." : "Estado do job atualizado apenas neste protótipo.");
  });
  shell.root.addEventListener("app:navigate", event => {
    const filter = event.detail === "completed" ? "done" : event.detail === "planning" ? "all" : "active";
    shell.content.querySelector("[data-filter]").value = filter;
    if (event.detail === "planning") shell.content.querySelector("[data-capacity-panel]").scrollIntoView({ behavior: "smooth", block: "center" });
    render();
  });
  const unsubscribe = jobsService.subscribe(render);
  host.onDestroy?.(unsubscribe);
  render();
  return { root: shell.root, content: shell.content };
}
