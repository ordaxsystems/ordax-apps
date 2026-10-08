#!/usr/bin/env python3
"""Canonical, authority-free contract for app-owned file association manifests.

One validator is shared by the workspace ownership audit, package builder and
package receipt verifier. The manifest only declares supported extensions:
it never authorizes file access, chooses an opener or grants host permissions.
"""
from __future__ import annotations

import json
import re

SCHEMA = "ordax.file-association-manifest/1"
EXPECTED_FIELDS = {"schema", "appId", "appVersion", "authority", "role", "extensions"}
APP_ID_RE = re.compile(r"^[a-z][a-z0-9-]{0,63}$")
EXT_RE = re.compile(r"^[a-z0-9][a-z0-9+_-]{0,31}$")
MAX_MANIFEST_BYTES = 64 * 1024


class AssociationContractError(ValueError):
    pass


def validate_manifest_bytes(payload: bytes, *, app_id: str, version: str) -> tuple[str, ...]:
    if not isinstance(payload, bytes) or not 0 < len(payload) <= MAX_MANIFEST_BYTES:
        raise AssociationContractError("association manifest size is outside bounds")
    try:
        value = json.loads(payload.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise AssociationContractError("association manifest must be valid UTF-8 JSON") from exc
    if not isinstance(value, dict) or set(value) != EXPECTED_FIELDS:
        raise AssociationContractError("association manifest fields are not canonical")
    if value["schema"] != SCHEMA or value["authority"] != "none" or value["role"] != "viewer":
        raise AssociationContractError("association manifest policy is invalid")
    if (
        not isinstance(app_id, str)
        or not APP_ID_RE.fullmatch(app_id)
        or value["appId"] != app_id
        or not isinstance(version, str)
        or value["appVersion"] != version
    ):
        raise AssociationContractError("association manifest identity differs from component")
    extensions = value["extensions"]
    if not isinstance(extensions, list) or not 0 < len(extensions) <= 128:
        raise AssociationContractError("association extensions must be a bounded non-empty list")
    if any(not isinstance(ext, str) or not EXT_RE.fullmatch(ext) for ext in extensions):
        raise AssociationContractError("association extension format is invalid")
    if extensions != sorted(set(extensions)):
        raise AssociationContractError("association extensions must be sorted and unique")
    return tuple(extensions)
