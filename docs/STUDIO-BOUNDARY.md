# ORDAX Studio boundary

## Status

This document defines the target product boundary for **ORDAX Studio** as a first-party OrdaX application with two official distribution targets: OrdaX OS and Windows.

The source-of-truth cutover to `apps/studio/` has **not** happened yet. Until the package/lifecycle gates are proven, the current Studio/Windows implementation remains in its existing authoritative repository. This document defines the destination contract only; it must not create a second long-lived source copy.

## Product identity

`ORDAX Studio` is the user-facing application name.

The Studio application is **provider-neutral**. ChatGPT, Grok, Claude, Gemini, Codex, local models and future AI clients are not Studio runtimes and must not become implementation branches inside the app.

Provider/product identity may be carried as authenticated session metadata for authorization, audit, revocation and UX, but the same typed ORDAX capability must execute through the same platform/runtime implementation regardless of which authorized client requested it.

Example conceptual envelope:

```text
actor
client.type = ai-provider
client.provider = openai | xai | anthropic | google | local | ...
client.product = chatgpt | grok | claude | gemini | ...
device
grant
action
payload
```

Provider metadata does not grant authority by itself.

## Canonical layering

```text
External AI clients / provider connectors
  ├─ ORDAX connector for ChatGPT
  ├─ ORDAX connector for Grok
  ├─ future provider connectors
  └─ local intelligence clients
                 │
                 ▼
        ORDAX Control Plane / protocol
                 │
                 ▼
      device/platform capability runtime
                 │
        ┌────────┴────────┐
        │                 │
     OrdaX OS          Windows host
        │                 │
 platform services    ORDAX Runtime
        └────────┬────────┘
                 │ public ports/contracts
                 ▼
            ORDAX Studio
```

## What Studio owns

Studio may own product/UI behavior such as:

- project/workspace UX;
- project files/editor surfaces through authorized platform ports;
- Git UX through a typed capability port;
- sessions, task views and checkpoints as application UX;
- preview/artifact presentation;
- device/tool/adapters presentation;
- Studio-owned application state;
- Studio localization, assets and tests.

Studio may define app-private contracts for its own state where those contracts do not become platform authority.

## What Studio must not own

Studio must not copy, fork or mint implementations/authority for:

- Identity;
- global Memory service;
- Intelligence provider/router implementation;
- permissions/grants;
- sync authority;
- package install/update/rollback authority;
- trust roots or signing keys;
- device pairing authority;
- provider credentials;
- unrestricted shell/computer authority.

Those remain platform/runtime responsibilities and are consumed through published contracts/ports.

## OrdaX OS deployment

On OrdaX OS, Studio is an application component and consumes platform-provided runtime ports. It must not bundle a second operating-system runtime merely to reproduce services already owned by the platform.

Target source layout after the future source-of-truth cutover:

```text
apps/studio/
  app.json
  src/
  assets/
  i18n/
  tests/
```

Any additional directory is app-owned implementation only. Platform services are dependencies by contract, not copied source.

## Windows deployment

Windows is an official, separately distributable ORDAX Studio target. It must not require OrdaX OS to be installed.

Because Windows does not natively provide the OrdaX platform services, the Windows product ships a local **ORDAX Runtime**/device host that implements the same capability boundary expected by Studio. The canonical launcher is `ORDAX Studio.exe`; the canonical installer family is `ORDAX-Studio-Setup-<version>-x64.exe`.

That Runtime is infrastructure, not a ChatGPT/Grok/Codex runtime. It must stay provider-neutral and enforce local policy, authenticated grants and audit independently of the Studio UI.

Conceptually:

```text
ORDAX Studio portable UI/core
        │
        ├─ OrdaX OS adapter -> platform runtime ports
        └─ Windows adapter  -> ORDAX Runtime
```

The goal is one Studio product with environment adapters, not separate Studio forks per operating system or AI provider.

## Dual-distribution invariant

OrdaX OS and Windows are two release targets of the **same portable Studio source**. After source cutover, both consume `apps/studio/`; target-specific code is restricted to host adapters, package metadata and lifecycle integration.

A release must not be promoted merely because each target works independently. Before cutover and for future compatibility gates, the release pipeline must prove:

- both targets consume the same portable Studio source/input;
- both expose compatible public port majors;
- typed action semantics are equivalent across OrdaX OS and Windows;
- provider-specific code does not select an alternate implementation;
- OrdaX OS does not bundle a duplicate ORDAX Runtime;
- Windows remains installable and usable without OrdaX OS;
- Windows host/runtime code does not leak into the portable app package.

The machine-readable SSOT for these rules is `migrations/studio.distribution.json` and CI must reject drift.

## Provider connectors

Provider-specific integrations are thin boundary components outside Studio core, for example:

- `ORDAX for ChatGPT`;
- `ORDAX for Grok`;
- future provider-specific connectors.

A connector is responsible for provider-facing protocol/auth/manifest concerns. It must not duplicate ORDAX capabilities, authorization or device execution logic.

Codex has no structural role. If supported, it is just another authorized client/connector and receives no implicit privilege.

## Security invariants

- client/provider identity is descriptive context, never authority by itself;
- remote grant and local/device policy are both required where applicable;
- Studio UI is not an authorization boundary;
- provider connectors cannot mint grants or bypass device policy;
- read/write/execute capabilities remain typed and auditable;
- provider-specific code cannot fork core capability semantics;
- removal of Studio does not imply deletion of user data owned by platform services;
- package/catalog presence cannot grant authority.

## Versioning

Studio, OrdaX OS, provider connectors and device runtimes evolve independently while remaining compatible through pinned public contract majors.

Example:

```text
OrdaX OS                  50
ORDAX Studio              12.4.0
ORDAX connector ChatGPT   3.x
ORDAX connector Grok      1.x
Windows ORDAX Runtime     1.x
```

`ORDAX Studio 12.4.0` identifies the portable app release. OrdaX OS packaging and Windows packaging may have target-specific build metadata, but they must not represent divergent application feature versions from the same release line.

A Studio release must not require rebuilding the Base image solely because Studio changed.

## Source-of-truth cutover rule

Do not copy the current Studio implementation into `apps/studio/` as a parallel source tree.

The eventual cutover must follow the repository migration invariant:

1. prove package/build compatibility against the pinned App SDK;
2. remove private platform/runtime implementation dependencies from Studio core;
3. prove OrdaX OS and Windows adapter parity against the same portable contract;
4. define deterministic packages and health contracts for both targets;
5. prove OrdaX OS install, verify, stage, health, promote and rollback;
6. prove Windows clean install, upgrade and uninstall with user-data preservation;
7. prove offline reinstall where applicable;
8. freeze the migration boundary;
9. move Studio portable source in one controlled cutover;
10. update platform catalog and Windows package references to that same source;
11. delete the former authoritative Studio source in the same migration cycle;
12. prove no residual path can launch a removed or divergent Studio copy.

Until these gates are green, this repository documents and validates the target boundary without claiming source ownership.
