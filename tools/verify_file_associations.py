#!/usr/bin/env python3
"""Validate first-party file association manifests as one collision-free registry."""

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
    raise SystemExit(f"ORDAX_FILE_ASSOCIATIONS=FAIL\n{message}")


def main() -> None:
    extension_owner: dict[str, str] = {}
    media_type_owner: dict[str, str] = {}
    associated_apps: list[str] = []

    for app_root in sorted(
        path for path in APPS_ROOT.iterdir()
        if path.is_dir() and (path / "app.json").is_file()
    ):
        association_path = app_root / "associations" / "manifest.json"
        if not association_path.exists():
            continue
        try:
            app = builder.validate_app_manifest(
                builder.load_json(
                    app_root / "app.json",
                    max_bytes=64 * 1024,
                    label=f"{app_root.name}/app.json",
                )
            )
            manifest = builder.validate_file_association_manifest(
                builder.load_json(
                    association_path,
                    max_bytes=builder.MAX_FILE_ASSOCIATION_MANIFEST_BYTES,
                    label=f"{app_root.name}/associations/manifest.json",
                ),
                app,
            )
        except (builder.AppPackageError, OSError, ValueError) as exc:
            fail(f"{app_root.name}: {exc}")

        for extension in manifest["extensions"]:
            previous = extension_owner.get(extension)
            if previous is not None:
                fail(
                    f"extension {extension} has multiple primary handlers: "
                    f"{previous}, {app['id']}"
                )
            extension_owner[extension] = app["id"]

        for media_type in manifest["mediaTypes"]:
            previous = media_type_owner.get(media_type)
            if previous is not None:
                fail(
                    f"media type {media_type} has multiple primary handlers: "
                    f"{previous}, {app['id']}"
                )
            media_type_owner[media_type] = app["id"]

        associated_apps.append(app["id"])

    if not associated_apps:
        fail("no first-party file association manifests were discovered")

    print("ORDAX_FILE_ASSOCIATIONS=PASS")
    print(f"ASSOCIATED_APP_COUNT={len(associated_apps)}")
    print("ASSOCIATED_APPS=" + ",".join(associated_apps))
    print(f"EXTENSION_COUNT={len(extension_owner)}")
    print(f"MEDIA_TYPE_COUNT={len(media_type_owner)}")
    print("PRIMARY_HANDLER_COLLISIONS=0")


if __name__ == "__main__":
    main()
