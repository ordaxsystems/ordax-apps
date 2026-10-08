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
import json
from pathlib import Path
import re
import stat
import sys

COMPONENT_SCHEMA = "ordax.component-manifest/1"
COMPATIBILITY_SCHEMA = "ordax.component-compatibility/1"
SOURCE_REPOSITORY = "ordaxsystems/ordax-apps"
APP_ID_RE = re.compile(r"^[a-z][a-z0-9-]{0,63}$")


class CatalogInventoryError(RuntimeError):
    pass


def _read_json(path: Path, label: str) -> dict:
    try:
        metadata = path.lstat()
    except OSError as exc:
        raise CatalogInventoryError(f"cannot read {label}: {path}") from exc
    if not stat.S_ISREG(metadata.st_mode):
        raise CatalogInventoryError(f"{label} must be a regular non-symlink file")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise CatalogInventoryError(f"cannot read {label}: {path}") from exc
    if not isinstance(value, dict):
        raise CatalogInventoryError(f"{label} must be a JSON object")
    return value


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
            manifest.get("schema") != COMPONENT_SCHEMA
            or not isinstance(app_id, str)
            or APP_ID_RE.fullmatch(app_id) is None
            or app_id != app_dir.name
        ):
            raise CatalogInventoryError(f"invalid app manifest identity: {manifest_path}")
        if app_id in seen:
            raise CatalogInventoryError(f"duplicate app id: {app_id}")
        seen.add(app_id)

        if manifest.get("releaseMode") != "component-slot":
            continue
        if manifest.get("owner") != SOURCE_REPOSITORY:
            raise CatalogInventoryError(f"{app_id} component-slot owner is not canonical")

        compatibility_path = _compatibility_path(apps_root, migrations_root, app_id)
        if compatibility_path is None:
            continue
        compatibility = _read_json(compatibility_path, f"{app_id} compatibility")
        if (
            compatibility.get("schema") != COMPATIBILITY_SCHEMA
            or compatibility.get("componentId") != app_id
            or compatibility.get("componentVersion") != manifest.get("version")
            or compatibility.get("authority") != "none"
        ):
            raise CatalogInventoryError(f"{app_id} compatibility identity is invalid")

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
