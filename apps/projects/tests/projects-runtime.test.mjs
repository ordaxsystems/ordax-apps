import assert from "node:assert/strict";
import test from "node:test";
import { componentRuntime } from "../src/runtime.mjs";
import { createProjectsPresentation, mountProjectsWorkspaceControls } from "../src/ui/workspace-controls.mjs";
import { probeProjectsDeviceAgent } from "../src/device-agent-status.mjs";
import { assertDeviceAgentCapabilityReaderPort } from "../src/sdk/contracts/device-capabilities.mjs";
import { translateProjectsMessage } from "../src/i18n/messages.mjs";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createLocaleProfile } from "../src/sdk/contracts/locale-profile.mjs";

const cloudId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const spaceId = "11111111-1111-4111-8111-111111111111";
const project = Object.freeze({
  id: "project-1", name: "Loja", path: "/Documentos/Loja",
  createdAt: 10, lastOpenedAt: 20, lastFilePath: null,
});

test("Projects package exports only its own independent runtime identity", () => {
  assert.equal(componentRuntime.schema, "ordax.component-runtime/1");
  assert.equal(componentRuntime.componentId, "projects");
  assert.equal(componentRuntime.version, "0.1.0");
  assert.equal(typeof componentRuntime.mount, "function");
});

test("unavailable platform project catalog degrades without invented projects", () => {
  const result = createProjectsPresentation();
  assert.equal(result.available, false);
  assert.deepEqual(result.items, []);
  assert.equal(result.linkedCount, 0);
  assert.equal(result.persistence, "session");
});

test("read-only cloud-links projection never invents or mutates platform projects", () => {
  const original = { persistence:"device", projects:[project] };
  const result = createProjectsPresentation({
    projects: original,
    cloudLinks: { persistence:"device", links:[{
      localProjectId: "project-1", cloudProjectId: cloudId,
      spaceId, linkedAt: 30,
    }, {
      localProjectId: "project-99", cloudProjectId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      spaceId, linkedAt: 40,
    }] },
  });
  assert.equal(result.available, true);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, "project-1");
  assert.equal(result.items[0].linked, true);
  assert.equal(result.items[0].cloudProjectId, cloudId);
  assert.equal(result.linkedCount, 1);
  assert.equal(original.projects.length, 1);
  assert.equal("link" in result, false);
});

test("Device Agent stays optional and cannot be represented by a full mutable port", async () => {
  assert.equal(await probeProjectsDeviceAgent(null), null);
  assert.throws(() => assertDeviceAgentCapabilityReaderPort({
    schema: "ordax.device-agent-capability-reader/1", execute() {},
  }), TypeError);
});

test("component-localized Projects labels are independent of OS translations", () => {
  assert.equal(translateProjectsMessage("pt-BR", "projects.title"), "Projetos");
  assert.equal(translateProjectsMessage("en-US", "projects.title"), "Projects");
  assert.equal(translateProjectsMessage("pt-PT", "projects.count.many", { count: 3 }), "3 projetos");
  assert.equal(translateProjectsMessage("en-US", "projects.count.many", { count: 4 }), "4 projects");
  assert.throws(() => translateProjectsMessage("en-US", "projects.unknown"), /Unknown Projects localization key/);
  assert.throws(() => translateProjectsMessage("en-US", "projects.activity"), /Missing Projects localization value/);
  const source = readFileSync(new URL("../src/ui/workspace-controls.mjs", import.meta.url), "utf8");
  const badge = readFileSync(new URL("../src/ui/device-agent-status.mjs", import.meta.url), "utf8");
  assert.match(source, /translateProjectsMessage\(localization\.getLocale\(\), messageId, params\)/);
  assert.match(badge, /translateProjectsMessage\(localization\.getLocale\(\)/);
  assert.doesNotMatch(source, /localization\.translate/);
  assert.doesNotMatch(badge, /localization\.translate/);
});

test("project UI consumes only the read-only published reader, not mutable catalog methods", () => {
  const source = readFileSync(new URL("../src/ui/workspace-controls.mjs", import.meta.url), "utf8");
  assert.match(source, /assertProjectCatalogReader\(projects\)/);
  assert.doesNotMatch(source, /assertProjectCatalogPort\(projects\)/);
  assert.match(source, /Projects app accepts a read-only project-catalog reader/);
});

test("external Projects receives a read-only platform projection and unsubscribes cleanly", () => {
  const snapshot = { persistence: "device", projects: [project] };
  const unsubscribed = [];
  const reader = {
    schema: "ordax.project-catalog/1",
    getSnapshot() { return snapshot; },
    subscribe(callback) {
      callback(snapshot);
      return () => unsubscribed.push("projects");
    },
  };
  const lifecycle = {
    schema: "ordax.surface-render-lifecycle/5",
    localization: {
      schema: "ordax.localization/2",
      getLocale: () => "pt-BR",
      getProfile: () => createLocaleProfile("pt-BR"),
      translate: (id) => id, // Host cannot supply package-owned translations
      subscribe(callback) {
        callback("pt-BR");
        return () => unsubscribed.push("locale");
      },
    },
    getAppTarget: () => null,
    setAppTarget: () => null,
    subscribeRender: () => () => unsubscribed.push("render"),
  };
  let handlers = 0;
  const root = {
    ownerDocument: {},
    querySelector: () => null,
    addEventListener() { handlers += 1; },
    removeEventListener() { handlers -= 1; },
  };

  // Privileged catalog must be narrowed by OS before injection into app.
  assert.throws(() => mountProjectsWorkspaceControls(root, {
    projects: { ...reader, remove() {} },
    surfaceLifecycle: lifecycle,
  }), /read-only project-catalog reader/);

  const mounted = mountProjectsWorkspaceControls(root, {
    projects: reader,
    surfaceLifecycle: lifecycle,
  });
  assert.equal(handlers, 1);
  mounted.destroy();
  mounted.destroy();
  assert.equal(handlers, 0);
  assert.deepEqual(unsubscribed.sort(), ["locale", "projects", "render"]);
});

test("all vendored project and host contracts match their published App SDK 1.17 git blobs", () => {
  // Immutable proof copied from the SDK bundle pinned in platform-sdk.lock.json;
  // this is validation metadata, not another contract implementation.
  const sdkBlobs = {
    "app-activation": "1de6af71e6f20b14f3d7892d4d4758d23a0d1e90",
    "component-runtime": "32dcacae6962b48e17b0abac0d64355aca1cecd5",
    "device-capabilities": "e6317d3826102f5283a840139b48d11d95564752",
    "file-space": "e775c22080e40dc3fb8ab8d2e2f00ccf312825d0",
    "locale-profile": "2edd61c44e76d87e7fd1873ff833d48009b9a95c",
    "localization": "df3fb7fc65f27d35cffc984c748b0e199b499bb4",
    "project-catalog": "a598f300ae53b30283e90ea0834e70799b56c609",
    "project-cloud-links-data": "1fa9a6a93c675db9771c9167dad59abe112c7193",
    "project-cloud-links-reader": "f62016f3e2b09cbad6b4ed0f1dceafc453f19948",
    "surface-render-lifecycle": "4808fd208be87926bc62fe192a841ad521e13783",
  };
  const names = Object.keys(sdkBlobs).sort();
  assert.equal(names.length, 10);
  for (const name of names) {
    const bytes = readFileSync(new URL("../src/sdk/contracts/" + name + ".mjs", import.meta.url));
    const hash = createHash("sha1")
      .update(Buffer.from("blob " + bytes.length + String.fromCharCode(0)))
      .update(bytes)
      .digest("hex");
    assert.equal(hash, sdkBlobs[name], name);
  }
});

test("migration preserves exact original version and stylesheet bytes from OS snapshot", () => {
  const manifest = JSON.parse(readFileSync(
    new URL("../../../migrations/projects.source-snapshot.json", import.meta.url), "utf8",
  ));
  assert.equal(manifest.repository, "ordaxsystems/ordax-os");
  assert.equal(manifest.file_count, 10);
  const pins = new Map(manifest.files.map(entry => [entry.path, entry]));
  for (const [oldPath, newPath] of [
    ["system/apps/projects/version.mjs", "../src/version.mjs"],
    ["system/apps/projects/projects.css", "../assets/projects.css"],
  ]) {
    const reference = pins.get(oldPath);
    assert.ok(reference, "Missing original OS snapshot: " + oldPath);
    const bytes = readFileSync(new URL(newPath, import.meta.url));
    const hash = createHash("sha1")
      .update(Buffer.from("blob " + bytes.length + String.fromCharCode(0)))
      .update(bytes)
      .digest("hex");
    assert.equal(bytes.length, reference.size, oldPath);
    assert.equal(hash, reference.blob_sha, oldPath);
  }
});
