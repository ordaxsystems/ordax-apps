// Executed by the localhost preview host only with ORDAX_FOOD_BROWSER_SMOKE=1.
// This is a real-browser smoke proof, never a Space provider.
const parameters = new URL(location.href).searchParams;
const embedded = parameters.get("presentation") === "embedded-preview";
const view = parameters.get("view") ?? "orders";
const browserErrors = [];
window.addEventListener("error", (event) => {
  const source = event.target?.src || event.target?.href || "";
  browserErrors.push(`JS/resource: ${event.message || event.type} ${source} ${event.filename || ""}:${event.lineno || ""}`);
}, true);
window.addEventListener("unhandledrejection", (event) => {
  browserErrors.push(`Promise: ${String(event.reason?.stack ?? event.reason)}`);
});
const expected = {
  kitchen: "Produção",
  orders: "Montar pedido",
  tables: "Mesas",
};

function ensure(ok, message) {
  if (!ok) throw new Error(message);
}

async function eventually(check, message) {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    const result = check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 35));
  }
  throw new Error(typeof message === "function" ? message() : message);
}

function announce(status, detail) {
  const result = document.createElement("div");
  result.id = "food-browser-proof";
  result.setAttribute("data-result", status);
  result.textContent = `FOOD_BROWSER_PROOF=${status};${detail}`;
  document.body.append(result);
}

async function checkAfterPageLoad() {
try {
  const host = document.querySelector("#app");
  ensure(host, "Host de prévia ausente.");
  const content = await eventually(() => (embedded ? host.shadowRoot : host)
    ?.querySelector("#main-content"),
    () => `Prévia não montou: errors=${browserErrors.join(" | ") || "nenhum"}; ready=${document.readyState}; modules=${[...document.querySelectorAll("script")].map(x=>x.src).join(",")}; resources=${performance.getEntriesByType("resource").filter(x=>/food|preview/.test(x.name)).map(x=>`${x.name.split("/").slice(-2).join("/")}:${x.responseStatus || "?"}`).join(",")}; host=${host.innerHTML.slice(0,350)}; shadowHost=${Boolean(host.shadowRoot)}; mount=${host.shadowRoot?.querySelector(".food-preview-content-root")?.innerHTML.slice(0,850) ?? "ausente"}`);
  const root = embedded ? host.shadowRoot : document;
  const expectedHeading = parameters.has("station")
    ? `TELA ${parameters.get("station")} DE ${parameters.get("screenCount") ?? parameters.get("station")}`
    : expected[view] ?? "OrdaX";
  ensure(expectedHeading && content.textContent.includes(expectedHeading),
    `O módulo ${view} não renderizou o conteúdo esperado${expectedHeading ? `: ${expectedHeading}` : ""}.`);
  ensure(content.getBoundingClientRect().width > 100,
    "O conteúdo Food não recebeu largura visível.");
  ensure(!root.querySelector(".fatal-state"), "A montagem do Food reportou falha fatal.");

  if (parameters.has("station")) {
    const station = parameters.get("station");
    ensure(root.querySelector(`[data-kitchen-station-screen="${station}"]`),
      "A tela dedicada da estação não foi montada.");
    ensure(root.querySelectorAll("[data-kitchen-stage]").length === 1,
      "A tela dedicada exibe mais de uma macroetapa.");
    ensure(root.querySelectorAll("[data-kitchen-current-order]").length <= 1,
      "A tela dedicada exibe mais de um pedido em foco.");
    ensure(root.querySelectorAll("[data-kitchen-upcoming-order]").length <= 5,
      "A lista da estação exibe mais de cinco próximos pedidos.");
    const stationContent = root.querySelector(`[data-kitchen-station-screen="${station}"]`);
    ensure(stationContent?.querySelector('button[data-task-action="start"], button[data-task-action="complete"]'),
      "A estação não mostra como iniciar ou concluir a etapa atual.");
    ensure(stationContent?.querySelector('button[data-task-action="pass-next"]')?.textContent.includes("Próximo"),
      "A estação não mostra a ação para passar ao próximo pedido.");
    if (root.querySelector("[data-kitchen-current-order]")) {
      const focusedTicket = root.querySelector("[data-kitchen-current-order]");
      ensure(focusedTicket.querySelectorAll(".kitchen-item-line").length > 0,
        "O pedido em foco não apresenta itens de produção.");
    }
    ensure(root.querySelector(".food-embedded-preview-kitchen"),
      "A tela dedicada não ativou o layout compacto do preview.");
    ensure(root.querySelector('[data-action="fullscreen-kitchen"]'),
      "A tela dedicada não oferece o controle de tela cheia.");
    ensure(!root.querySelector(".kitchen-summary, .kitchen-toolbar, .kitchen-display-setup"),
      "A tela dedicada mantém controles do quadro geral.");
    const display = root.querySelector(`[data-kitchen-station-screen="${station}"]`);
    const fullscreenButton = root.querySelector('[data-action="fullscreen-kitchen"]');
    Object.defineProperty(display, "requestFullscreen", { configurable: true, value: undefined });
    fullscreenButton.click();
    const mount = host.shadowRoot.querySelector(".food-preview-content-root");
    ensure(mount.classList.contains("kitchen-display-fullscreen-fallback"),
      "A tela dedicada não ativou o modo de viewport quando a Fullscreen API não está disponível.");
    ensure(fullscreenButton.textContent.includes("Sair da tela cheia"),
      "O controle de tela cheia não oferece uma ação para sair do modo alternativo.");
    fullscreenButton.click();
    ensure(!mount.classList.contains("kitchen-display-fullscreen-fallback"),
      "O modo alternativo de tela cheia não pode ser encerrado pelo mesmo controle.");
  }

  if (embedded) {
    ensure(root.querySelector(".food-embedded-preview")?.dataset.previewOnly === "true",
      "A apresentação incorporável perdeu sua marcação interna de segurança.");
    ensure(!/prévia|preview|fictíci|amostra|dados de teste|registros de teste|sem autenticação/i.test(root.textContent ?? ""),
      "A interface incorporável exibe um aviso de demonstração desnecessário.");
    ensure(!root.querySelector(".sidebar") && !root.querySelector(".topbar"),
      "A incorporação duplicou a navegação do Space.");
    ensure(document.querySelector('link[data-food-preview-stylesheet]') === null,
      "CSS Food ainda está aplicado globalmente no documento.");
    const style = await eventually(() =>
      root.querySelector('link[data-food-preview-stylesheet]')?.sheet,
      "O navegador não carregou CSS do Food no Shadow DOM.");
    ensure(style.cssRules.length > 0, "A folha de estilos do Food chegou vazia.");
    ensure(getComputedStyle(host).getPropertyValue("--ink").trim() !== "",
      "Os tokens do tema não estão disponíveis no Shadow DOM.");
    for (const id of ["cancel-dialog", "table-open-dialog"]) {
      ensure(root.getElementById(id), `Diálogo Food ${id} ausente no Shadow DOM.`);
      ensure(!document.getElementById(id), `Diálogo Food ${id} vazou para o host.`);
    }
    if (view === "tables") {
      const open = root.querySelector('[data-action="open-table-command"]');
      ensure(open, "Botão real de abertura de mesa não renderizado.");
      open.click();
      const dialog = root.getElementById("table-open-dialog");
      ensure(dialog.open, "O navegador não abriu o diálogo nativo da mesa.");
      ensure(root.getElementById("table-open-form").elements.guestCount.value !== "",
        "Formulário de comanda foi aberto sem número de pessoas.");
      dialog.close();
    }
  } else {
    ensure(host.querySelector(".app-shell") && host.querySelector(".sidebar"),
      "O modo standalone perdeu a navegação própria.");
    ensure(document.querySelector('link[data-food-preview-stylesheet]')?.sheet,
      "O modo standalone perdeu sua folha de estilos.");
    ensure(document.getElementById("cancel-dialog"),
      "O modo standalone perdeu os diálogos existentes.");
    ensure(host.shadowRoot === null, "Standalone criou Shadow DOM indevido.");
  }
  announce("PASS", `${embedded ? "embedded" : "standalone"}:${view}`);
} catch (error) {
  announce("FAIL", String(error?.stack ?? error).replaceAll("<", "(").slice(0,2300));
}
}

// Module imports can still be loading while virtual time advances in headless
// Chromium. Begin assertions after the entire preview module graph settles.
if (document.readyState === "complete") {
  void checkAfterPageLoad();
} else {
  window.addEventListener("load", () => { void checkAfterPageLoad(); }, { once: true });
}
