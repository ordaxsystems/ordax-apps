import assert from "node:assert/strict";
import test from "node:test";
import {componentRuntime} from "../src/runtime.mjs";
import {createDocument,publicPorts,screen} from "../../../tests/support/preview_mount_fixture.mjs";

test("Colors preserves chosen HEX and calculated display when locale changes", async () => {
  const {document,root}=createDocument(), ports=publicPorts();
  const component=await componentRuntime.mount({root,surfaceLifecycle:ports.surfaceLifecycle});
  const previous=screen(root,"hex","swatch","rgb","hsl","error");
  previous.hex.value="#ff00aa";
  previous.hex.emit("input");
  assert.equal(previous.rgb.textContent,"RGB 255, 0, 170");
  assert.equal(previous.swatch.style.background,"#ff00aa");
  assert.equal(previous.error.hidden,true);
  ports.switchLocale("en-US");
  const next=screen(root,"hex","swatch","rgb","hsl","error");
  assert.notEqual(previous.hex,next.hex);
  assert.equal(next.hex.value,"#ff00aa");
  assert.equal(next.swatch.style.background,"#ff00aa");
  assert.equal(next.rgb.textContent,"RGB 255, 0, 170");
  assert.equal(previous.hex.listeners.get("input")?.size,0);
  assert.deepEqual(ports.listeners(),{activations:0,localizations:1});
  component.destroy();
  component.destroy();
  assert.deepEqual(ports.listeners(),{activations:0,localizations:0});
  assert.equal(root.children.length,0);
  assert.equal(document.head.children.length,0);
});

test("Colors retains invalid color text while translating errors and does not leak listeners", async () => {
  const {root}=createDocument(), ports=publicPorts();
  const component=await componentRuntime.mount({root,surfaceLifecycle:ports.surfaceLifecycle});
  const current=screen(root,"hex","error","rgb");
  current.hex.value="#zzzzzz";
  current.hex.emit("input");
  assert.equal(current.error.hidden,false);
  assert.equal(current.error.textContent,"Cor HEX inválida");
  ports.switchLocale("en-US");
  const later=screen(root,"hex","error","rgb");
  assert.equal(later.hex.value,"#zzzzzz");
  assert.equal(later.error.textContent,"Invalid HEX color");
  assert.equal(later.rgb.textContent,"—");
  assert.equal(current.hex.listeners.get("input")?.size,0);
  component.destroy();
});

test("Colors rejects missing localization and cleans up a failed subscribe", async () => {
  const {document,root}=createDocument(), ports=publicPorts();
  await assert.rejects(componentRuntime.mount({
    root,surfaceLifecycle:{schema:"ordax.surface-render-lifecycle/5"},
  }),TypeError);
  assert.equal(document.head.children.length,0);
  ports.surfaceLifecycle.localization.subscribe=()=>{throw new Error("subscription denied");};
  await assert.rejects(
    componentRuntime.mount({root,surfaceLifecycle:ports.surfaceLifecycle}),
    /subscription denied/,
  );
  assert.equal(document.head.children.length,0);
  assert.equal(root.children.length,0);
});
