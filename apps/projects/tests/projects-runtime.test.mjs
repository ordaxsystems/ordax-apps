import assert from "node:assert/strict";
import test from "node:test";
import { componentRuntime } from "../src/runtime.mjs";
import { createProjectsPresentation } from "../src/ui/workspace-controls.mjs";
import { probeProjectsDeviceAgent } from "../src/device-agent-status.mjs";
import { assertDeviceAgentCapabilityReaderPort } from "../src/sdk/contracts/device-capabilities.mjs";

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
      localProjectId: "orphan", cloudProjectId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
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
