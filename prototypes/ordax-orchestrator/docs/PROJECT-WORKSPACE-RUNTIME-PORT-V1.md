# Proposed Runtime Workspace Port v1 — contract handoff (M1)

**Status:** **proposal only**, Runtime/Platform have **not** implemented or accepted this port. Lab alpha.11 contains a fail-closed consumer seam, *not* a locally connected computer integration. Owner of this document: Apps. Runtime owns the host implementation; Platform owns Product grants/remote policy.

## Purpose

Allow OrdaX Orchestrator to attach a **preauthorized folder/repository resource** to one Lab Project and read a bounded workspace/Git summary. The App never resolves `C:\\...`, symlinks/junctions or runs shell commands. The existing Computer Control/plugin may offer broad full access but that is **not** evidence of project-scoped consent.

## Consumer interface, proposed and currently injectable only in tests

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

### Selector gate (not yet implemented)

Only the human-facing **trusted Runtime chooser**, with explicit resource selection and expiry, may issue a new resourceId/grant. The current App UI deliberately does not offer a path text field or an `Attach` button: such a control would be fake until this selector is connected. `workspace_bind` (an MCP/App service operation) can record only an **already validated** opaque resource reference, and rejects raw paths; the Runtime remains the sole authorizer. If it cannot resolve/prove the exact grant, binding fails and writes nothing.

### State / failure

- `workspace_status`: available=false and state=`capability_unavailable` when no port is wired. Lists only bindingId, deviceId and timestamp, never the resource path, content or credential.
- `workspace_bind`: await Runtime proof **outside** SQLite transaction; recheck App actor/project authorization; atomically reserve command receipt and save idempotent binding. An unavailable grant/port cannot create a binding. Replays of the same requestId return a prior receipt only under current authorization.
- `workspace_snapshot`: require both App project scope and fresh Runtime proof; Runtime returns an already authorized bounded summary. App drops any extraneous `path`, file contents or secrets and rejects bad hashes, timestamps and counters. Failure does not promote a stale snapshot to verified.
- No destructive operation, Git write, terminal command, network push, AI submission or watcher in M1.
- SQLite Lab persists `projectId, workspaceSessionId, actorId, clientId, deviceId, resourceId, createdAt` only. **No raw directory or Git checkout contents**.

### Open architecture questions for Runtime/Platform

1. Product grants: map `lab_project_id` to a canonical Platform/Space project scope without treating an arbitrary Lab ID as an authority; no project collisions or cross-user use.
2. Selector: trusted OS/Windows UI resource picker, deny symlink/junction outside root, ensure identity and consent after restart.
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

**Owners:** App's interface and tests are already staged in `product/src/project-workspace.mjs`. Runtime/Platform owners must provide the actual port via a separate reviewed contract/PR. No temporary filesystem adapter may be added to the Electron UI as a substitute.
