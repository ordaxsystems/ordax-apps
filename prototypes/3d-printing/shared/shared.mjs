export const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
export const number = (value, digits = 0) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(Number(value) || 0);
export const money = value => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value) || 0);
export const bytes = value => value < 1024 ? `${value} B` : value < 1048576 ? `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(value / 1024)} KB` : `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(value / 1048576)} MB`;
export const toast = message => {
  let node = document.querySelector("[data-toast]");
  if (!node) { node = document.createElement("div"); node.dataset.toast = ""; node.className = "toast"; node.setAttribute("role", "status"); document.body.append(node); }
  node.textContent = message; node.classList.add("show"); clearTimeout(node._timer); node._timer = setTimeout(() => node.classList.remove("show"), 2600);
};
export function showModal({ title, content = "", saveLabel = "Salvar", onSave = () => {} }) {
  const backdrop = document.createElement("div"); backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `<form class="modal" role="dialog" aria-modal="true"><header class="modal-header"><h2>${escapeHtml(title)}</h2><button class="icon-button" type="button" data-close aria-label="Fechar">${icon("close")}</button></header><div class="modal-body">${content}</div><footer class="modal-footer"><button class="button secondary" type="button" data-close>Cancelar</button><button class="button primary" type="submit">${escapeHtml(saveLabel)}</button></footer></form>`;
  document.body.append(backdrop);
  backdrop.addEventListener("click", event => { if (event.target === backdrop || event.target.closest("[data-close]")) backdrop.remove(); });
  backdrop.querySelector("form").addEventListener("submit", event => { event.preventDefault(); if (onSave(new FormData(event.currentTarget)) !== false) backdrop.remove(); });
  backdrop.querySelector("input,select,textarea")?.focus();
  return backdrop;
}
export const icon = (name, size = 18) => {
  const paths = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    cube: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="M3 8v9l9 5 9-5V8M12 13v9"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    upload: '<path d="M12 16V4m0 0L7 9m5-5 5 5M4 16v4h16v-4"/>',
    printer: '<path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/><path d="M18 12h.01"/>',
    box: '<path d="m12 3 9 4.5v9L12 21l-9-4.5v-9L12 3Z"/><path d="m3 7.5 9 5 9-5M12 13v8"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.6a8 8 0 0 1-1.7 1l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.7-1l-1.7.6-1.4-2.4L5.3 15a8 8 0 0 1 0-2l-1.4-1.1 1.4-2.4 1.7.6a8 8 0 0 1 1.7-1L9 7.3h2.8l.3 1.8a8 8 0 0 1 1.7 1l1.7-.6 1.4 2.4-1.4 1.1a8 8 0 0 1-.1 2Z"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/>',
    tool: '<path d="M14.7 6.3a5 5 0 0 0-6.4 6.4L3 18l3 3 5.3-5.3a5 5 0 0 0 6.4-6.4L14 13l-3-3z"/>',
    arrow: '<path d="M5 12h14m-7-7 7 7-7 7"/>',
    close: '<path d="m18 6-12 12M6 6l12 12"/>',
    tune: '<path d="M4 21v-7m0-4V3m8 18v-9m0-4V3m8 18v-5m0-4V3M2 14h4m4-6h4m4 8h4"/>',
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.cube}</svg>`;
};

export const button = (label, attrs = "", kind = "primary", glyph = "") => `<button class="button ${kind}" type="button" ${attrs}>${glyph ? icon(glyph, 16) : ""}<span>${escapeHtml(label)}</span></button>`;
export const stat = (label, value, detail = "") => `<article class="stat-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>${detail ? `<small>${escapeHtml(detail)}</small>` : ""}</article>`;
export const initials = name => String(name || "3D").split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();
