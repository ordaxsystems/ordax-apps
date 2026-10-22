# Runtime Workspace Port v1 — consumer contract and production gate (M1)

**Status (22/10/2026; checked against the current `main` of all three repositories):** Runtime `main` contains the read-only `ProjectWorkspacePort`, canonical local-project registry binding, in-memory resource-selection broker and a native Windows folder-picker adapter. The picker and broker are **not composed into an authenticated Owner flow**, and no live Platform proof reaches the Orchestrator. Platform `main` contains the canonical Owner project-scope resolver, the `project-workspace-read` profile, and a source-only proposal for the subordinate resource binding/verifier; it has **no resource issuance/revocation route, no applied resource-binding migration, and no Runtime verification endpoint**. Apps Orchestrator alpha.12 contains the fail-closed consumer seam in `product/src/project-workspace.mjs`, but the packaged service is not given a live `workspacePort`, so status remains `capability_unavailable`. The browser-grant integration in Studio does not authorize workspace reads. The v1 ABI below remains a consumer contract, **not proof of end-to-end integration**. Owner of this document: Apps. Runtime owns host implementation; Platform owns Product authorization.

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

Runtime now has a native Windows folder-picker adapter and an in-memory selection broker. Neither is connected to the authenticated Owner host or a Product issuer/verifier. Only a human-facing trusted Runtime flow with explicit resource selection, consent and expiry may create a resourceId binding. The App deliberately has no path text field or active `Attach` action: such a control would be fake until this flow is connected. `workspace_bind` can record only an **already validated** opaque resource reference and rejects raw paths; Runtime remains the sole filesystem and grant verifier. If it cannot prove the exact grant, binding fails and writes nothing.

### State / failure

- `workspace_status`: available=false and state=`capability_unavailable` when no port is wired. Lists only bindingId, deviceId and timestamp, never the resource path, content or credential.
- `workspace_bind`: await Runtime proof **outside** SQLite transaction; recheck App actor/project authorization; atomically reserve command receipt and save idempotent binding. An unavailable grant/port cannot create a binding. Replays of the same requestId return a prior receipt only under current authorization.
- `workspace_snapshot`: require both App project scope and fresh Runtime proof; Runtime returns an already authorized bounded summary. App drops any extraneous `path`, file contents or secrets and rejects bad hashes, timestamps and counters. Failure does not promote a stale snapshot to verified.
- No destructive operation, Git write, terminal command, network push, AI submission or watcher in M1.
- SQLite Lab persists `projectId, workspaceSessionId, actorId, clientId, deviceId, resourceId, createdAt` only. **No raw directory or Git checkout contents**.

### Open architecture questions for Runtime/Platform

1. Product grants: the canonical Owner project-scope resolver exists, but the Lab-to-Product authority mapping and resource issuance/revocation are not exposed to Runtime. Never treat an arbitrary Lab ID as authority; prevent project collisions and cross-user use.
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

**Owners and existing code:** Apps consumer/tests are in `product/src/project-workspace.mjs`; Runtime's core, canonical registry binding, resource-selection broker and native picker are in `ordax_dev_agent/project_workspace_port.py`, `project_workspace_registry_binding.py`, `workspace_resource_selection.py` and `windows_owner_workspace_picker.py`. Platform's verifier proposal is under `control-plane/supabase/proposals/`, not applied. **Still missing:** authenticated Owner issuance/revocation, a live Runtime-to-Platform proof transport composed into the App, and a real Windows read-only E2E. No temporary filesystem adapter may be added to the Electron UI as a substitute.
