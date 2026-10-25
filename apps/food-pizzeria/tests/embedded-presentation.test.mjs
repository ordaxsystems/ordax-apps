import test from "node:test";
import assert from "node:assert/strict";

import {
  assertFoodModuleView,
  assertFoodPreviewPresentation,
  renderEmbeddedFoodPreview,
} from "../src/ui/presentation.mjs";
import { createFoodPizzeriaApp } from "../src/ui/app.mjs";
import { createSeedFoodState } from "../src/fixtures/mock-data.mjs";
import { FOOD_DATA_PORT_SCHEMA } from "../src/ports/food-data-port.mjs";

const context = Object.freeze({ businessId: "preview-na-garagem", adapter: "browser-local-preview" });

function fakePreviewPort(adapter = "browser-local-preview") {
  const state = createSeedFoodState();
  return {
    schema: FOOD_DATA_PORT_SCHEMA,
    context: { ...context, adapter },
    async initialize() { return state; },
    getSnapshot() { return state; },
    subscribe() { return () => {}; },
    async execute() { throw new Error("Não é um provider comercial."); },
    destroy() {},
  };
}

function fakeRoot() {
  const listeners = new Map();
  const dialogs = new Map([
    ["#cancel-dialog", fakeElement()],
    ["#cancel-order-form", fakeElement()],
    ["#table-open-dialog", fakeElement()],
    ["#table-open-form", fakeElement()],
  ]);
  return {
    innerHTML: "",
    getRootNode() { return { querySelector(selector) { return dialogs.get(selector) ?? null; } }; },
    querySelector(selector) { return dialogs.get(selector) ?? null; },
    querySelectorAll() { return []; },
    addEventListener(type, callback) { listeners.set(type, callback); },
    removeEventListener(type) { listeners.delete(type); },
    get listenerCount() { return listeners.size; },
  };
}

function fakeElement() {
  return { addEventListener() {}, removeEventListener() {} };
}

test("content-only Food preview never includes a second sidebar, header or dashboard", async () => {
  const root = fakeRoot();
  const app = createFoodPizzeriaApp({ root, dataPort: fakePreviewPort(), presentation: "embedded-preview" });
  app.navigate("kitchen");
  await app.mount();
  assert.match(root.innerHTML, /data-preview-only="true"/);
  assert.match(root.innerHTML, /Prévia local/);
  assert.match(root.innerHTML, /id="main-content"/);
  assert.doesNotMatch(root.innerHTML, /class="sidebar"|class="topbar"|class="main-nav"|data-view="overview"/);
  app.navigate("orders");
  assert.match(root.innerHTML, /Montar pedido/);
  assert.doesNotMatch(root.innerHTML, /class="sidebar"|class="topbar"/);
  app.destroy();
  assert.equal(root.listenerCount, 0);
});

test("embedded Food preview cannot impersonate a real Space provider or open horizontal apps", () => {
  assert.equal(assertFoodPreviewPresentation("standalone-preview", fakePreviewPort("other-host")), "standalone-preview");
  assert.throws(() => assertFoodPreviewPresentation("embedded-preview", fakePreviewPort("space-live")),
    /host Space ainda não está autorizado/);
  assert.throws(() => assertFoodPreviewPresentation("space-live", fakePreviewPort()),
    /Apresentação Food desconhecida/);
  assert.equal(assertFoodModuleView("delivery"), "delivery");
  for (const view of ["overview", "inventory", "pos", "finance", "team"]) {
    assert.throws(() => assertFoodModuleView(view), /somente módulos operacionais/);
  }
  const port = fakePreviewPort("space-live");
  assert.throws(() => createFoodPizzeriaApp({ root: fakeRoot(), dataPort: port, presentation: "embedded-preview" }),
    /host Space ainda não está autorizado/);
});

test("pure embedded frame remains explicitly marked as fictitious", () => {
  const markup = renderEmbeddedFoodPreview("<section>Cardápio</section>");
  assert.match(markup, /Prévia local/);
  assert.match(markup, /dados fictícios/);
  assert.match(markup, /Cardápio/);
  assert.doesNotMatch(markup, /<nav|<aside|class="topbar"/);
  assert.throws(() => renderEmbeddedFoodPreview(null), /Conteúdo Food inválido/);
});
