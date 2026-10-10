#!/usr/bin/env python3
"""Authority-free validation of app-owned Surface presentation manifests.

The package builder and signed-candidate receipt verifier consume this one
validator; presentation is descriptive data and cannot grant any capability.
"""
from __future__ import annotations

import json
import re

SCHEMA = "ordax.app-presentation-manifest/1"
EXPECTED_FIELDS = {
    "schema", "appId", "appVersion", "authority", "sourceLocale",
    "description", "monogram", "singleton", "translations",
}
COPY_FIELDS = {"title", "description"}
APP_ID_RE = re.compile(r"^[a-z][a-z0-9-]{0,63}$")
MONOGRAM_RE = re.compile(r"^[A-Z0-9]{1,8}$")
LOCALE_RE = re.compile(r"^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-(?:[A-Z]{2}|[0-9]{3}))?$")
MAX_MANIFEST_BYTES = 64 * 1024


class PresentationContractError(ValueError):
    pass


def _pairs_unique(pairs):
    record = {}
    for key, value in pairs:
        if key in record:
            raise PresentationContractError(f"presentation JSON duplicates field: {key}")
        record[key] = value
    return record


def _text(value, max_length, label):
    if (not isinstance(value, str) or not 0 < len(value) <= max_length
            or not value.strip() or any(ord(ch) < 32 or ord(ch) == 127 for ch in value)):
        raise PresentationContractError(f"{label} is invalid")
    return value


def validate_manifest_bytes(payload: bytes, *, app_id: str, version: str) -> dict:
    if not isinstance(payload, bytes) or not 0 < len(payload) <= MAX_MANIFEST_BYTES:
        raise PresentationContractError("presentation manifest size is outside bounds")
    try:
        value = json.loads(payload.decode("utf-8"), object_pairs_hook=_pairs_unique)
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise PresentationContractError("presentation manifest must be valid UTF-8 JSON") from exc
    if not isinstance(value, dict) or set(value) != EXPECTED_FIELDS:
        raise PresentationContractError("presentation manifest fields are not canonical")
    if (value["schema"] != SCHEMA or value["authority"] != "none"
            or not isinstance(app_id, str) or not APP_ID_RE.fullmatch(app_id)
            or value["appId"] != app_id or value["appVersion"] != version):
        raise PresentationContractError("presentation identity or authority differs from component")
    if (not isinstance(value["sourceLocale"], str)
            or not LOCALE_RE.fullmatch(value["sourceLocale"])):
        raise PresentationContractError("presentation source locale is invalid")
    _text(value["description"], 320, "presentation description")
    if not isinstance(value["monogram"], str) or not MONOGRAM_RE.fullmatch(value["monogram"]):
        raise PresentationContractError("presentation monogram is invalid")
    if type(value["singleton"]) is not bool:
        raise PresentationContractError("presentation singleton must be boolean")
    translations = value["translations"]
    if not isinstance(translations, dict) or len(translations) > 40:
        raise PresentationContractError("presentation translations are invalid")
    for locale, copy in translations.items():
        if not LOCALE_RE.fullmatch(locale) or locale == value["sourceLocale"]:
            raise PresentationContractError("presentation translation locale is invalid")
        if not isinstance(copy, dict) or set(copy) != COPY_FIELDS:
            raise PresentationContractError("presentation translation fields are not canonical")
        _text(copy["title"], 160, "presentation translated title")
        _text(copy["description"], 320, "presentation translated description")
    return value
