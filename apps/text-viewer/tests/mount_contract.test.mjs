import assert from "node:assert/strict";
import test from "node:test";
import { componentRuntime } from "../src/runtime.mjs";

// Intentionally narrow DOM fixture for the real runtime's public-port behavior.
// No native filesystem, privileged broker, simulated install or platform host.
class Node {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName;
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
    this.children = [];
    this.dataset = {};
    this.textContent = "";
    this.targets = new Map();
  }

  set innerHTML(value) {
    if (this.tagName !== "section") throw new Error("unexpected DOM HTML write");
    this.targets.clear();
    for (const name of ["title", "path", "content"]) {
      if (!value.includes("data-" + name)) throw new Error("missing required UI binding");
      this.targets.set(name, new Node(name === "content" ? "pre" : "span", this.ownerDocument));
    }
  }

  querySelector(selector) {
    const binding = /^\[data-(title|path|content)\]$/.exec(selector);
    if (binding && this.targets.has(binding[1])) return this.targets.get(binding[1]);
    for (const child of this.children) {
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
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
    if (this.parentNode) {
      const at = this.parentNode.children.indexOf(this);
      if (at >= 0) this.parentNode.children.splice(at, 1);
      this.parentNode = null;
    }
  }
}

function createDocument() {
  const document = {
    createElement(tagName) { return new Node(tagName, document); },
    querySelector(selector) {
      if (selector === 'link[data-ordax-component-style="text-viewer"]') {
        return document.head.children.find(
          node => node.tagName === "link" &&
            node.dataset.ordaxComponentStyle === "text-viewer",
        ) ?? null;
      }
      return null;
    },
  };
  document.head = document.createElement("head");
  return document;
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function createPorts({ readTextFile = async path => ({path, text: "conteúdo"}) } = {}) {
  let locale = "pt-BR";
  const activationListeners = new Set();
  const localizationListeners = new Set();
  const ports = {
    fileSpace: {
      schema: "ordax.file-space/11",
      readTextFile,
    },
    appActivation: {
      schema: "ordax.app-activation/1",
      subscribe(handler) {
        activationListeners.add(handler);
        return () => activationListeners.delete(handler);
      },
    },
    surfaceLifecycle: {
      schema: "ordax.surface-render-lifecycle/5",
      localization: {
        getLocale: () => locale,
        subscribe(handler) {
          localizationListeners.add(handler);
          return () => localizationListeners.delete(handler);
        },
      },
    },
    activate(path, appId = "text-viewer") {
      for (const handler of [...activationListeners]) handler({appId, target: path});
    },
    switchLocale(next) {
      locale = next;
      for (const handler of [...localizationListeners]) handler();
    },
    listeners() {
      return {activation: activationListeners.size, localization: localizationListeners.size};
    },
  };
  return ports;
}

function view(root) {
  const section = root.children[0];
  assert.equal(section.className, "ordax-text-viewer");
  return {
    title: section.querySelector("[data-title]"),
    path: section.querySelector("[data-path]"),
    content: section.querySelector("[data-content]"),
  };
}

test("readTextFile uses only File Space and keeps literal text after locale switch", async () => {
  const document = createDocument(), root = document.createElement("main");
  const reads = [];
  const ports = createPorts({readTextFile: async path => {
    reads.push(path);
    return {path, text: "<script>not executable text</script>"};
  }});
  const component = await componentRuntime.mount({root, ...ports});
  assert.deepEqual(ports.listeners(), {activation: 1, localization: 1});
  assert.equal(document.head.children.length, 1);
  assert.equal(view(root).title.textContent, "Visualizador de Texto");
  ports.activate("/Documentos/relatorio.txt");
  await Promise.resolve();
  assert.deepEqual(reads, ["/Documentos/relatorio.txt"]);
  assert.equal(view(root).path.textContent, "/Documentos/relatorio.txt");
  assert.equal(view(root).content.textContent, "<script>not executable text</script>");
  ports.switchLocale("en-US");
  assert.equal(view(root).title.textContent, "Text Viewer");
  assert.equal(view(root).content.textContent, "<script>not executable text</script>");
  component.destroy();
  component.destroy();
  assert.deepEqual(ports.listeners(), {activation: 0, localization: 0});
  assert.equal(document.head.children.length, 0);
  assert.equal(root.children.length, 0);
});

test("latest activation wins even if an earlier read resolves last", async () => {
  const first = deferred(), second = deferred();
  const document = createDocument(), root = document.createElement("main");
  const ports = createPorts({readTextFile: path =>
    path === "/antigo.txt" ? first.promise : second.promise});
  const component = await componentRuntime.mount({root, ...ports});
  ports.activate("/antigo.txt");
  ports.activate("/novo.txt");
  assert.equal(view(root).path.textContent, "/novo.txt");
  assert.equal(view(root).content.textContent, "Carregando…");
  ports.switchLocale("en-US");
  assert.equal(view(root).content.textContent, "Loading…");
  second.resolve({path: "/novo.txt", text: "NOVO"});
  await Promise.resolve();
  first.resolve({path: "/antigo.txt", text: "ANTIGO"});
  await Promise.resolve();
  assert.equal(view(root).path.textContent, "/novo.txt");
  assert.equal(view(root).content.textContent, "NOVO");
  component.destroy();
});

test("stale rejection cannot replace the current read's successful output", async () => {
  const first = deferred(), second = deferred();
  const document = createDocument(), root = document.createElement("main");
  const ports = createPorts({readTextFile: path =>
    path === "/primeiro.txt" ? first.promise : second.promise});
  const component = await componentRuntime.mount({root, ...ports});
  ports.activate("/primeiro.txt");
  ports.activate("/segundo.txt");
  second.resolve({path: "/segundo.txt", text: "CONFIÁVEL"});
  await Promise.resolve();
  first.reject(new Error("stale read failed"));
  await Promise.resolve();
  assert.equal(view(root).content.textContent, "CONFIÁVEL");
  component.destroy();
});

test("File Space path mismatch or malformed text never renders untrusted content", async () => {
  const document = createDocument(), root = document.createElement("main");
  const ports = createPorts({readTextFile: async () => ({
    path: "/outro-arquivo.txt", text: "OUTRO",
  })});
  const component = await componentRuntime.mount({root, ...ports});
  ports.activate("/esperado.txt");
  await Promise.resolve();
  assert.equal(view(root).path.textContent, "/esperado.txt");
  assert.equal(view(root).content.textContent, "Não foi possível abrir este arquivo de texto.");
  ports.switchLocale("en-US");
  assert.equal(view(root).content.textContent, "This text file could not be opened.");
  ports.fileSpace.readTextFile = async path => ({path, text: {unsafe: true}});
  ports.activate("/invalido.txt");
  await Promise.resolve();
  assert.equal(view(root).content.textContent, "This text file could not be opened.");
  component.destroy();
});

test("a pending read cannot mutate a destroyed component", async () => {
  const read = deferred();
  const document = createDocument(), root = document.createElement("main");
  const ports = createPorts({readTextFile: () => read.promise});
  const component = await componentRuntime.mount({root, ...ports});
  ports.activate("/pendente.txt");
  const detached = view(root).content;
  component.destroy();
  assert.equal(root.children.length, 0);
  assert.equal(document.head.children.length, 0);
  assert.deepEqual(ports.listeners(), {activation: 0, localization: 0});
  read.resolve({path: "/pendente.txt", text: "NÃO EXIBIR"});
  await Promise.resolve();
  ports.activate("/depois.txt");
  ports.switchLocale("en-US");
  assert.equal(detached.textContent, "Carregando…");
  assert.equal(root.children.length, 0);
});

test("invalid ports and subscribe failures reject without leaving UI or subscriptions", async () => {
  const document = createDocument(), root = document.createElement("main");
  const ports = createPorts();
  await assert.rejects(componentRuntime.mount({
    root, ...ports, fileSpace: {schema: "ordax.file-space/11"},
  }), TypeError);
  assert.equal(document.head.children.length, 0);
  ports.surfaceLifecycle.localization.subscribe = () => {
    throw new Error("localization subscription denied");
  };
  await assert.rejects(componentRuntime.mount({root, ...ports}), /subscription denied/);
  assert.equal(root.children.length, 0);
  assert.equal(document.head.children.length, 0);
  assert.equal(ports.listeners().activation, 0);
});

test("unrelated app and invalid logical path do not trigger File Space read", async () => {
  const document = createDocument(), root = document.createElement("main");
  const seen = [];
  const ports = createPorts({readTextFile: async path => {
    seen.push(path);
    return {path, text: "ok"};
  }});
  const component = await componentRuntime.mount({root, ...ports});
  ports.activate("/permitido.txt", "image-viewer");
  ports.activate("/docs/../segredo.txt");
  ports.activate("C:\\Users\\arquivo.txt");
  assert.deepEqual(seen, []);
  assert.equal(view(root).content.textContent, "Abra um arquivo de texto pelo app Arquivos.");
  component.destroy();
});
