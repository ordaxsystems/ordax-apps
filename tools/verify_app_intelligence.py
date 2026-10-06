#!/usr/bin/env python3
"""Fail-closed validation for first-party app intelligence manifests."""

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
    raise SystemExit(f"ORDAX_APP_INTELLIGENCE=FAIL\n{message}")


def main() -> None:
    app_roots = sorted(
        path for path in APPS_ROOT.iterdir()
        if path.is_dir() and (path / "app.json").is_file()
    )
    if not app_roots:
        fail("no first-party apps were discovered")

    validated = []
    for app_root in app_roots:
        try:
            app = builder.validate_app_manifest(
                builder.load_json(
                    app_root / "app.json",
                    max_bytes=64 * 1024,
                    label=f"{app_root.name}/app.json",
                )
            )
            ai_path = app_root / "ai" / "manifest.json"
            if not ai_path.is_file() or ai_path.is_symlink():
                fail(f"{app['id']} must provide ai/manifest.json")
            manifest = builder.validate_app_intelligence_manifest(
                builder.load_json(
                    ai_path,
                    max_bytes=builder.MAX_AI_MANIFEST_BYTES,
                    label=f"{app['id']}/ai/manifest.json",
                ),
                app,
            )
        except (builder.AppPackageError, OSError, ValueError) as exc:
            fail(f"{app_root.name}: {exc}")
        if manifest["authority"] != "none" or manifest["execution"] != "declarative-only":
            fail(f"{app['id']} intelligence manifest crossed the authority boundary")
        validated.append(app["id"])

    print("ORDAX_APP_INTELLIGENCE=PASS")
    print(f"FIRST_PARTY_APP_COUNT={len(validated)}")
    print("FIRST_PARTY_APPS=" + ",".join(validated))
    print("AI_MANIFEST_SCHEMA=ordax.app-intelligence-manifest/1")
    print("AI_MANIFEST_AUTHORITY=none")
    print("AI_MANIFEST_EXECUTION=declarative-only")


if __name__ == "__main__":
    main()
