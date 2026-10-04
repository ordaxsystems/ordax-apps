import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const sdkRoot = process.env.ORDAX_STUDIO_SDK_ROOT;
if (!sdkRoot) throw new Error("ORDAX_STUDIO_SDK_ROOT is required");

const load = async (name) => import(pathToFileURL(path.join(sdkRoot, name)).href);

const runtime = await load("studio-runtime.mjs");
const capabilities = await load("device-capabilities.mjs");
const actions = await load("device-action-envelope.mjs");
const projects = await load("project-catalog.mjs");

function projectCatalog() {
  return {
    schema: projects.PROJECT_CATALOG_SCHEMA,
    getSnapshot() {
      return { persistence: "session", projects: [] };
    },
    subscribe() { return () => {}; },
    create() {},
    rename() {},
    recordOpened() {},
    recordFileOpened() {},
    clearLastFile() {},
    relocateLastFilePath() {},
    remove() {},
  };
}

function capabilitySnapshot() {
  return {
    schema: capabilities.DEVICE_AGENT_CAPABILITIES_SCHEMA,
    state: "ready",
    capabilities: [
      { id: "computer.files.read", modes: ["read"] },
      { id: "computer.files.write", modes: ["write"] },
    ],
  };
}

function capabilityReader(overrides = {}) {
  return {
    schema: capabilities.DEVICE_AGENT_CAPABILITY_READER_SCHEMA,
    async capabilities() { return capabilitySnapshot(); },
    ...overrides,
  };
}

function actionRequest(overrides = {}) {
  return {
    schema: actions.DEVICE_ACTION_REQUEST_SCHEMA,
    actionId: "studio-action-1",
    idempotencyKey: "studio-idempotency-1",
    accountId: "account-1",
    spaceId: "space-1",
    projectId: "project-1",
    deviceId: "device-1",
    client: "ordax-desktop",
    capability: "computer.files.read",
    operation: "files.read",
    parameters: { path: "README.md" },
    requestedAt: 1000,
    expiresAt: 2000,
    expectedDeviceRevision: null,
    ...overrides,
  };
}

function receiptFor(request, overrides = {}) {
  return {
    schema: actions.DEVICE_ACTION_RECEIPT_SCHEMA,
    actionId: request.actionId,
    deviceId: request.deviceId,
    state: "accepted",
    acceptedAt: request.requestedAt,
    completedAt: null,
    deviceRevision: null,
    resultCode: null,
    message: null,
    ...overrides,
  };
}

function studioPort({ onRequest = null, reader = null, catalog = null, ...extra } = {}) {
  return {
    schema: runtime.STUDIO_RUNTIME_PORT_SCHEMA,
    capabilityReader: reader ?? capabilityReader(),
    projectCatalog: catalog ?? projectCatalog(),
    async requestAction(request) {
      if (onRequest) return onRequest(request);
      return receiptFor(request);
    },
    ...extra,
  };
}

test("public Studio runtime validates capability discovery without raw execution", async () => {
  const port = studioPort();
  assert.equal(runtime.assertStudioRuntimePort(port), port);
  const snapshot = await runtime.readStudioRuntimeCapabilities(port);
  assert.equal(snapshot.schema, capabilities.DEVICE_AGENT_CAPABILITIES_SCHEMA);
  assert.equal(snapshot.state, "ready");
  assert.deepEqual(snapshot.capabilities.map((entry) => entry.id), [
    "computer.files.read",
    "computer.files.write",
  ]);
  assert.equal(Object.isFrozen(snapshot), true);
});

test("portable Studio boundary rejects raw Device Agent execution surfaces", () => {
  assert.throws(
    () => runtime.assertStudioRuntimePort(studioPort({ execute() {} })),
    /must not expose raw device execution/,
  );
  assert.throws(
    () => runtime.assertStudioRuntimePort(studioPort({ deviceAgent: {} })),
    /must not expose raw device execution/,
  );
  assert.throws(
    () => runtime.assertStudioRuntimePort(studioPort({ reader: capabilityReader({ execute() {} }) })),
    /must not expose execute/,
  );
});

test("Studio action request stays typed data and receipt must correlate", async () => {
  let observed = null;
  const request = actionRequest();
  const port = studioPort({
    onRequest(validated) {
      observed = validated;
      return receiptFor(validated);
    },
  });
  const receipt = await runtime.requestStudioDeviceAction(port, request);
  assert.equal(observed.schema, actions.DEVICE_ACTION_REQUEST_SCHEMA);
  assert.equal(observed.actionId, request.actionId);
  assert.equal(observed.deviceId, request.deviceId);
  assert.equal(Object.isFrozen(observed), true);
  assert.equal(receipt.schema, actions.DEVICE_ACTION_RECEIPT_SCHEMA);
  assert.equal(receipt.actionId, request.actionId);
  assert.equal(receipt.deviceId, request.deviceId);

  await assert.rejects(
    runtime.requestStudioDeviceAction(
      studioPort({ onRequest: (validated) => receiptFor(validated, { actionId: "other-action" }) }),
      request,
    ),
    /does not match its request/,
  );
});

test("forbidden capabilities and credential-like payloads fail before host dispatch", async () => {
  let dispatchCount = 0;
  const port = studioPort({
    onRequest(validated) {
      dispatchCount += 1;
      return receiptFor(validated);
    },
  });

  await assert.rejects(
    runtime.requestStudioDeviceAction(port, actionRequest({ capability: "shell.generic" })),
    /capability is forbidden/,
  );
  await assert.rejects(
    runtime.requestStudioDeviceAction(port, actionRequest({ parameters: { token: "secret-value" } })),
    /credential-like field token/,
  );
  assert.equal(dispatchCount, 0);
});

test("Studio runtime requires the public project catalog port", () => {
  const invalidCatalog = {
    schema: projects.PROJECT_CATALOG_SCHEMA,
    getSnapshot() { return { persistence: "session", projects: [] }; },
  };
  assert.throws(
    () => runtime.assertStudioRuntimePort(studioPort({ catalog: invalidCatalog })),
    /Project-catalog port must implement/,
  );
});

test("same public request semantics are host-neutral", async () => {
  const seen = [];
  const makeHost = (host) => studioPort({
    onRequest(validated) {
      seen.push({ host, request: validated });
      return receiptFor(validated);
    },
  });

  const request = actionRequest();
  const windowsReceipt = await runtime.requestStudioDeviceAction(makeHost("windows"), request);
  const ordaxReceipt = await runtime.requestStudioDeviceAction(makeHost("ordax-os"), request);

  assert.deepEqual(seen[0].request, seen[1].request);
  assert.deepEqual(windowsReceipt, ordaxReceipt);
  assert.equal(Object.hasOwn(seen[0].request, "host"), false);
  assert.equal(Object.hasOwn(seen[0].request, "provider"), false);
});
