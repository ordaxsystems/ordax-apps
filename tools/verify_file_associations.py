#!/usr/bin/env python3
"""Validate app-owned file association manifests as the single source of truth."""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APPS = ROOT / "apps"
SCHEMA = "ordax.file-association-manifest/1"
APP_ID_RE = re.compile(r"^[a-z][a-z0-9-]{0,63}$")
EXT_RE = re.compile(r"^[a-z0-9][a-z0-9+_-]{0,31}$")
EXPECTED_FIELDS = {"schema", "appId", "appVersion", "authority", "role", "extensions"}

def fail(message: str) -> None:
    raise SystemExit(f"ORDAX_FILE_ASSOCIATIONS=FAIL\n{message}")

def main() -> None:
    owners: dict[str, str] = {}
    manifests = 0
    for app_root in sorted(path for path in APPS.iterdir() if path.is_dir()):
        path = app_root / "associations" / "manifest.json"
        if not path.exists():
            continue
        if path.is_symlink() or not path.is_file():
            fail(f"{app_root.name}: association manifest must be a regular file")
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
            app = json.loads((app_root / "app.json").read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            fail(f"{app_root.name}: cannot read association/app manifest: {exc}")
        if not isinstance(value, dict) or set(value) != EXPECTED_FIELDS:
            fail(f"{app_root.name}: association manifest fields are not canonical")
        if value["schema"] != SCHEMA or value["authority"] != "none" or value["role"] != "viewer":
            fail(f"{app_root.name}: association policy is invalid")
        if value["appId"] != app.get("id") or value["appVersion"] != app.get("version"):
            fail(f"{app_root.name}: association identity drifted from app.json")
        if not APP_ID_RE.fullmatch(str(value["appId"])):
            fail(f"{app_root.name}: invalid app id")
        extensions = value["extensions"]
        if not isinstance(extensions, list) or not extensions or len(extensions) > 128:
            fail(f"{app_root.name}: extensions must be a bounded non-empty list")
        if extensions != sorted(extensions) or len(set(extensions)) != len(extensions):
            fail(f"{app_root.name}: extensions must be unique and sorted")
        for ext in extensions:
            if not isinstance(ext, str) or not EXT_RE.fullmatch(ext) or ext.lower() != ext:
                fail(f"{app_root.name}: invalid extension {ext!r}")
            previous = owners.get(ext)
            if previous is not None:
                fail(f"extension .{ext} is claimed by both {previous} and {value['appId']}")
            owners[ext] = value["appId"]
        manifests += 1
    if manifests == 0:
        fail("no file association manifests were found")
    print("ORDAX_FILE_ASSOCIATIONS=PASS")
    print(f"FILE_ASSOCIATION_MANIFEST_COUNT={manifests}")
    print(f"FILE_ASSOCIATION_EXTENSION_COUNT={len(owners)}")

if __name__ == "__main__":
    main()
