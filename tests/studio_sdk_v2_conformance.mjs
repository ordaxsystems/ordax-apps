import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const sdkRoot = process.env.ORDAX_STUDIO_SDK_ROOT;
if (!sdkRoot) throw new Error("ORDAX_STUDIO_SDK_ROOT is required");

const load = async (name) => import(pathToFileURL(path.join(sdkRoot, name)).href);

const runtime = await load("studio-runtime-v2.mjs");
const contextContract = await load("studio-action-context.mjs");
const actionsV2 = await load("device-action-envelope-v2.mjs");
const actionsV1 = await load("device-action-envelope.mjs");
const capabilities = await load("device-capabilities.mjs");
const projects = await load("project-catalog.mjs");

function projectCatalog() {
  const noop = () => {};
  return {
    schema: projects.PROJECT_CATALOG_SCHEMA,
    getSnapshot: () => ({ persistence: "session", projects: [] }),
    subscribe: noop,
    create: noop,
    rename: noop,
    recordOpened: noop,
    recordFileOpened: noop,
    clearLastFile: noop,
    relocateLastFilePath: noop,
    remove: noop,
  };
}

function capabilityReader() {
  return {
    schema: capabilities.DEVICE_AGENT_CAPABILITY_READER_SCHEMA,
    async capabilities() {
      return {
        schema: capabilities.DEVICE_AGENT_CAPABILITIES_SCHEMA,
        state: "ready",
        capabilities: [{ id: "computer.windows", modes: ["read"] }],
      };
    },
  };
}

function actionContext(overrides = {}) {
  return {
    schema: contextContract.STUDIO_ACTION_CONTEXT_SCHEMA,
    actor: { kind: "device-owner", subjectId: null },
    deviceId: "windows-local-device-1",
    client: "ordax-desktop",
    spaceId: null,
    ...overrides,
  };
}

function request(overrides = {}) {
  return {
    schema: actionsV2.DEVICE_ACTION_REQUEST_V2_SCHEMA,
    actionId: "studio-v2-action-1",
    idempotencyKey: "studio-v2-idempotency-1",
    actor: { kind: "device-owner", subjectId: null },
    spaceId: null,
    projectId: null,
    deviceId: "windows-local-device-1",
    client: "ordax-desktop",
    capability: "computer.windows",
    parameters: {},
    requestedAt: 1000,
    expiresAt: 2000,
    expectedDeviceRevision: null,
    ...overrides,
  };
}

function receiptFor(action, overrides = {}) {
  return {
    schema: actionsV1.DEVICE_ACTION_RECEIPT_SCHEMA,
    actionId: action.actionId,
    deviceId: action.deviceId,
    state: "accepted",
    acceptedAt: action.requestedAt,
    completedAt: null,
    deviceRevision: null,
    resultCode: null,
    message: null,
    ...overrides,
  };
}

function studioPort({ context = actionContext(), onRequest = null, ...extra } = {}) {
  return {
    schema: runtime.STUDIO_RUNTIME_V2_PORT_SCHEMA,
    capabilityReader: capabilityReader(),
    projectCatalog: projectCatalog(),
    async getActionContext() {
      return context;
    },
    async requestAction(action) {
      if (onRequest) return onRequest(action);
      return receiptFor(action);
    },
    ...extra,
  };
}

test("runtime v2 accepts host-derived device-owner context without synthetic account identity", async () => {
  const port = studioPort();
  assert.equal(runtime.assertStudioRuntimeV2Port(port), port);

  const context = await runtime.readStudioActionContext(port);
  assert.equal(context.schema, contextContract.STUDIO_ACTION_CONTEXT_SCHEMA);
  assert.deepEqual(context.actor, { kind: "device-owner", subjectId: null });
  assert.equal(context.deviceId, "windows-local-device-1");
  assert.equal(context.spaceId, null);

  const snapshot = await runtime.readStudioRuntimeV2Capabilities(port);
  assert.equal(snapshot.state, "ready");
  assert.deepEqual(snapshot.capabilities[0], { id: "computer.windows", modes: ["read"] });
});

test("device-scoped request v2 keeps projectId null and correlates receipt", async () => {
  let observed = null;
  const action = request();
  const port = studioPort({
    onRequest(validated) {
      observed = validated;
      return receiptFor(validated);
    },
  });

  const receipt = await runtime.requestStudioDeviceActionV2(port, action);
  assert.equal(observed.schema, actionsV2.DEVICE_ACTION_REQUEST_V2_SCHEMA);
  assert.equal(observed.projectId, null);
  assert.deepEqual(observed.actor, { kind: "device-owner", subjectId: null });
  assert.equal(receipt.actionId, action.actionId);
  assert.equal(receipt.deviceId, action.deviceId);
});

test("runtime v2 rejects caller identity that does not match host action context", async () => {
  const port = studioPort();

  await assert.rejects(
    runtime.requestStudioDeviceActionV2(
      port,
      request({ actor: { kind: "account", subjectId: "account-1" } }),
    ),
    /identity does not match host context/,
  );

  await assert.rejects(
    runtime.requestStudioDeviceActionV2(port, request({ deviceId: "other-device" })),
    /identity does not match host context/,
  );

  await assert.rejects(
    runtime.requestStudioDeviceActionV2(port, request({ spaceId: "space-1" })),
    /identity does not match host context/,
  );
});

test("device-owner cannot fabricate a subject id and account actor requires one", () => {
  assert.throws(
    () => actionsV2.validateDeviceActionRequestV2(
      request({ actor: { kind: "device-owner", subjectId: "account-1" } }),
    ),
    /must not fabricate an account subject id/,
  );

  assert.throws(
    () => actionsV2.validateDeviceActionRequestV2(
      request({ actor: { kind: "account", subjectId: null } }),
    ),
    /requires a real subject id/,
  );
});

test("runtime v2 exposes no raw or generic dispatch surface", () => {
  assert.throws(
    () => runtime.assertStudioRuntimeV2Port(studioPort({ execute() {} })),
    /must not expose raw or generic dispatch/,
  );
  assert.throws(
    () => runtime.assertStudioRuntimeV2Port(studioPort({ deviceAgent: {} })),
    /must not expose raw or generic dispatch/,
  );
  assert.throws(
    () => runtime.assertStudioRuntimeV2Port(studioPort({ call() {} })),
    /must not expose raw or generic dispatch/,
  );
});

test("request v2 still rejects forbidden capabilities and credential-like payloads", () => {
  assert.throws(
    () => actionsV2.validateDeviceActionRequestV2(request({ capability: "shell.generic" })),
    /capability is forbidden/,
  );
  assert.throws(
    () => actionsV2.validateDeviceActionRequestV2(
      request({ parameters: { token: "secret-value" } }),
    ),
    /credential-like field token/,
  );
});
