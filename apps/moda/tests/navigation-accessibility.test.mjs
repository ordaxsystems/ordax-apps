import test from "node:test";
import assert from "node:assert/strict";
import { createEventScope, sidebarFocusWrapTarget } from "../src/ui/app.mjs";

test("mobile sidebar focus wraps at the first and last control", () => {
  assert.equal(sidebarFocusWrapTarget(0, 12, true), 11);
  assert.equal(sidebarFocusWrapTarget(11, 12, false), 0);
  assert.equal(sidebarFocusWrapTarget(5, 12, false), null);
  assert.equal(sidebarFocusWrapTarget(5, 12, true), null);
});

test("mobile sidebar focus enters from outside and handles an empty menu", () => {
  assert.equal(sidebarFocusWrapTarget(-1, 12, false), 0);
  assert.equal(sidebarFocusWrapTarget(-1, 12, true), 11);
  assert.equal(sidebarFocusWrapTarget(0, 0, false), null);
});

test("app event scope removes delegated listeners on teardown and is idempotent", () => {
  const root = new EventTarget();
  const calls = [];
  const events = createEventScope(root);
  events.add("click", () => calls.push("click"));
  events.add("close", () => calls.push("close"), true);

  root.dispatchEvent(new Event("click"));
  root.dispatchEvent(new Event("close"));
  assert.deepEqual(calls, ["click", "close"]);

  events.dispose();
  events.dispose();
  root.dispatchEvent(new Event("click"));
  root.dispatchEvent(new Event("close"));
  assert.deepEqual(calls, ["click", "close"]);
});
