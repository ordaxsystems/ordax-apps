#!/usr/bin/env python3
"""Render a public-only unsigned component candidate handoff.

The handoff binds one deterministic ordax-apps package, release descriptor and
compatibility descriptor to an exact source commit. It intentionally carries no
signing, publication, installation or activation authority.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import sys

BUILDER_PATH = Path(__file__).with_name("build.py")
_spec = importlib.util.spec_from_file_location("ordax_app_package_builder", BUILDER_PATH)
builder = importlib.util.module_from_spec(_spec)
assert _spec.loader is not None
_spec.loader.exec_module(builder)

HANDOFF_SCHEMA = "ordax-apps.unsigned-component-candidate/1"
SOURCE_REPOSITORY = "ordaxsystems/ordax-apps"
TRUST_DOMAIN = "runtime-components"
KEY_ID = "ordax-runtime-components-v1"
MAX_DESCRIPTOR_BYTES = 512 * 1024


class HandoffError(RuntimeError):
    pass


def _read_regular(path: Path, label: str, max_bytes: int) -> bytes:
    try:
        metadata = path.lstat()
    except OSError as exc:
        raise HandoffError(f"{label} is unavailable: {path}") from exc
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        raise HandoffError(f"{label} must be a regular non-symlink file")
    if metadata.st_size <= 0 or metadata.st_size > max_bytes:
        raise HandoffError(f"{label} size is outside allowed bounds")
    return path.read_bytes()


def _sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _canonical_json(value: object) -> bytes:
    return (json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n").encode("utf-8")


def render_handoff(
    *,
    package: Path,
    release: Path,
    compatibility: Path,
    app_id: str,
    source_commit: str,
) -> tuple[dict, bytes]:
    try:
        manifest, package_bytes = builder.verify_package(package)
    except (builder.AppPackageError, OSError, ValueError) as exc:
        raise HandoffError(f"candidate package verification failed: {exc}") from exc

    release_bytes = _read_regular(release, "release descriptor", MAX_DESCRIPTOR_BYTES)
    compatibility_bytes = _read_regular(
        compatibility,
        "compatibility descriptor",
        MAX_DESCRIPTOR_BYTES,
    )
    try:
        release_value = json.loads(release_bytes.decode("utf-8"))
        compatibility_value = json.loads(compatibility_bytes.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise HandoffError("candidate descriptors must be valid UTF-8 JSON") from exc
    if not isinstance(release_value, dict) or not isinstance(compatibility_value, dict):
        raise HandoffError("candidate descriptors must contain JSON objects")
    if release_bytes != _canonical_json(release_value):
        raise HandoffError("release descriptor is not canonical deterministic JSON")
    if compatibility_bytes != _canonical_json(compatibility_value):
        raise HandoffError("compatibility descriptor is not canonical deterministic JSON")

    try:
        expected_release, expected_compatibility_bytes = builder.render_release_v2(
            package,
            compatibility,
        )
    except (builder.AppPackageError, OSError, ValueError) as exc:
        raise HandoffError(f"candidate release verification failed: {exc}") from exc

    if release_value != expected_release:
        raise HandoffError("release descriptor does not match deterministic package identity")
    if compatibility_bytes != expected_compatibility_bytes:
        raise HandoffError("compatibility descriptor does not match deterministic package identity")

    component = manifest.get("component") or {}
    if component.get("id") != app_id:
        raise HandoffError("candidate app id does not match requested app")
    if manifest.get("source_commit") != source_commit:
        raise HandoffError("candidate package source commit does not match requested source")
    if release_value.get("source_repository") != SOURCE_REPOSITORY:
        raise HandoffError("candidate source repository is not canonical ordax-apps")
    if release_value.get("source_commit") != source_commit:
        raise HandoffError("candidate release source commit does not match requested source")
    if release_value.get("component", {}).get("id") != app_id:
        raise HandoffError("candidate release app id does not match requested app")
    if release_value.get("component", {}).get("release_mode") != "component-slot":
        raise HandoffError("candidate release must use component-slot")
    if release_value.get("activation") != {
        "direct_activation_allowed": False,
        "pending_health_required": True,
    }:
        raise HandoffError("candidate activation boundary drifted")

    handoff = {
        "$schema": HANDOFF_SCHEMA,
        "status": "unsigned-candidate",
        "component": {
            "id": app_id,
            "version": component.get("version"),
            "releaseMode": component.get("releaseMode"),
        },
        "source": {
            "repository": SOURCE_REPOSITORY,
            "commit": source_commit,
        },
        "artifacts": {
            "package": {
                "name": package.name,
                "sha256": _sha256(package_bytes),
                "size": len(package_bytes),
            },
            "release": {
                "name": release.name,
                "sha256": _sha256(release_bytes),
                "size": len(release_bytes),
            },
            "compatibility": {
                "name": compatibility.name,
                "sha256": _sha256(compatibility_bytes),
                "size": len(compatibility_bytes),
            },
        },
        "trust": {
            "domain": TRUST_DOMAIN,
            "requiredKeyId": KEY_ID,
            "canonicalPublicAnchorRequiredBeforeProductionSigning": True,
        },
        "authority": {
            "signing": False,
            "publication": False,
            "installation": False,
            "activation": False,
        },
        "safety": {
            "containsPrivateKeyMaterial": False,
            "directActivationAllowed": False,
            "platformLifecycleRequired": True,
        },
    }
    return handoff, _canonical_json(handoff)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", type=Path, required=True)
    parser.add_argument("--release", type=Path, required=True)
    parser.add_argument("--compatibility", type=Path, required=True)
    parser.add_argument("--app-id", required=True)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)

    try:
        handoff, payload = render_handoff(
            package=args.package,
            release=args.release,
            compatibility=args.compatibility,
            app_id=args.app_id,
            source_commit=args.source_commit,
        )
        if args.out.exists() or args.out.is_symlink():
            raise HandoffError("refusing to overwrite unsigned handoff output")
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_bytes(payload)
        print("ORDAX_UNSIGNED_COMPONENT_HANDOFF=PASS")
        print(f"APP_ID={handoff['component']['id']}")
        print(f"APP_VERSION={handoff['component']['version']}")
        print(f"SOURCE_COMMIT={handoff['source']['commit']}")
        print("SIGNING_AUTHORITY=NO")
        print("PUBLICATION_AUTHORITY=NO")
        print("INSTALL_AUTHORITY=NO")
        print("ACTIVATION_AUTHORITY=NO")
        return 0
    except (HandoffError, OSError) as exc:
        print(f"ORDAX_UNSIGNED_COMPONENT_HANDOFF=FAIL\n{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
