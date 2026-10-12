import assert from"node:assert/strict";import test from"node:test";import{monthMatrix,shiftMonth}from"../src/calendar.mjs";
test("builds leap-month grid",()=>{const cells=monthMatrix(2028,1);assert.equal(cells.filter(Boolean).length,29);assert.equal(cells.includes(29),true);});
test("shifts across year boundary",()=>{assert.deepEqual(shiftMonth(2026,0,-1),{year:2025,month:11});});

import {componentRuntime} from "../src/runtime.mjs";
import {createDocument,publicPorts,screen} from "../../../tests/support/preview_mount_fixture.mjs";

test("Calendar mounts, navigates months, translates and releases one UI lifecycle",async()=>{
  const {document,root}=createDocument(),ports=publicPorts();
  const instance=await componentRuntime.mount({root,surfaceLifecycle:ports.surfaceLifecycle});
  assert.equal(document.head.children.length,1);
  let ui=screen(root,"prev","today","next");
  assert.equal(typeof ui.prev.onclick,"function");
  assert.equal(typeof ui.today.onclick,"function");
  ui.prev.onclick();
  const shifted=screen(root,"prev","today","next");
  assert.notEqual(shifted.prev,ui.prev,"month navigation should rerender without mounting another instance");
  ports.switchLocale("en-US");
  ui=screen(root,"prev","today","next");
  ui.today.onclick();
  assert.deepEqual(ports.listeners(),{activations:0,localizations:1});
  assert.equal(document.head.children.length,1);
  instance.destroy();
  instance.destroy();
  assert.equal(root.children.length,0);
  assert.equal(document.head.children.length,0);
  assert.deepEqual(ports.listeners(),{activations:0,localizations:0});
});

test("Calendar rejects absent public localization before adding CSS",async()=>{
  const {document,root}=createDocument();
  await assert.rejects(componentRuntime.mount({
    root,surfaceLifecycle:{schema:"ordax.surface-render-lifecycle/5"},
  }),TypeError);
  assert.equal(root.children.length,0);
  assert.equal(document.head.children.length,0);
});

test("Calendar rolls back CSS and DOM on localization subscribe failure",async()=>{
  const {document,root}=createDocument(),ports=publicPorts();
  ports.surfaceLifecycle.localization.subscribe=()=>{throw new Error("subscription unavailable");};
  await assert.rejects(componentRuntime.mount({
    root,surfaceLifecycle:ports.surfaceLifecycle,
  }),/subscription unavailable/);
  assert.equal(root.children.length,0);
  assert.equal(document.head.children.length,0);
});

test("Calendar cleans up stylesheet when section creation fails",async()=>{
  const {document,root}=createDocument({failCreateTag:"section"}),ports=publicPorts();
  await assert.rejects(componentRuntime.mount({
    root,surfaceLifecycle:ports.surfaceLifecycle,
  }),/DOM creation rejected/);
  assert.equal(root.children.length,0);
  assert.equal(document.head.children.length,0);
  assert.deepEqual(ports.listeners(),{activations:0,localizations:0});
});
