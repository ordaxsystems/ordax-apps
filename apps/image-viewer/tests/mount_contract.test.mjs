import assert from "node:assert/strict";
import test from "node:test";
import { componentRuntime } from "../src/runtime.mjs";

// Narrow local DOM fixture for public-port and resource lifecycle tests.
// It does not implement a browser, sandbox, OS host, install or File Space.
class Node {
  constructor(tag, doc) {
    this.tagName = tag;
    this.ownerDocument = doc;
    this.parentNode = null;
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.listeners = new Map();
    this.attributes = new Map();
    this.textContent = "";
    this.targets = new Map();
    this.disabled = false;
    this.hidden = false;
  }
  set innerHTML(value) {
    if (this.tagName !== "section") throw new Error("Unexpected innerHTML");
    for (const id of ["title","path","stage","empty","prev","next","out","fit","in","one"]) {
      if (!value.includes("data-" + id)) throw new Error("Missing DOM binding: " + id);
      this.targets.set(id, new Node(id, this.ownerDocument));
    }
    this.targets.get("stage").append(this.targets.get("empty"));
  }
  querySelector(query) {
    const match = /^\[data-([a-z]+)\]$/.exec(query);
    return match ? this.targets.get(match[1]) ?? null : null;
  }
  append(child) {
    child.parentNode = this;
    this.children.push(child);
  }
  replaceChildren(...children) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    for (const child of children) this.append(child);
  }
  remove() {
    if (!this.parentNode) return;
    const index = this.parentNode.children.indexOf(this);
    if (index >= 0) this.parentNode.children.splice(index, 1);
    this.parentNode = null;
  }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  addEventListener(kind, handler) {
    if (!this.listeners.has(kind)) this.listeners.set(kind, new Set());
    this.listeners.get(kind).add(handler);
  }
  removeEventListener(kind, handler) {
    this.listeners.get(kind)?.delete(handler);
  }
  emit(kind, event = {}) {
    for (const handler of this.listeners.get(kind) ?? []) handler(event);
  }
}

function fixture({ failImageElement = false } = {}) {
  const doc = {
    createElement(tag) {
      if (failImageElement && tag === "img") throw new Error("Image DOM creation denied");
      return new Node(tag, doc);
    },
    querySelector(query) {
      if (query === 'link[data-ordax-component-style="image-viewer"]') {
        return doc.head.children.find(item =>
          item.tagName === "link" && item.dataset.ordaxComponentStyle === "image-viewer",
        ) ?? null;
      }
      return null;
    },
  };
  doc.head = doc.createElement("head");
  return {doc, root: doc.createElement("main")};
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes,no) => { resolve = yes; reject = no; });
  return {promise,resolve,reject};
}
function image(path) {
  return {path, mime:"image/png", bytes:new Uint8Array([137,80,78,71,0,0,0,0])};
}
const flush = () => new Promise(resolve => setImmediate(resolve));

function publicPorts({
  list = async () => ({entries: []}),
  readImagePreview = async path => image(path),
} = {}) {
  let locale = "pt-BR";
  const activations = new Set(), localizations = new Set();
  const ports = {
    surfaceLifecycle: {
      schema: "ordax.surface-render-lifecycle/5",
      localization: {
        getLocale() { return locale; },
        subscribe(handler) {
          localizations.add(handler);
          return () => localizations.delete(handler);
        },
      },
    },
    fileSpace: {schema:"ordax.file-space/11",list,readImagePreview},
    appActivation: {
      schema:"ordax.app-activation/1",
      subscribe(handler) {
        activations.add(handler);
        return () => activations.delete(handler);
      },
    },
    activate(path, appId = "image-viewer") {
      for (const handler of [...activations]) handler({appId,target:path});
    },
    switchLocale(next) {
      locale = next;
      for (const handler of [...localizations]) handler();
    },
    listeners() { return {activations:activations.size,localizations:localizations.size}; },
  };
  return ports;
}
function screen(root) {
  assert.equal(root.children.length, 1);
  const section = root.children[0];
  return {
    section,
    path:section.querySelector("[data-path]"),
    stage:section.querySelector("[data-stage]"),
    empty:section.querySelector("[data-empty]"),
    prev:section.querySelector("[data-prev]"),
    next:section.querySelector("[data-next]"),
  };
}

async function withObjectUrls(action) {
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const created = [], revoked = [];
  URL.createObjectURL = blob => {
    assert.equal(blob.type, "image/png");
    const ref = "blob:fixture-" + (created.length + 1);
    created.push(ref);
    return ref;
  };
  URL.revokeObjectURL = ref => revoked.push(ref);
  try {
    await action({created,revoked});
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  }
}

test("Image Viewer imports via File Space, revokes old URLs and cleans up twice", async () => {
  await withObjectUrls(async ({created,revoked}) => {
    const {doc,root} = fixture();
    const ports = publicPorts();
    const component = await componentRuntime.mount({root,...ports});
    assert.equal(doc.head.children.length, 1);
    ports.activate("/images/primeira.png");
    await flush();
    assert.equal(screen(root).stage.children.at(-1).src, "blob:fixture-1");
    ports.activate("/images/segunda.png");
    await flush();
    assert.equal(screen(root).path.textContent, "/images/segunda.png");
    assert.deepEqual(revoked, ["blob:fixture-1"]);
    assert.equal(screen(root).stage.children.at(-1).src, "blob:fixture-2");
    component.destroy();
    component.destroy();
    assert.deepEqual(created, ["blob:fixture-1","blob:fixture-2"]);
    assert.deepEqual(revoked, created);
    assert.deepEqual(ports.listeners(), {activations:0,localizations:0});
    assert.equal(doc.head.children.length, 0);
    assert.equal(root.children.length, 0);
  });
});

test("stale directory listing cannot change navigation or launch a stale preview", async () => {
  await withObjectUrls(async ({created}) => {
    const one=deferred(), two=deferred(), reads=[];
    const {root}=fixture();
    const ports = publicPorts({
      list:path=>path==="/old" ? one.promise : two.promise,
      readImagePreview: async path => { reads.push(path); return image(path); },
    });
    const component=await componentRuntime.mount({root,...ports});
    ports.activate("/old/a.png");
    ports.activate("/new/b.png");
    two.resolve({entries:[{kind:"file",name:"b.png"},{kind:"file",name:"c.png"}]});
    await flush();
    assert.deepEqual(reads, ["/new/b.png"]);
    assert.equal(screen(root).next.disabled, false);
    one.resolve({entries:[{kind:"file",name:"a.png"},{kind:"file",name:"d.png"}]});
    await flush();
    assert.deepEqual(reads, ["/new/b.png"]);
    assert.equal(screen(root).next.disabled, false);
    assert.equal(screen(root).path.textContent, "/new/b.png");
    assert.equal(created.length, 1);
    component.destroy();
  });
});

test("stale preview results or failures cannot replace most recent image", async () => {
  await withObjectUrls(async ({created,revoked}) => {
    const first=deferred(), second=deferred();
    const {root}=fixture();
    const ports=publicPorts({readImagePreview:path=>path==="/a.png"?first.promise:second.promise});
    const component=await componentRuntime.mount({root,...ports});
    ports.activate("/a.png");
    await flush();
    ports.activate("/b.png");
    await flush();
    second.resolve(image("/b.png"));
    await flush();
    first.reject(new Error("Older preview failed"));
    await flush();
    assert.equal(screen(root).path.textContent, "/b.png");
    assert.equal(screen(root).stage.children.at(-1).src, "blob:fixture-1");
    assert.equal(screen(root).empty.hidden, true);
    assert.equal(created.length, 1);
    component.destroy();
    assert.deepEqual(revoked, created);
  });
});

test("pending preview after destroy cannot create or show temporary image URL", async () => {
  await withObjectUrls(async ({created,revoked}) => {
    const read=deferred();
    const {doc,root}=fixture();
    const ports=publicPorts({readImagePreview:()=>read.promise});
    const component=await componentRuntime.mount({root,...ports});
    ports.activate("/pending.png");
    await flush();
    const detached=screen(root).empty;
    component.destroy();
    read.resolve(image("/pending.png"));
    await flush();
    ports.activate("/later.png");
    ports.switchLocale("en-US");
    assert.equal(created.length, 0);
    assert.equal(revoked.length, 0);
    assert.equal(detached.textContent, "Carregando…");
    assert.equal(root.children.length, 0);
    assert.equal(doc.head.children.length, 0);
    assert.deepEqual(ports.listeners(), {activations:0,localizations:0});
  });
});

test("bad MIME and File Space identity are rejected before object URL creation", async () => {
  await withObjectUrls(async ({created}) => {
    const {root}=fixture();
    const ports=publicPorts({readImagePreview:async path=>({
      ...image(path),mime:"image/svg+xml",
    })});
    const component=await componentRuntime.mount({root,...ports});
    ports.activate("/vector.svg");
    await flush();
    assert.equal(screen(root).empty.textContent, "Não foi possível abrir esta imagem.");
    ports.fileSpace.readImagePreview=async path=>image("/unrelated.png");
    ports.activate("/different.png");
    await flush();
    assert.equal(created.length, 0);
    assert.equal(screen(root).empty.textContent, "Não foi possível abrir esta imagem.");
    component.destroy();
  });
});

test("DOM error after URL creation revokes the URL immediately", async () => {
  await withObjectUrls(async ({created,revoked}) => {
    const {doc,root}=fixture({failImageElement:true});
    const ports=publicPorts();
    const component=await componentRuntime.mount({root,...ports});
    ports.activate("/broken.png");
    await flush();
    assert.deepEqual(created, ["blob:fixture-1"]);
    assert.deepEqual(revoked, created);
    assert.equal(screen(root).empty.textContent, "Não foi possível abrir esta imagem.");
    component.destroy();
    assert.equal(doc.head.children.length, 0);
  });
});

test("invalid public ports or failed locale subscribe release all resources", async () => {
  const {doc,root}=fixture(),ports=publicPorts();
  await assert.rejects(
    componentRuntime.mount({root,...ports,fileSpace:{schema:"ordax.file-space/11"}}),
    TypeError,
  );
  assert.equal(doc.head.children.length, 0);
  ports.surfaceLifecycle.localization.subscribe=()=>{throw new Error("Locale subscription failure");};
  await assert.rejects(componentRuntime.mount({root,...ports}),/Locale subscription failure/);
  assert.deepEqual(ports.listeners(), {activations:0,localizations:0});
  assert.equal(doc.head.children.length, 0);
  assert.equal(root.children.length, 0);
});

test("unrelated activation and invalid logical path never reach File Space", async () => {
  const reads=[], {root}=fixture();
  const ports=publicPorts({
    list:async path=>{reads.push(path);return {entries:[]};},
    readImagePreview:async path=>{reads.push(path);return image(path);},
  });
  const component=await componentRuntime.mount({root,...ports});
  ports.activate("/secret.png","text-viewer");
  ports.activate("/images/../secret.png");
  ports.activate("C:\\Windows\\secret.png");
  await flush();
  assert.deepEqual(reads, []);
  component.destroy();
});
