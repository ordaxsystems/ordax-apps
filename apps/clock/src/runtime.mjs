const COMPONENT_RUNTIME_SCHEMA = "ordax.component-runtime/1";
const SURFACE_SCHEMA = "ordax.surface-render-lifecycle/5";
const VERSION = "0.1.0";
const STYLE_URL = new URL("../assets/clock.css", import.meta.url).href;

function assertLifecycle(value) {
  if (!value || value.schema !== SURFACE_SCHEMA || !value.localization) {
    throw new TypeError("A compatible Surface render lifecycle is required");
  }
  return value;
}

function labels(locale) {
  return String(locale || "").toLowerCase().startsWith("pt")
    ? { title:"Relógio", local:"Hora local", stopwatch:"Cronômetro", start:"Iniciar", pause:"Pausar", reset:"Zerar" }
    : { title:"Clock", local:"Local time", stopwatch:"Stopwatch", start:"Start", pause:"Pause", reset:"Reset" };
}

async function styles(root) {
  const d = root.ownerDocument;
  let link = d.querySelector('link[data-ordax-component-style="clock"]');
  if (link) return () => {};
  link = d.createElement("link");
  link.rel = "stylesheet";
  link.href = STYLE_URL;
  link.dataset.ordaxComponentStyle = "clock";
  d.head.append(link);
  return () => link.remove();
}

function mountView(root, lifecycle) {
  const d = root.ownerDocument;
  const t = labels(lifecycle.localization.getLocale());
  const section = d.createElement("section");
  section.className = "ordax-clock";
  section.innerHTML = `
    <header><h1>${t.title}</h1><p>${t.local}</p></header>
    <div class="ordax-clock__time" data-time>--:--:--</div>
    <div class="ordax-clock__date" data-date></div>
    <div class="ordax-clock__stopwatch">
      <strong>${t.stopwatch}</strong>
      <output data-stopwatch>00:00.0</output>
      <div>
        <button type="button" data-action="toggle">${t.start}</button>
        <button type="button" data-action="reset">${t.reset}</button>
      </div>
    </div>`;
  root.replaceChildren(section);

  const time = section.querySelector("[data-time]");
  const date = section.querySelector("[data-date]");
  const sw = section.querySelector("[data-stopwatch]");
  const toggle = section.querySelector('[data-action="toggle"]');
  const reset = section.querySelector('[data-action="reset"]');
  let running = false;
  let elapsed = 0;
  let startedAt = 0;

  const renderClock = () => {
    const now = new Date();
    const locale = lifecycle.localization.getLocale();
    time.textContent = new Intl.DateTimeFormat(locale, {hour:"2-digit", minute:"2-digit", second:"2-digit"}).format(now);
    date.textContent = new Intl.DateTimeFormat(locale, {dateStyle:"full"}).format(now);
  };
  const renderStopwatch = () => {
    const ms = elapsed + (running ? performance.now() - startedAt : 0);
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    const tenths = Math.floor((ms % 1000) / 100);
    sw.textContent = `${String(minutes).padStart(2,"0")}:${String(seconds).padStart(2,"0")}.${tenths}`;
  };
  const tick = setInterval(() => { renderClock(); renderStopwatch(); }, 100);
  renderClock(); renderStopwatch();

  const onToggle = () => {
    if (running) {
      elapsed += performance.now() - startedAt;
      running = false;
      toggle.textContent = t.start;
    } else {
      startedAt = performance.now();
      running = true;
      toggle.textContent = t.pause;
    }
  };
  const onReset = () => {
    elapsed = 0;
    startedAt = performance.now();
    renderStopwatch();
  };
  toggle.addEventListener("click", onToggle);
  reset.addEventListener("click", onReset);
  return () => {
    clearInterval(tick);
    toggle.removeEventListener("click", onToggle);
    reset.removeEventListener("click", onReset);
  };
}

export const componentRuntime = Object.freeze({
  schema: COMPONENT_RUNTIME_SCHEMA,
  componentId: "clock",
  version: VERSION,
  async mount({root, surfaceLifecycle} = {}) {
    if (!root?.ownerDocument) throw new TypeError("Clock requires a mount root");
    const lifecycle = assertLifecycle(surfaceLifecycle);
    const releaseStyles = await styles(root);
    let releaseView = mountView(root, lifecycle);
    const unsubscribe = lifecycle.localization.subscribe(() => {
      releaseView();
      releaseView = mountView(root, lifecycle);
    });
    return Object.freeze({ destroy() { unsubscribe?.(); releaseView?.(); root.replaceChildren(); releaseStyles(); } });
  },
});
