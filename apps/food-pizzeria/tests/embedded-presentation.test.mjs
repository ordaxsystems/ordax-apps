import test from "node:test";
import assert from "node:assert/strict";

import {
  assertFoodModuleView,
  assertFoodPreviewPresentation,
  renderEmbeddedFoodPreview,
} from "../src/ui/presentation.mjs";
import { createFoodPizzeriaApp } from "../src/ui/app.mjs";
import { createSeedFoodState } from "../src/fixtures/mock-data.mjs";
import { updateFoodPizzeriaSettings } from "../src/domain/domain.mjs";
import { FOOD_DATA_PORT_SCHEMA } from "../src/ports/food-data-port.mjs";

const context = Object.freeze({ businessId: "preview-na-garagem", adapter: "browser-local-preview" });

function fakePreviewPort(adapter = "browser-local-preview", state = createSeedFoodState()) {
  return {
    schema: FOOD_DATA_PORT_SCHEMA,
    context: { ...context, adapter },
    async initialize() { return state; },
    getSnapshot() { return state; },
    getPreviewPreferences() { return { deliveryFeeCents: 500 }; },
    async updatePreviewPreferences(preferences) { return preferences; },
    subscribe() { return () => {}; },
    async execute() { throw new Error("Não é um provider comercial."); },
    destroy() {},
  };
}

function fakeRoot() {
  const listeners = new Map();
  const guestCount = { value: "", max: "" };
  const customerName = { value: "", focus() {} };
  const tableOpenForm = {
    ...fakeElement(),
    elements: {
      tableId: { innerHTML: "", value: "" },
      customerName,
      guestCount,
    },
  };
  const tableOpenDialog = { ...fakeElement(), showModal() { this.open = true; } };
  const dialogs = new Map([
    ["#cancel-dialog", fakeElement()],
    ["#cancel-order-form", fakeElement()],
    ["#table-open-dialog", tableOpenDialog],
    ["#table-open-form", tableOpenForm],
  ]);
  return {
    innerHTML: "",
    getRootNode() { return { querySelector(selector) { return dialogs.get(selector) ?? null; } }; },
    querySelector(selector) { return dialogs.get(selector) ?? null; },
    querySelectorAll() { return []; },
    addEventListener(type, callback) { listeners.set(type, callback); },
    removeEventListener(type) { listeners.delete(type); },
    get tableOpenForm() { return tableOpenForm; },
    get tableOpenDialog() { return tableOpenDialog; },
    get listenerCount() { return listeners.size; },
    dispatchPreviewClick(view) {
      let prevented = false;
      listeners.get("click")?.({
        target: { closest() { return { dataset: { view } }; } },
        preventDefault() { prevented = true; },
      });
      return prevented;
    },
    dispatchPreviewAction(action, dataset = {}) {
      listeners.get("click")?.({
        target: { closest() { return { dataset: { action, ...dataset } }; } },
        preventDefault() {},
      });
    },
  };
}

function fakeElement() {
  return { addEventListener() {}, removeEventListener() {} };
}

test("content-only Food preview never includes a second sidebar, header or dashboard", async () => {
  const root = fakeRoot();
  const app = createFoodPizzeriaApp({ root, dataPort: fakePreviewPort(), presentation: "embedded-preview" });
  try {
    app.navigate("kitchen");
    await app.mount();
    assert.match(root.innerHTML, /data-preview-only="true"/);
    assert.match(root.innerHTML, /Prévia local/);
    assert.match(root.innerHTML, /id="main-content"/);
    assert.doesNotMatch(root.innerHTML, /class="sidebar"|class="topbar"|class="main-nav"|data-view="overview"/);
    for (const view of ["orders", "menu", "tables", "delivery", "settings"]) {
      app.navigate(view);
      assert.match(root.innerHTML, /data-preview-only="true"/);
      assert.doesNotMatch(root.innerHTML, /class="sidebar"|class="topbar"/);
    }
    app.navigate("orders");
    assert.match(root.innerHTML, /Montar pedido/);
    const beforeUnauthorizedClick = root.innerHTML;
    assert.equal(root.dispatchPreviewClick("inventory"), true);
    assert.equal(root.innerHTML, beforeUnauthorizedClick);
    assert.throws(() => app.navigate("overview"), /somente módulos operacionais/);
    assert.throws(() => app.navigate("not-a-module"), /somente módulos operacionais/);
    assert.equal(root.dispatchPreviewClick("kitchen"), true);
    assert.match(root.innerHTML, /Fila da cozinha/);
    assert.doesNotMatch(root.innerHTML, /class="sidebar"|class="topbar"/);
  } finally {
    app.destroy();
  }
  assert.equal(root.listenerCount, 0);
});

test("embedded Food preview cannot impersonate a real Space provider or open horizontal apps", () => {
  assert.equal(assertFoodPreviewPresentation("standalone-preview", fakePreviewPort()), "standalone-preview");
  for (const presentation of ["standalone-preview", "embedded-preview"]) {
    for (const adapter of ["other-host", "space-live"]) {
      assert.throws(() => assertFoodPreviewPresentation(presentation, fakePreviewPort(adapter)),
        /host Space ainda não está autorizado/);
      const root = fakeRoot();
      assert.throws(() => createFoodPizzeriaApp({
        root, dataPort: fakePreviewPort(adapter), presentation,
      }), /host Space ainda não está autorizado/);
      assert.equal(root.listenerCount, 0);
      assert.equal(root.innerHTML, "");
    }
  }
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

test("a single-seat table opens with a valid default guest count", async () => {
  const initial = createSeedFoodState();
  const state = updateFoodPizzeriaSettings(initial, {
    tables: initial.settings.tables.map((table) =>
      table.id === 5 ? { ...table, seats: 1 } : table),
  });
  const root = fakeRoot();
  const app = createFoodPizzeriaApp({
    root,
    dataPort: fakePreviewPort("browser-local-preview", state),
    presentation: "embedded-preview",
  });
  try {
    await app.mount();
    app.navigate("tables");
    root.dispatchPreviewAction("open-table-command", { tableId: "5" });
    assert.equal(root.tableOpenDialog.open, true);
    assert.equal(root.tableOpenForm.elements.tableId.value, "5");
    assert.equal(root.tableOpenForm.elements.guestCount.max, "1");
    assert.equal(root.tableOpenForm.elements.guestCount.value, "1");
  } finally {
    app.destroy();
  }
});

test("preview-only launch cannot be promoted into an operational Space by its adapter", () => {
  let called = 0;
  const port = {
    ...fakePreviewPort("space-live"),
    async initialize() { called += 1; return createSeedFoodState(); },
    async execute() { called += 1; throw new Error("host operation must never run"); },
  };
  const root = fakeRoot();
  for (const presentation of ["standalone-preview", "embedded-preview"]) {
    assert.throws(() => createFoodPizzeriaApp({ root, dataPort: port, presentation }),
      /host Space ainda não está autorizado/);
  }
  assert.equal(called, 0);
  assert.equal(root.listenerCount, 0);
  assert.equal(root.innerHTML, "");
});
