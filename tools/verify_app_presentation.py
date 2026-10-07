#!/usr/bin/env python3
"""Validate app-owned presentation manifests for external first-party apps."""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APPS = ROOT / "apps"
SCHEMA = "ordax.app-presentation-manifest/1"
APP_ID_RE = re.compile(r"^[a-z][a-z0-9-]{0,63}$")
MONOGRAM_RE = re.compile(r"^[A-Z0-9]{1,8}$")
EXPECTED_FIELDS = {
    "schema", "appId", "appVersion", "authority",
    "description", "monogram", "singleton", "localization",
}
LOCALIZATION_FIELDS = {"sourceLocale", "bundledLocales", "packPolicy"}

def fail(message: str) -> None:
    raise SystemExit(f"ORDAX_APP_PRESENTATION=FAIL\n{message}")

def main() -> None:
    count = 0
    for app_root in sorted(path for path in APPS.iterdir() if path.is_dir()):
        path = app_root / "presentation" / "manifest.json"
        if not path.exists():
            continue
        if path.is_symlink() or not path.is_file():
            fail(f"{app_root.name}: presentation manifest must be a regular file")
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
            app = json.loads((app_root / "app.json").read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            fail(f"{app_root.name}: cannot read presentation/app manifest: {exc}")
        if not isinstance(value, dict) or set(value) != EXPECTED_FIELDS:
            fail(f"{app_root.name}: presentation fields are not canonical")
        if value["schema"] != SCHEMA or value["authority"] != "none":
            fail(f"{app_root.name}: presentation policy is invalid")
        if value["appId"] != app.get("id") or value["appVersion"] != app.get("version"):
            fail(f"{app_root.name}: presentation identity drifted from app.json")
        if not APP_ID_RE.fullmatch(str(value["appId"])):
            fail(f"{app_root.name}: invalid app id")
        description = value["description"]
        if not isinstance(description, str) or not description.strip() or len(description) > 320:
            fail(f"{app_root.name}: invalid description")
        if not isinstance(value["monogram"], str) or not MONOGRAM_RE.fullmatch(value["monogram"]):
            fail(f"{app_root.name}: invalid monogram")
        if value["singleton"] is not True:
            fail(f"{app_root.name}: MVP utility apps must currently be singleton")
        localization = value["localization"]
        if not isinstance(localization, dict) or set(localization) != LOCALIZATION_FIELDS:
            fail(f"{app_root.name}: invalid localization descriptor")
        if localization["sourceLocale"] != "pt-BR":
            fail(f"{app_root.name}: source locale must be pt-BR")
        locales = localization["bundledLocales"]
        if not isinstance(locales, list) or locales != sorted(locales) or len(set(locales)) != len(locales):
            fail(f"{app_root.name}: bundled locales must be sorted and unique")
        if "pt-BR" not in locales or localization["packPolicy"] != "component-scoped":
            fail(f"{app_root.name}: localization policy is invalid")
        count += 1
    if count == 0:
        fail("no app presentation manifests were found")
    print("ORDAX_APP_PRESENTATION=PASS")
    print(f"APP_PRESENTATION_MANIFEST_COUNT={count}")

if __name__ == "__main__":
    main()
