#!/usr/bin/env python3
"""Discover catalog-eligible first-party apps from canonical app artifacts.

An app is catalog-eligible when:
- apps/<id>/app.json exists and declares component-slot delivery;
- exactly one compatibility descriptor exists in either
  apps/<id>/compatibility.json or migrations/<id>.compatibility.json.

No manual app-id allowlist is maintained here. The app source and compatibility
artifacts are the source of truth. Apps without a compatibility descriptor are
not distribution-ready and are excluded.
"""

from __future__ import annotations

import argparse
import importlib.util
from pathlib import Path
import sys

# Canonical packaging validation is the single source of app manifest and
# compatibility semantics. Catalog discovery adds only ownership/eligibility.
_spec = importlib.util.spec_from_file_location(
    "ordax_catalog_inventory_builder", Path(__file__).with_name("build.py"),
)
builder = importlib.util.module_from_spec(_spec)
assert _spec.loader is not None
_spec.loader.exec_module(builder)


class CatalogInventoryError(RuntimeError):
    pass


def _read_json(path: Path, label: str, *, max_bytes: int = 64 * 1024) -> dict:
    try:
        return builder.load_json(path, max_bytes=max_bytes, label=label)
    except (builder.AppPackageError, OSError) as exc:
        raise CatalogInventoryError(f"invalid {label}: {exc}") from exc


def _compatibility_path(apps_root: Path, migrations_root: Path, app_id: str) -> Path | None:
    local = apps_root / app_id / "compatibility.json"
    migration = migrations_root / f"{app_id}.compatibility.json"
    # Never treat an existing directory or a dangling symlink as an absent
    # descriptor: it is invalid source state, not an ineligible app.
    present = [
        path for path in (local, migration)
        if path.exists() or path.is_symlink()
    ]
    if len(present) > 1:
        raise CatalogInventoryError(
            f"{app_id} compatibility is ambiguous: both local and migration descriptors exist"
        )
    return present[0] if present else None


def discover_catalog_apps(apps_root: Path, migrations_root: Path) -> list[dict]:
    if apps_root.is_symlink() or not apps_root.is_dir():
        raise CatalogInventoryError(f"apps root must be a real directory: {apps_root}")
    if migrations_root.is_symlink() or not migrations_root.is_dir():
        raise CatalogInventoryError(f"migrations root must be a real directory: {migrations_root}")

    entries: list[dict] = []
    seen: set[str] = set()
    for app_dir in sorted(apps_root.iterdir()):
        if app_dir.is_symlink():
            raise CatalogInventoryError(f"apps directory entry must not be a symlink: {app_dir}")
        if not app_dir.is_dir():
            continue
        manifest_path = app_dir / "app.json"
        if not manifest_path.exists() and not manifest_path.is_symlink():
            continue
        manifest = _read_json(manifest_path, f"{app_dir.name} app manifest")
        app_id = manifest.get("id")
        if (
            manifest.get("schema") != builder.COMPONENT_MANIFEST_SCHEMA
            or not isinstance(app_id, str)
            or builder.APP_ID_RE.fullmatch(app_id) is None
            or app_id != app_dir.name
        ):
            raise CatalogInventoryError(f"invalid app manifest identity: {manifest_path}")
        if app_id in seen:
            raise CatalogInventoryError(f"duplicate app id: {app_id}")
        seen.add(app_id)

        if manifest.get("releaseMode") != "component-slot":
            continue
        migration_path = migrations_root / f"{app_id}.externalization.json"
        if migration_path.is_file() and not migration_path.is_symlink():
            migration = _read_json(migration_path, f"{app_id} externalization")
            if migration.get("source_repository_current") != "ordaxsystems/ordax-apps":
                stage = migration.get("prelaunch_package_staging", {})
                if (app_id == "files"
                    and stage.get("mode") == "unsigned-package-candidate"
                    and stage.get("activation_allowed") is False
                    and migration.get("distribution_activation_allowed") is False):
                    continue
                raise CatalogInventoryError(f"{app_id}: platform-owned source is not a Store candidate")
        try:
            manifest = builder.validate_app_manifest(manifest)
        except builder.AppPackageError as exc:
            raise CatalogInventoryError(f"{app_id} app manifest is invalid: {exc}") from exc

        compatibility_path = _compatibility_path(apps_root, migrations_root, app_id)
        if compatibility_path is None:
            continue
        compatibility = _read_json(
            compatibility_path, f"{app_id} compatibility",
            max_bytes=builder.MAX_COMPATIBILITY_BYTES,
        )
        try:
            builder.validate_compatibility(compatibility, manifest)
        except builder.AppPackageError as exc:
            raise CatalogInventoryError(f"{app_id} compatibility is invalid: {exc}") from exc

        entries.append({
            "appId": app_id,
            "appRoot": (apps_root / app_id).as_posix(),
            "compatibility": compatibility_path.as_posix(),
        })

    if not entries:
        raise CatalogInventoryError("no catalog-eligible first-party apps were discovered")
    return entries


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apps-root", type=Path, default=Path("apps"))
    parser.add_argument("--migrations-root", type=Path, default=Path("migrations"))
    parser.add_argument("--format", choices=("json", "tsv"), default="json")
    args = parser.parse_args(argv)
    try:
        entries = discover_catalog_apps(args.apps_root, args.migrations_root)
        if args.format == "tsv":
            for entry in entries:
                print(f"{entry['appId']}\t{entry['appRoot']}\t{entry['compatibility']}")
        else:
            print(json.dumps(entries, indent=2, sort_keys=True))
        return 0
    except CatalogInventoryError as exc:
        print(f"ORDAX_STORE_CATALOG_INVENTORY=FAIL\n{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
