#!/usr/bin/env python3
"""Assemble a stageable Store catalog publication payload from signed components.

Version 1 remains the unsigned pre-publication protocol. This version adds the
identity of each signed runtime-component envelope and refuses to assemble an
entry until the canonical platform verifier has authenticated that envelope
against the supplied runtime-components public trust.

The tool never reads a private key, signs data, publishes artifacts, stages
components, activates apps or grants lifecycle authority.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
from typing import Callable

_TOOL_DIR = Path(__file__).resolve().parent
_V1_PATH = _TOOL_DIR / "render_store_catalog_publication.py"
_spec = importlib.util.spec_from_file_location("store_catalog_publication_v1", _V1_PATH)
_v1 = importlib.util.module_from_spec(_spec)
assert _spec.loader is not None
_spec.loader.exec_module(_v1)

CANDIDATE_SCHEMA = _v1.CANDIDATE_SCHEMA
PUBLICATION_SCHEMA = "ordax-apps.store-catalog-publication/2"
SOURCE_REPOSITORY = _v1.SOURCE_REPOSITORY
TRUST_DOMAIN = _v1.TRUST_DOMAIN
KEY_ID = _v1.KEY_ID
MAX_CATALOG_BYTES = _v1.MAX_CATALOG_BYTES
MAX_ARTIFACT_BYTES = 64 * 1024 * 1024
MAX_ENVELOPE_BYTES = 2 * 1024 * 1024
MAX_TRUST_BYTES = 16 * 1024
MAX_VERIFIER_STDOUT = 32 * 1024
APP_ID_RE = re.compile(r"^[a-z][a-z0-9-]{0,63}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
ARTIFACT_NAME_RE = re.compile(r"^[A-Za-z0-9._-]{1,128}$")
SEMVER_RE = re.compile(r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$")
EXPECTED_ENTRY_FIELDS = {
    "appId", "title", "version", "releaseMode", "sourceCommit", "artifacts", "trust"
}
EXPECTED_ARTIFACT_GROUP_FIELDS = {"package", "release", "compatibility"}
EXPECTED_ARTIFACT_FIELDS = {"name", "sha256", "size"}
VERIFY_MARKER = "RUNTIME_COMPONENT_RELEASE_V2_VERIFIED"


class CatalogPublicationV2Error(RuntimeError):
    pass


def canonical_json(value: object) -> bytes:
    return _v1.canonical_json(value)


def _regular_file(path: Path, label: str, max_bytes: int, *, executable: bool = False) -> os.stat_result:
    try:
        metadata = path.lstat()
    except OSError as exc:
        raise CatalogPublicationV2Error(f"{label} is unavailable: {path}") from exc
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        raise CatalogPublicationV2Error(f"{label} must be a regular non-symlink file")
    if metadata.st_size <= 0 or metadata.st_size > max_bytes:
        raise CatalogPublicationV2Error(f"{label} size is outside allowed bounds")
    if executable and os.name != "nt" and metadata.st_mode & 0o111 == 0:
        raise CatalogPublicationV2Error(f"{label} must be executable")
    return metadata


def _artifact(value: object, label: str) -> dict:
    if not isinstance(value, dict) or set(value) != EXPECTED_ARTIFACT_FIELDS:
        raise CatalogPublicationV2Error(f"{label} fields are not canonical")
    name = value.get("name")
    digest = value.get("sha256")
    size = value.get("size")
    if not isinstance(name, str) or not ARTIFACT_NAME_RE.fullmatch(name):
        raise CatalogPublicationV2Error(f"{label} name is invalid")
    if not isinstance(digest, str) or not SHA256_RE.fullmatch(digest):
        raise CatalogPublicationV2Error(f"{label} sha256 is invalid")
    if not isinstance(size, int) or isinstance(size, bool) or size <= 0 or size > MAX_ARTIFACT_BYTES:
        raise CatalogPublicationV2Error(f"{label} size is invalid")
    return {"name": name, "sha256": digest, "size": size}


def _validate_candidate_entry(entry: object, source_commit: str) -> dict:
    if not isinstance(entry, dict) or set(entry) != EXPECTED_ENTRY_FIELDS:
        raise CatalogPublicationV2Error("catalog candidate entry fields are not canonical")
    app_id = entry.get("appId")
    title = entry.get("title")
    version = entry.get("version")
    if not isinstance(app_id, str) or not APP_ID_RE.fullmatch(app_id):
        raise CatalogPublicationV2Error("catalog candidate app id is invalid")
    if (
        not isinstance(title, str)
        or not title
        or title != title.strip()
        or len(title) > 160
        or any(ord(char) < 32 or ord(char) == 127 for char in title)
    ):
        raise CatalogPublicationV2Error(f"{app_id} title is invalid")
    if not isinstance(version, str) or not SEMVER_RE.fullmatch(version):
        raise CatalogPublicationV2Error(f"{app_id} version is invalid")
    if entry.get("releaseMode") != "component-slot":
        raise CatalogPublicationV2Error(f"{app_id} must use component-slot")
    if entry.get("sourceCommit") != source_commit:
        raise CatalogPublicationV2Error(f"{app_id} source commit mismatch")
    if entry.get("trust") != {"domain": TRUST_DOMAIN, "requiredKeyId": KEY_ID}:
        raise CatalogPublicationV2Error(f"{app_id} trust identity drifted")
    artifacts = entry.get("artifacts")
    if not isinstance(artifacts, dict) or set(artifacts) != EXPECTED_ARTIFACT_GROUP_FIELDS:
        raise CatalogPublicationV2Error(f"{app_id} artifact groups are not canonical")
    return {
        "appId": app_id,
        "title": title,
        "version": version,
        "releaseMode": "component-slot",
        "sourceCommit": source_commit,
        "artifacts": {
            "package": _artifact(artifacts["package"], f"{app_id} package"),
            "release": _artifact(artifacts["release"], f"{app_id} release"),
            "compatibility": _artifact(artifacts["compatibility"], f"{app_id} compatibility"),
        },
        "trust": {"domain": TRUST_DOMAIN, "requiredKeyId": KEY_ID},
    }


def read_candidate(path: Path) -> tuple[dict, bytes]:
    try:
        candidate, payload = _v1.read_candidate(path)
    except _v1.CatalogPublicationError as exc:
        raise CatalogPublicationV2Error(str(exc)) from exc
    source = candidate.get("source")
    if (
        not isinstance(source, dict)
        or source.get("repository") != SOURCE_REPOSITORY
        or not isinstance(source.get("commit"), str)
        or not COMMIT_RE.fullmatch(source["commit"])
    ):
        raise CatalogPublicationV2Error("catalog candidate source identity is invalid")
    entries = [_validate_candidate_entry(entry, source["commit"]) for entry in candidate["entries"]]
    ids = [entry["appId"] for entry in entries]
    if ids != sorted(ids) or len(ids) != len(set(ids)):
        raise CatalogPublicationV2Error("catalog candidate app ids must be sorted and unique")
    normalized = dict(candidate)
    normalized["entries"] = entries
    return normalized, payload


def _verify_bound_artifact(root: Path, record: dict, label: str) -> Path:
    path = root / record["name"]
    metadata = _regular_file(path, label, MAX_ARTIFACT_BYTES)
    if metadata.st_size != record["size"]:
        raise CatalogPublicationV2Error(f"{label} size does not match candidate")
    try:
        payload = path.read_bytes()
    except OSError as exc:
        raise CatalogPublicationV2Error(f"{label} could not be read") from exc
    digest = hashlib.sha256(payload).hexdigest()
    if digest != record["sha256"]:
        raise CatalogPublicationV2Error(f"{label} sha256 does not match candidate")
    return path


def _parse_verifier_stdout(stdout: str) -> dict[str, str]:
    if not isinstance(stdout, str) or len(stdout.encode("utf-8", errors="strict")) > MAX_VERIFIER_STDOUT:
        raise CatalogPublicationV2Error("platform verifier output is invalid")
    values: dict[str, str] = {}
    for raw_line in stdout.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if "=" not in line:
            raise CatalogPublicationV2Error("platform verifier output is not canonical key=value")
        key, value = line.split("=", 1)
        if not key or key in values:
            raise CatalogPublicationV2Error("platform verifier output contains duplicate or empty keys")
        values[key] = value
    required = {
        VERIFY_MARKER,
        "COMPONENT_ID",
        "COMPONENT_VERSION",
        "SOURCE_COMMIT",
        "PENDING_HEALTH_REQUIRED",
        "DIRECT_ACTIVATION_ALLOWED",
    }
    if set(values) != required:
        raise CatalogPublicationV2Error("platform verifier output fields are not canonical")
    if values[VERIFY_MARKER] != "YES":
        raise CatalogPublicationV2Error("platform verifier did not authenticate the component envelope")
    if values["PENDING_HEALTH_REQUIRED"] != "YES" or values["DIRECT_ACTIVATION_ALLOWED"] != "NO":
        raise CatalogPublicationV2Error("platform verifier reported unsafe activation semantics")
    return values


def _verify_component_envelope(
    *,
    verifier: Path,
    trust: Path,
    envelope: Path,
    compatibility: Path,
    expected_app_id: str,
    expected_version: str,
    expected_source_commit: str,
    runner: Callable[..., subprocess.CompletedProcess],
) -> None:
    try:
        completed = runner(
            [
                str(verifier),
                "verify-envelope-v2",
                "--envelope",
                str(envelope),
                "--trust",
                str(trust),
                "--compatibility",
                str(compatibility),
            ],
            check=False,
            capture_output=True,
            text=True,
            timeout=15,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise CatalogPublicationV2Error("platform verifier is unavailable") from exc
    if completed.returncode != 0:
        raise CatalogPublicationV2Error("component envelope failed canonical platform verification")
    values = _parse_verifier_stdout(completed.stdout)
    if values["COMPONENT_ID"] != expected_app_id:
        raise CatalogPublicationV2Error("verified component envelope app id mismatch")
    if values["COMPONENT_VERSION"] != expected_version:
        raise CatalogPublicationV2Error("verified component envelope version mismatch")
    if values["SOURCE_COMMIT"] != expected_source_commit:
        raise CatalogPublicationV2Error("verified component envelope source commit mismatch")


def _envelope_artifact(path: Path, app_id: str) -> dict:
    metadata = _regular_file(path, f"{app_id} component envelope", MAX_ENVELOPE_BYTES)
    try:
        payload = path.read_bytes()
    except OSError as exc:
        raise CatalogPublicationV2Error(f"{app_id} component envelope could not be read") from exc
    return {
        "name": path.name,
        "sha256": hashlib.sha256(payload).hexdigest(),
        "size": metadata.st_size,
    }


def render_publication_v2(
    *,
    candidate: dict,
    candidate_bytes: bytes,
    artifacts_root: Path,
    verifier: Path,
    trust: Path,
    sequence: int,
    runner: Callable[..., subprocess.CompletedProcess] = subprocess.run,
) -> tuple[dict, bytes]:
    if isinstance(sequence, bool) or not isinstance(sequence, int) or sequence <= 0:
        raise CatalogPublicationV2Error("publication sequence must be a positive integer")
    _regular_file(verifier, "platform runtime-component verifier", MAX_ARTIFACT_BYTES, executable=True)
    _regular_file(trust, "runtime-components public trust", MAX_TRUST_BYTES)

    try:
        root_metadata = artifacts_root.lstat()
    except OSError as exc:
        raise CatalogPublicationV2Error("signed component artifact root is unavailable") from exc
    if stat.S_ISLNK(root_metadata.st_mode) or not stat.S_ISDIR(root_metadata.st_mode):
        raise CatalogPublicationV2Error("signed component artifact root must be a real directory")

    entries = []
    for candidate_entry in candidate["entries"]:
        app_id = candidate_entry["appId"]
        app_root = artifacts_root / app_id
        try:
            app_metadata = app_root.lstat()
        except OSError as exc:
            raise CatalogPublicationV2Error(f"{app_id} signed artifact directory is unavailable") from exc
        if stat.S_ISLNK(app_metadata.st_mode) or not stat.S_ISDIR(app_metadata.st_mode):
            raise CatalogPublicationV2Error(f"{app_id} signed artifact directory must be a real directory")

        bound = candidate_entry["artifacts"]
        package_path = _verify_bound_artifact(app_root, bound["package"], f"{app_id} package")
        release_path = _verify_bound_artifact(app_root, bound["release"], f"{app_id} release")
        compatibility_path = _verify_bound_artifact(
            app_root,
            bound["compatibility"],
            f"{app_id} compatibility",
        )
        # Reading and hashing package/release above is intentional even though
        # verify-envelope-v2 authenticates release+compatibility. The candidate
        # package binding remains part of the catalog publication identity.
        del package_path, release_path

        envelope_path = app_root / f"{app_id}.runtime-component-envelope.json"
        _regular_file(envelope_path, f"{app_id} component envelope", MAX_ENVELOPE_BYTES)
        _verify_component_envelope(
            verifier=verifier,
            trust=trust,
            envelope=envelope_path,
            compatibility=compatibility_path,
            expected_app_id=app_id,
            expected_version=candidate_entry["version"],
            expected_source_commit=candidate_entry["sourceCommit"],
            runner=runner,
        )

        entry = {
            **candidate_entry,
            "artifacts": {
                **bound,
                "componentEnvelope": _envelope_artifact(envelope_path, app_id),
            },
        }
        entries.append(entry)

    publication = {
        "$schema": PUBLICATION_SCHEMA,
        "status": "unsigned-publication-payload",
        "sequence": sequence,
        "source": candidate["source"],
        "entries": entries,
        "trust": {
            "domain": TRUST_DOMAIN,
            "requiredKeyId": KEY_ID,
        },
        "provenance": {
            "candidateSchema": CANDIDATE_SCHEMA,
            "candidateSha256": hashlib.sha256(candidate_bytes).hexdigest(),
        },
        "authority": {
            "signing": False,
            "publication": False,
            "installation": False,
            "activation": False,
            "rollback": False,
        },
        "safety": {
            "requiresExternalSignature": True,
            "canonicalPublicAnchorRequired": True,
            "componentEnvelopesRequired": True,
            "componentEnvelopesVerifiedBeforeCatalogAssembly": True,
            "componentEnvelopesReverifiedByPlatformLifecycle": True,
            "platformLifecycleRequired": True,
            "payloadGrantsAuthority": False,
        },
    }
    return publication, canonical_json(publication)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--artifacts-root", type=Path, required=True)
    parser.add_argument("--verifier", type=Path, required=True)
    parser.add_argument("--trust", type=Path, required=True)
    parser.add_argument("--sequence", type=int, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        candidate, candidate_bytes = read_candidate(args.candidate)
        publication, payload = render_publication_v2(
            candidate=candidate,
            candidate_bytes=candidate_bytes,
            artifacts_root=args.artifacts_root,
            verifier=args.verifier,
            trust=args.trust,
            sequence=args.sequence,
        )
        if args.out.exists() or args.out.is_symlink():
            raise CatalogPublicationV2Error("refusing to overwrite Store publication v2 output")
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_bytes(payload)
        print("ORDAX_STORE_CATALOG_PUBLICATION_V2=PASS")
        print(f"SEQUENCE={publication['sequence']}")
        print(f"ENTRY_COUNT={len(publication['entries'])}")
        print("COMPONENT_ENVELOPES_VERIFIED=YES")
        print("PRIVATE_KEY_ACCESS=NO")
        print("CATALOG_SIGNATURE_EMITTED=NO")
        print("PUBLICATION_AUTHORITY=NO")
        print("INSTALL_AUTHORITY=NO")
        return 0
    except (CatalogPublicationV2Error, OSError, UnicodeError) as exc:
        print(f"ORDAX_STORE_CATALOG_PUBLICATION_V2=FAIL\n{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
