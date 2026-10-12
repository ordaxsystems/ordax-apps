#!/usr/bin/env python3
"""Read-only receipt verifier for a complete public unsigned Store export.

The export is an untrusted input. This verifier uses the exact existing
package/release/handoff and signing-request renderers; it does not sign,
publish, install or grant production authority. It requires no apps source
tree or private signing material.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import stat
import sys
import zipfile

import materialize_store_artifact_bundle as bundle_module
import materialize_unsigned_store_handoff as export_module
import render_store_catalog_publication as publication_module
import render_store_catalog_publication_v2 as publication_v2
import render_unsigned_handoff as unsigned_module


class ExportReceiptError(ValueError):
    pass


def _exact_file_inventory(root: Path, app_ids: list[str]) -> int:
    """Reject missing, extra and symlinked entries before opening artifacts."""
    expected_files = {
        "store.catalog-candidate.json",
        "store.catalog-publication-v1.json",
    }
    expected_dirs = {"unsigned", "artifacts", "signing-requests"}
    for app_id in app_ids:
        expected_dirs.add(f"artifacts/{app_id}")
        expected_files.add(f"unsigned/{app_id}.unsigned-candidate.json")
        expected_files.add(f"signing-requests/{app_id}.component-signing-request.json")
        for suffix in (".zip", ".release.json", ".compatibility.json"):
            expected_files.add(f"artifacts/{app_id}/{app_id}{suffix}")

    found_files: set[str] = set()
    found_dirs: set[str] = set()
    for path in root.rglob("*"):
        relative = path.relative_to(root).as_posix()
        metadata = path.lstat()
        if stat.S_ISLNK(metadata.st_mode):
            raise ExportReceiptError(f"symbolic link forbidden in public export: {relative}")
        if stat.S_ISDIR(metadata.st_mode):
            found_dirs.add(relative)
        elif stat.S_ISREG(metadata.st_mode):
            found_files.add(relative)
        else:
            raise ExportReceiptError(f"non-regular public export entry: {relative}")
    if found_dirs != expected_dirs or found_files != expected_files:
        raise ExportReceiptError("public export contains missing, unexpected or misplaced files")
    return len(found_files)


def verify_export(root: Path) -> dict:
    try:
        root = bundle_module._real_directory(root, "unsigned export root")
        candidate, candidate_bytes = publication_v2.read_candidate(
            root / "store.catalog-candidate.json"
        )
    except (bundle_module.StoreArtifactBundleError,
            publication_v2.CatalogPublicationV2Error) as exc:
        raise ExportReceiptError(str(exc)) from exc

    entries = candidate["entries"]
    ids = [entry["appId"] for entry in entries]
    file_count = _exact_file_inventory(root, ids)

    publication_bytes = export_module.read_regular(
        root / "store.catalog-publication-v1.json",
        label="unsigned publication v1", limit=export_module.MAX_METADATA_BYTES,
    )
    try:
        publication = json.loads(publication_bytes.decode("utf-8"))
        _, canonical_publication_bytes = publication_module.render_publication(
            candidate=candidate, candidate_bytes=candidate_bytes,
            sequence=publication["sequence"],
        )
    except (ValueError, TypeError, KeyError, UnicodeError,
            publication_module.CatalogPublicationError) as exc:
        raise ExportReceiptError("invalid or unbound unsigned publication v1") from exc
    if publication_bytes != canonical_publication_bytes:
        raise ExportReceiptError("unsigned publication v1 is not canonical for candidate")

    source_commit = candidate["source"]["commit"]
    for entry in entries:
        app_id = entry["appId"]
        artifacts = root / "artifacts" / app_id
        handoff_path = root / "unsigned" / f"{app_id}.unsigned-candidate.json"
        handoff_bytes = export_module.read_regular(
            handoff_path, label=f"{app_id} unsigned handoff",
            limit=export_module.MAX_METADATA_BYTES,
        )
        package = artifacts / f"{app_id}.zip"
        try:
            handoff, canonical_handoff_bytes = unsigned_module.render_handoff(
                package=package,
                release=artifacts / f"{app_id}.release.json",
                compatibility=artifacts / f"{app_id}.compatibility.json",
                app_id=app_id,
                source_commit=source_commit,
            )
        except (unsigned_module.HandoffError, OSError, ValueError, zipfile.BadZipFile) as exc:
            raise ExportReceiptError(f"{app_id} package/descriptor failed canonical verification") from exc
        if handoff_bytes != canonical_handoff_bytes:
            raise ExportReceiptError(f"{app_id} unsigned handoff bytes do not match verified package")

        # The canonical package verifier above already authenticated every ZIP
        # entry and its manifest hashes. Read the verified component metadata
        # to bind the catalog title, which is not present in the unsigned handoff.
        with zipfile.ZipFile(package) as archive:
            component = json.loads(
                archive.read(unsigned_module.builder.PACKAGE_MANIFEST_NAME).decode("utf-8")
            )["component"]
        expected_entry = {
            "appId": app_id,
            "title": component["title"],
            "version": handoff["component"]["version"],
            "releaseMode": handoff["component"]["releaseMode"],
            "sourceCommit": source_commit,
            "artifacts": handoff["artifacts"],
            "trust": {
                "domain": handoff["trust"]["domain"],
                "requiredKeyId": handoff["trust"]["requiredKeyId"],
            },
        }
        if component["owner"] != unsigned_module.SOURCE_REPOSITORY or entry != expected_entry:
            raise ExportReceiptError(f"{app_id} catalog entry is not bound to verified source")

        request_bytes = export_module.read_regular(
            root / "signing-requests" / f"{app_id}.component-signing-request.json",
            label=f"{app_id} external signing request",
            limit=export_module.MAX_METADATA_BYTES,
        )
        if request_bytes != export_module._render_signing_request(
            handoff, canonical_handoff_bytes,
        ):
            raise ExportReceiptError(f"{app_id} signing request is not bound to verified artifacts")

    return {
        "app_count": len(ids),
        "file_count": file_count,
        "signing_requests": len(ids),
        "source_commit": source_commit,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        result = verify_export(args.root)
    except (ExportReceiptError, OSError, ValueError, TypeError, KeyError,
            UnicodeError, zipfile.BadZipFile) as exc:
        print(f"ORDAX_STORE_UNSIGNED_EXPORT_RECEIPT=FAIL\n{exc}", file=sys.stderr)
        return 1
    print("ORDAX_STORE_UNSIGNED_EXPORT_RECEIPT=PASS")
    print(f"APP_COUNT={result['app_count']}")
    print(f"FILE_COUNT={result['file_count']}")
    print(f"SIGNING_REQUESTS={result['signing_requests']}")
    print(f"SOURCE_COMMIT={result['source_commit']}")
    print("PRODUCTION_SIGNATURES_VERIFIED=NO")
    print("INSTALLATION_AUTHORITY=NO")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
