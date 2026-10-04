import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  STUDIO_HOST_BRIDGE_SCHEMA,
  assertStudioHostBridge,
  studioHostBridgePortSchemas,
} from "../contracts/studio-host-bridge.mjs";

function port(schema, extra = {}) {
  return { schema, ...extra };
}

function validBridge() {
  return {
    schema: STUDIO_HOST_BRIDGE_SCHEMA,
    authority: "none",
    studioRuntime: port("ordax.studio-runtime/1", {
      capabilityReader: {},
      projectCatalog: {},
      requestAction: async () => ({}),
    }),
    memory: port("ordax.memory/1"),
    intelligence: port("ordax.intelligence/1"),
    localization: port("ordax.localization/1"),
  };
}

test("Studio host bridge composes only reviewed public port schemas", () => {
  assert.deepEqual(studioHostBridgePortSchemas(), {
    studioRuntime: "ordax.studio-runtime/1",
    memory: "ordax.memory/1",
    intelligence: "ordax.intelligence/1",
    localization: "ordax.localization/1",
  });

  const bridge = assertStudioHostBridge(validBridge());
  assert.equal(bridge.schema, STUDIO_HOST_BRIDGE_SCHEMA);
  assert.equal(bridge.authority, "none");
  assert.equal(bridge.studioRuntime.schema, "ordax.studio-runtime/1");
});

test("Windows and OrdaX OS hosts conform to the same portable bridge shape", () => {
  const windows = validBridge();
  const ordaxOs = validBridge();

  assert.deepEqual(
    Object.keys(assertStudioHostBridge(windows)).sort(),
    Object.keys(assertStudioHostBridge(ordaxOs)).sort(),
  );
  assert.deepEqual(
    Object.values(studioHostBridgePortSchemas()).sort(),
    [
      "ordax.intelligence/1",
      "ordax.localization/1",
      "ordax.memory/1",
      "ordax.studio-runtime/1",
    ].sort(),
  );
});

test("host-specific and generic dispatch surfaces are rejected", () => {
  for (const field of [
    "call",
    "execute",
    "deviceAgent",
    "controlPlane",
    "computerPolicy",
    "pairing",
    "provider",
    "pywebview",
    "webview2",
  ]) {
    const candidate = { ...validBridge(), [field]: {} };
    assert.throws(() => assertStudioHostBridge(candidate), /fields are incompatible/);
  }

  for (const field of ["call", "execute", "deviceAgent"]) {
    const candidate = validBridge();
    candidate.studioRuntime[field] = () => {};
    assert.throws(
      () => assertStudioHostBridge(candidate),
      /must not expose raw or generic dispatch/,
    );
  }
});

test("bridge cannot relabel private or provider-specific implementations as public ports", () => {
  for (const [field, schema] of [
    ["studioRuntime", "ordax.device-agent/1"],
    ["memory", "ordax-private.memory-store/1"],
    ["intelligence", "chatgpt.responses/1"],
    ["localization", "windows.locale/1"],
  ]) {
    const candidate = validBridge();
    candidate[field] = port(schema);
    assert.throws(() => assertStudioHostBridge(candidate), /schema is incompatible/);
  }
});

test("bridge source contains no concrete host, provider, or Control Plane implementation", async () => {
  const source = await readFile(
    new URL("../contracts/studio-host-bridge.mjs", import.meta.url),
    "utf8",
  );

  for (const forbidden of [
    "window.pywebview",
    "window.chrome.webview",
    "ActionRegistry",
    "AgentConfig",
    "CloudflareControlPlane",
    "ordax_dev_agent",
    "ordax_device_agent",
  ]) {
    assert.equal(source.includes(forbidden), false, `bridge leaked ${forbidden}`);
  }
});
