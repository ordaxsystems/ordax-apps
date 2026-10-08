import assert from "node:assert/strict";

// Narrow shared test fixture for preview apps; NOT the OrdaX host, browser,
// sandbox, grants or a second File Space implementation.
class TestNode {
  constructor(tagName, document) {
    this.tagName = tagName;
    this.ownerDocument = document;
    this.parentNode = null;
    this.children = [];
    this.targets = new Map();
    this.listeners = new Map();
    this.attributes = new Map();
    this.dataset = {};
    this.style = {};
    this.hidden = false;
    this.disabled = false;
    this.textContent = "";
    this.paused = false;
    this.pauseCalls = 0;
  }
  set innerHTML(value) {
    if (this.tagName !== "section") throw new Error("Unexpected innerHTML target");
    this.targets.clear();
    for (const [, name] of value.matchAll(/data-([a-z]+)(?=[\s=>])/g)) {
      if (this.targets.has(name)) continue;
      const tag = name === "stage" ? "main" : "span";
      this.targets.set(name, new TestNode(tag, this.ownerDocument));
    }
    if (this.targets.has("stage") && this.targets.has("empty")) {
      this.targets.get("stage").append(this.targets.get("empty"));
    }
  }
  querySelector(query) {
    const match = /^\[data-([a-z]+)\]$/.exec(query);
    return match ? this.targets.get(match[1]) ?? null : null;
  }
  append(child) {
    if (this.ownerDocument.failAppendTag === child.tagName) {
      throw new Error("DOM append rejected: " + child.tagName);
    }
    child.parentNode = this;
    this.children.push(child);
  }
  replaceChildren(...nodes) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    for (const child of nodes) this.append(child);
  }
  remove() {
    if (!this.parentNode) return;
    const siblings = this.parentNode.children;
    const index = siblings.indexOf(this);
    if (index >= 0) siblings.splice(index, 1);
    this.parentNode = null;
  }
  addEventListener(kind, callback) {
    if (!this.listeners.has(kind)) this.listeners.set(kind, new Set());
    this.listeners.get(kind).add(callback);
  }
  removeEventListener(kind, callback) { this.listeners.get(kind)?.delete(callback); }
  emit(kind, event = {}) {
    for (const callback of this.listeners.get(kind) ?? []) callback(event);
  }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  pause() {
    this.pauseCalls += 1;
    this.paused = true;
  }
}

export function createDocument({failCreateTag = null, failAppendTag = null} = {}) {
  const document = {
    failAppendTag,
    createElement(tagName) {
      if (tagName === failCreateTag) throw new Error("DOM creation rejected: " + tagName);
      return new TestNode(tagName, document);
    },
    querySelector(query) {
      if (!query.startsWith('link[data-ordax-component-style="')) return null;
      const name = query.slice('link[data-ordax-component-style="'.length, -2);
      return document.head.children.find(node =>
        node.tagName === "link" && node.dataset.ordaxComponentStyle === name
      ) ?? null;
    },
  };
  document.head = document.createElement("head");
  return {document, root: document.createElement("main")};
}

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}

export function publicPorts({list, readDocumentPreview, readMediaPreview} = {}) {
  let locale = "pt-BR";
  const activations = new Set();
  const localizations = new Set();
  const ports = {
    surfaceLifecycle: {
      schema: "ordax.surface-render-lifecycle/5",
      localization: {
        getLocale: () => locale,
        subscribe(handler) {
          localizations.add(handler);
          return () => localizations.delete(handler);
        },
      },
    },
    appActivation: {
      schema: "ordax.app-activation/1",
      subscribe(handler) {
        activations.add(handler);
        return () => activations.delete(handler);
      },
    },
    fileSpace: {
      schema: "ordax.file-space/11",
      list: list ?? (async () => ({entries:[]})),
      readDocumentPreview: readDocumentPreview ?? (async path => ({
        path, mime:"application/pdf", bytes:new Uint8Array([37,80,68,70]),
      })),
      readMediaPreview: readMediaPreview ?? (async path => ({
        path, mime:"audio/mpeg", bytes:new Uint8Array([1,2,3,4]),
      })),
    },
    activate(appId, target) {
      for (const handler of [...activations]) handler({appId, target});
    },
    switchLocale(next) {
      locale = next;
      for (const handler of [...localizations]) handler();
    },
    listeners() {
      return {activations:activations.size,localizations:localizations.size};
    },
  };
  return ports;
}

export function screen(root, ...fields) {
  assert.equal(root.children.length, 1);
  const section = root.children[0];
  const values = {section};
  for (const field of fields) {
    const node = section.querySelector("[data-" + field + "]");
    assert.ok(node, "Missing UI binding: " + field);
    values[field] = node;
  }
  return values;
}

export async function withObjectUrls(action) {
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const created = [], revoked = [], types = [];
  URL.createObjectURL = blob => {
    const ref = "blob:preview-test-" + (created.length + 1);
    created.push(ref);
    types.push(blob.type);
    return ref;
  };
  URL.revokeObjectURL = value => revoked.push(value);
  try {
    await action({created,revoked,types});
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  }
}

export function flush() {
  return new Promise(resolve => setImmediate(resolve));
}
