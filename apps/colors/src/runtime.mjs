import { hexToRgb, rgbToHsl } from "./color.mjs";

const COMPONENT_RUNTIME_SCHEMA = "ordax.component-runtime/1";
const SURFACE_SCHEMA = "ordax.surface-render-lifecycle/5";
const VERSION = "0.2.0";
const STYLE_URL = new URL("../assets/colors.css", import.meta.url).href;

function messages(locale) {
  return String(locale || "").toLowerCase().startsWith("pt")
    ? { title: "Cores", color: "Cor", invalid: "Cor HEX inválida" }
    : { title: "Colors", color: "Color", invalid: "Invalid HEX color" };
}

async function mountStyles(root) {
  const d = root.ownerDocument;
  const link = d.createElement("link");
  link.rel = "stylesheet";
  link.href = STYLE_URL;
  link.dataset.ordaxComponentStyle = "colors";
  d.head.append(link);
  return () => link.remove();
}

export const componentRuntime = Object.freeze({
  schema: COMPONENT_RUNTIME_SCHEMA,
  componentId: "colors",
  version: VERSION,
  async mount({ root, surfaceLifecycle } = {}) {
    if (!root?.ownerDocument || surfaceLifecycle?.schema !== SURFACE_SCHEMA
      || typeof surfaceLifecycle.localization?.getLocale !== "function"
      || typeof surfaceLifecycle.localization?.subscribe !== "function") {
      throw new TypeError("Colors requires compatible Surface lifecycle and localization");
    }
    const releaseStyles = await mountStyles(root);
    const d = root.ownerDocument;
    const section = d.createElement("section");
    section.className = "ordax-colors";
    root.replaceChildren(section);

    let selectedHex = "#3366cc";
    let releaseInput = null;
    let unsubscribe = null;
    let destroyed = false;
    const render = () => {
      releaseInput?.();
      const t = messages(surfaceLifecycle.localization.getLocale());
      section.innerHTML = `
        <h1>${t.title}</h1>
        <div data-swatch></div>
        <label>${t.color} (HEX)<input data-hex value="#3366cc" maxlength="7"></label>
        <output data-rgb></output>
        <output data-hsl></output>
        <p data-error hidden></p>`;

      const hex = section.querySelector("[data-hex]");
      hex.value = selectedHex;
      const swatch = section.querySelector("[data-swatch]");
      const rgb = section.querySelector("[data-rgb]");
      const hsl = section.querySelector("[data-hsl]");
      const error = section.querySelector("[data-error]");

      const update = () => {
        selectedHex = hex.value;
        try {
          const c = hexToRgb(hex.value);
          const q = rgbToHsl(c.r, c.g, c.b);
          swatch.style.background = hex.value;
          rgb.textContent = `RGB ${c.r}, ${c.g}, ${c.b}`;
          hsl.textContent = `HSL ${q.h}°, ${q.s}%, ${q.l}%`;
          hex.dataset.invalid = "false";
          error.hidden = true;
        } catch {
          hex.dataset.invalid = "true";
          rgb.textContent = "—";
          hsl.textContent = "—";
          error.textContent = t.invalid;
          error.hidden = false;
        }
      };
      hex.addEventListener("input", update);
      releaseInput = () => hex.removeEventListener("input", update);
      update();
    };

    const destroy = () => {
      if (destroyed) return;
      destroyed = true;
      try {
        unsubscribe?.();
      } finally {
        releaseInput?.();
        root.replaceChildren();
        releaseStyles();
      }
    };
    try {
      render();
      unsubscribe = surfaceLifecycle.localization.subscribe(() => {
        if (destroyed) return;
        try {
          render();
        } catch (error) {
          destroy();
          throw error;
        }
      });
      return Object.freeze({destroy});
    } catch (error) {
      destroy();
      throw error;
    }
  },
});
