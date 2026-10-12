#!/usr/bin/env python3
"""Render the canonical unsigned Store catalog publication payload.

This transforms one deterministic catalog candidate into the exact byte payload
that a separate signing boundary may authenticate later. It never reads private
keys, emits signatures, publishes artifacts, installs apps, activates components
or grants lifecycle authority.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import stat
import sys

CANDIDATE_SCHEMA = "ordax-apps.store-catalog-candidate/1"
PUBLICATION_SCHEMA = "ordax-apps.store-catalog-publication/1"
SOURCE_REPOSITORY = "ordaxsystems/ordax-apps"
TRUST_DOMAIN = "runtime-components"
KEY_ID = "ordax-runtime-components-v1"
MAX_CATALOG_BYTES = 2 * 1024 * 1024
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


class CatalogPublicationError(RuntimeError):
    pass


def canonical_json(value: object) -> bytes:
    return (json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n").encode("utf-8")


def read_candidate(path: Path) -> tuple[dict, bytes]:
    try:
        metadata = path.lstat()
    except OSError as exc:
        raise CatalogPublicationError(f"catalog candidate is unavailable: {path}") from exc
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        raise CatalogPublicationError("catalog candidate must be a regular non-symlink file")
    if metadata.st_size <= 0 or metadata.st_size > MAX_CATALOG_BYTES:
        raise CatalogPublicationError("catalog candidate size is outside allowed bounds")
    payload = path.read_bytes()
    try:
        value = json.loads(payload.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise CatalogPublicationError("catalog candidate must be valid UTF-8 JSON") from exc
    if not isinstance(value, dict) or payload != canonical_json(value):
        raise CatalogPublicationError("catalog candidate must be canonical deterministic JSON")
    expected_fields = {
        "$schema", "status", "source", "entries", "trust", "authority", "safety"
    }
    if set(value) != expected_fields:
        raise CatalogPublicationError("catalog candidate fields are not canonical")
    if value.get("$schema") != CANDIDATE_SCHEMA or value.get("status") != "unsigned-catalog-candidate":
        raise CatalogPublicationError("unsupported Store catalog candidate")
    source = value.get("source")
    if (
        not isinstance(source, dict)
        or source.get("repository") != SOURCE_REPOSITORY
        or not isinstance(source.get("commit"), str)
        or not re.fullmatch(r"[0-9a-f]{40}", source["commit"])
    ):
        raise CatalogPublicationError("catalog candidate source identity is invalid")
    entries = value.get("entries")
    if not isinstance(entries, list) or not entries or len(entries) > 128:
        raise CatalogPublicationError("catalog candidate entries must be bounded and non-empty")
    ids = []
    for entry in entries:
        if not isinstance(entry, dict):
            raise CatalogPublicationError("catalog candidate entry is invalid")
        app_id = entry.get("appId")
        if not isinstance(app_id, str) or not app_id:
            raise CatalogPublicationError("catalog candidate app id is invalid")
        ids.append(app_id)
    if ids != sorted(ids) or len(ids) != len(set(ids)):
        raise CatalogPublicationError("catalog candidate entries must be sorted and unique")
    if value.get("trust") != {
        "domain": TRUST_DOMAIN,
        "requiredKeyId": KEY_ID,
        "canonicalPublicAnchorRequiredBeforeProductionSigning": True,
    }:
        raise CatalogPublicationError("catalog candidate trust requirements drifted")
    if value.get("authority") != {
        "signing": False,
        "publication": False,
        "installation": False,
        "activation": False,
        "rollback": False,
    }:
        raise CatalogPublicationError("catalog candidate must remain authority-free")
    if value.get("safety") != {
        "catalogGrantsAuthority": False,
        "platformLifecycleRequired": True,
        "requestSelectsArtifact": False,
        "requestSelectsVersion": False,
    }:
        raise CatalogPublicationError("catalog candidate safety boundary drifted")
    return value, payload


def render_publication(*, candidate: dict, candidate_bytes: bytes, sequence: int) -> tuple[dict, bytes]:
    if isinstance(sequence, bool) or not isinstance(sequence, int) or sequence <= 0:
        raise CatalogPublicationError("publication sequence must be a positive integer")
    candidate_sha256 = hashlib.sha256(candidate_bytes).hexdigest()
    if not SHA256_RE.fullmatch(candidate_sha256):
        raise CatalogPublicationError("catalog candidate digest is invalid")
    publication = {
        "$schema": PUBLICATION_SCHEMA,
        "status": "unsigned-publication-payload",
        "sequence": sequence,
        "source": candidate["source"],
        "entries": candidate["entries"],
        "trust": {
            "domain": TRUST_DOMAIN,
            "requiredKeyId": KEY_ID,
        },
        "provenance": {
            "candidateSchema": CANDIDATE_SCHEMA,
            "candidateSha256": candidate_sha256,
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
            "platformLifecycleRequired": True,
            "payloadGrantsAuthority": False,
        },
    }
    return publication, canonical_json(publication)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--sequence", type=int, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        candidate, candidate_bytes = read_candidate(args.candidate)
        publication, payload = render_publication(
            candidate=candidate,
            candidate_bytes=candidate_bytes,
            sequence=args.sequence,
        )
        if args.out.exists() or args.out.is_symlink():
            raise CatalogPublicationError("refusing to overwrite Store publication payload output")
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_bytes(payload)
        print("ORDAX_STORE_CATALOG_PUBLICATION_PAYLOAD=PASS")
        print(f"SEQUENCE={publication['sequence']}")
        print(f"ENTRY_COUNT={len(publication['entries'])}")
        print(f"CANDIDATE_SHA256={publication['provenance']['candidateSha256']}")
        print("PRIVATE_KEY_ACCESS=NO")
        print("SIGNATURE_EMITTED=NO")
        print("INSTALL_AUTHORITY=NO")
        return 0
    except (CatalogPublicationError, OSError) as exc:
        print(f"ORDAX_STORE_CATALOG_PUBLICATION_PAYLOAD=FAIL\n{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
