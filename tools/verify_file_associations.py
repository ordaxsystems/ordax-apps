#!/usr/bin/env python3
"""Audit app-owned file associations with the package's canonical contract."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import stat

ROOT = Path(__file__).resolve().parents[1]
APPS = ROOT / "apps"
_spec = importlib.util.spec_from_file_location(
    "ordax_file_association_contract",
    ROOT / "tools" / "app-package" / "association_contract.py",
)
contract = importlib.util.module_from_spec(_spec)
assert _spec.loader is not None
_spec.loader.exec_module(contract)


def fail(message: str) -> None:
    raise SystemExit(f"ORDAX_FILE_ASSOCIATIONS=FAIL\n{message}")


def main() -> None:
    if APPS.is_symlink() or not APPS.is_dir():
        fail("apps root must be a real directory")
    owners: dict[str, str] = {}
    manifests = 0
    for app_root in sorted(APPS.iterdir()):
        if app_root.is_symlink():
            fail(f"{app_root.name}: app directory entry must not be a symlink")
        if not app_root.is_dir():
            continue
        assoc_dir = app_root / "associations"
        # A dangling manifest or symlink directory must never disappear from
        # discovery by an exists() check.
        if not (assoc_dir.exists() or assoc_dir.is_symlink()):
            continue
        if assoc_dir.is_symlink() or not assoc_dir.is_dir():
            fail(f"{app_root.name}: associations must be a real directory")
        path = assoc_dir / "manifest.json"
        app_path = app_root / "app.json"
        try:
            assoc_info, app_info = path.lstat(), app_path.lstat()
            if not stat.S_ISREG(assoc_info.st_mode) or not stat.S_ISREG(app_info.st_mode):
                fail(f"{app_root.name}: association/app manifest must be regular non-symlink files")
            if assoc_info.st_size <= 0 or assoc_info.st_size > contract.MAX_MANIFEST_BYTES:
                fail(f"{app_root.name}: association manifest exceeds bounds")
            if app_info.st_size <= 0 or app_info.st_size > 64 * 1024:
                fail(f"{app_root.name}: app manifest exceeds bounds")
            app = json.loads(app_path.read_text(encoding="utf-8"))
            if not isinstance(app, dict) or app.get("id") != app_root.name:
                fail(f"{app_root.name}: app manifest id mismatch")
            extensions = contract.validate_manifest_bytes(
                path.read_bytes(), app_id=app["id"], version=app.get("version"),
            )
        except (OSError, UnicodeError, json.JSONDecodeError,
                contract.AssociationContractError) as exc:
            fail(f"{app_root.name}: invalid association/app manifest: {exc}")
        for ext in extensions:
            previous = owners.get(ext)
            if previous is not None:
                fail(f"extension .{ext} is claimed by both {previous} and {app['id']}")
            owners[ext] = app["id"]
        manifests += 1
    if manifests == 0:
        fail("no file association manifests were found")
    print("ORDAX_FILE_ASSOCIATIONS=PASS")
    print(f"FILE_ASSOCIATION_MANIFEST_COUNT={manifests}")
    print(f"FILE_ASSOCIATION_EXTENSION_COUNT={len(owners)}")


if __name__ == "__main__":
    main()
