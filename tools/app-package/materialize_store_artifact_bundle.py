#!/usr/bin/env python3
"""Materialize a deterministic content-addressed Store artifact bundle.

The input is an already assembled Store publication v2 plus the exact artifact
bytes it names. The output layout contains no URLs and grants no publication,
installation or activation authority. A future transport maps a separately
configured base origin to the fixed content-addressed relative path.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import sys
import tempfile

PUBLICATION_SCHEMA = "ordax-apps.store-catalog-publication/2"
CANDIDATE_SCHEMA = "ordax-apps.store-catalog-candidate/1"
LAYOUT_SCHEMA = "ordax-apps.store-artifact-layout/1"
SOURCE_REPOSITORY = "ordaxsystems/ordax-apps"
TRUST_DOMAIN = "runtime-components"
KEY_ID = "ordax-runtime-components-v1"
MAX_PUBLICATION_BYTES = 2 * 1024 * 1024
ROLE_MAX_BYTES = {
    "package": 32 * 1024 * 1024,
    "release": 256 * 1024,
    "compatibility": 64 * 1024,
    "componentEnvelope": 1 * 1024 * 1024,
}
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
APP_ID_RE = re.compile(r"^[a-z][a-z0-9-]{0,63}$")
NAME_RE = re.compile(r"^[A-Za-z0-9._-]{1,128}$")
SEMVER_RE = re.compile(r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$")


class StoreArtifactBundleError(RuntimeError):
    pass


def canonical_json(value: object) -> bytes:
    return (json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n").encode("utf-8")


def _regular_file(path: Path, label: str, max_bytes: int) -> os.stat_result:
    try:
        metadata = path.lstat()
    except OSError as exc:
        raise StoreArtifactBundleError(f"{label} is unavailable: {path}") from exc
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        raise StoreArtifactBundleError(f"{label} must be a regular non-symlink file")
    if metadata.st_size <= 0 or metadata.st_size > max_bytes:
        raise StoreArtifactBundleError(f"{label} size is outside allowed bounds")
    return metadata


def _real_directory(path: Path, label: str) -> Path:
    try:
        metadata = path.lstat()
    except OSError as exc:
        raise StoreArtifactBundleError(f"{label} is unavailable: {path}") from exc
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISDIR(metadata.st_mode):
        raise StoreArtifactBundleError(f"{label} must be a real directory")
    resolved = path.resolve(strict=True)
    if resolved != path.absolute():
        raise StoreArtifactBundleError(f"{label} may not traverse symlinks")
    return resolved


def _identity(value: object, role: str, app_id: str) -> dict:
    if not isinstance(value, dict) or set(value) != {"name", "sha256", "size"}:
        raise StoreArtifactBundleError(f"{app_id} {role} identity fields are not canonical")
    name = value.get("name")
    digest = value.get("sha256")
    size = value.get("size")
    if (
        not isinstance(name, str)
        or not NAME_RE.fullmatch(name)
        or not isinstance(digest, str)
        or not SHA256_RE.fullmatch(digest)
        or not isinstance(size, int)
        or isinstance(size, bool)
        or size <= 0
        or size > ROLE_MAX_BYTES[role]
    ):
        raise StoreArtifactBundleError(f"{app_id} {role} identity is invalid")
    if role == "componentEnvelope" and name != f"{app_id}.runtime-component-envelope.json":
        raise StoreArtifactBundleError(f"{app_id} component envelope name is not canonical")
    return {"name": name, "sha256": digest, "size": size}


def read_publication(path: Path) -> tuple[dict, bytes]:
    _regular_file(path, "Store publication v2", MAX_PUBLICATION_BYTES)
    try:
        payload = path.read_bytes()
        value = json.loads(payload.decode("utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise StoreArtifactBundleError("Store publication v2 must be valid UTF-8 JSON") from exc
    if not isinstance(value, dict) or payload != canonical_json(value):
        raise StoreArtifactBundleError("Store publication v2 must be canonical deterministic JSON")
    if set(value) != {
        "$schema", "status", "sequence", "source", "entries", "trust",
        "provenance", "authority", "safety",
    }:
        raise StoreArtifactBundleError("Store publication v2 fields are not canonical")
    if value.get("$schema") != PUBLICATION_SCHEMA or value.get("status") != "unsigned-publication-payload":
        raise StoreArtifactBundleError("unsupported Store publication v2")
    if (
        not isinstance(value.get("sequence"), int)
        or isinstance(value["sequence"], bool)
        or value["sequence"] <= 0
    ):
        raise StoreArtifactBundleError("Store publication v2 sequence is invalid")
    source = value.get("source")
    if (
        not isinstance(source, dict)
        or set(source) != {"repository", "commit"}
        or source.get("repository") != SOURCE_REPOSITORY
        or not isinstance(source.get("commit"), str)
        or not COMMIT_RE.fullmatch(source["commit"])
    ):
        raise StoreArtifactBundleError("Store publication v2 source identity is invalid")
    if value.get("trust") != {"domain": TRUST_DOMAIN, "requiredKeyId": KEY_ID}:
        raise StoreArtifactBundleError("Store publication v2 trust identity drifted")
    if value.get("authority") != {
        "signing": False,
        "publication": False,
        "installation": False,
        "activation": False,
        "rollback": False,
    }:
        raise StoreArtifactBundleError("Store publication v2 must remain authority-free")
    provenance = value.get("provenance")
    if (
        not isinstance(provenance, dict)
        or set(provenance) != {"candidateSchema", "candidateSha256"}
        or provenance.get("candidateSchema") != CANDIDATE_SCHEMA
        or not isinstance(provenance.get("candidateSha256"), str)
        or not SHA256_RE.fullmatch(provenance["candidateSha256"])
    ):
        raise StoreArtifactBundleError("Store publication v2 provenance is invalid")
    safety = value.get("safety")
    if safety != {
        "requiresExternalSignature": True,
        "canonicalPublicAnchorRequired": True,
        "componentEnvelopesRequired": True,
        "componentEnvelopesVerifiedBeforeCatalogAssembly": True,
        "componentEnvelopesReverifiedByPlatformLifecycle": True,
        "platformLifecycleRequired": True,
        "payloadGrantsAuthority": False,
    }:
        raise StoreArtifactBundleError("Store publication v2 safety boundary drifted")

    entries = value.get("entries")
    if not isinstance(entries, list) or not entries or len(entries) > 128:
        raise StoreArtifactBundleError("Store publication v2 entries must be bounded and non-empty")
    ids: list[str] = []
    normalized_entries: list[dict] = []
    for entry in entries:
        if not isinstance(entry, dict) or set(entry) != {
            "appId", "title", "version", "releaseMode", "sourceCommit", "artifacts", "trust"
        }:
            raise StoreArtifactBundleError("Store publication v2 entry fields are not canonical")
        app_id = entry.get("appId")
        title = entry.get("title")
        version = entry.get("version")
        if not isinstance(app_id, str) or not APP_ID_RE.fullmatch(app_id):
            raise StoreArtifactBundleError("Store publication v2 app id is invalid")
        if (
            not isinstance(title, str)
            or not title
            or title != title.strip()
            or len(title) > 160
            or any(ord(char) < 32 or ord(char) == 127 for char in title)
            or not isinstance(version, str)
            or not SEMVER_RE.fullmatch(version)
            or entry.get("releaseMode") != "component-slot"
            or entry.get("sourceCommit") != source["commit"]
        ):
            raise StoreArtifactBundleError(f"{app_id} release/source identity drifted")
        if entry.get("trust") != {"domain": TRUST_DOMAIN, "requiredKeyId": KEY_ID}:
            raise StoreArtifactBundleError(f"{app_id} trust identity drifted")
        artifacts = entry.get("artifacts")
        if not isinstance(artifacts, dict) or set(artifacts) != set(ROLE_MAX_BYTES):
            raise StoreArtifactBundleError(f"{app_id} artifact groups are not canonical")
        normalized = {
            role: _identity(artifacts[role], role, app_id)
            for role in ("package", "release", "compatibility", "componentEnvelope")
        }
        ids.append(app_id)
        normalized_entries.append({"appId": app_id, "artifacts": normalized})
    if ids != sorted(ids) or len(ids) != len(set(ids)):
        raise StoreArtifactBundleError("Store publication v2 app ids must be sorted and unique")
    return {**value, "_normalizedEntries": normalized_entries}, payload


def blob_relative_path(digest: str) -> Path:
    if not isinstance(digest, str) or not SHA256_RE.fullmatch(digest):
        raise StoreArtifactBundleError("artifact digest is invalid")
    return Path("sha256") / digest[:2] / digest


def _read_bound_artifact(path: Path, identity: dict, role: str, app_id: str) -> bytes:
    metadata = _regular_file(path, f"{app_id} {role}", ROLE_MAX_BYTES[role])
    if metadata.st_size != identity["size"]:
        raise StoreArtifactBundleError(f"{app_id} {role} size does not match publication")
    try:
        payload = path.read_bytes()
    except OSError as exc:
        raise StoreArtifactBundleError(f"{app_id} {role} could not be read") from exc
    if hashlib.sha256(payload).hexdigest() != identity["sha256"]:
        raise StoreArtifactBundleError(f"{app_id} {role} sha256 does not match publication")
    return payload


def _write_blob(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
    _real_directory(path.parent, "artifact bundle digest directory")
    if path.exists() or path.is_symlink():
        existing = _read_bound_artifact(
            path,
            {"name": path.name, "sha256": hashlib.sha256(payload).hexdigest(), "size": len(payload)},
            "package",
            "deduplicated",
        )
        if existing != payload:
            raise StoreArtifactBundleError("content-addressed artifact collision detected")
        return
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o444)
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        if os.name != "nt":
            directory_fd = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
    except OSError as exc:
        try:
            path.unlink()
        except OSError:
            pass
        raise StoreArtifactBundleError("content-addressed artifact persistence failed") from exc


def materialize_bundle(
    *,
    publication_path: Path,
    artifacts_root: Path,
    out_root: Path,
) -> dict:
    publication, publication_bytes = read_publication(publication_path)
    artifacts_root = _real_directory(artifacts_root, "Store artifact source root")
    if out_root.exists() or out_root.is_symlink():
        raise StoreArtifactBundleError("refusing to overwrite Store artifact bundle output")
    parent = _real_directory(out_root.parent, "Store artifact bundle parent")
    staging = Path(tempfile.mkdtemp(prefix=f".{out_root.name}.stage-", dir=parent))
    committed = False
    try:
        staging = _real_directory(staging, "Store artifact bundle staging root")
        seen: set[str] = set()
        total_bytes = 0
        normalized_entries = publication.pop("_normalizedEntries")
        for entry in normalized_entries:
            app_id = entry["appId"]
            app_root = _real_directory(artifacts_root / app_id, f"{app_id} artifact source")
            for role in ("package", "release", "compatibility", "componentEnvelope"):
                identity = entry["artifacts"][role]
                payload = _read_bound_artifact(app_root / identity["name"], identity, role, app_id)
                target = staging / blob_relative_path(identity["sha256"])
                _write_blob(target, payload)
                if identity["sha256"] not in seen:
                    seen.add(identity["sha256"])
                    total_bytes += len(payload)

        descriptor = {
            "$schema": LAYOUT_SCHEMA,
            "status": "materialized-candidate",
            "sourcePublication": {
                "schema": PUBLICATION_SCHEMA,
                "sha256": hashlib.sha256(publication_bytes).hexdigest(),
            },
            "addressing": {
                "algorithm": "sha256",
                "pathTemplate": "sha256/{prefix2}/{sha256}",
            },
            "blobCount": len(seen),
            "totalBytes": total_bytes,
            "authority": {
                "publication": False,
                "installation": False,
                "activation": False,
            },
        }
        descriptor_path = staging / "store-artifact-layout.json"
        descriptor_bytes = canonical_json(descriptor)
        try:
            descriptor_fd = os.open(
                descriptor_path,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL,
                0o444,
            )
            with os.fdopen(descriptor_fd, "wb") as handle:
                handle.write(descriptor_bytes)
                handle.flush()
                os.fsync(handle.fileno())
            os.rename(staging, out_root)
            if os.name != "nt":
                directory_fd = os.open(parent, os.O_RDONLY)
                try:
                    os.fsync(directory_fd)
                finally:
                    os.close(directory_fd)
        except OSError as exc:
            raise StoreArtifactBundleError(
                "Store artifact bundle commit failed"
            ) from exc
        committed = True
        return descriptor
    finally:
        if not committed:
            shutil.rmtree(staging, ignore_errors=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--publication", type=Path, required=True)
    parser.add_argument("--artifacts-root", type=Path, required=True)
    parser.add_argument("--out-root", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        descriptor = materialize_bundle(
            publication_path=args.publication,
            artifacts_root=args.artifacts_root,
            out_root=args.out_root,
        )
        print("ORDAX_STORE_ARTIFACT_BUNDLE=PASS")
        print(f"BLOB_COUNT={descriptor['blobCount']}")
        print(f"TOTAL_BYTES={descriptor['totalBytes']}")
        print("URLS_EMBEDDED=NO")
        print("PUBLICATION_AUTHORITY=NO")
        print("INSTALL_AUTHORITY=NO")
        return 0
    except StoreArtifactBundleError as exc:
        print(f"ORDAX_STORE_ARTIFACT_BUNDLE=FAIL\n{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
