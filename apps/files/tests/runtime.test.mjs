import assert from "node:assert/strict";
import test from "node:test";

import { componentRuntime } from "../src/runtime.mjs";
import {
  validateComponentRuntime,
  validateMountedComponent,
} from "../src/sdk/contracts/component-runtime.mjs";
import { createLocaleProfile } from "../src/sdk/contracts/locale-profile.mjs";

class FakeElement {
  constructor(documentObject = null) {
    this.ownerDocument = documentObject;
    this.childNodes = [];
    this.listeners = new Map();
    this.dataset = {};
    this.removed = false;
  }
  append(...elements) {
    for (const element of elements) {
      element.parent = this;
      this.childNodes.push(element);
    }
  }
  remove() {
    this.removed = true;
    if (this.parent) {
      this.parent.childNodes = this.parent.childNodes.filter((child) => child !== this);
      this.parent = null;
    }
  }
  querySelector() { return null; }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type, listener) {
    if (this.listeners.get(type) === listener) this.listeners.delete(type);
  }
}

function makeRoot({ stylesheetFails = false } = {}) {
  const styles = [];
  const documentObject = {
    head: {
      append(node) {
        styles.push(node);
        queueMicrotask(() => node.dispatch(stylesheetFails ? "error" : "load"));
      },
    },
    createElement() {
      const el = new FakeElement(documentObject);
      el.dispatch = (type) => el.listeners.get(type)?.();
      return el;
    },
  };
  const root = new FakeElement(documentObject);
  return { root, styles };
}

function makeContext() {
  const subscriptions = new Map();
  let activationListener = null;
  const lifecycle = {
    schema: "ordax.surface-render-lifecycle/5",
    getAppTarget() { return null; },
    setAppTarget(id, path) { this.lastTarget = [id, path]; },
    subscribeRender(listener) {
      subscriptions.set("render", listener);
      return () => subscriptions.delete("render");
    },
    localization: {
      schema: "ordax.localization/2",
      getLocale() { return "pt-BR"; },
      getProfile() { return createLocaleProfile("pt-BR"); },
      translate(id) { return id; },
      subscribe() { return () => {}; },
    },
  };
  let listed = 0;
  const listing = path => ({ path, entries: [] });
  const fileSpace = {
    schema: "ordax.file-space/11",
    list(path) { listed += 1; return Promise.resolve(listing(path)); },
    createDirectory(path) { return Promise.resolve(listing(path)); },
    readTextFile(path) { return Promise.resolve({ path, size: 0, text: "" }); },
    renameEntry(path) { return Promise.resolve(listing(path)); },
    copyFile(_src, _name, dest) { return Promise.resolve(listing(dest)); },
    moveEntry(_src, _name, dest) { return Promise.resolve(listing(dest)); },
    trashEntry(path) { return Promise.resolve(listing(path)); },
    listTrash() { return Promise.resolve({ entries: [] }); },
    restoreTrashEntry() { return Promise.resolve({ entries: [] }); },
    exportFile() { return Promise.resolve(true); },
    importFile(path) { return Promise.resolve(listing(path)); },
  };
  const appActivation = {
    schema: "ordax.app-activation/1",
    publish() {},
    subscribe(listener) {
      activationListener = listener;
      return () => { activationListener = null; };
    },
  };
  return {
    fileSpace,
    surfaceLifecycle: lifecycle,
    appActivation,
    get listed() { return listed; },
    get listeners() { return subscriptions.size; },
    get activationListener() { return activationListener; },
  };
}

test("Files runtime implements the public component interface", () => {
  assert.equal(
    validateComponentRuntime(componentRuntime, { componentId: "files", version: "0.1.0" }),
    componentRuntime,
  );
  assert.equal(componentRuntime.schema, "ordax.component-runtime/1");
});

test("Files runtime mounts with injected ports, lists root and cleans resources", async () => {
  const originalElement = globalThis.Element;
  globalThis.Element = FakeElement;
  try {
    const { root, styles } = makeRoot();
    const context = makeContext();
    const mounted = validateMountedComponent(
      await componentRuntime.mount({ root, ...context }),
      "files",
    );
    for (let i = 0; i < 10; i++) await Promise.resolve();

    assert.equal(context.listed, 1);
    assert.deepEqual(context.surfaceLifecycle.lastTarget, ["files", "/"]);
    assert.equal(root.childNodes.length, 1);
    const frame = root.childNodes[0];
    assert.equal(frame.dataset.windowId, "files");
    assert.equal(frame.childNodes[0].dataset.appExtension, "file-space");
    assert.equal(styles.length, 1);
    assert.equal(styles[0].dataset.ordaxComponentStyle, "files");
    assert.equal(styles[0].rel, "stylesheet");
    assert.match(styles[0].href, /\/apps\/files\/assets\/files\.css$/);
    assert.equal(context.listeners, 1);
    assert.equal(typeof context.activationListener, "function");
    assert.equal(root.listeners.size, 4);

    mounted.destroy();
    mounted.destroy();
    assert.equal(context.listeners, 0);
    assert.equal(context.activationListener, null);
    assert.equal(root.listeners.size, 0);
    assert.equal(root.childNodes.length, 0);
    assert.equal(styles[0].removed, true);
  } finally {
    if (originalElement === undefined) delete globalThis.Element;
    else globalThis.Element = originalElement;
  }
});

test("Files runtime fails closed before DOM use when mandatory host ports are absent", async () => {
  await assert.rejects(componentRuntime.mount({}), /compatible file-space/);
});

test("Files runtime rolls back stylesheet when an optional host resource contract is invalid", async () => {
  const originalElement = globalThis.Element;
  globalThis.Element = FakeElement;
  try {
    const { root, styles } = makeRoot();
    const context = makeContext();
    await assert.rejects(
      componentRuntime.mount({ root, ...context, recentFiles: { schema: "invalid" } }),
      /compatible recent-files/,
    );
    assert.equal(root.childNodes.length, 0);
    assert.equal(styles[0].removed, true);
    assert.equal(root.listeners.size, 0);
  } finally {
    if (originalElement === undefined) delete globalThis.Element;
    else globalThis.Element = originalElement;
  }
});
