#!/usr/bin/env python3
"""Fail-closed validation for first-party Application Action manifests."""

from __future__ import annotations

import argparse
import importlib.util
import subprocess
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


def check_provider_syntax(app_root: Path, provider_manifest: dict) -> int:
    """Check only modules declared in the validated canonical provider manifest."""
    checked = 0
    for provider in provider_manifest["providers"]:
        module = builder.safe_relative(
            provider["module"], "Application Action provider module"
        )
        path = app_root / Path(*module.parts)
        if path.is_symlink() or not path.is_file() or path.suffix != ".mjs":
            fail(f"provider module is not a regular .mjs file: {module}")
        try:
            subprocess.run(
                ["node", "--check", str(path)],
                check=True, capture_output=True, text=True, timeout=20,
            )
        except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
            fail(f"provider JavaScript syntax check failed: {module}: {exc}")
        checked += 1
    return checked


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check-provider-syntax", action="store_true",
        help="Run node --check on each module from the canonical provider manifest",
    )
    args = parser.parse_args(argv)
    app_roots = sorted(
        path for path in APPS_ROOT.iterdir()
        if path.is_dir() and (path / "app.json").is_file()
    )
    if not app_roots:
        fail("no first-party apps were discovered")

    validated: list[str] = []
    capability_count = 0
    syntax_checked = 0
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
            provider_path = app_root / "actions" / "providers" / "manifest.json"
            if not provider_path.is_file() or provider_path.is_symlink():
                fail(f"{app['id']} must provide actions/providers/manifest.json")
            providers = builder.validate_application_action_provider_manifest(
                builder.load_json(
                    provider_path,
                    max_bytes=builder.MAX_ACTION_PROVIDER_MANIFEST_BYTES,
                    label=f"{app['id']}/actions/providers/manifest.json",
                ),
                app,
                manifest,
                lambda module: builder.read_regular(
                    app_root / Path(*builder.PurePosixPath(module).parts),
                    max_bytes=builder.MAX_FILE_BYTES,
                    label=module,
                ),
            )
        except (builder.AppPackageError, OSError, ValueError) as exc:
            fail(f"{app_root.name}: {exc}")

        if args.check_provider_syntax:
            syntax_checked += check_provider_syntax(app_root, providers)

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
    print("APPLICATION_ACTION_PROVIDER_ARTIFACTS=verified-typed-inactive")
    if args.check_provider_syntax:
        print(f"APPLICATION_ACTION_PROVIDER_JS_SYNTAX_CHECKED={syntax_checked}")


if __name__ == "__main__":
    main()
