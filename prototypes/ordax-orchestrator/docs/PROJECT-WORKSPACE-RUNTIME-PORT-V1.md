# Runtime Workspace Port v1 — consumer contract and production gate (M1)

**Baseline técnico verificado em 24/10/2026; atualização de governança em 26/10/2026:** Runtime `main` at `7f7963f11e1892b692c6f00662a559717a6d7dfd` contains the read-only `ProjectWorkspacePort`, canonical local-project registry binding, in-memory resource-selection broker, native Windows folder picker, Owner scope resolver, two-phase issuance client and Device proof adapter. Runtime PR [#206](https://github.com/ordaxsystems/ordax-runtime/pull/206) is merged, but these pieces remain **source-level seams**: the picker, issuance client and proof callback are not composed into an authenticated Owner flow. Runtime PR [#205](https://github.com/ordaxsystems/ordax-runtime/pull/205) is closed because it depended on the incompatible single-phase Platform #274 contract.

Platform `main` at `3ae5d914df03f8f6a677ddd18cf3337cd0bcb89a` contains the Device workspace-proof route from merged PR #273 and two-party Owner approval/Device confirmation handlers from merged PR #277. Their gates remain off. The supporting authority SQL from merged PR [#276](https://github.com/ordaxsystems/ordax-platform/pull/276) remains a proposal under `proposals/`, not an applied migration. Platform PR [#274](https://github.com/ordaxsystems/ordax-platform/pull/274) was **closed without merge on 26/10/2026** because its single-phase registration ingress conflicts with the existing Owner approval + Device confirmation contract; its branch remains historical evidence only. Do not reintroduce it or create a second resource issuer. Apps Orchestrator alpha.19 contains the fail-closed consumer seam in `product/src/project-workspace.mjs`, but the Host composition has no live `workspacePort`; status remains `capability_unavailable`. The browser-grant integration in Studio does not authorize workspace reads. The v1 ABI below remains a consumer contract, **not proof of end-to-end integration**. Owner of this document: Apps. Runtime owns host implementation; Platform owns Product authorization.

**Host-only composition gap:** Apps `product/scripts/start-host.mjs` starts the Node Host with a source-local `.host-profile`; `host/host-application.mjs` composes `workspacePort` as absent and maps GPT operations to `provider_transport_unavailable_on_host`. Runtime `orchestrator_app_launcher.py` still verifies and starts the Electron executable plus `app.asar` and `runtime-build.json`. Runtime's inherited fd 3/4 client and the App's transport parser are protocol pieces, not a Runtime launcher for this Node Host. The browser page therefore has no live Runtime grant, workspace scanner or GPT transport.

## Purpose

Allow OrdaX Orchestrator to attach a **preauthorized folder/repository resource** to one Lab Project and read a bounded workspace/Git summary. The App never resolves `C:\\...`, symlinks/junctions or runs shell commands. The existing Computer Control/plugin may offer broad full access but that is **not** evidence of project-scoped consent.

## Consumer interface, injectable in tests but not wired in the packaged App

```ts
interface ProjectWorkspacePort {
  verifyBinding(input: {
    context: {
      actorId: string;
      clientId: string;
      workspaceSessionId: string;
      projectId: string;
    };
    deviceId: string;
    resourceId: string; // opaque non-bearer reference from trusted Runtime selector
  }): Promise<{
    authorized: true;
    projectId: string; deviceId: string; resourceId: string;
    actorId: string; clientId: string; workspaceSessionId: string;
  }>;

  snapshot(input: {
    context: { actorId: string; clientId: string; workspaceSessionId: string; projectId: string; };
    deviceId: string; resourceId: string;
  }): Promise<{
    authorized: true; deviceId: string; resourceId: string;
    state: 'connected'|'offline'|'denied'|'revoked'|'moved'|'unavailable';
    revision?: string; observedAt?: string;
    fileCount?: number; changedCount?: number;
    git?: { isRepository: boolean; branch?: string; head?: string; };
  }>;
}
```

**This is a consumer shape, not permission issuance.** In production Runtime must authenticate the caller, map actor/client/workspace session to the OrdaX user and device, verify the specific project resource grant, local filesystem policy, resource-bound path and symlink safety **inside Runtime**, and return only an already authorized result. It must revalidate the grant at the moment of snapshot, not reuse an old `verifyBinding` as proof. `resourceId` is a reference, not a secret/bearer token. Any attempt to forge it must fail.

### Owner-selection and authorization gate (partially implemented)

Runtime has a native Windows folder-picker adapter and an in-memory selection broker, plus a client for the two-phase Platform issuance contract. Platform `main` has the corresponding Owner approval, Device confirmation and Device workspace-proof handlers, but all required flags remain off and the authority SQL proposal is not applied. The source handlers and client therefore do not constitute a usable grant flow. Only a human-facing trusted Runtime flow with explicit resource selection, consent and expiry may create a `resourceId` binding. The App deliberately has no path text field or active `Attach` action: such a control would be fake until this flow is connected. `workspace_bind` can record only an **already validated** opaque resource reference and rejects raw paths; Runtime remains the sole filesystem and grant verifier. If it cannot prove the exact grant, binding fails and writes nothing.

### State / failure

- `workspace_status`: available=false and state=`capability_unavailable` when no port is wired. Lists only bindingId, deviceId and timestamp, never the resource path, content or credential.
- `workspace_bind`: await Runtime proof **outside** SQLite transaction; recheck App actor/project authorization; atomically reserve command receipt and save idempotent binding. An unavailable grant/port cannot create a binding. Replays of the same requestId return a prior receipt only under current authorization.
- `workspace_snapshot`: require both App project scope and fresh Runtime proof; Runtime returns an already authorized bounded summary. App drops any extraneous `path`, file contents or secrets and rejects bad hashes, timestamps and counters. Failure does not promote a stale snapshot to verified.
- No destructive operation, Git write, terminal command, network push, AI submission or watcher in M1.
- SQLite Lab persists `projectId, workspaceSessionId, actorId, clientId, deviceId, resourceId, createdAt` only. **No raw directory or Git checkout contents**.

### Open architecture questions for Runtime/Platform

1. Product grants: the two-party flow and canonical authority are present in source, but the governed SQL is not applied and the feature gates are not enabled. The owner-to-Lab-project mapping and resource issuance/revocation are not operational. Never treat an arbitrary Lab ID as authority; prevent project collisions and cross-user use.
2. Selector: the native Windows picker and selection broker exist in Runtime, but trusted Owner composition, authenticated consent binding and the live proof callback are not wired. Preserve the existing root/junction checks and revalidate identity after selection.
3. Device offline/revoked: typed responses vs transport failures, status receipt and no eventual privilege reuse.
4. Snapshot read ownership: source identity/attestation, Git detached HEAD and worktrees, untracked vs ignored, bounded filenames, content-sensitive access, filesystem events sequencing.
5. Lifecycle: grant expiry, unbind/revoke in canonical authority, already-bound records after Runtime uninstall/reinstall, machine/device switch.
6. Version `ordax.project-workspace/1`, compatibility test shared among Apps/Runtime/Platform; no project first-party special-case baked into general Computer Control.

## First test contract

- No port → blocked, no read or write.
- Valid opaque reference + scoped grant → one stored binding, read-only summary.
- New project/actor/client/device cannot reuse a grant from another scope.
- Full-access local policy alone is insufficient; require project grant.
- Revocation between request and proof or snapshot blocks and does not persist.
- Snapshot containing raw path, file contents or unexpected fields cannot leak them into App/UI.
- Idempotency after retry/restart, no duplicate binding, no phantom completion.
- Windows packaged App + **real** Runtime/Platform Product grant required before marking M1 fully implemented.

**Owners and current code:** Apps consumer/tests are in `product/src/project-workspace.mjs`; Runtime's core, canonical registry binding, resource-selection broker, Owner scope resolver, Device proof adapter, two-phase issuance client and native picker are in `ordax_dev_agent/project_workspace_port.py`, `project_workspace_registry_binding.py`, `workspace_resource_selection.py`, `owner_project_scope_resolver.py`, `project_workspace_device_live.py`, `tests/test_workspace_two_phase_issuance_client.py` and `windows_owner_workspace_picker.py`. Platform's corresponding route handlers exist in source but are default-off; the verifier/binding SQL remains a proposal, and PR #274 is superseded. **Still missing:** an applied and governed authority migration, operational Owner/Device issuance and revocation, authenticated Runtime-to-Platform proof composed into the Host, and a real Windows read-only E2E. No temporary filesystem adapter may be added to the UI as a substitute.
