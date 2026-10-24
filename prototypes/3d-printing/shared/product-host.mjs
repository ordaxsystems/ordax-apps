import { escapeHtml, icon } from "/shared.mjs";
import { featureIds } from "/feature-registry.mjs";

function createSessionFileBus() {
  const latest = new Map();
  const subscribers = new Map();
  return {
    publish(channel, payload, sourceId) {
      if (!(payload?.file instanceof Blob)) return false;
      const entry = { ...payload, sourceId };
      latest.set(channel, entry);
      for (const listener of subscribers.get(channel) ?? []) listener(entry);
      return true;
    },
    subscribe(channel, sourceId, listener) {
      if (!subscribers.has(channel)) subscribers.set(channel, new Set());
      const wrapped = entry => { if (entry.sourceId !== sourceId) listener(entry); };
      subscribers.get(channel).add(wrapped);
      const current = latest.get(channel);
      if (current && current.sourceId !== sourceId) queueMicrotask(() => wrapped(current));
      return () => subscribers.get(channel)?.delete(wrapped);
    },
    clear() { latest.clear(); subscribers.clear(); },
  };
}

function createFeatureSurface({ area, options, featureRoot }) {
  const panel = document.createElement("section");
  panel.className = "product-feature-panel";
  panel.hidden = true;
  panel.setAttribute("aria-label", options.title);
  const shadow = panel.attachShadow({ mode: "open" });
  const nav = options.nav?.length ? `<nav class="feature-nav app-nav" aria-label="${escapeHtml(options.title)}">${options.nav.map((item, index) => `<button class="nav-item${index === 0 ? " active" : ""}" type="button" data-nav="${escapeHtml(item.id)}">${icon(item.icon ?? "grid", 16)}<span>${escapeHtml(item.label)}</span>${item.count ? `<b>${escapeHtml(item.count)}</b>` : ""}</button>`).join("")}</nav>` : "";
  shadow.innerHTML = `<link rel="stylesheet" href="/shared.css"/><link rel="stylesheet" href="/feature-surface.css"/><link rel="stylesheet" href="/features/${area.featureId}/app.css"/><div class="feature-surface">${nav}<div class="feature-toolbar" data-heading-actions></div><section class="feature-content page-content" data-content>${options.content ?? ""}</section></div>`;
  featureRoot.append(panel);
  shadow.querySelectorAll("[data-nav]").forEach(button => button.addEventListener("click", () => {
    shadow.querySelectorAll("[data-nav]").forEach(item => item.classList.toggle("active", item === button));
    shadow.dispatchEvent(new CustomEvent("app:navigate", { detail: button.dataset.nav }));
  }));
  return { panel, shell: { root: shadow, content: shadow.querySelector("[data-content]"), actions: shadow.querySelector("[data-heading-actions]") } };
}

export function mountProductHost({ appId, title, subtitle, mark, areas, services }) {
  if (!Array.isArray(areas) || !areas.length) throw new TypeError("A product host needs at least one feature area");
  for (const area of areas) if (!featureIds.includes(area.featureId) || typeof area.mount !== "function") throw new TypeError(`Invalid feature module: ${area.featureId}`);
  if (typeof services?.appData?.read !== "function" || typeof services?.appData?.write !== "function") throw new TypeError("The product host requires the public App Data port");
  document.title = title;
  document.documentElement.lang = "pt-BR";
  const root = document.querySelector("#app");
  root.innerHTML = `<div class="app-shell product-shell"><header class="topbar"><div class="topbar-brand"><span class="brand-mark">${escapeHtml(mark ?? "3D")}</span><span class="brand-name">${escapeHtml(title)}</span></div></header><div class="app-layout product-layout${areas.length === 1 ? " product-layout--single" : ""}"><aside class="sidebar"${areas.length === 1 ? " hidden" : ""}><nav class="app-nav" data-product-nav aria-label="Navegação do app">${areas.map((area, index) => `<button class="nav-item${index === 0 ? " active" : ""}" type="button" data-product-area="${escapeHtml(area.id)}">${icon(area.icon ?? "grid", 17)}<span>${escapeHtml(area.label)}</span></button>`).join("")}</nav></aside><main class="main-area"><div class="page-heading"><div><span class="eyebrow">${escapeHtml(subtitle ?? "IMPRESSÃO 3D")}</span><h1 data-area-title></h1><p class="product-area-description" data-area-description></p></div></div><section class="product-content" data-product-content></section></main></div><div class="toast" data-toast role="status" aria-live="polite"></div></div>`;

  const featureRoot = root.querySelector("[data-product-content]");
  const data = services.appData;
  const files = createSessionFileBus();
  const mounted = new Map();
  const cleanups = [];
  const byId = new Map(areas.map(area => [area.id, area]));
  for (const area of areas) {
    let surface;
    const featureContext = {
      featureId: area.featureId,
      data,
      slicer: services.slicer,
      intelligence: services.intelligence,
      files: { publish: (channel, payload) => files.publish(channel, payload, area.featureId), subscribe: (channel, listener) => files.subscribe(channel, area.featureId, listener) },
      onDestroy(cleanup) { if (typeof cleanup === "function") cleanups.push(cleanup); },
      mountShell(options) {
        surface = createFeatureSurface({ area, options, featureRoot });
        return surface.shell;
      },
    };
    const shell = area.mount(featureContext);
    if (!surface) throw new Error(`Feature ${area.featureId} did not mount its surface`);
    mounted.set(area.id, { area, panel: surface.panel, shell });
  }

  function activate(areaId) {
    const entry = mounted.get(areaId);
    if (!entry) return;
    for (const [id, item] of mounted) item.panel.hidden = id !== areaId;
    root.querySelectorAll("[data-product-area]").forEach(button => {
      const active = button.dataset.productArea === areaId;
      button.classList.toggle("active", active);
      button.setAttribute("aria-current", active ? "page" : "false");
    });
    root.querySelector("[data-area-title]").textContent = entry.area.pageTitle ?? entry.area.label;
    root.querySelector("[data-area-description]").textContent = entry.area.description ?? "";
    entry.shell.root.dispatchEvent(new CustomEvent("app:activate"));
  }
  root.querySelectorAll("[data-product-area]").forEach(button => button.addEventListener("click", () => activate(button.dataset.productArea)));
  activate(areas[0].id);
  return { root, activate, data, files, destroy() { for (const cleanup of cleanups.splice(0)) cleanup(); files.clear(); root.replaceChildren(); } };
}
