#!/usr/bin/env python3
"""Materialize a complete, public-only unsigned Store handoff.

This is an *artifact copy* from verified inputs, not a builder, signer, Store
publisher or installation authority. CI ephemeral keys, trust and test-signed
component envelopes cannot enter the output because every path is allowlisted
from the canonical unsigned catalog and its handoffs.
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
import zipfile

import catalog_inventory as inventory_module
import materialize_store_artifact_bundle as bundle_module
import render_store_catalog_candidate as candidate_module
import render_store_catalog_publication as publication_module
import render_unsigned_handoff as unsigned_module

MAX_PACKAGE_BYTES = 32 * 1024 * 1024
MAX_METADATA_BYTES = 2 * 1024 * 1024
APP_ID_RE = re.compile(r"^[a-z][a-z0-9-]{0,63}$")


class UnsignedHandoffError(ValueError):
    pass


def read_regular(path: Path, *, label: str, limit: int) -> bytes:
    try:
        metadata = path.lstat()
    except OSError as exc:
        raise UnsignedHandoffError(f"{label} is missing") from exc
    if not stat.S_ISREG(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
        raise UnsignedHandoffError(f"{label} must be a regular, non-symlink file")
    if metadata.st_size < 1 or metadata.st_size > limit:
        raise UnsignedHandoffError(f"{label} exceeds size limits")
    return path.read_bytes()


def create_handoff(
    *, candidate_path: Path, publication_path: Path,
    artifacts_root: Path, handoffs_dir: Path, apps_root: Path,
    migrations_root: Path, output_root: Path,
) -> dict:
    if output_root.exists() or output_root.is_symlink():
        raise UnsignedHandoffError("refusing to overwrite an existing public handoff directory")
    try:
        candidate, candidate_bytes = publication_module.read_candidate(candidate_path)
    except publication_module.CatalogPublicationError as exc:
        raise UnsignedHandoffError(str(exc)) from exc

    source_commit = candidate["source"]["commit"]
    entries = candidate["entries"]
    # A self-consistent catalog can still silently omit an eligible app.
    # This operation claims a *complete* pre-publication handoff, so validate
    # membership against the one canonical catalog inventory. No fixed ID
    # allowlist or second catalog is maintained by this exporter.
    try:
        eligible_ids = [
            item["appId"]
            for item in inventory_module.discover_catalog_apps(apps_root, migrations_root)
        ]
    except inventory_module.CatalogInventoryError as exc:
        raise UnsignedHandoffError("canonical catalog inventory is unavailable") from exc
    ids = [entry["appId"] for entry in entries]
    if ids != eligible_ids:
        raise UnsignedHandoffError(
            "catalog candidate is incomplete or contains apps outside canonical eligible inventory"
        )
    publication_bytes = read_regular(
        publication_path, label="unsigned publication v1", limit=MAX_METADATA_BYTES,
    )
    try:
        publication = json.loads(publication_bytes.decode("utf-8"))
        sequence = publication["sequence"]
        expected, expected_bytes = publication_module.render_publication(
            candidate=candidate, candidate_bytes=candidate_bytes, sequence=sequence,
        )
    except (ValueError, TypeError, KeyError, UnicodeError,
            publication_module.CatalogPublicationError) as exc:
        raise UnsignedHandoffError("unsigned publication v1 is not canonical") from exc
    if publication != expected or publication_bytes != expected_bytes:
        raise UnsignedHandoffError("unsigned publication v1 is not bound to the catalog candidate")

    files: list[tuple[Path, Path, bytes]] = [
        (candidate_path, Path("store.catalog-candidate.json"), candidate_bytes),
        (publication_path, Path("store.catalog-publication-v1.json"), publication_bytes),
    ]
    for entry in entries:
        app_id = entry.get("appId")
        if not isinstance(app_id, str) or not APP_ID_RE.fullmatch(app_id):
            raise UnsignedHandoffError("invalid catalog app id")
        handoff = handoffs_dir / f"{app_id}.unsigned-candidate.json"
        handoff_bytes = read_regular(
            handoff, label=f"{app_id} unsigned handoff", limit=MAX_METADATA_BYTES,
        )
        try:
            reconstructed = candidate_module._catalog_entry(
                handoff, apps_root, source_commit,
            )
        except (candidate_module.CatalogCandidateError, OSError) as exc:
            raise UnsignedHandoffError(f"{app_id} handoff differs from canonical app identity") from exc
        if reconstructed != entry:
            raise UnsignedHandoffError(f"{app_id} handoff differs from catalog candidate")
        files.append((handoff, Path("unsigned") / handoff.name, handoff_bytes))

        for kind, suffix, limit in (
            ("package", ".zip", MAX_PACKAGE_BYTES),
            ("release", ".release.json", MAX_METADATA_BYTES),
            ("compatibility", ".compatibility.json", MAX_METADATA_BYTES),
        ):
            record = entry["artifacts"][kind]
            expected_name = app_id + suffix
            if record["name"] != expected_name:
                raise UnsignedHandoffError(f"{app_id} {kind} artifact name mismatch")
            location = artifacts_root / app_id / expected_name
            payload = read_regular(
                location, label=f"{app_id} {kind} artifact", limit=limit,
            )
            if len(payload) != record["size"] or hashlib.sha256(payload).hexdigest() != record["sha256"]:
                raise UnsignedHandoffError(f"{app_id} {kind} artifact hash or size mismatch")
            files.append((
                location, Path("artifacts") / app_id / expected_name, payload,
            ))

        # Hashes in a candidate are not evidence that the *package itself* is
        # valid: an attacker can recalculate every digest for a forged ZIP.
        # Reuse the exact canonical unsigned-handoff validator instead of
        # introducing another release/compatibility validator here.
        try:
            _, canonical_handoff_bytes = unsigned_module.render_handoff(
                package=artifacts_root / app_id / f"{app_id}.zip",
                release=artifacts_root / app_id / f"{app_id}.release.json",
                compatibility=artifacts_root / app_id / f"{app_id}.compatibility.json",
                app_id=app_id,
                source_commit=source_commit,
            )
        except (unsigned_module.HandoffError, OSError, ValueError, zipfile.BadZipFile) as exc:
            raise UnsignedHandoffError(
                f"{app_id} canonical package/descriptor verification failed"
            ) from exc
        if handoff_bytes != canonical_handoff_bytes:
            raise UnsignedHandoffError(
                f"{app_id} unsigned handoff is not canonical for verified artifacts"
            )

    if ids != sorted(ids) or len(set(ids)) != len(ids):
        raise UnsignedHandoffError("catalog app ids must be unique and sorted")
    if len(files) != len(entries) * 4 + 2:
        raise UnsignedHandoffError("public handoff file inventory is incomplete")

    # Match the already-established Store artifact-bundle commit boundary.
    # Do not expose a partially written public handoff when any write fails.
    try:
        parent = bundle_module._real_directory(
            output_root.parent, "unsigned handoff output parent",
        )
    except bundle_module.StoreArtifactBundleError as exc:
        raise UnsignedHandoffError(str(exc)) from exc
    staging = Path(tempfile.mkdtemp(
        prefix=f".{output_root.name}.stage-", dir=parent,
    ))
    committed = False
    try:
        for _, relative, payload in files:
            destination = staging / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(payload)
        if output_root.exists() or output_root.is_symlink():
            raise UnsignedHandoffError(
                "refusing to overwrite an existing public handoff directory"
            )
        os.rename(staging, output_root)
        committed = True
    finally:
        if not committed:
            shutil.rmtree(staging, ignore_errors=True)
    return {"app_count": len(entries), "file_count": len(files), "source_commit": source_commit}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--publication", type=Path, required=True)
    parser.add_argument("--artifacts-root", type=Path, required=True)
    parser.add_argument("--handoffs-dir", type=Path, required=True)
    parser.add_argument("--apps-root", type=Path, default=Path("apps"))
    parser.add_argument("--migrations-root", type=Path, default=Path("migrations"))
    parser.add_argument("--out-root", type=Path, required=True)
    args = parser.parse_args()
    try:
        result = create_handoff(
            candidate_path=args.candidate,
            publication_path=args.publication,
            artifacts_root=args.artifacts_root,
            handoffs_dir=args.handoffs_dir,
            apps_root=args.apps_root,
            migrations_root=args.migrations_root,
            output_root=args.out_root,
        )
    except (UnsignedHandoffError, OSError, ValueError, TypeError, KeyError) as exc:
        print(f"ORDAX_STORE_UNSIGNED_HANDOFF=FAIL\n{exc}", file=sys.stderr)
        return 1
    print("ORDAX_STORE_UNSIGNED_HANDOFF=PASS")
    print(f"APP_COUNT={result['app_count']}")
    print(f"PUBLIC_FILES={result['file_count']}")
    print(f"SOURCE_COMMIT={result['source_commit']}")
    print("SIGNED_ENVELOPES=NO")
    print("PRIVATE_KEY_MATERIAL=NO")
    print("INSTALLATION_AUTHORITY=NO")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
