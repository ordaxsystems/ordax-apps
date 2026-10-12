import assert from "node:assert/strict";
import test from "node:test";
import { componentRuntime } from "../src/runtime.mjs";
import { createDocument, publicPorts, screen, deferred } from "../../../tests/support/preview_mount_fixture.mjs";

test("locale switch preserves generated secrets, user input and output", async () => {
  const { document, root } = createDocument(), ports = publicPorts();
  const runtime = await componentRuntime.mount({root, surfaceLifecycle:ports.surfaceLifecycle});
  const fields = ["uuid","password","password-length","hash-input","hash","base64-input","base64","url-input","url"];
  const first = screen(root, ...fields);
  const uuid = first.uuid.textContent, password = first.password.textContent;
  assert.match(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(password.length, 24);
  first["password-length"].value = "32";
  first["hash-input"].value = "rascunho";
  first["base64-input"].value = "Olá 🌎";
  first["url-input"].value = "a b/c";
  first.hash.textContent = "hash anterior";
  first.base64.textContent = "base64 anterior";
  first.url.textContent = "url anterior";
  ports.switchLocale("en-US");
  const next = screen(root, ...fields);
  assert.equal(next.uuid.textContent, uuid);
  assert.equal(next.password.textContent, password);
  for(const field of ["password-length","hash-input","base64-input","url-input"])
    assert.equal(next[field].value, first[field].value, field);
  for(const field of ["hash","base64","url"])
    assert.equal(next[field].textContent, first[field].textContent, field);
  assert.deepEqual(ports.listeners(),{activations:0,localizations:1});
  runtime.destroy();
  runtime.destroy();
  assert.deepEqual(ports.listeners(),{activations:0,localizations:0});
  assert.equal(root.children.length, 0);
  assert.equal(document.head.children.length, 0);
});

test("older async SHA-256 result never overwrites latest result or destroyed Surface", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "crypto"), requests = [];
  Object.defineProperty(globalThis,"crypto",{configurable:true,value:{
    randomUUID:()=> "12345678-1234-4123-8123-123456789abc",
    getRandomValues:(bytes)=>bytes.fill(7),
    subtle:{digest(_algorithm,bytes){
      const pending=deferred();
      requests.push({text:new TextDecoder().decode(bytes),pending});
      return pending.promise;
    }},
  }});
  try{
    const {document,root}=createDocument(),ports=publicPorts();
    const runtime=await componentRuntime.mount({root,surfaceLifecycle:ports.surfaceLifecycle});
    const ui=screen(root,"hash-input","hash","hash-run");
    ui["hash-input"].value="old";
    const old=ui["hash-run"].onclick();
    ui["hash-input"].value="new";
    const current=ui["hash-run"].onclick();
    assert.deepEqual(requests.map(x=>x.text),["old","new"]);
    requests[1].pending.resolve(new Uint8Array(32).fill(2).buffer);
    await current;
    assert.equal(ui.hash.textContent,"02".repeat(32));
    requests[0].pending.resolve(new Uint8Array(32).fill(1).buffer);
    await old;
    assert.equal(ui.hash.textContent,"02".repeat(32));
    ui["hash-input"].value="closing";
    const closing=ui["hash-run"].onclick();
    runtime.destroy();
    requests[2].pending.resolve(new Uint8Array(32).fill(3).buffer);
    await closing;
    assert.equal(ui.hash.textContent,"02".repeat(32));
    assert.equal(root.children.length,0);
    assert.equal(document.head.children.length,0);
    assert.deepEqual(ports.listeners(),{activations:0,localizations:0});
  }finally{
    if(previous)Object.defineProperty(globalThis,"crypto",previous);
    else delete globalThis.crypto;
  }
});

test("missing localization fails early and subscribe failure cleans style and UI",async()=>{
  const {document,root}=createDocument();
  await assert.rejects(componentRuntime.mount({
    root,surfaceLifecycle:{schema:"ordax.surface-render-lifecycle/5"},
  }),TypeError);
  const ports=publicPorts();
  ports.surfaceLifecycle.localization.subscribe=()=>{throw new Error("subscribe rejected");};
  await assert.rejects(componentRuntime.mount({
    root,surfaceLifecycle:ports.surfaceLifecycle,
  }),/subscribe rejected/);
  assert.equal(root.children.length,0);
  assert.equal(document.head.children.length,0);
});
