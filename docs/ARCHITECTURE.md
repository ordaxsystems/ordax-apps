# OrdaX Apps Architecture

## Boundary

This repository owns first-party application source that can evolve independently from the OrdaX platform.

It does **not** own boot, kernel, recovery, Surface/Shell, Identity, Memory, Intelligence, permissions, sync, Component Manager, Store service, update trust, or authority.

Those remain platform-owned by `ordaxsystems/prototipo-ordax-os`.

## Repository model

OrdaX uses a hybrid model:

- platform/core: `prototipo-ordax-os`;
- official removable/bootstrap/on-demand apps: `ordax-apps`;
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

## First extraction candidate

`notes` is the initial candidate because it is non-structural and comparatively bounded. Because OrdaX is still pre-launch and has no production Notes data, Notes uses the **remove-platform-first** cutover above. Package/lifecycle proof then happens from the canonical source in `ordax-apps`; until that proof is complete, Notes may simply be unavailable rather than duplicated.
