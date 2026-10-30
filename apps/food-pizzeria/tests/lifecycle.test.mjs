import test from "node:test";
import assert from "node:assert/strict";

import { createFoodPizzeriaApp } from "../src/ui/app.mjs";
import { createSeedFoodState } from "../src/fixtures/mock-data.mjs";
import { FOOD_DATA_PORT_SCHEMA } from "../src/ports/food-data-port.mjs";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function fakeElement() {
  const listeners = new Map();
  return {
    open: false,
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name) { listeners.delete(name); },
    close() { this.open = false; },
    get listenerCount() { return listeners.size; },
  };
}

function fakeClassList() {
  const names = new Set();
  return {
    add(name) { names.add(name); },
    remove(name) { names.delete(name); },
    contains(name) { return names.has(name); },
  };
}

function fakeMountRoot() {
  const listeners = new Map();
  const attrs = new Map();
  const cancelDialog = fakeElement();
  const tableOpenDialog = fakeElement();
  const cancelForm = fakeElement();
  const tableOpenForm = fakeElement();
  const kitchenStation = { classList: fakeClassList() };
  const dialogs = new Map([
    ["#cancel-dialog", cancelDialog],
    ["#table-open-dialog", tableOpenDialog],
    ["#cancel-order-form", cancelForm],
    ["#table-open-form", tableOpenForm],
    ["[data-kitchen-station-screen]", kitchenStation],
  ]);
  const root = {
    innerHTML: "",
    classList: fakeClassList(),
    setAttribute(name, value) { attrs.set(name, value); },
    removeAttribute(name) { attrs.delete(name); },
    getAttribute(name) { return attrs.get(name) ?? null; },
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name) { listeners.delete(name); },
    getRootNode() { return { querySelector: (selector) => dialogs.get(selector) ?? null }; },
    querySelector(selector) { return dialogs.get(selector) ?? null; },
    querySelectorAll() { return []; },
    emitClick(dataset) {
      const callback = listeners.get("click");
      if (!callback) return false;
      const target = {
        dataset,
        innerHTML: "",
        setAttribute(name, value) { attrs.set(name, value); },
      };
      this.lastClickedTarget = target;
      callback({
        target: { closest: () => target },
        preventDefault() {},
      });
      return true;
    },
    get listenerCount() {
      return [...listeners.values()].length
        + cancelDialog.listenerCount + tableOpenDialog.listenerCount
        + cancelForm.listenerCount + tableOpenForm.listenerCount;
    },
    get dialogs() { return { cancelDialog, tableOpenDialog }; },
    get kitchenStation() { return kitchenStation; },
  };
  return root;
}

function fakePort({ initialize, execute } = {}) {
  const state = createSeedFoodState();
  const subscribers = new Set();
  let capturedSubscriber;
  let unsubscribeCount = 0;
  const port = {
    schema: FOOD_DATA_PORT_SCHEMA,
    context: { businessId: "preview-lifecycle", adapter: "browser-local-preview" },
    initialize: initialize ?? (async () => state),
    getSnapshot() { return state; },
    getPreviewPreferences() { return { deliveryFeeCents: 500 }; },
    async updatePreviewPreferences(preferences) { return preferences; },
    subscribe(listener) {
      capturedSubscriber = listener;
      subscribers.add(listener);
      return () => { unsubscribeCount += 1; subscribers.delete(listener); };
    },
    execute: execute ?? (async () => state),
    destroy() {},
    get subscribers() { return subscribers.size; },
    get capturedSubscriber() { return capturedSubscriber; },
    get unsubscribeCount() { return unsubscribeCount; },
  };
  return port;
}

test("unmount while initialize is pending must not register listeners or timers later", async () => {
  const init = deferred();
  const port = fakePort({ initialize: () => init.promise });
  const root = fakeMountRoot();
  const app = createFoodPizzeriaApp({ root, dataPort: port, presentation: "embedded-preview" });
  const inProgress = app.mount();
  app.destroy();
  init.resolve();
  await assert.rejects(inProgress, /encerrada durante a inicialização/);
  assert.equal(root.listenerCount, 0);
  assert.equal(port.subscribers, 0);
  assert.equal(root.innerHTML, "");
  assert.equal(root.getAttribute("aria-busy"), null);
  assert.throws(() => app.navigate("orders"), /já foi encerrada/);
  await assert.rejects(app.mount(), /não pode ser montada novamente/);
});

test("browsers without the Fullscreen API use a reversible viewport mode", async () => {
  const root = fakeMountRoot();
  const app = createFoodPizzeriaApp({ root, dataPort: fakePort(), presentation: "embedded-preview" });
  await app.mount();

  root.emitClick({ action: "fullscreen-kitchen" });
  assert.equal(root.classList.contains("kitchen-display-fullscreen-fallback"), true);
  assert.match(root.lastClickedTarget.innerHTML, /Sair da tela cheia/);

  root.emitClick({ action: "fullscreen-kitchen" });
  assert.equal(root.classList.contains("kitchen-display-fullscreen-fallback"), false);
  assert.match(root.lastClickedTarget.innerHTML, /Tela cheia/);
  app.destroy();
});

test("unmount after mounting releases listeners, subscription, dialogs and rendered data", async () => {
  const port = fakePort();
  const root = fakeMountRoot();
  const app = createFoodPizzeriaApp({ root, dataPort: port, presentation: "embedded-preview" });
  await app.mount();
  assert.ok(root.listenerCount > 0);
  assert.equal(port.subscribers, 1);
  assert.match(root.innerHTML, /id="main-content"/);
  root.dialogs.tableOpenDialog.open = true;
  app.destroy();
  assert.equal(root.listenerCount, 0);
  assert.equal(port.subscribers, 0);
  assert.equal(port.unsubscribeCount, 1);
  assert.equal(root.dialogs.tableOpenDialog.open, false);
  assert.equal(root.innerHTML, "");
  assert.equal(root.getAttribute("aria-busy"), null);
  port.capturedSubscriber(); // Late queued notification cannot re-render a dead app.
  assert.equal(root.innerHTML, "");
  app.destroy(); // Idempotent teardown.
  assert.equal(port.unsubscribeCount, 1);
});

test("an in-flight Food command cannot recreate UI, timeout or stale data after unmount", async () => {
  const operation = deferred();
  const requested = deferred();
  const port = fakePort({
    execute: async () => {
      requested.resolve();
      return operation.promise;
    },
  });
  const root = fakeMountRoot();
  const app = createFoodPizzeriaApp({ root, dataPort: port, presentation: "embedded-preview" });
  await app.mount();
  const flavorId = port.getSnapshot().flavors.find(({ active }) => active).id;
  assert.equal(root.emitClick({ action: "toggle-flavor", flavorId, active: "false" }), true);
  await requested.promise;
  assert.equal(root.getAttribute("aria-busy"), "true");
  app.destroy();
  operation.resolve(port.getSnapshot());
  await new Promise((done) => setImmediate(done));
  assert.equal(root.innerHTML, "");
  assert.equal(root.getAttribute("aria-busy"), null);
  assert.equal(root.listenerCount, 0);
  assert.equal(port.subscribers, 0);
});
