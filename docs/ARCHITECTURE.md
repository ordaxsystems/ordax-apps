# OrdaX Apps Architecture

## Boundary

This repository owns first-party application source that can evolve independently from the OrdaX platform.

It does **not** own boot, kernel, recovery, Surface/Shell, Identity, Memory, Intelligence, permissions, sync, Component Manager, Store service, update trust, or authority.

Those remain platform-owned by `washingtonmsdj/prototipo-ordax-os`.

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

Extraction from the platform repo is therefore staged:

1. prove external package/build compatibility;
2. freeze the migration boundary;
3. move the app source;
4. change platform catalog/package references;
5. delete the old source from the platform repo;
6. prove no residual path can launch the removed copy.

Long-lived duplicated app source is forbidden.

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

`notes` is the initial candidate because it is non-structural and comparatively bounded. It must not be moved until package install, reinstall, offline execution, rollback and uninstall-with-data-preservation are proven.
