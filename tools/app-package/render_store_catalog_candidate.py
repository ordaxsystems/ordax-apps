#!/usr/bin/env python3
"""Render a deterministic, authority-free Store catalog candidate.

The catalog candidate aggregates already-verified ordax-apps unsigned component
handoffs from one exact source commit. It is publication input only: it carries
artifact identity and trust requirements, but no signing, publication,
installation, activation or rollback authority.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import stat
import sys

CATALOG_SCHEMA = "ordax-apps.store-catalog-candidate/1"
HANDOFF_SCHEMA = "ordax-apps.unsigned-component-candidate/1"
COMPONENT_MANIFEST_SCHEMA = "ordax.component-manifest/1"
SOURCE_REPOSITORY = "washingtonmsdj/ordax-apps"
TRUST_DOMAIN = "runtime-components"
KEY_ID = "ordax-runtime-components-v1"
MAX_HANDOFF_BYTES = 512 * 1024
MAX_MANIFEST_BYTES = 128 * 1024
MAX_ENTRIES = 128
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
APP_ID_RE = re.compile(r"^[a-z][a-z0-9-]{0,63}$")


class CatalogCandidateError(RuntimeError):
    pass


def _canonical_json(value: object) -> bytes:
    return (json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n").encode("utf-8")


def _read_json(
    path: Path,
    label: str,
    max_bytes: int,
    *,
    require_canonical: bool,
) -> dict:
    try:
        metadata = path.lstat()
    except OSError as exc:
        raise CatalogCandidateError(f"{label} is unavailable: {path}") from exc
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        raise CatalogCandidateError(f"{label} must be a regular non-symlink file")
    if metadata.st_size <= 0 or metadata.st_size > max_bytes:
        raise CatalogCandidateError(f"{label} size is outside allowed bounds")
    payload = path.read_bytes()
    try:
        value = json.loads(payload.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise CatalogCandidateError(f"{label} must be valid UTF-8 JSON") from exc
    if not isinstance(value, dict):
        raise CatalogCandidateError(f"{label} must contain a JSON object")
    if require_canonical and payload != _canonical_json(value):
        raise CatalogCandidateError(f"{label} is not canonical deterministic JSON")
    return value


def _validate_artifact(value: object, label: str) -> dict:
    if not isinstance(value, dict):
        raise CatalogCandidateError(f"{label} must be an object")
    if set(value) != {"name", "sha256", "size"}:
        raise CatalogCandidateError(f"{label} fields are not canonical")
    name = value.get("name")
    sha256 = value.get("sha256")
    size = value.get("size")
    if not isinstance(name, str) or not name or "/" in name or "\\" in name:
        raise CatalogCandidateError(f"{label} name is invalid")
    if not isinstance(sha256, str) or not re.fullmatch(r"[0-9a-f]{64}", sha256):
        raise CatalogCandidateError(f"{label} sha256 is invalid")
    if not isinstance(size, int) or isinstance(size, bool) or size <= 0:
        raise CatalogCandidateError(f"{label} size is invalid")
    return {"name": name, "sha256": sha256, "size": size}


def _validate_manifest(apps_root: Path, app_id: str, version: str) -> dict:
    path = apps_root / app_id / "app.json"
    manifest = _read_json(
        path,
        f"{app_id} app manifest",
        MAX_MANIFEST_BYTES,
        require_canonical=False,
    )
    if manifest.get("schema") != COMPONENT_MANIFEST_SCHEMA:
        raise CatalogCandidateError(f"{app_id} app manifest schema is unsupported")
    if manifest.get("id") != app_id:
        raise CatalogCandidateError(f"{app_id} app manifest id mismatch")
    if manifest.get("version") != version:
        raise CatalogCandidateError(f"{app_id} app manifest version mismatch")
    if manifest.get("releaseMode") != "component-slot":
        raise CatalogCandidateError(f"{app_id} must use component-slot delivery")
    if manifest.get("owner") != SOURCE_REPOSITORY:
        raise CatalogCandidateError(f"{app_id} owner is not canonical ordax-apps")
    title = manifest.get("title")
    if not isinstance(title, str) or not title.strip() or title != title.strip() or len(title) > 160:
        raise CatalogCandidateError(f"{app_id} title is invalid")
    return manifest


def _catalog_entry(handoff_path: Path, apps_root: Path, source_commit: str) -> dict:
    handoff = _read_json(
        handoff_path,
        f"unsigned component handoff {handoff_path.name}",
        MAX_HANDOFF_BYTES,
        require_canonical=True,
    )
    if handoff.get("$schema") != HANDOFF_SCHEMA or handoff.get("status") != "unsigned-candidate":
        raise CatalogCandidateError("unsupported unsigned component handoff")
    if set(handoff) != {
        "$schema", "status", "component", "source", "artifacts", "trust", "authority", "safety"
    }:
        raise CatalogCandidateError("unsigned component handoff fields are not canonical")

    component = handoff.get("component")
    if not isinstance(component, dict) or set(component) != {"id", "version", "releaseMode"}:
        raise CatalogCandidateError("unsigned component identity is not canonical")
    app_id = component.get("id")
    version = component.get("version")
    if not isinstance(app_id, str) or not APP_ID_RE.fullmatch(app_id):
        raise CatalogCandidateError("unsigned component app id is invalid")
    if not isinstance(version, str) or not version:
        raise CatalogCandidateError(f"{app_id} version is invalid")
    if component.get("releaseMode") != "component-slot":
        raise CatalogCandidateError(f"{app_id} handoff must use component-slot")

    source = handoff.get("source")
    if source != {"repository": SOURCE_REPOSITORY, "commit": source_commit}:
        raise CatalogCandidateError(f"{app_id} source identity does not match catalog source")

    authority = handoff.get("authority")
    if authority != {
        "signing": False,
        "publication": False,
        "installation": False,
        "activation": False,
    }:
        raise CatalogCandidateError(f"{app_id} handoff must remain authority-free")

    safety = handoff.get("safety")
    if safety != {
        "containsPrivateKeyMaterial": False,
        "directActivationAllowed": False,
        "platformLifecycleRequired": True,
    }:
        raise CatalogCandidateError(f"{app_id} handoff safety boundary drifted")

    trust = handoff.get("trust")
    if trust != {
        "domain": TRUST_DOMAIN,
        "requiredKeyId": KEY_ID,
        "canonicalPublicAnchorRequiredBeforeProductionSigning": True,
    }:
        raise CatalogCandidateError(f"{app_id} trust requirements drifted")

    artifacts = handoff.get("artifacts")
    if not isinstance(artifacts, dict) or set(artifacts) != {"package", "release", "compatibility"}:
        raise CatalogCandidateError(f"{app_id} artifact identity is not canonical")

    manifest = _validate_manifest(apps_root, app_id, version)
    return {
        "appId": app_id,
        "title": manifest["title"],
        "version": version,
        "releaseMode": "component-slot",
        "sourceCommit": source_commit,
        "artifacts": {
            "package": _validate_artifact(artifacts["package"], f"{app_id} package artifact"),
            "release": _validate_artifact(artifacts["release"], f"{app_id} release artifact"),
            "compatibility": _validate_artifact(
                artifacts["compatibility"],
                f"{app_id} compatibility artifact",
            ),
        },
        "trust": {
            "domain": TRUST_DOMAIN,
            "requiredKeyId": KEY_ID,
        },
    }


def render_catalog_candidate(
    *,
    handoffs: list[Path],
    apps_root: Path,
    source_commit: str,
) -> tuple[dict, bytes]:
    if not COMMIT_RE.fullmatch(source_commit):
        raise CatalogCandidateError("source commit must be lowercase 40-hex")
    if not handoffs or len(handoffs) > MAX_ENTRIES:
        raise CatalogCandidateError("catalog requires between 1 and 128 handoffs")

    entries = [_catalog_entry(path, apps_root, source_commit) for path in handoffs]
    entries.sort(key=lambda value: value["appId"])
    ids = [entry["appId"] for entry in entries]
    if len(ids) != len(set(ids)):
        raise CatalogCandidateError("catalog app ids must be unique")

    catalog = {
        "$schema": CATALOG_SCHEMA,
        "status": "unsigned-catalog-candidate",
        "source": {
            "repository": SOURCE_REPOSITORY,
            "commit": source_commit,
        },
        "entries": entries,
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
            "rollback": False,
        },
        "safety": {
            "catalogGrantsAuthority": False,
            "platformLifecycleRequired": True,
            "requestSelectsArtifact": False,
            "requestSelectsVersion": False,
        },
    }
    return catalog, _canonical_json(catalog)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--handoff", action="append", type=Path, required=True)
    parser.add_argument("--apps-root", type=Path, default=Path("apps"))
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)

    try:
        catalog, payload = render_catalog_candidate(
            handoffs=args.handoff,
            apps_root=args.apps_root,
            source_commit=args.source_commit,
        )
        if args.out.exists() or args.out.is_symlink():
            raise CatalogCandidateError("refusing to overwrite Store catalog candidate output")
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_bytes(payload)
        print("ORDAX_STORE_CATALOG_CANDIDATE=PASS")
        print(f"ENTRY_COUNT={len(catalog['entries'])}")
        print(f"SOURCE_COMMIT={catalog['source']['commit']}")
        print("SIGNING_AUTHORITY=NO")
        print("PUBLICATION_AUTHORITY=NO")
        print("INSTALL_AUTHORITY=NO")
        print("ACTIVATION_AUTHORITY=NO")
        return 0
    except (CatalogCandidateError, OSError) as exc:
        print(f"ORDAX_STORE_CATALOG_CANDIDATE=FAIL\n{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
