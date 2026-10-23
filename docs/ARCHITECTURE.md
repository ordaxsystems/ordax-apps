# OrdaX Apps Architecture

## Boundary

This repository owns first-party application source that can evolve independently from the OrdaX platform.

It does **not** own boot, kernel, recovery, Surface/Shell, Identity, Memory, Intelligence, permissions, sync, Component Manager, Store service, update trust, or authority.

Those capabilities are owned by `ordaxsystems/ordax-os`, except remote OAuth/grants/control-plane responsibilities in `ordaxsystems/ordax-platform` and device-host/computer execution in `ordaxsystems/ordax-runtime`. The authoritative cross-repository boundary is [`ordax-os/docs/contracts/repository-ownership.json`](https://github.com/ordaxsystems/ordax-os/blob/main/docs/contracts/repository-ownership.json).

## Repository model

OrdaX uses a hybrid model:

- operating system, boot, Surface/Shell, structural services and package lifecycle: `ordaxsystems/ordax-os`;
- official removable/bootstrap/on-demand app source: `ordaxsystems/ordax-apps`;
- device-host Runtime and computer execution: `ordaxsystems/ordax-runtime`;
- remote OAuth, grants, MCP and control plane: `ordaxsystems/ordax-platform`;
- third-party/user apps: their own repositories;
- structural Store/Settings/Account/System surfaces remain platform-owned.

A separate repository does not imply a separate security model. Packages from this repository must pass the same identity, provenance, compatibility, health and rollback rules required by the platform.

## Why a first-party apps monorepo

This repository keeps shared app tooling, CI conventions and contract conformance together while allowing each app to have an independent package/version/release lifecycle. An app may later move to its own repository only when its ownership, build, compatibility CI and release boundary are mature enough to justify it.

## Source-of-truth rule

An app must have exactly one authoritative source repository at a time.

Extraction from the platform repo is staged without a long-lived dual source.

For a released app with real user data, use a staged handoff that preserves service continuity and data. For a **pre-launch app with no production users/data**, OrdaX also permits a remove-first cutover:

1. freeze the migration boundary;
2. remove the app implementation from the platform runtime while keeping independent product/delivery metadata;
3. prove the platform boots and operates with the app absent;
4. move the last canonical app source into `ordax-apps`;
5. build and prove the deterministic external package from that single source;
6. prove verify → stage → health → promote → rollback/reinstall/uninstall;
7. publish availability through the signed catalog/Store path;
8. prove no residual platform implementation can launch.

Temporary app absence is acceptable only in this explicit pre-launch/no-data mode. Long-lived duplicated app source is forbidden.

## Structural Store

The OrdaX Store is part of the system distribution architecture and is not removable.

The Store UI is not the authority that installs software. It requests operations from the platform-owned installation owner. The Store cannot grant permissions, mint authority, bypass package verification or modify the trust root.

## App contract direction

Apps depend on published platform contracts. The platform must not import application implementation code in order to function.

Typical direction:

```text
OrdaX Platform contracts/services
           ↓
      app package
           ↓
 first-party or third-party UI
```

Never:

```text
app repository
   ↓ owns/copies
Identity / Memory / permissions / updater / trust
```

## Localization

Localization remains component-scoped. Each app owns its strings/packs while honoring the global OrdaX locale and fallback contract. A translation-only app change must not require rebuilding the Base image.

## Notes source cutover (completed, distribution still gated)

The Notes source is already canonical in `ordaxsystems/ordax-apps/apps/notes`, as recorded in [`migrations/notes.externalization.json`](../migrations/notes.externalization.json). The source transfer used the pre-launch **remove-platform-first** rule above. Package/lifecycle candidate proofs are separate from production activation: `distribution_activation_allowed=false` remains binding until the release/trust gates are closed. The platform must not restore a parallel Notes implementation to compensate for unavailable distribution.
