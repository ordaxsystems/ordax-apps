import { convert, formatConversion } from "./conversions.mjs";

const COMPONENT_RUNTIME_SCHEMA = "ordax.component-runtime/1";
const SURFACE_SCHEMA = "ordax.surface-render-lifecycle/5";
const VERSION = "0.2.0";
const STYLE_URL = new URL("../assets/converter.css", import.meta.url).href;
const UNITS = [
  ["m","metros"],["km","quilômetros"],["cm","centímetros"],
  ["in","polegadas"],["ft","pés"],["mi","milhas"],
  ["kg","quilogramas"],["g","gramas"],["lb","libras"],["oz","onças"],
  ["l","litros"],["ml","mililitros"],["cup","xícaras"],
  ["c","°C"],["f","°F"],["k","K"],
];

async function styles(root) {
  const documentObject = root.ownerDocument;
  const selector = 'link[data-ordax-component-style="converter"]';
  let link = documentObject.querySelector(selector);
  if (link) return () => {};
  link = documentObject.createElement("link");
  link.rel = "stylesheet";
  link.href = STYLE_URL;
  link.dataset.ordaxComponentStyle = "converter";
  documentObject.head.append(link);
  return () => link.remove();
}

function view(root, lifecycle, previous = null) {
  const documentObject = root.ownerDocument;
  const pt = String(lifecycle.localization.getLocale()).toLowerCase().startsWith("pt");
  const section = documentObject.createElement("section");
  section.className = "ordax-converter";
  section.innerHTML = '<h1>' + (pt ? "Conversor" : "Converter") +
    '</h1><div class="ordax-converter__row"><input data-value type="number" step="any" aria-label="' +
    (pt ? "Valor" : "Value") +
    '"><select data-from></select><span>→</span><select data-to></select></div><output data-result>1</output><p data-error hidden></p>';
  root.replaceChildren(section);

  const from = section.querySelector("[data-from]");
  const to = section.querySelector("[data-to]");
  for (const [id, label] of UNITS) {
    for (const select of [from, to]) {
      const option = documentObject.createElement("option");
      option.value = id;
      option.textContent = label;
      select.append(option);
    }
  }
  from.value = previous?.from ?? "m";
  to.value = previous?.to ?? "km";
  const value = section.querySelector("[data-value]");
  const result = section.querySelector("[data-result]");
  const error = section.querySelector("[data-error]");
  value.value = previous?.value ?? "1";

  const update = () => {
    try {
      result.textContent = formatConversion(convert(value.value, from.value, to.value));
      error.hidden = true;
    } catch {
      result.textContent = "—";
      error.textContent = pt ? "Unidades incompatíveis" : "Incompatible units";
      error.hidden = false;
    }
  };
  for (const element of [value, from, to]) element.addEventListener("input", update);
  update();
  return Object.freeze({
    snapshot() {
      return {value: value.value, from: from.value, to: to.value};
    },
    destroy() {
      for (const element of [value, from, to]) element.removeEventListener("input", update);
    },
  });
}

export const componentRuntime = Object.freeze({
  schema: COMPONENT_RUNTIME_SCHEMA,
  componentId: "converter",
  version: VERSION,
  async mount({root, surfaceLifecycle} = {}) {
    if (!root?.ownerDocument
      || surfaceLifecycle?.schema !== SURFACE_SCHEMA
      || typeof surfaceLifecycle.localization?.getLocale !== "function"
      || typeof surfaceLifecycle.localization?.subscribe !== "function") {
      throw new TypeError("Converter requires compatible Surface lifecycle and localization");
    }
    const releaseStyles = await styles(root);
    let releaseView = null, unsubscribe = null, destroyed = false;
    const destroy = () => {
      if (destroyed) return;
      destroyed = true;
      try {
        unsubscribe?.();
      } finally {
        releaseView?.destroy();
        root.replaceChildren();
        releaseStyles();
      }
    };
    try {
      releaseView = view(root, surfaceLifecycle);
      unsubscribe = surfaceLifecycle.localization.subscribe(() => {
        if (destroyed) return;
        const previous = releaseView.snapshot();
        releaseView.destroy();
        releaseView = null;
        releaseView = view(root, surfaceLifecycle, previous);
      });
      return Object.freeze({destroy});
    } catch (error) {
      destroy();
      throw error;
    }
  },
});
