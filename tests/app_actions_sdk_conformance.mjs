import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { createNotesRuntime } from "../apps/notes/src/domain/runtime.mjs";
import {
  applicationActionProviderArtifact as notesProviderArtifact,
  createApplicationActionProvider as createNotesActionProvider,
} from "../apps/notes/actions/providers/notes-native.mjs";
import {
  applicationActionProviderArtifact as studioProviderArtifact,
  createApplicationActionProvider as createStudioActionProvider,
} from "../apps/studio/actions/providers/studio-native.mjs";

const rootUrl = new URL("../", import.meta.url);
const sdkRoot = process.env.ORDAX_APP_ACTIONS_SDK_ROOT;
if (!sdkRoot) throw new Error("ORDAX_APP_ACTIONS_SDK_ROOT is required");

const manifestContract = await import(
  pathToFileURL(path.join(sdkRoot, "application-action-manifest.mjs")).href
);
const providerContract = await import(
  pathToFileURL(path.join(sdkRoot, "application-action-provider.mjs")).href
);

async function json(relative) {
  return JSON.parse(await readFile(new URL(relative, rootUrl), "utf8"));
}

function invocation(provider, actionId, args, suffix) {
  return providerContract.validateApplicationActionProviderInvocation({
    schema: providerContract.APPLICATION_ACTION_PROVIDER_INVOCATION_SCHEMA,
    workItemId: `work-${suffix}`,
    resourceRef: `application-action:${suffix}`,
    appId: provider.appId,
    actionId,
    arguments: args,
  }, {
    appId: provider.appId,
    actionIds: provider.actions,
  });
}

function successful(value) {
  const normalized = providerContract.validateApplicationActionProviderResult(value);
  assert.equal(normalized.status, "succeeded");
  return normalized;
}

for (const appId of ["notes", "studio"]) {
  test(`${appId} action manifest conforms to pinned App SDK 1.12`, async () => {
    const app = await json(`apps/${appId}/app.json`);
    const raw = await json(`apps/${appId}/actions/manifest.json`);
    const manifest = manifestContract.validateApplicationActionManifest(raw, {
      appId: app.id,
      appVersion: app.version,
    });

    assert.equal(manifest.authority, "none");
    assert.equal(manifest.execution, "proposal-only");
    for (const capability of manifest.capabilities) {
      assert.equal(capability.appId, app.id);
      assert.match(capability.actionId, new RegExp(`^${app.id}\\.`));
      assert.equal(capability.sourceClass, "first-party");
      assert.equal(capability.platform, "ordax");
      assert.equal(capability.provider.kind, "first-party-native");
      assert.equal(capability.provider.revision, "2");
      assert.equal(capability.binding.payloadSha256, null);
      assert.equal(capability.executionAuthorized, false);
      assert.equal(capability.modelDirectExecutionAuthorized, false);
    }
  });
}

test("Notes provider revision 2 conforms to SDK 1.12 and operates only on injected Notes runtime", async () => {
  const runtime = createNotesRuntime();
  const provider = providerContract.validateApplicationActionProvider(
    createNotesActionProvider(runtime),
  );
  const manifest = await json("apps/notes/actions/manifest.json");

  assert.equal(provider.appId, "notes");
  assert.equal(provider.adapterId, "notes-native");
  assert.equal(provider.revision, "2");
  assert.deepEqual(
    new Set(provider.actions),
    new Set(manifest.capabilities.map((capability) => capability.actionId)),
  );
  assert.equal(notesProviderArtifact.authority, "none");
  assert.equal(notesProviderArtifact.execution, "unavailable");
  assert.equal(notesProviderArtifact.revision, "2");

  const created = successful(await provider.invoke(invocation(
    provider,
    "notes.create-note",
    { title: "Provider 1.12", body: "Conteúdo tipado" },
    "notes-create",
  )));
  assert.equal(created.output.title, "Provider 1.12");
  assert.match(created.output.noteId, /^note:/);

  const inspected = successful(await provider.invoke(invocation(
    provider,
    "notes.inspect-notes",
    { query: "Provider 1.12" },
    "notes-inspect",
  )));
  assert.equal(inspected.output.notes.length, 1);
  assert.equal(inspected.output.notes[0].noteId, created.output.noteId);

  runtime.destroy();
});

test("Studio provider revision 2 conforms to SDK 1.12 over typed host methods", async () => {
  const calls = [];
  const ok = (name, data = { state: "ready" }) => async (...args) => {
    calls.push([name, ...args]);
    return { ok: true, summary: `${name} ok`, data };
  };
  const host = {
    projectsCatalog: async () => ({
      ok: true,
      summary: "projects ok",
      projects: [
        { slug: "ordax-apps", path: "must-not-leak" },
        { id: "bay-of-all-saints", path: "must-not-leak" },
      ],
    }),
    selectProject: ok("selectProject"),
    inventory: ok("inventory", { files: 42, path: "must-not-leak" }),
    briefing: ok("briefing", { status: "ready", token: "must-not-leak" }),
    search: ok("search", { matches: 2, path: "must-not-leak" }),
    gitDiff: ok("gitDiff", { changedFiles: 3 }),
    previewStatus: ok("previewStatus"),
    previewStart: ok("previewStart"),
    previewStop: ok("previewStop"),
    previewCapture: ok("previewCapture"),
    previewLogs: ok("previewLogs", { lines: 12 }),
    health: ok("health", { state: "healthy" }),
    executionStatus: ok("executionStatus", { state: "idle" }),
    productStatus: ok("productStatus", { state: "ready" }),
    browserStart: ok("browserStart", { sessionId: "must-not-leak" }),
    blenderPrepare: ok("blenderPrepare"),
    blenderInstallBridge: ok("blenderInstallBridge"),
    blenderInstances: ok("blenderInstances", { count: 1 }),
    blenderStart: ok("blenderStart"),
  };

  const provider = providerContract.validateApplicationActionProvider(
    createStudioActionProvider(host),
  );
  const manifest = await json("apps/studio/actions/manifest.json");

  assert.equal(provider.appId, "studio");
  assert.equal(provider.adapterId, "studio-native");
  assert.equal(provider.revision, "2");
  assert.deepEqual(
    new Set(provider.actions),
    new Set(manifest.capabilities.map((capability) => capability.actionId)),
  );
  assert.equal(studioProviderArtifact.authority, "none");
  assert.equal(studioProviderArtifact.execution, "unavailable");
  assert.equal(studioProviderArtifact.revision, "2");

  const projects = successful(await provider.invoke(invocation(
    provider,
    "studio.list-projects",
    {},
    "studio-projects",
  )));
  assert.deepEqual(projects.output.projects, ["ordax-apps", "bay-of-all-saints"]);
  assert.equal(JSON.stringify(projects.output).includes("must-not-leak"), false);

  const preview = successful(await provider.invoke(invocation(
    provider,
    "studio.preview-project",
    { operation: "logs" },
    "studio-preview",
  )));
  assert.equal(preview.output.lines, 12);
  assert.deepEqual(calls.find((entry) => entry[0] === "previewLogs"), ["previewLogs", 65536]);

  const browser = successful(await provider.invoke(invocation(
    provider,
    "studio.open-managed-browser",
    { url: "https://example.com" },
    "studio-browser",
  )));
  assert.deepEqual(browser.output, { opened: true, url: "https://example.com" });
  assert.deepEqual(
    calls.find((entry) => entry[0] === "browserStart"),
    ["browserStart", "https://example.com", false, 3],
  );
});

test("Studio does not expose raw-path edit or PID-less Blender adopt capability", async () => {
  const raw = await json("apps/studio/actions/manifest.json");
  const actionIds = new Set(raw.capabilities.map((capability) => capability.actionId));
  assert.equal(actionIds.has("studio.edit-file"), false);
  for (const capability of raw.capabilities) {
    assert.equal(capability.parameters.some((parameter) => parameter.id === "path"), false);
  }
  const blender = raw.capabilities.find(
    (capability) => capability.actionId === "studio.prepare-blender",
  );
  const operations = blender.parameters.find((parameter) => parameter.id === "operation").values;
  assert.equal(operations.includes("adopt"), false);
});
