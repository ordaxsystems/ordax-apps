import assert from "node:assert/strict";
import test from "node:test";
import { componentRuntime } from "../src/runtime.mjs";
import { projectPersonalActivitySnapshot } from "../src/view-model.mjs";
import { validateComponentRuntime } from "../src/sdk/contracts/component-runtime.mjs";
import { assertPersonalApprovalConsent } from "../src/sdk/contracts/personal-approval-consent.mjs";
import { assertPersonalActivityExportPort } from "../src/sdk/contracts/personal-activity-export.mjs";

function snapshot(ownerKind = "device", ownerId = null) {
  return {
    schema: "ordax.personal-runtime/1",
    persistence: "session",
    ownerKind,
    ownerId,
    nextOrdinal: 1,
    workItems: [],
    activities: [],
    results: [],
    approvals: [],
    decisions: [],
    attempts: [],
  };
}

test("Activity packages a real component runtime with canonical identity and denied missing host", async () => {
  assert.equal(validateComponentRuntime(componentRuntime, {
    componentId: "activity",
    version: "0.1.0",
  }), componentRuntime);
  await assert.rejects(
    componentRuntime.mount(),
    /document head for component styles/,
  );
});

test("Activity projects only host-validated, owner-partitioned work", () => {
  const calls = [];
  const source = snapshot();
  source.nextOrdinal = 2;
  source.workItems = [{
    schema: "ordax.personal-work-item/1",
    id: "personal-work-1",
    ownerKind: "device",
    ownerId: null,
    goal: "Continuar integração do aplicativo",
    state: "queued",
    spaceId: null,
    projectId: null,
    pendingApprovalId: null,
    backgroundExecution: false,
    contextRefs: [],
    createdAt: "2026-10-13T00:00:00.000Z",
    updatedAt: "2026-10-13T00:00:00.000Z",
  }];
  const view = projectPersonalActivitySnapshot(source, (validated, context) => {
    calls.push(context);
    assert.equal(validated.ownerKind, "device");
    return { blocks: [], resultId: null };
  });
  assert.equal(view.ownerKind, "device");
  assert.equal(view.work.length, 1);
  assert.equal(view.work[0].item.id, "personal-work-1");
  assert.deepEqual(calls, [{
    ownerKind: "device",
    ownerId: null,
    spaceId: null,
    projectId: null,
    workItemId: "personal-work-1",
  }]);
  assert.equal(view.work[0].pendingApproval, null);
  assert.equal(view.work[0].latestAttempt, null);
  assert.ok(Object.isFrozen(view));
  assert.ok(Object.isFrozen(view.work));
});

test("Activity rejects invented cross-owner context and lacks silent canvas fallback", () => {
  assert.throws(() => projectPersonalActivitySnapshot(snapshot(), null), /canonical Intelligence projection/);
  const invalid = snapshot("account", "account-1");
  invalid.nextOrdinal = 2;
  invalid.workItems = [{
    id: "personal-work-1", ownerKind: "account", ownerId: "account-2",
    goal: "Invisible other account work", state: "queued",
    spaceId: null, projectId: null, pendingApprovalId: null,
    backgroundExecution: false, contextRefs: [],
    createdAt: "2026-10-13T00:00:00.000Z",
    updatedAt: "2026-10-13T00:00:00.000Z",
  }];
  assert.throws(() => projectPersonalActivitySnapshot(invalid, () => ({})), /owner partition/);
});

test("Activity approval and export actions require injected typed host ports", () => {
  assert.throws(() => assertPersonalApprovalConsent({
    schema: "ordax.personal-approval-consent/1",
    approve() {}, deny() {},
  }), /approval consent port/);
  assert.throws(() => assertPersonalActivityExportPort({
    schema: "ordax.personal-activity-export-port/1",
  }), /export port/);
});
