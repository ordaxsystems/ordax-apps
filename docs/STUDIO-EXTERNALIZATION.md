# ORDAX Studio — generic app boundary and externalization plan

Status: architecture target; source cutover is not authorized yet.

## Decision

`studio` is a first-party OrdaX app. The product name is **ORDAX Studio**.

The Studio is provider-neutral. ChatGPT, Grok, Claude, Gemini, Codex or a local model are external clients/connectors of OrdaX capabilities; none of them owns the Studio runtime model or changes the implementation of a local action.

Provider identity may be recorded for authentication, audit, grant resolution, revocation and session attribution. It must not select a second implementation of files, processes, input, Git, projects, memory or device control.

## Product model

```text
ChatGPT connector ─┐
Grok connector ────┤
other clients ─────┤
local intelligence ┘
        │
        ▼
ORDAX Control Plane / public protocol
        │
        ▼
OrdaX device capability boundary
        │
        ├─ on OrdaX OS: platform-owned runtime/services
        └─ on Windows: ORDAX Runtime host adapter
        │
        ▼
ORDAX Studio
```

The arrows above describe capability flow, not ownership. Studio consumes public platform ports; it does not own Identity, Memory, Intelligence implementation, permissions, sync, updater, trust roots or install authority.

## Names and responsibilities

### ORDAX Studio

First-party application UI/product surface for projects, workspaces, files, Git, sessions, tools, device status and development adapters.

The app remains named `ORDAX Studio` regardless of which AI client is connected.

### OrdaX OS platform runtime

On OrdaX OS, device and platform capabilities are provided by platform-owned services and injected through public contracts/runtime ports. `apps/studio` must not bundle a second OrdaX Runtime to duplicate those services.

### ORDAX Runtime on foreign operating systems

Windows and other foreign operating systems may require a host runtime because they do not provide OrdaX platform services natively. That host is infrastructure/adapter for the foreign OS, not a ChatGPT-specific or Grok-specific runtime and not part of the OrdaX OS app package merely because Studio uses it on Windows.

### Provider connectors

Provider-specific integrations are thin clients/adapters around the same OrdaX protocol and grants. Naming may use forms such as `ORDAX for ChatGPT` or `ORDAX for Grok` where the host marketplace requires a distinct app name.

Provider connectors must not fork the local action implementation or mint broader authority than the user/device grant allows.

### Codex

Codex has no structural role in ORDAX Studio. Development tooling may invoke local MCP binaries during development, but that does not make Codex a product dependency. If supported as a product client in the future, it is another connector with the same authorization boundary.

## Security and authority invariants

1. Studio packages have `authority:none` and cannot mint grants, install authority, trust roots or provider credentials.
2. Every privileged action remains bounded by platform permissions/device policy and the corresponding remote/client grant.
3. Enabling one provider does not automatically authorize another provider.
4. Provider identity is metadata for authentication/audit/authorization, not a backend switch.
5. App uninstall and user-data deletion remain separate operations.
6. Studio failure remains inside the app failure domain and must not prevent OrdaX OS boot.
7. The Store remains structural and cannot delegate installation authority to Studio.

## OrdaX OS package target

The eventual source target is:

```text
apps/studio/
  app.json
  src/
  assets/
  i18n/
  tests/
```

Studio should consume the pinned App SDK and public runtime ports. Expected platform contract families include, subject to compatibility review at cutover:

- `ordax.app-activation/1`
- `ordax.component-manifest/1`
- `ordax.component-runtime/1`
- `ordax.intelligence/1`
- `ordax.memory/1`
- `ordax.localization/1`
- `ordax.surface-render-lifecycle/4`
- permission/device/project/file contracts published by the platform when the Studio boundary requires them

A missing required public contract is fixed in the platform first. Private platform service source must never be copied into this repository as a shortcut.

## Source-of-truth migration rule

The current Studio/Windows implementation remains in its existing authoritative repository until the package boundary is proven. Creating this document does not move or duplicate source.

Studio cutover follows the same single-source-of-truth rule used by other OrdaX apps:

1. inventory Studio code by responsibility;
2. separate portable Studio app code from foreign-OS Runtime/host code;
3. identify every private platform dependency;
4. publish/consume the required public contracts instead of copying private services;
5. define the external `app.json`/component manifest and deterministic package build;
6. prove install -> verify -> stage -> health -> promote -> rollback;
7. prove offline launch/reinstall and uninstall with user data preserved;
8. freeze the migration boundary;
9. move the app source in one cutover window;
10. update the platform catalog/package references;
11. delete the former app source from its old location in the same migration cycle;
12. prove no residual path can launch the removed copy.

Long-lived duplicated Studio source is forbidden.

## Initial code classification for the existing Windows product

The current Windows product should be classified before migration rather than copied wholesale:

- Studio UI, project/workspace UX and portable app logic: candidate for `apps/studio`;
- Windows service/process management, Windows filesystem/input integration and resident device host: foreign-OS Runtime/adapter;
- Cloudflare control plane and remote authorization infrastructure: service infrastructure, not app source;
- provider manifests/connectors: provider integration packages, not Studio core;
- Blender/Unity and future tool integrations: adapters behind generic Studio/runtime contracts;
- local development MCP executables: development/diagnostic tooling unless explicitly promoted to a supported connector boundary.

## Provider-neutral action envelope

The conceptual remote request model is provider-neutral:

```text
actor
client
provider metadata
session
subject/device
requested capability/action
grant
action payload
```

For example, `client.provider=openai` and `client.product=chatgpt` may differ from `client.provider=xai` and `client.product=grok`, while both resolve the same canonical `computer.text_read` action after authorization.

## Non-goals

Do not:

- create `ChatGPT Runtime`, `Grok Runtime` or `Codex Runtime` forks;
- embed provider-specific action implementations into Studio;
- move the current Studio source before lifecycle/conformance gates are proven;
- copy Identity, Memory, Intelligence, permissions, updater, sync or trust implementations into `ordax-apps`;
- use the Store UI or the Studio app as an authority boundary;
- make the OrdaX OS package depend on a Windows executable or on Codex.

## Relationship to the Notes pilot

Notes remains the first package-externalization pilot. Studio can advance its boundary inventory and conformance design in parallel, but its source cutover must not bypass the package lifecycle discipline proven by the pilot.

The goal is one ORDAX Studio product with platform adapters, not separate products per AI provider or operating system.
