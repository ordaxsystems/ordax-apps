import { calculateExpression, formatResult } from "./expression.mjs";
import { calculatorMessages } from "./i18n/messages.mjs";

const COMPONENT_RUNTIME_SCHEMA = "ordax.component-runtime/1";
const SURFACE_RENDER_LIFECYCLE_SCHEMA = "ordax.surface-render-lifecycle/5";
const CALCULATOR_VERSION = "0.2.0";
const STYLESHEET_URL = new URL("../assets/calculator.css", import.meta.url).href;
const STYLE_SELECTOR = 'link[data-ordax-component-style="calculator"]';

function assertLifecycle(value) {
  if (
    !value || typeof value !== "object"
    || value.schema !== SURFACE_RENDER_LIFECYCLE_SCHEMA
    || typeof value.subscribeRender !== "function"
    || !value.localization
    || typeof value.localization.getLocale !== "function"
    || typeof value.localization.subscribe !== "function"
  ) {
    throw new TypeError("A compatible Surface render lifecycle is required");
  }
  return value;
}

async function mountStyles(root) {
  const documentObject = root?.ownerDocument;
  if (!documentObject?.head) throw new TypeError("Calculator requires a document head");

  const existing = documentObject.querySelector(STYLE_SELECTOR);
  if (existing) return () => {};

  const link = documentObject.createElement("link");
  link.rel = "stylesheet";
  link.href = STYLESHEET_URL;
  link.dataset.ordaxComponentStyle = "calculator";
  const loaded = new Promise((resolve, reject) => {
    link.addEventListener("load", resolve, { once: true });
    link.addEventListener("error", () => reject(new Error("Calculator stylesheet failed to load")), { once: true });
  });
  documentObject.head.append(link);
  try {
    await loaded;
  } catch (error) {
    link.remove();
    throw error;
  }
  return () => link.remove();
}

function createButton(documentObject, label, value, kind = "") {
  const button = documentObject.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.dataset.value = value;
  if (kind) button.dataset.kind = kind;
  return button;
}

function render(root, lifecycle) {
  const documentObject = root.ownerDocument;
  const messages = calculatorMessages(lifecycle.localization.getLocale());

  const shell = documentObject.createElement("section");
  shell.className = "ordax-calculator";
  shell.setAttribute("aria-label", messages.title);

  const display = documentObject.createElement("div");
  display.className = "ordax-calculator__display";

  const input = documentObject.createElement("input");
  input.className = "ordax-calculator__input";
  input.type = "text";
  input.inputMode = "decimal";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.maxLength = 512;
  input.setAttribute("aria-label", messages.expression);

  const output = documentObject.createElement("output");
  output.className = "ordax-calculator__result";
  output.setAttribute("aria-label", messages.result);
  output.textContent = "0";

  display.append(input, output);

  const grid = documentObject.createElement("div");
  grid.className = "ordax-calculator__grid";
  const keys = [
    ["C", "clear", "utility"], ["⌫", "backspace", "utility"], ["(", "("], [")", ")"],
    ["7", "7"], ["8", "8"], ["9", "9"], ["÷", "/", "operator"],
    ["4", "4"], ["5", "5"], ["6", "6"], ["×", "*", "operator"],
    ["1", "1"], ["2", "2"], ["3", "3"], ["−", "-", "operator"],
    ["0", "0"], [".", "."], ["%", "%", "operator"], ["+", "+", "operator"],
    ["π", "pi"], ["xʸ", "^", "operator"], ["√", "sqrt("], ["=", "calculate", "equals"],
  ];
  for (const [label, value, kind] of keys) grid.append(createButton(documentObject, label, value, kind));

  shell.append(display, grid);
  root.replaceChildren(shell);

  const calculate = () => {
    try {
      const result = calculateExpression(input.value);
      output.textContent = formatResult(result);
      output.dataset.state = "ok";
    } catch {
      output.textContent = messages.invalid;
      output.dataset.state = "error";
    }
  };

  const onClick = (event) => {
    const button = event.target.closest("button[data-value]");
    if (!button || !grid.contains(button)) return;
    const value = button.dataset.value;
    if (value === "clear") {
      input.value = "";
      output.textContent = "0";
      output.dataset.state = "ok";
    } else if (value === "backspace") {
      input.value = input.value.slice(0, -1);
    } else if (value === "calculate") {
      calculate();
    } else {
      input.value += value;
    }
    input.focus();
  };

  const onKeyDown = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      calculate();
    } else if (event.key === "Escape") {
      input.value = "";
      output.textContent = "0";
      output.dataset.state = "ok";
    }
  };

  grid.addEventListener("click", onClick);
  input.addEventListener("keydown", onKeyDown);
  input.focus();

  return () => {
    grid.removeEventListener("click", onClick);
    input.removeEventListener("keydown", onKeyDown);
  };
}

export const componentRuntime = Object.freeze({
  schema: COMPONENT_RUNTIME_SCHEMA,
  componentId: "calculator",
  version: CALCULATOR_VERSION,
  async mount({ root, surfaceLifecycle } = {}) {
    if (!root?.ownerDocument) throw new TypeError("Calculator requires a valid mount root");
    const lifecycle = assertLifecycle(surfaceLifecycle);
    const releaseStyles = await mountStyles(root);
    let releaseRender = render(root, lifecycle);

    const rerender = () => {
      releaseRender?.();
      releaseRender = render(root, lifecycle);
    };
    const unsubscribeLocale = lifecycle.localization.subscribe(rerender);

    let destroyed = false;
    return Object.freeze({
      destroy() {
        if (destroyed) return;
        destroyed = true;
        unsubscribeLocale?.();
        releaseRender?.();
        root.replaceChildren();
        releaseStyles();
      },
    });
  },
});
