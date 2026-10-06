#!/usr/bin/env python3
"""Fail-closed validation for first-party Application Action manifests."""

from __future__ import annotations

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APPS_ROOT = ROOT / "apps"
BUILDER_PATH = ROOT / "tools" / "app-package" / "build.py"

spec = importlib.util.spec_from_file_location("ordax_app_package_builder", BUILDER_PATH)
builder = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(builder)


def fail(message: str) -> None:
    raise SystemExit(f"ORDAX_APP_ACTIONS=FAIL\n{message}")


def main() -> None:
    app_roots = sorted(
        path for path in APPS_ROOT.iterdir()
        if path.is_dir() and (path / "app.json").is_file()
    )
    if not app_roots:
        fail("no first-party apps were discovered")

    validated: list[str] = []
    capability_count = 0
    for app_root in app_roots:
        try:
            app = builder.validate_app_manifest(
                builder.load_json(
                    app_root / "app.json",
                    max_bytes=64 * 1024,
                    label=f"{app_root.name}/app.json",
                )
            )
            ai_manifest = builder.validate_app_intelligence_manifest(
                builder.load_json(
                    app_root / "ai" / "manifest.json",
                    max_bytes=builder.MAX_AI_MANIFEST_BYTES,
                    label=f"{app['id']}/ai/manifest.json",
                ),
                app,
            )
            action_path = app_root / "actions" / "manifest.json"
            if not action_path.is_file() or action_path.is_symlink():
                fail(f"{app['id']} must provide actions/manifest.json")
            manifest = builder.validate_application_action_manifest(
                builder.load_json(
                    action_path,
                    max_bytes=builder.MAX_ACTION_MANIFEST_BYTES,
                    label=f"{app['id']}/actions/manifest.json",
                ),
                app,
                ai_manifest,
            )
        except (builder.AppPackageError, OSError, ValueError) as exc:
            fail(f"{app_root.name}: {exc}")

        if manifest["authority"] != "none" or manifest["execution"] != "proposal-only":
            fail(f"{app['id']} Application Action manifest crossed authority boundary")
        capability_count += len(manifest["capabilities"])
        validated.append(app["id"])

    print("ORDAX_APP_ACTIONS=PASS")
    print(f"FIRST_PARTY_APP_COUNT={len(validated)}")
    print("FIRST_PARTY_APPS=" + ",".join(validated))
    print(f"APPLICATION_ACTION_CAPABILITY_COUNT={capability_count}")
    print("APPLICATION_ACTION_MANIFEST_SCHEMA=ordax.application-action-manifest/1")
    print("APPLICATION_ACTION_AUTHORITY=none")
    print("APPLICATION_ACTION_EXECUTION=proposal-only")


if __name__ == "__main__":
    main()
