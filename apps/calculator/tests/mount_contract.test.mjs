import assert from "node:assert/strict";
import test from "node:test";
import { componentRuntime } from "../src/runtime.mjs";

// Narrow test-only DOM implementation: validates public surface port use,
// user events and cleanup. NOT a browser renderer, OrdaX host or sandbox.
class TestNode {
  constructor(tagName, document) {
    this.tagName = tagName.toLowerCase();
    this.ownerDocument = document;
    this.parentNode = null;
    this.children = [];
    this.listeners = new Map();
    this.dataset = {};
    this.attributes = new Map();
    this.className = "";
    this.textContent = "";
    this.value = "";
  }
  append(...nodes) {
    for (const node of nodes) {
      node.parentNode = this;
      this.children.push(node);
      if (this.tagName === "head" && node.tagName === "link") {
        queueMicrotask(() => node.dispatch(
          this.ownerDocument.stylesheetError ? "error" : "load",
        ));
      }
    }
  }
  replaceChildren(...nodes) {
    for (const child of this.children) child.parentNode = null;
    this.children.length = 0;
    this.append(...nodes);
  }
  remove() {
    if (!this.parentNode) return;
    const siblings = this.parentNode.children;
    const index = siblings.indexOf(this);
    if (index !== -1) siblings.splice(index, 1);
    this.parentNode = null;
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
  }
  removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
  dispatch(type, event = {}) {
    for (const handler of this.listeners.get(type) ?? []) handler(event);
  }
  focus() { this.ownerDocument.activeElement = this; }
  matches(selector) {
    if (selector === "button[data-value]") {
      return this.tagName === "button" && this.dataset.value !== undefined;
    }
    if (selector === 'link[data-ordax-component-style="calculator"]') {
      return this.tagName === "link" &&
        this.dataset.ordaxComponentStyle === "calculator";
    }
    return selector[0] === "." &&
      this.className.split(/\s+/).includes(selector.slice(1));
  }
  closest(selector) {
    for (let node = this; node; node = node.parentNode) {
      if (node.matches(selector)) return node;
    }
    return null;
  }
  contains(other) {
    for (let node = other; node; node = node.parentNode) {
      if (node === this) return true;
    }
    return false;
  }
  querySelector(selector) {
    for (const child of this.children) {
      if (child.matches(selector)) return child;
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }
}
function testDocument({ stylesheetError = false } = {}) {
  const document = {
    stylesheetError,
    activeElement: null,
    createElement(tag) { return new TestNode(tag, document); },
    querySelector(selector) { return document.head.querySelector(selector); },
  };
  document.head = document.createElement("head");
  return document;
}
function testPublicSurface() {
  let locale = "pt-BR";
  const localizationListeners = new Set();
  const localization = {
    getLocale() { return locale; },
    subscribe(handler) {
      localizationListeners.add(handler);
      return () => localizationListeners.delete(handler);
    },
  };
  return {
    surfaceLifecycle: {
      schema: "ordax.surface-render-lifecycle/5",
      subscribeRender() { return () => {}; },
      localization,
    },
    localizationListeners,
    changeLocale(value) {
      locale = value;
      for (const handler of [...localizationListeners]) handler();
    },
  };
}
function calculatorNodes(root) {
  const shell = root.querySelector(".ordax-calculator");
  assert.ok(shell, "mounted calculator UI should exist");
  const input = root.querySelector(".ordax-calculator__input");
  const output = root.querySelector(".ordax-calculator__result");
  const grid = root.querySelector(".ordax-calculator__grid");
  assert.ok(input && output && grid);
  return { shell, input, output, grid };
}
function press(grid, value) {
  const button = grid.children.find(child => child.dataset.value === value);
  assert.ok(button, "missing calculator button " + value);
  grid.dispatch("click", { target: button });
}
test("Calculator mounts using public surface port, calculates and cleans up once", async () => {
  const document = testDocument();
  const root = document.createElement("main");
  const port = testPublicSurface();
  const instance = await componentRuntime.mount({ root, surfaceLifecycle: port.surfaceLifecycle });
  assert.equal(port.localizationListeners.size, 1);
  assert.equal(document.head.children.length, 1);
  const { input, output, grid } = calculatorNodes(root);
  press(grid, "7");
  press(grid, "+");
  press(grid, "2");
  press(grid, "calculate");
  assert.equal(input.value, "7+2");
  assert.equal(output.textContent, "9");
  assert.equal(output.dataset.state, "ok");
  instance.destroy();
  instance.destroy();
  assert.equal(root.children.length, 0);
  assert.equal(document.head.children.length, 0);
  assert.equal(port.localizationListeners.size, 0);
  assert.equal(grid.listeners.get("click")?.size, 0);
  assert.equal(input.listeners.get("keydown")?.size, 0);
});
test("Locale change preserves an unfinished expression, current result and only one subscription", async () => {
  const document = testDocument();
  const root = document.createElement("main");
  const port = testPublicSurface();
  const instance = await componentRuntime.mount({ root, surfaceLifecycle: port.surfaceLifecycle });
  const old = calculatorNodes(root);
  press(old.grid, "7");
  press(old.grid, "+");
  press(old.grid, "2");
  assert.equal(old.output.textContent, "0", "input should not calculate implicitly");
  port.changeLocale("en-US");
  const current = calculatorNodes(root);
  assert.notEqual(current.input, old.input);
  assert.equal(current.input.value, "7+2");
  assert.equal(current.output.textContent, "0");
  assert.equal(port.localizationListeners.size, 1);
  assert.equal(old.grid.listeners.get("click")?.size, 0);
  assert.equal(old.input.listeners.get("keydown")?.size, 0);
  assert.equal(document.head.children.length, 1);
  let enterPrevented = false;
  current.input.dispatch("keydown", {
    key: "Enter",
    preventDefault() { enterPrevented = true; },
  });
  assert.equal(enterPrevented, true);
  assert.equal(current.output.textContent, "9");
  instance.destroy();
  assert.equal(root.children.length, 0);
  assert.equal(document.head.children.length, 0);
  assert.equal(port.localizationListeners.size, 0);
});
test("Invalid host surface fails before mounting or subscribing", async () => {
  const document = testDocument();
  const root = document.createElement("main");
  await assert.rejects(
    componentRuntime.mount({ root, surfaceLifecycle: { schema: "ordax.surface-render-lifecycle/5" } }),
    TypeError,
  );
  assert.equal(root.children.length, 0);
  assert.equal(document.head.children.length, 0);
});
test("Stylesheet loading error removes temporary link without a partial mount", async () => {
  const document = testDocument({ stylesheetError: true });
  const root = document.createElement("main");
  const port = testPublicSurface();
  await assert.rejects(
    componentRuntime.mount({ root, surfaceLifecycle: port.surfaceLifecycle }),
    /stylesheet failed to load/,
  );
  assert.equal(root.children.length, 0);
  assert.equal(document.head.children.length, 0);
  assert.equal(port.localizationListeners.size, 0);
});
test("Subscription failure rolls back mounted UI, events and stylesheet", async () => {
  const document = testDocument();
  const root = document.createElement("main");
  const port = testPublicSurface();
  port.surfaceLifecycle.localization.subscribe = () => {
    throw new Error("subscription denied");
  };
  await assert.rejects(
    componentRuntime.mount({ root, surfaceLifecycle: port.surfaceLifecycle }),
    /subscription denied/,
  );
  assert.equal(root.children.length, 0);
  assert.equal(document.head.children.length, 0);
});
