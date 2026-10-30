// Runtime smoke test for bytes extracted from the canonical unsigned ZIP.
// A deliberately small DOM models only the public Surface mount contract;
// this is NOT a WebKit, signed-slot, hardware or production activation proof.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

const packageRoot = process.argv[2];
if (!packageRoot) throw new Error("Path to verified extracted app package is required");
const base = resolve(packageRoot, "system", "apps", "assistant");
const manifest = JSON.parse(readFileSync(join(base, "app.json"), "utf8"));
assert.equal(manifest.id, "assistant");
assert.equal(manifest.releaseMode, "component-slot");
const presentation = JSON.parse(readFileSync(join(base, "presentation", "manifest.json"), "utf8"));
assert.equal(presentation.schema, "ordax.app-presentation-manifest/1");
assert.equal(presentation.appId, manifest.id);
assert.equal(presentation.appVersion, manifest.version);
assert.equal(presentation.authority, "none");
assert.equal(presentation.sourceLocale, "pt-BR");
assert.equal(presentation.singleton, true);
assert.deepEqual(presentation.translations, {}, "manifest title remains sole product brand authority");
assert.equal(manifest.owner, "ordaxsystems/ordax-apps");
assert.equal(existsSync(join(base, "assets", "assistant.css")), true);

class TestElement {
  constructor(documentObject, tag = "div") {
    this.nodeType = 1;
    this.ownerDocument = documentObject;
    this.tagName = tag.toLowerCase();
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.parentNode = null;
    this.hidden = false;
    this.classList = {
      add: (...names) => { for (const name of names) this._classes.add(name); },
      remove: (...names) => { for (const name of names) this._classes.delete(name); },
      contains: (name) => this._classes.has(name),
    };
    this._classes = new Set();
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  addEventListener(name, listener) {
    const listeners = this.listeners.get(name) ?? new Set();
    listeners.add(listener);
    this.listeners.set(name, listeners);
  }
  removeEventListener(name, listener) { this.listeners.get(name)?.delete(listener); }
  fire(name) { for (const listener of this.listeners.get(name) ?? []) listener({ target: this }); }
  append(...elements) {
    for (const element of elements) {
      element.parentNode?.removeChild(element);
      element.parentNode = this;
      this.children.push(element);
      if (element.tagName === "link") queueMicrotask(() => element.fire("load"));
    }
  }
  removeChild(element) {
    const index = this.children.indexOf(element);
    if (index >= 0) this.children.splice(index, 1);
    element.parentNode = null;
  }
  remove() { this.parentNode?.removeChild(this); }
  replaceChildren(...elements) {
    for (const item of this.children) item.parentNode = null;
    this.children = [];
    this.append(...elements);
  }
  get childElementCount() { return this.children.length; }
  contains(child) {
    if (this === child) return true;
    return this.children.some(element => element.contains(child));
  }
  matches(selector) {
    if (selector === '[data-app-extension="assistant-conversation"]') {
      return this.dataset.appExtension === "assistant-conversation";
    }
    if (selector === 'link[data-ordax-component-style="assistant"]') {
      return this.tagName === "link" && this.dataset.ordaxComponentStyle === "assistant";
    }
    if (selector === "[data-assistant-input]") return this.dataset.assistantInput !== undefined;
    if (selector === "[data-assistant-send]") return this.dataset.assistantSend !== undefined;
    if (selector === "[data-assistant-record-work]") return this.dataset.assistantRecordWork !== undefined;
    if (selector === "[data-assistant-work-overview][open]") return false;
    if (selector.startsWith("details[data-assistant-")) return false;
    return false;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  querySelectorAll(selector) {
    const found = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (child.matches(selector)) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }
}
class TestDocument {
  constructor() { this.head = this.createElement("head"); this.activeElement = null; }
  createElement(tag) { return new TestElement(this, tag); }
  querySelector(selector) { return this.head.querySelector(selector); }
}
globalThis.Element = TestElement;

const documentObject = new TestDocument();
// A real isolated Native iframe provides only <main id="ordax-app-root">.
const root = documentObject.createElement("main");
assert.equal(root.childElementCount, 0);
const profile = {
  schema: "ordax.locale-profile/1", locale: "pt-BR", language: "pt",
  region: "BR", script: "Latn", direction: "ltr",
};
const identity = {
  schema: "ordax.identity-session/1",
  getSnapshot: () => ({ state: "unavailable" }),
  subscribe: () => () => {},
};
const space = {
  schema: "ordax.space-selection/1",
  getSnapshot: () => ({ schema: "ordax.space-selection/1", state: "unavailable" }),
  subscribe: () => () => {}, select() { throw Error("forbidden"); },
  clear() { throw Error("forbidden"); },
};
let inferenceCalls = 0;
const intelligence = {
  schema: "ordax.intelligence/1",
  getSnapshot: () => ({ schema: "ordax.intelligence/1", state: "degraded",
    inferenceAvailable: false, engineId: null, modelId: null,
    authority: "none", toolExecution: false }),
  subscribe: () => () => {},
  respond() { inferenceCalls++; throw Error("Pending runtime cannot invoke inference"); },
};
const lifecycle = {
  schema: "ordax.surface-render-lifecycle/5",
  localization: {
    schema: "ordax.localization/2",
    getLocale: () => "pt-BR",
    getProfile: () => profile,
    translate: id => id,
    subscribe: () => () => {},
  },
  getAppTarget: () => null,
  setAppTarget() { throw Error("pending runtime cannot change app target"); },
  subscribeRender: () => () => {},
};
const runtimeUrl = pathToFileURL(join(base, "src", "runtime.mjs")).href;
const { componentRuntime } = await import(runtimeUrl);
assert.equal(componentRuntime.schema, "ordax.component-runtime/1");
assert.equal(componentRuntime.componentId, manifest.id);
assert.equal(componentRuntime.version, manifest.version);
const { translateAssistantMessage } = await import(
  pathToFileURL(join(base, "src", "i18n", "messages.mjs")).href
);
assert.equal(translateAssistantMessage("pt-BR", "assistant.title"), manifest.title);
const mounted = await componentRuntime.mount({
  root, surfaceLifecycle: lifecycle,
  identitySessionPort: identity, spaceSelectionPort: space, intelligence,
});
assert.equal(typeof mounted.destroy, "function");
const slot = root.querySelector('[data-app-extension="assistant-conversation"]');
assert.ok(slot, "real app owns and creates its slot inside the empty Native root");
assert.equal(root.childElementCount, 1, "the app must not create a parallel UI");
assert.equal(slot.classList.contains("ordax-assistant-host"), true);
assert.ok(slot.querySelector("[data-assistant-input]"), "real runtime rendered a textarea");
const renderedTitles = [];
const inspectTitles = (node) => {
  if (node.className === "ordax-assistant-title") renderedTitles.push(node.textContent);
  for (const child of node.children) inspectTitles(child);
};
inspectTitles(slot);
assert.deepEqual(renderedTitles, [manifest.title],
  "visible conversation title must come only from the canonical app manifest");
const headings = slot.querySelectorAll("[data-assistant-input]");
assert.equal(headings.length, 1);
assert.equal(documentObject.head.querySelector('link[data-ordax-component-style="assistant"]') !== null, true);
assert.equal(inferenceCalls, 0);
mounted.destroy();
mounted.destroy(); // idempotent tear-down, no leaked CSS or foreground state
assert.equal(slot.childElementCount, 0);
assert.equal(root.childElementCount, 0, "app-owned slot must be released with the runtime");
assert.equal(documentObject.head.querySelector('link[data-ordax-component-style="assistant"]'), null);

// A parent-owned extension remains intact after teardown; no duplicate slot.
const providedSlot = documentObject.createElement("section");
providedSlot.dataset.appExtension = "assistant-conversation";
root.append(providedSlot);
const embedded = await componentRuntime.mount({
  root, surfaceLifecycle: lifecycle,
  identitySessionPort: identity, spaceSelectionPort: space, intelligence,
});
assert.equal(root.childElementCount, 1);
assert.strictEqual(root.querySelector('[data-app-extension="assistant-conversation"]'), providedSlot);
assert.ok(providedSlot.querySelector("[data-assistant-input]"));
embedded.destroy();
assert.equal(root.childElementCount, 1, "app cannot remove a host-owned extension");
assert.equal(providedSlot.childElementCount, 0);
assert.equal(documentObject.head.querySelector('link[data-ordax-component-style="assistant"]'), null);
providedSlot.remove();

// Mount failure must rollback both DOM slot and app-owned CSS.
await assert.rejects(() => componentRuntime.mount({
  root, surfaceLifecycle: lifecycle,
  identitySessionPort: null, spaceSelectionPort: null, intelligence,
}), /Identity|Session|required|port|compatible/i);
assert.equal(root.childElementCount, 0, "failed mount must not strand app DOM");
assert.equal(documentObject.head.querySelector('link[data-ordax-component-style="assistant"]'), null);
assert.equal(inferenceCalls, 0);

console.log(JSON.stringify({
  schema: "ordax.assistant-packaged-mount-proof/1",
  componentId: manifest.id,
  version: manifest.version,
  title: manifest.title,
  actualPackagedRuntimeImported: true,
  actualPackagedRuntimeMounted: true,
  actualPackagedRuntimeDestroyed: true,
  nativeEmptyRootRendered: true,
  hostExtensionOwnershipPreserved: true,
  failedMountTeardownVerified: true,
  syntheticIdentitySpaceIntelligenceOnly: true,
  inferenceExecuted: false,
  signedDistributionVerified: false,
  nativeWebKitBootVerified: false,
}));
