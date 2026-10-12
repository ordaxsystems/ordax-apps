import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const sdkRoot = process.env.ORDAX_STUDIO_SDK_ROOT;
if (!sdkRoot) throw new Error("ORDAX_STUDIO_SDK_ROOT is required");

const load = async (name) => import(pathToFileURL(path.join(sdkRoot, name)).href);

const runtime = await load("studio-runtime-v3.mjs");
const contextContract = await load("studio-action-context.mjs");
const actionsV2 = await load("device-action-envelope-v2.mjs");
const actionsV1 = await load("device-action-envelope.mjs");
const actionResults = await load("device-action-result.mjs");
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
    actionId: "studio-v3-action-1",
    idempotencyKey: "studio-v3-idempotency-1",
    actor: { kind: "device-owner", subjectId: null },
    spaceId: null,
    projectId: "project-1",
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

function succeededReceipt(action, overrides = {}) {
  return {
    schema: actionsV1.DEVICE_ACTION_RECEIPT_SCHEMA,
    actionId: action.actionId,
    deviceId: action.deviceId,
    state: "succeeded",
    acceptedAt: action.requestedAt,
    completedAt: action.requestedAt + 1,
    deviceRevision: 1,
    resultCode: "ok",
    message: null,
    ...overrides,
  };
}

function resultFor(action, overrides = {}) {
  return {
    schema: actionResults.DEVICE_ACTION_RESULT_SCHEMA,
    binding: {
      actionId: action.actionId,
      actor: action.actor,
      spaceId: action.spaceId,
      projectId: action.projectId,
      deviceId: action.deviceId,
      client: action.client,
    },
    receipt: succeededReceipt(action),
    output: { windows: [{ title: "Explorer" }] },
    ...overrides,
  };
}

function studioPort({ context = actionContext(), onRequest = null, onResult = null, ...extra } = {}) {
  return {
    schema: runtime.STUDIO_RUNTIME_V3_PORT_SCHEMA,
    capabilityReader: capabilityReader(),
    projectCatalog: projectCatalog(),
    async getActionContext() {
      return context;
    },
    async requestAction(action) {
      if (onRequest) return onRequest(action);
      return succeededReceipt(action);
    },
    async getActionResult(action) {
      if (onResult) return onResult(action);
      return resultFor(action);
    },
    ...extra,
  };
}

test("runtime v3 reads a bounded result using the original request and preserves host scope", async () => {
  const action = request();
  let observedRequest = null;
  const port = studioPort({
    onResult(validated) {
      observedRequest = validated;
      return resultFor(validated);
    },
  });

  assert.equal(runtime.assertStudioRuntimeV3Port(port), port);
  const result = await runtime.readStudioDeviceActionResult(port, action);

  assert.equal(observedRequest.actionId, action.actionId);
  assert.equal(observedRequest.projectId, "project-1");
  assert.equal(result.schema, actionResults.DEVICE_ACTION_RESULT_SCHEMA);
  assert.equal(result.receipt.state, "succeeded");
  assert.equal(result.output.windows[0].title, "Explorer");
  assert.deepEqual(result.binding.actor, { kind: "device-owner", subjectId: null });
});

test("runtime v3 rejects a result rebound to another project, device or action", async () => {
  const action = request();

  await assert.rejects(
    runtime.readStudioDeviceActionResult(
      studioPort({
        onResult(validated) {
          return resultFor(validated, {
            binding: { ...resultFor(validated).binding, projectId: "project-2" },
          });
        },
      }),
      action,
    ),
    /binding does not match its request/,
  );

  await assert.rejects(
    runtime.readStudioDeviceActionResult(
      studioPort({
        onResult(validated) {
          return resultFor(validated, {
            binding: { ...resultFor(validated).binding, deviceId: "other-device" },
            receipt: succeededReceipt(validated, { deviceId: "other-device" }),
          });
        },
      }),
      action,
    ),
    /binding does not match its request/,
  );
});

test("runtime v3 revalidates host context before result lookup", async () => {
  await assert.rejects(
    runtime.readStudioDeviceActionResult(
      studioPort({ context: actionContext({ spaceId: "space-other" }) }),
      request(),
    ),
    /identity does not match host context/,
  );
});

test("result contract keeps output bounded data and rejects credential-like fields", () => {
  const action = request();
  assert.throws(
    () => actionResults.validateDeviceActionResult(
      resultFor(action, { output: { access_token: "secret" } }),
    ),
    /credential-like field/,
  );

  assert.throws(
    () => actionResults.validateDeviceActionResult({
      ...resultFor(action),
      receipt: succeededReceipt(action, { state: "failed", resultCode: "error" }),
    }),
    /must not expose output/,
  );
});

test("runtime v3 exposes no raw or generic dispatch surface", () => {
  assert.throws(
    () => runtime.assertStudioRuntimeV3Port(studioPort({ execute() {} })),
    /must not expose raw or generic dispatch/,
  );
  assert.throws(
    () => runtime.assertStudioRuntimeV3Port(studioPort({ deviceAgent: {} })),
    /must not expose raw or generic dispatch/,
  );
  assert.throws(
    () => runtime.assertStudioRuntimeV3Port(studioPort({ call() {} })),
    /must not expose raw or generic dispatch/,
  );
});
