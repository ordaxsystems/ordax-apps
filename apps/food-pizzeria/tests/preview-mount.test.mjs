import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createFoodPreviewMount } from "../src/ui/preview-mount.mjs";

function fakeDocument({ allowShadow = true, stylesheet = true, dialogs = true } = {}) {
  const elements = [];
  function element(name) {
    const value = {
      name,
      children: [],
      append(child) { this.children.push(child); child.parent = this; },
    };
    elements.push(value);
    return value;
  }
  const host = element("app");
  if (allowShadow) host.attachShadow = () => {
    const shadow = element("shadow");
    host.shadowRoot = shadow;
    return shadow;
  };
  const globalSheet = stylesheet ? {
    name: "global-stylesheet",
    href: "/apps/food-pizzeria/assets/food-pizzeria.css",
    removed: false,
    cloneNode() { return { name: "shadow-stylesheet", href: this.href }; },
    remove() { this.removed = true; },
  } : null;
  const cancelDialog = dialogs ? element("cancel-dialog") : null;
  const tableOpenDialog = dialogs ? element("table-open-dialog") : null;
  const document = {
    querySelector(selector) {
      if (selector === "#app") return host;
      if (selector === 'link[data-food-preview-stylesheet]') return globalSheet;
      return null;
    },
    getElementById(id) {
      return id === "cancel-dialog" ? cancelDialog
        : id === "table-open-dialog" ? tableOpenDialog
        : null;
    },
    createElement(tag) { return element(tag); },
  };
  return { document, host, globalSheet, cancelDialog, tableOpenDialog };
}

test("standalone preview retains its existing document, stylesheet and dialogs", () => {
  const fixture = fakeDocument();
  assert.equal(createFoodPreviewMount(fixture.document, "standalone-preview"), fixture.host);
  assert.equal(fixture.host.shadowRoot, undefined);
  assert.equal(fixture.globalSheet.removed, false);
  assert.equal(fixture.cancelDialog.parent, undefined);
});

test("embedded preview isolates the one Food stylesheet and native dialogs in Shadow DOM", () => {
  const fixture = fakeDocument();
  const root = createFoodPreviewMount(fixture.document, "embedded-preview");
  assert.equal(fixture.globalSheet.removed, true);
  assert.equal(fixture.host.shadowRoot.children[0].name, "shadow-stylesheet");
  assert.equal(fixture.host.shadowRoot.children[0].href, fixture.globalSheet.href);
  assert.strictEqual(fixture.host.shadowRoot.children[1], root);
  assert.equal(root.className, "food-preview-content-root");
  assert.strictEqual(fixture.cancelDialog.parent, fixture.host.shadowRoot);
  assert.strictEqual(fixture.tableOpenDialog.parent, fixture.host.shadowRoot);
  assert.equal(fixture.host.shadowRoot.children.length, 4);
});

test("embedded preview fails before altering the document if isolation requirements are absent", () => {
  for (const options of [{ stylesheet: false }, { dialogs: false }, { allowShadow: false }]) {
    const fixture = fakeDocument(options);
    assert.throws(() => createFoodPreviewMount(fixture.document, "embedded-preview"),
      /exige stylesheet, diálogos e Shadow DOM/);
    assert.equal(fixture.host.shadowRoot, undefined);
    assert.equal(fixture.globalSheet?.removed, false);
  }
  assert.throws(() => createFoodPreviewMount(fakeDocument().document, "space-live"),
    /Apresentação de prévia desconhecida/);
});

test("one stylesheet declares document and ShadowRoot theme scopes without a duplicate theme copy", () => {
  const css = readFileSync(new URL("../assets/food-pizzeria.css", import.meta.url), "utf8");
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(css, /^:root, :host \{/);
  assert.match(css, /:host \{ display: block; min-width: 0; \}/);
  assert.match(html, /data-food-preview-stylesheet/);
  assert.equal((html.match(/food-pizzeria\.css/g) ?? []).length, 1);
});
