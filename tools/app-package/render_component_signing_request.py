#!/usr/bin/env python3
"""Render an authority-free external signing request for one Store component.

The request is derived from an existing canonical unsigned-component handoff and
the exact artifact bytes it identifies. It contains no private key material and
grants no signing, publication, installation, activation, or rollback authority.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import stat
import sys

HANDOFF_SCHEMA = "ordax-apps.unsigned-component-candidate/1"
REQUEST_SCHEMA = "ordax-apps.component-signing-request/1"
SOURCE_REPOSITORY = "washingtonmsdj/ordax-apps"
TRUST_DOMAIN = "runtime-components"
KEY_ID = "ordax-runtime-components-v1"
MAX_HANDOFF_BYTES = 512 * 1024
ROLE_MAX_BYTES = {
    "package": 32 * 1024 * 1024,
    "release": 256 * 1024,
    "compatibility": 64 * 1024,
}
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
APP_ID_RE = re.compile(r"^[a-z][a-z0-9-]{0,63}$")


class ComponentSigningRequestError(RuntimeError):
    pass


def canonical_json(value: object) -> bytes:
    return (
        json.dumps(
            value,
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
            allow_nan=False,
        )
        + "\n"
    ).encode("utf-8")


def _read_regular(path: Path, label: str, max_bytes: int) -> bytes:
    try:
        metadata = path.lstat()
    except OSError as exc:
        raise ComponentSigningRequestError(f"{label} is unavailable") from exc
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        raise ComponentSigningRequestError(
            f"{label} must be a regular non-symlink file"
        )
    if metadata.st_size <= 0 or metadata.st_size > max_bytes:
        raise ComponentSigningRequestError(
            f"{label} size is outside allowed bounds"
        )
    try:
        return path.read_bytes()
    except OSError as exc:
        raise ComponentSigningRequestError(f"{label} could not be read") from exc


def _read_handoff(path: Path) -> tuple[dict, bytes]:
    payload = _read_regular(path, "unsigned component handoff", MAX_HANDOFF_BYTES)
    try:
        value = json.loads(payload.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ComponentSigningRequestError(
            "unsigned component handoff must be valid UTF-8 JSON"
        ) from exc
    if not isinstance(value, dict) or payload != canonical_json(value):
        raise ComponentSigningRequestError(
            "unsigned component handoff must be canonical deterministic JSON"
        )
    if value.get("$schema") != HANDOFF_SCHEMA or value.get("status") != "unsigned-candidate":
        raise ComponentSigningRequestError("unsupported unsigned component handoff")
    if set(value) != {
        "$schema", "status", "component", "source", "artifacts",
        "trust", "authority", "safety",
    }:
        raise ComponentSigningRequestError(
            "unsigned component handoff fields are not canonical"
        )
    return value, payload


def _validate_identity(value: object, *, role: str) -> dict:
    if not isinstance(value, dict) or set(value) != {"name", "sha256", "size"}:
        raise ComponentSigningRequestError(f"{role} artifact identity is not canonical")
    name = value.get("name")
    digest = value.get("sha256")
    size = value.get("size")
    if (
        not isinstance(name, str)
        or not name
        or "/" in name
        or "\\" in name
        or not isinstance(digest, str)
        or not SHA256_RE.fullmatch(digest)
        or not isinstance(size, int)
        or isinstance(size, bool)
        or size <= 0
        or size > ROLE_MAX_BYTES[role]
    ):
        raise ComponentSigningRequestError(f"{role} artifact identity is invalid")
    return {"name": name, "sha256": digest, "size": size}


def _bind_file(root: Path, identity: dict, *, role: str) -> None:
    path = root / identity["name"]
    payload = _read_regular(path, f"{role} artifact", ROLE_MAX_BYTES[role])
    if len(payload) != identity["size"]:
        raise ComponentSigningRequestError(
            f"{role} artifact size does not match unsigned handoff"
        )
    if hashlib.sha256(payload).hexdigest() != identity["sha256"]:
        raise ComponentSigningRequestError(
            f"{role} artifact sha256 does not match unsigned handoff"
        )


def render_signing_request(
    *,
    handoff_path: Path,
    artifacts_root: Path,
) -> tuple[dict, bytes]:
    handoff, handoff_bytes = _read_handoff(handoff_path)

    component = handoff["component"]
    if (
        not isinstance(component, dict)
        or set(component) != {"id", "version", "releaseMode"}
        or not isinstance(component.get("id"), str)
        or not APP_ID_RE.fullmatch(component["id"])
        or not isinstance(component.get("version"), str)
        or not component["version"]
        or component.get("releaseMode") != "component-slot"
    ):
        raise ComponentSigningRequestError("component identity is invalid")

    source = handoff["source"]
    if (
        not isinstance(source, dict)
        or set(source) != {"repository", "commit"}
        or source.get("repository") != SOURCE_REPOSITORY
        or not isinstance(source.get("commit"), str)
        or not COMMIT_RE.fullmatch(source["commit"])
    ):
        raise ComponentSigningRequestError("source identity is invalid")

    if handoff.get("trust") != {
        "domain": TRUST_DOMAIN,
        "requiredKeyId": KEY_ID,
        "canonicalPublicAnchorRequiredBeforeProductionSigning": True,
    }:
        raise ComponentSigningRequestError("trust identity is invalid")

    if handoff.get("authority") != {
        "signing": False,
        "publication": False,
        "installation": False,
        "activation": False,
    }:
        raise ComponentSigningRequestError("unsigned handoff authority drifted")

    safety = handoff.get("safety")
    if safety != {
        "containsPrivateKeyMaterial": False,
        "directActivationAllowed": False,
        "platformLifecycleRequired": True,
    }:
        raise ComponentSigningRequestError("unsigned handoff safety boundary drifted")

    artifacts = handoff.get("artifacts")
    if not isinstance(artifacts, dict) or set(artifacts) != set(ROLE_MAX_BYTES):
        raise ComponentSigningRequestError("unsigned handoff artifacts are not canonical")

    normalized = {
        role: _validate_identity(artifacts[role], role=role)
        for role in ("package", "release", "compatibility")
    }

    try:
        root_meta = artifacts_root.lstat()
    except OSError as exc:
        raise ComponentSigningRequestError("artifact root is unavailable") from exc
    if stat.S_ISLNK(root_meta.st_mode) or not stat.S_ISDIR(root_meta.st_mode):
        raise ComponentSigningRequestError(
            "artifact root must be a real non-symlink directory"
        )

    for role in ("package", "release", "compatibility"):
        _bind_file(artifacts_root, normalized[role], role=role)

    app_id = component["id"]
    request_value = {
        "$schema": REQUEST_SCHEMA,
        "status": "external-signature-required",
        "component": dict(component),
        "source": dict(source),
        "sourceHandoff": {
            "schema": HANDOFF_SCHEMA,
            "sha256": hashlib.sha256(handoff_bytes).hexdigest(),
        },
        "inputs": normalized,
        "output": {
            "name": f"{app_id}.runtime-component-envelope.json",
            "schema": "prototype-ordax.runtime-component-envelope/1",
            "releaseSchema": "prototype-ordax.runtime-component-release/2",
            "signatureAlgorithm": "ed25519",
        },
        "trust": {
            "domain": TRUST_DOMAIN,
            "requiredKeyId": KEY_ID,
            "canonicalPublicAnchorRequired": True,
        },
        "verification": {
            "signerMustRevalidateInputHashes": True,
            "signedPayloadMustEqualReleaseBytes": True,
            "compatibilityMustBeBoundByEnvelope": True,
            "canonicalPlatformVerifierRequiredBeforeCatalogAssembly": True,
        },
        "authority": {
            "signing": False,
            "publication": False,
            "installation": False,
            "activation": False,
            "rollback": False,
        },
        "safety": {
            "containsPrivateKeyMaterial": False,
            "privateKeyPathAllowed": False,
            "remoteSignerCredentialAllowed": False,
            "directActivationAllowed": False,
            "platformLifecycleRequired": True,
        },
    }
    return request_value, canonical_json(request_value)


def write_signing_request(
    *,
    handoff_path: Path,
    artifacts_root: Path,
    output_path: Path,
) -> dict:
    if output_path.exists() or output_path.is_symlink():
        raise ComponentSigningRequestError(
            "refusing to overwrite component signing request output"
        )
    value, payload = render_signing_request(
        handoff_path=handoff_path,
        artifacts_root=artifacts_root,
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(payload)
    return value


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--handoff", type=Path, required=True)
    parser.add_argument("--artifacts-root", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)

    try:
        value = write_signing_request(
            handoff_path=args.handoff,
            artifacts_root=args.artifacts_root,
            output_path=args.out,
        )
        print("ORDAX_COMPONENT_SIGNING_REQUEST=PASS")
        print(f"APP_ID={value['component']['id']}")
        print(f"APP_VERSION={value['component']['version']}")
        print(f"KEY_ID={value['trust']['requiredKeyId']}")
        print("PRIVATE_KEY_MATERIAL=NO")
        print("SIGNING_AUTHORITY=NO")
        print("PUBLICATION_AUTHORITY=NO")
        print("ACTIVATION_AUTHORITY=NO")
        return 0
    except (ComponentSigningRequestError, OSError) as exc:
        print(f"ORDAX_COMPONENT_SIGNING_REQUEST=FAIL\n{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
