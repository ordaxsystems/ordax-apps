import assert from "node:assert/strict";
import test from "node:test";
import {componentRuntime} from "../src/runtime.mjs";
import {
  createDocument, publicPorts, screen,
} from "../../../tests/support/preview_mount_fixture.mjs";

test("Converter preserves in-progress value and unit pair when the locale changes", async () => {
  const {document,root} = createDocument(), ports = publicPorts();
  const component = await componentRuntime.mount({root,surfaceLifecycle:ports.surfaceLifecycle});
  assert.equal(document.head.children.length,1);
  const old = screen(root,"value","from","to","result","error");
  old.value.value = "2.5";
  old.from.value = "km";
  old.to.value = "m";
  old.value.emit("input");
  assert.equal(old.error.hidden,true);
  assert.notEqual(old.result.textContent,"—");
  ports.switchLocale("en-US");
  const current = screen(root,"value","from","to","result","error");
  assert.notEqual(current.value,old.value);
  assert.equal(current.value.value,"2.5");
  assert.equal(current.from.value,"km");
  assert.equal(current.to.value,"m");
  assert.equal(current.error.hidden,true);
  assert.equal(old.value.listeners.get("input")?.size,0);
  assert.equal(old.from.listeners.get("input")?.size,0);
  assert.equal(old.to.listeners.get("input")?.size,0);
  assert.deepEqual(ports.listeners(),{activations:0,localizations:1});
  component.destroy();
  component.destroy();
  assert.deepEqual(ports.listeners(),{activations:0,localizations:0});
  assert.equal(root.children.length,0);
  assert.equal(document.head.children.length,0);
});

test("Converter retains an incompatible unit selection and translates error during locale change", async () => {
  const {root} = createDocument(), ports = publicPorts();
  const component = await componentRuntime.mount({root,surfaceLifecycle:ports.surfaceLifecycle});
  const first = screen(root,"value","from","to","error");
  first.value.value = "3";
  first.from.value = "kg";
  first.to.value = "mi";
  first.to.emit("input");
  assert.equal(first.error.hidden,false);
  assert.equal(first.error.textContent,"Unidades incompatíveis");
  ports.switchLocale("en-US");
  const later = screen(root,"value","from","to","error");
  assert.equal(later.value.value,"3");
  assert.equal(later.from.value,"kg");
  assert.equal(later.to.value,"mi");
  assert.equal(later.error.hidden,false);
  assert.equal(later.error.textContent,"Incompatible units");
  component.destroy();
});

test("Converter rejects incomplete public ports and cleans up failed subscriptions", async () => {
  const {document,root} = createDocument(), ports = publicPorts();
  await assert.rejects(
    componentRuntime.mount({root,surfaceLifecycle:{schema:"ordax.surface-render-lifecycle/5"}}),
    TypeError,
  );
  assert.equal(document.head.children.length,0);
  ports.surfaceLifecycle.localization.subscribe=()=>{throw new Error("subscription rejected");};
  await assert.rejects(
    componentRuntime.mount({root,surfaceLifecycle:ports.surfaceLifecycle}),
    /subscription rejected/,
  );
  assert.equal(document.head.children.length,0);
  assert.equal(root.children.length,0);
});
