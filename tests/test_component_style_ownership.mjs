import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { componentRuntime as calendarRuntime } from "../apps/calendar/src/runtime.mjs";
import { componentRuntime as calculatorRuntime } from "../apps/calculator/src/runtime.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

class FakeNode {
  constructor(tagName, doc) {
    this.tagName = tagName;
    this.ownerDocument = doc;
    this.dataset = {};
    this.style = {};
    this.handlers = new Map();
    this.children = [];
    this.attributes = new Map();
  }
  setAttribute(name, value) { this.attributes.set(name, value); }
  addEventListener(type, callback) { this.handlers.set(type, callback); }
  removeEventListener(type, callback) {
    if (this.handlers.get(type) === callback) this.handlers.delete(type);
  }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); }
  replaceChildren(...children) { this.children = children; }
  querySelector() { return new FakeNode("button", this.ownerDocument); }
  focus() {}
  remove() {
    if (this.tagName !== "link") return;
    this.ownerDocument.links = this.ownerDocument.links.filter(link => link !== this);
  }
}

function fakeDocument() {
  const doc = {
    links: [],
    createElement(name) { return new FakeNode(name, doc); },
    querySelector(selector) {
      // Deliberately allow looking up an existing link: the old,
      // broken shortcut incorrectly reused another mount's stylesheet.
      if (!selector.startsWith("link[data-ordax-component-style")) return null;
      return doc.links[0] ?? null;
    },
  };
  doc.head = {
    append(link) {
      doc.links.push(link);
      queueMicrotask(() => link.handlers.get("load")?.());
    },
  };
  return doc;
}

function fakeRoot(doc) {
  return {
    ownerDocument: doc,
    children: [],
    replaceChildren(...items) { this.children = items; },
  };
}

function fakeLifecycle() {
  const localization = {
    getLocale: () => "pt-BR",
    subscribe: () => () => {},
  };
  return {
    schema: "ordax.surface-render-lifecycle/5",
    localization,
    subscribeRender: () => () => {},
  };
}

for (const [name, runtime] of [
  ["calendar", calendarRuntime],
  ["calculator", calculatorRuntime],
]) {
  test(`${name}: two mount roots own independent CSS links`, async () => {
    const doc = fakeDocument();
    const first = await runtime.mount({
      root: fakeRoot(doc),
      surfaceLifecycle: fakeLifecycle(),
    });
    const second = await runtime.mount({
      root: fakeRoot(doc),
      surfaceLifecycle: fakeLifecycle(),
    });
    assert.equal(doc.links.length, 2, "each mount must own its own stylesheet");
    assert.notEqual(doc.links[0], doc.links[1]);
    first.destroy();
    assert.equal(doc.links.length, 1, "destroying first mount preserves second CSS");
    second.destroy();
    assert.equal(doc.links.length, 0, "last destroy releases final stylesheet");
  });

  test(`${name}: host-owned style link is not claimed or removed`, async () => {
    const doc = fakeDocument();
    const hostStyle = doc.createElement("link");
    hostStyle.dataset.ordaxComponentStyle = name;
    doc.head.append(hostStyle);
    const instance = await runtime.mount({
      root: fakeRoot(doc),
      surfaceLifecycle: fakeLifecycle(),
    });
    assert.equal(doc.links.length, 2);
    instance.destroy();
    assert.deepEqual(doc.links, [hostStyle]);
  });
}

test("every portable runtime owns style releases rather than borrowing another mount", async () => {
  const appsDir = resolve(ROOT, "apps");
  let checked = 0;
  for (const app of await readdir(appsDir, { withFileTypes: true })) {
    if (!app.isDirectory()) continue;
    let source;
    try {
      source = await readFile(resolve(appsDir, app.name, "src", "runtime.mjs"), "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    if (!source.includes("dataset.ordaxComponentStyle")) continue;
    assert.doesNotMatch(
      source,
      /link\[data-ordax-component-style/,
      `${app.name}: runtime must not use global stylesheet reuse without ownership`,
    );
    checked += 1;
  }
  assert.ok(checked >= 12, "regression floor: basic portable stylesheet owners");
});
