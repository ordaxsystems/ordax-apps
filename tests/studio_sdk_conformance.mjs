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
const memory = await load("memory.mjs");
const intelligence = await load("intelligence.mjs");
const localeProfile = await load("locale-profile.mjs");
const localization = await load("localization.mjs");

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

function memoryItem(overrides = {}) {
  return {
    id: "memory-1",
    ownerKind: "device",
    ownerId: null,
    scope: "project",
    kind: "summary",
    sensitivity: "private",
    content: "Studio parity fixture",
    provenance: "ordax-apps conformance",
    sourceTimestamp: "2026-10-04T00:00:00.000Z",
    spaceId: null,
    projectId: "project-1",
    ...overrides,
  };
}

function memoryPort() {
  const store = new Map();
  return {
    schema: memory.MEMORY_PORT_SCHEMA,
    async search(request) {
      const valid = memory.validateMemorySearchRequest(request);
      return [...store.values()].filter((item) => {
        if (valid.scopes && !valid.scopes.includes(item.scope)) return false;
        if (valid.projectId && item.projectId !== valid.projectId) return false;
        if (valid.query && !item.content.toLowerCase().includes(valid.query.toLowerCase())) return false;
        return true;
      }).slice(valid.offset, valid.offset + valid.limit);
    },
    async remember(item) {
      const valid = memory.validateMemoryItem(item);
      store.set(valid.id, valid);
      return valid;
    },
    async forget(request) {
      const valid = memory.validateMemoryForgetRequest(request);
      return store.delete(valid.id);
    },
    async flush() {
      return { ok: true };
    },
  };
}

function intelligencePort() {
  const snapshot = {
    state: "ready",
    inferenceAvailable: true,
    engineId: "fixture-engine",
    modelId: "fixture-model",
    authority: "none",
    toolExecution: false,
  };
  return {
    schema: intelligence.INTELLIGENCE_PORT_SCHEMA,
    getSnapshot() {
      return snapshot;
    },
    subscribe() {
      return () => {};
    },
    async respond(request) {
      const valid = intelligence.validateIntelligenceRequest(request);
      return intelligence.validateIntelligenceResponse({
        schema: intelligence.INTELLIGENCE_RESPONSE_SCHEMA,
        text: `${valid.intent}:${valid.prompt}`,
        engineId: snapshot.engineId,
        modelId: snapshot.modelId,
        authority: "none",
      });
    },
  };
}

function localizationPort(locale = "pt-BR") {
  const profile = localeProfile.createLocaleProfile(locale);
  return {
    schema: localization.LOCALIZATION_SCHEMA,
    getLocale() {
      return locale;
    },
    getProfile() {
      return profile;
    },
    translate(key, variables = {}) {
      const suffix = Object.keys(variables).length ? `:${JSON.stringify(variables)}` : "";
      return `${locale}:${key}${suffix}`;
    },
    subscribe() {
      return () => {};
    },
  };
}

function hostFacets() {
  return {
    studioRuntime: studioPort(),
    memory: memoryPort(),
    intelligence: intelligencePort(),
    localization: localizationPort(),
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

test("Memory, Intelligence and Localization facets use the pinned public contracts", async () => {
  const facets = hostFacets();
  assert.equal(memory.assertMemoryPort(facets.memory), facets.memory);
  assert.equal(intelligence.assertIntelligencePort(facets.intelligence), facets.intelligence);
  assert.equal(localization.assertLocalizationPort(facets.localization), facets.localization);

  const remembered = await facets.memory.remember(memoryItem());
  assert.equal(remembered.schema, memory.MEMORY_PORT_SCHEMA);
  const found = await facets.memory.search({
    ownerKind: "device",
    ownerId: null,
    query: "parity",
    scopes: ["project"],
    projectId: "project-1",
    limit: 8,
    offset: 0,
  });
  assert.equal(found.length, 1);
  assert.equal(found[0].id, "memory-1");

  const response = await facets.intelligence.respond({
    intent: "summarize",
    prompt: "Summarize the active project",
    context: [],
    maxTokens: 256,
  });
  assert.equal(response.schema, intelligence.INTELLIGENCE_RESPONSE_SCHEMA);
  assert.equal(response.authority, "none");
  assert.equal(facets.localization.getLocale(), "pt-BR");
  assert.equal(facets.localization.getProfile().schema, localeProfile.LOCALE_PROFILE_SCHEMA);
  assert.equal(facets.localization.translate("studio.ready"), "pt-BR:studio.ready");
});

test("same public facet semantics are host-neutral across Windows and OrdaX OS", async () => {
  const windows = hostFacets();
  const ordaxOs = hostFacets();

  runtime.assertStudioRuntimePort(windows.studioRuntime);
  runtime.assertStudioRuntimePort(ordaxOs.studioRuntime);
  memory.assertMemoryPort(windows.memory);
  memory.assertMemoryPort(ordaxOs.memory);
  intelligence.assertIntelligencePort(windows.intelligence);
  intelligence.assertIntelligencePort(ordaxOs.intelligence);
  localization.assertLocalizationPort(windows.localization);
  localization.assertLocalizationPort(ordaxOs.localization);

  const request = actionRequest();
  const windowsReceipt = await runtime.requestStudioDeviceAction(windows.studioRuntime, request);
  const ordaxReceipt = await runtime.requestStudioDeviceAction(ordaxOs.studioRuntime, request);
  assert.deepEqual(windowsReceipt, ordaxReceipt);

  const item = memoryItem();
  assert.deepEqual(await windows.memory.remember(item), await ordaxOs.memory.remember(item));
  const search = {
    ownerKind: "device",
    ownerId: null,
    query: "Studio",
    scopes: ["project"],
    projectId: "project-1",
    limit: 8,
    offset: 0,
  };
  assert.deepEqual(await windows.memory.search(search), await ordaxOs.memory.search(search));

  const intelligenceRequest = {
    intent: "explain",
    prompt: "Explain the current state",
    context: [],
    maxTokens: 128,
  };
  assert.deepEqual(
    await windows.intelligence.respond(intelligenceRequest),
    await ordaxOs.intelligence.respond(intelligenceRequest),
  );
  assert.deepEqual(windows.localization.getProfile(), ordaxOs.localization.getProfile());
  assert.equal(windows.localization.translate("studio.ready"), ordaxOs.localization.translate("studio.ready"));
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
