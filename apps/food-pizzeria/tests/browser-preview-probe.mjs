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
  kitchen: "Fila da cozinha",
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
    () => `Prévia não montou: errors=${browserErrors.join(" | ") || "nenhum"}; ready=${document.readyState}; modules=${[...document.querySelectorAll("script")].map(x=>x.src).join(",")}; resources=${performance.getEntriesByType("resource").filter(x=>/food|preview/.test(x.name)).map(x=>`${x.name.split("/").slice(-2).join("/")}:${x.responseStatus || "?"}`).join(",")}; host=${host.innerHTML.slice(0,350)}`);
  const root = embedded ? host.shadowRoot : document;
  ensure(content.textContent.includes(expected[view] ?? "OrdaX"),
    `O módulo ${view} não renderizou seu conteúdo esperado.`);
  ensure(content.getBoundingClientRect().width > 100,
    "O conteúdo Food não recebeu largura visível.");
  ensure(!root.querySelector(".fatal-state"), "A montagem do Food reportou falha fatal.");

  if (embedded) {
    ensure(root.querySelector(".food-embedded-preview")?.dataset.previewOnly === "true",
      "A apresentação incorporável não foi marcada como prévia local.");
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
