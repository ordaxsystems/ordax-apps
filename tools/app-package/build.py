#!/usr/bin/env python3
"""Build and verify deterministic OrdaX first-party app component candidates.

This tool has no signing, install, staging, promotion, rollback or trust authority.
It only renders deterministic package/release inputs for the platform-owned
runtime-component lifecycle.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import sys
import zipfile
from pathlib import Path, PurePosixPath

PACKAGE_SCHEMA = "prototype-ordax.runtime-component-package/1"
RELEASE_SCHEMA_V2 = "prototype-ordax.runtime-component-release/2"
COMPATIBILITY_SCHEMA = "ordax.component-compatibility/1"
COMPONENT_MANIFEST_SCHEMA = "ordax.component-manifest/1"
APP_INTELLIGENCE_MANIFEST_SCHEMA = "ordax.app-intelligence-manifest/1"
APP_INTELLIGENCE_EXECUTION_MODE = "declarative-only"
APPLICATION_ACTION_MANIFEST_SCHEMA = "ordax.application-action-manifest/1"
APPLICATION_ACTION_CAPABILITY_SCHEMA = "ordax.application-action-capability/1"
APPLICATION_ACTION_EXECUTION_MODE = "proposal-only"
APPLICATION_ACTION_PROVIDER_MANIFEST_SCHEMA = "ordax.application-action-provider-manifest/1"
APPLICATION_ACTION_PROVIDER_EXECUTION_MODE = "unavailable"
SOURCE_REPOSITORY = "washingtonmsdj/ordax-apps"
CREATED_FROM_RECIPE = "runtime-component/package/1"
PACKAGE_MANIFEST_NAME = "component-package.json"

APP_ID_RE = re.compile(r"^[a-z][a-z0-9-]{0,63}$")
SEMVER_RE = re.compile(r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$")
SHA40_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
CONTRACT_ID_RE = re.compile(r"^[a-z0-9]+(?:[.-][a-z0-9]+)*$")
INTENT_ID_RE = re.compile(r"^[a-z][a-z0-9-]{0,63}(?:\.[a-z][a-z0-9-]{0,63})+$")
PARAMETER_NAME_RE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
ACTION_ID_RE = re.compile(r"^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$")
ACTION_PARAMETER_ID_RE = re.compile(r"^[a-z][a-z0-9-]{0,63}$")
PROVIDER_ID_RE = re.compile(r"^[a-z][a-z0-9-]{0,127}$")
URI_SCHEME_RE = re.compile(r"^[a-z][a-z0-9+.-]{0,31}$")
AI_EFFECTS = {"none", "read", "write", "external-write", "destructive"}
AI_CONFIRMATION_MODES = {"none", "policy", "explicit"}
AI_PARAMETER_TYPES = {"string", "number", "integer", "boolean", "string-list", "json"}
ACTION_PARAMETER_TYPES = {"string", "boolean", "integer", "number", "enum", "uri", "resource-grant-id"}
ACTION_RISK_CLASSES = {"read-only", "local-change", "external-effect", "privileged"}
ACTION_CONFIRMATION_MODES = {"none", "policy-gated", "always"}
FORBIDDEN_ACTION_PARAMETER_IDS = {
    "path", "raw-path", "host-path", "command", "shell", "executable", "executable-path",
    "wineprefix", "wine-prefix", "argv", "environment", "env", "working-directory",
}

MAX_FILES = 256
MAX_FILE_BYTES = 2 * 1024 * 1024
MAX_TOTAL_BYTES = 16 * 1024 * 1024
MAX_PACKAGE_BYTES = 32 * 1024 * 1024
MAX_COMPATIBILITY_BYTES = 64 * 1024
MAX_AI_MANIFEST_BYTES = 128 * 1024
MAX_ACTION_MANIFEST_BYTES = 256 * 1024
MAX_ACTION_PROVIDER_MANIFEST_BYTES = 64 * 1024

INCLUDED_ROOTS = ("src", "assets", "ai", "actions")
SOURCE_EXTENSIONS = {".mjs", ".js"}

class AppPackageError(RuntimeError):
    pass


def canonical_json_bytes(value: object) -> bytes:
    return (json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n").encode("utf-8")


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def safe_relative(value: str, label: str) -> PurePosixPath:
    if not value or "\\" in value or value.startswith("/"):
        raise AppPackageError(f"{label} is not a safe relative POSIX path")
    path = PurePosixPath(value)
    if any(part in {"", ".", ".."} for part in path.parts):
        raise AppPackageError(f"{label} is not a safe relative POSIX path")
    return path


def read_regular(path: Path, *, max_bytes: int, label: str) -> bytes:
    info = path.lstat()
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
        raise AppPackageError(f"{label} must be a regular non-symlink file")
    if info.st_size <= 0 or info.st_size > max_bytes:
        raise AppPackageError(f"{label} size is outside allowed bounds")
    return path.read_bytes()


def load_json(path: Path, *, max_bytes: int, label: str) -> dict:
    payload = read_regular(path, max_bytes=max_bytes, label=label)
    try:
        value = json.loads(payload.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise AppPackageError(f"{label} is not valid UTF-8 JSON") from exc
    if not isinstance(value, dict):
        raise AppPackageError(f"{label} must be a JSON object")
    return value


def validate_app_manifest(value: dict) -> dict:
    expected = {
        "schema", "id", "title", "kind", "version", "releaseMode",
        "criticality", "failureDomain", "restartScope", "healthMode",
        "owner", "dependencies",
    }
    if set(value) != expected:
        raise AppPackageError("app.json fields are not canonical")
    if value["schema"] != COMPONENT_MANIFEST_SCHEMA:
        raise AppPackageError("app.json schema is incompatible")
    app_id = str(value["id"])
    if not APP_ID_RE.fullmatch(app_id):
        raise AppPackageError("app id is invalid")
    if value["kind"] != "app":
        raise AppPackageError("component kind must be app")
    if not SEMVER_RE.fullmatch(str(value["version"])):
        raise AppPackageError("app version is not semantic")
    if value["releaseMode"] != "component-slot":
        raise AppPackageError("external first-party app must use component-slot release mode")
    if value["owner"] != SOURCE_REPOSITORY:
        raise AppPackageError("external app owner must be washingtonmsdj/ordax-apps")
    for key in ("title", "criticality", "failureDomain", "restartScope", "healthMode"):
        if not isinstance(value[key], str) or not value[key] or len(value[key]) > 160:
            raise AppPackageError(f"app manifest field is invalid: {key}")
    dependencies = value["dependencies"]
    if not isinstance(dependencies, list) or len(dependencies) > 64:
        raise AppPackageError("app dependencies must be a bounded array")
    if any(not isinstance(item, str) or not item or len(item) > 96 for item in dependencies):
        raise AppPackageError("app dependency is invalid")
    if len(set(dependencies)) != len(dependencies):
        raise AppPackageError("app dependencies must be unique")
    return value


def _bounded_ai_text(value: object, label: str, max_chars: int) -> str:
    if not isinstance(value, str) or chr(0) in value:
        raise AppPackageError(f"{label} must be a string")
    normalized = value.strip()
    if not normalized or len(normalized) > max_chars:
        raise AppPackageError(f"{label} is outside allowed bounds")
    return normalized


def validate_app_intelligence_manifest(value: dict, app: dict) -> dict:
    expected = {"schema", "appId", "appVersion", "authority", "execution", "instructions", "intents"}
    if set(value) != expected:
        raise AppPackageError("ai/manifest.json fields are not canonical")
    if value["schema"] != APP_INTELLIGENCE_MANIFEST_SCHEMA:
        raise AppPackageError("ai/manifest.json schema is incompatible")
    if value["appId"] != app["id"] or value["appVersion"] != app["version"]:
        raise AppPackageError("AI manifest identity does not match app.json")
    if value["authority"] != "none":
        raise AppPackageError("AI manifest must not carry authority")
    if value["execution"] != APP_INTELLIGENCE_EXECUTION_MODE:
        raise AppPackageError("AI manifest cannot grant execution")

    instructions = value["instructions"]
    if not isinstance(instructions, list) or not instructions or len(instructions) > 32:
        raise AppPackageError("AI manifest instructions must be a bounded non-empty array")
    normalized_instructions = [
        _bounded_ai_text(item, "AI manifest instruction", 640)
        for item in instructions
    ]
    if len(set(normalized_instructions)) != len(normalized_instructions):
        raise AppPackageError("AI manifest instructions must be unique")

    intents = value["intents"]
    if not isinstance(intents, list) or len(intents) > 64:
        raise AppPackageError("AI manifest intents must be a bounded array")
    seen_intents: set[str] = set()
    for intent in intents:
        if not isinstance(intent, dict) or set(intent) != {
            "id", "description", "effect", "confirmation", "parameters", "examples"
        }:
            raise AppPackageError("AI manifest intent is malformed")
        intent_id = intent["id"]
        if (
            not isinstance(intent_id, str)
            or INTENT_ID_RE.fullmatch(intent_id) is None
            or not intent_id.startswith(f"{app['id']}.")
            or intent_id in seen_intents
        ):
            raise AppPackageError("AI manifest intent id is invalid, duplicated or not app-namespaced")
        seen_intents.add(intent_id)
        _bounded_ai_text(intent["description"], "AI manifest intent description", 640)
        if intent["effect"] not in AI_EFFECTS:
            raise AppPackageError("AI manifest intent effect is invalid")
        if intent["confirmation"] not in AI_CONFIRMATION_MODES:
            raise AppPackageError("AI manifest intent confirmation mode is invalid")
        if intent["effect"] in {"external-write", "destructive"} and intent["confirmation"] == "none":
            raise AppPackageError("external/destructive AI intents require confirmation policy")

        parameters = intent["parameters"]
        if not isinstance(parameters, list) or len(parameters) > 32:
            raise AppPackageError("AI manifest intent parameters must be a bounded array")
        seen_parameters: set[str] = set()
        for parameter in parameters:
            if not isinstance(parameter, dict) or set(parameter) != {
                "name", "type", "required", "description"
            }:
                raise AppPackageError("AI manifest intent parameter is malformed")
            name = parameter["name"]
            if (
                not isinstance(name, str)
                or PARAMETER_NAME_RE.fullmatch(name) is None
                or name in seen_parameters
            ):
                raise AppPackageError("AI manifest parameter name is invalid or duplicated")
            seen_parameters.add(name)
            if parameter["type"] not in AI_PARAMETER_TYPES:
                raise AppPackageError("AI manifest parameter type is invalid")
            if not isinstance(parameter["required"], bool):
                raise AppPackageError("AI manifest parameter required flag must be boolean")
            _bounded_ai_text(parameter["description"], "AI manifest parameter description", 320)

        examples = intent["examples"]
        if not isinstance(examples, list) or len(examples) > 8:
            raise AppPackageError("AI manifest intent examples must be a bounded array")
        normalized_examples = [
            _bounded_ai_text(item, "AI manifest intent example", 320)
            for item in examples
        ]
        if len(set(normalized_examples)) != len(normalized_examples):
            raise AppPackageError("AI manifest intent examples must be unique")
    return value



def _bounded_action_text(value: object, label: str, max_chars: int) -> str:
    if (
        not isinstance(value, str)
        or not value
        or len(value) > max_chars
        or any(ord(char) < 32 or ord(char) == 127 for char in value)
    ):
        raise AppPackageError(f"{label} is invalid")
    return value


def _validate_action_parameter(value: dict) -> dict:
    if not isinstance(value, dict):
        raise AppPackageError("application action parameter must be an object")
    allowed = {"id", "type", "required", "maxLength", "minimum", "maximum", "values", "schemes"}
    if not {"id", "type", "required"}.issubset(value) or set(value) - allowed:
        raise AppPackageError("application action parameter fields are invalid")

    parameter_id = value["id"]
    parameter_type = value["type"]
    if (
        not isinstance(parameter_id, str)
        or ACTION_PARAMETER_ID_RE.fullmatch(parameter_id) is None
        or parameter_id in FORBIDDEN_ACTION_PARAMETER_IDS
    ):
        raise AppPackageError("application action parameter id is invalid or exposes raw authority")
    if parameter_type not in ACTION_PARAMETER_TYPES:
        raise AppPackageError("application action parameter type is invalid")
    if not isinstance(value["required"], bool):
        raise AppPackageError("application action parameter required flag is invalid")

    if parameter_type == "string":
        maximum = value.get("maxLength", 1024)
        if not isinstance(maximum, int) or isinstance(maximum, bool) or maximum < 1 or maximum > 8192:
            raise AppPackageError("application action string maxLength is invalid")
        if any(key in value for key in ("minimum", "maximum", "values", "schemes")):
            raise AppPackageError("string application action parameter has incompatible constraints")
    elif parameter_type == "uri":
        maximum = value.get("maxLength", 2048)
        if not isinstance(maximum, int) or isinstance(maximum, bool) or maximum < 1 or maximum > 8192:
            raise AppPackageError("application action URI maxLength is invalid")
        schemes = value.get("schemes")
        if not isinstance(schemes, list) or not schemes or len(schemes) > 16:
            raise AppPackageError("application action URI schemes are invalid")
        if any(
            not isinstance(scheme, str) or URI_SCHEME_RE.fullmatch(scheme) is None
            for scheme in schemes
        ) or len(set(schemes)) != len(schemes):
            raise AppPackageError("application action URI schemes are invalid or duplicated")
        if any(key in value for key in ("minimum", "maximum", "values")):
            raise AppPackageError("URI application action parameter has incompatible constraints")
    elif parameter_type == "resource-grant-id":
        maximum = value.get("maxLength", 128)
        if not isinstance(maximum, int) or isinstance(maximum, bool) or maximum < 1 or maximum > 128:
            raise AppPackageError("application action resource grant maxLength is invalid")
        if any(key in value for key in ("minimum", "maximum", "values", "schemes")):
            raise AppPackageError("resource grant application action parameter has incompatible constraints")
    elif parameter_type in {"integer", "number"}:
        minimum = value.get("minimum")
        maximum = value.get("maximum")
        if minimum is not None and (
            not isinstance(minimum, (int, float))
            or isinstance(minimum, bool)
        ):
            raise AppPackageError("application action numeric minimum is invalid")
        if maximum is not None and (
            not isinstance(maximum, (int, float))
            or isinstance(maximum, bool)
        ):
            raise AppPackageError("application action numeric maximum is invalid")
        if minimum is not None and maximum is not None and minimum > maximum:
            raise AppPackageError("application action numeric range is invalid")
        if any(key in value for key in ("maxLength", "values", "schemes")):
            raise AppPackageError("numeric application action parameter has incompatible constraints")
    elif parameter_type == "enum":
        values = value.get("values")
        if (
            not isinstance(values, list)
            or not values
            or len(values) > 64
            or any(
                not isinstance(item, str)
                or not item
                or len(item) > 160
                or any(ord(char) < 32 or ord(char) == 127 for char in item)
                for item in values
            )
            or len(set(values)) != len(values)
        ):
            raise AppPackageError("application action enum values are invalid")
        if any(key in value for key in ("maxLength", "minimum", "maximum", "schemes")):
            raise AppPackageError("enum application action parameter has incompatible constraints")
    elif any(key in value for key in ("maxLength", "minimum", "maximum", "values", "schemes")):
        raise AppPackageError("boolean application action parameter has incompatible constraints")
    return value


def _validate_action_risk_confirmation(risk_class: object, confirmation: object) -> None:
    if risk_class not in ACTION_RISK_CLASSES:
        raise AppPackageError("application action risk class is invalid")
    if confirmation not in ACTION_CONFIRMATION_MODES:
        raise AppPackageError("application action confirmation mode is invalid")
    if risk_class == "privileged" and confirmation != "always":
        raise AppPackageError("privileged application action requires confirmation")
    if risk_class == "external-effect" and confirmation == "none":
        raise AppPackageError("external-effect application action requires policy or confirmation")


def _validate_action_matches_intent(capability: dict, intent: dict) -> None:
    ai_parameters = {parameter["name"]: parameter for parameter in intent["parameters"]}
    action_parameters = {parameter["id"]: parameter for parameter in capability["parameters"]}
    if set(ai_parameters) != set(action_parameters):
        raise AppPackageError(
            f"application action parameters drifted from AI intent: {capability['actionId']}"
        )
    compatible_types = {
        "string": {"string", "enum", "uri", "resource-grant-id"},
        "number": {"number"},
        "integer": {"integer"},
        "boolean": {"boolean"},
    }
    for name, action_parameter in action_parameters.items():
        ai_parameter = ai_parameters[name]
        if ai_parameter["type"] not in compatible_types:
            raise AppPackageError(
                f"AI intent parameter type is not representable by Application Actions: {name}"
            )
        if action_parameter["type"] not in compatible_types[ai_parameter["type"]]:
            raise AppPackageError(
                f"application action parameter type drifted from AI intent: {name}"
            )
        if action_parameter["required"] is not ai_parameter["required"]:
            raise AppPackageError(
                f"application action required flag drifted from AI intent: {name}"
            )

    risk_rank = {
        "read-only": 0,
        "local-change": 1,
        "external-effect": 2,
        "privileged": 3,
    }
    minimum_risk = {
        "none": 0,
        "read": 0,
        "write": 1,
        "external-write": 2,
        "destructive": 1,
    }[intent["effect"]]
    if risk_rank[capability["riskClass"]] < minimum_risk:
        raise AppPackageError(
            f"application action risk is weaker than AI intent: {capability['actionId']}"
        )

    confirmation_rank = {"none": 0, "policy-gated": 1, "always": 2}
    minimum_confirmation = {
        "none": 0,
        "policy": 1,
        "explicit": 2,
    }[intent["confirmation"]]
    if confirmation_rank[capability["confirmation"]] < minimum_confirmation:
        raise AppPackageError(
            f"application action confirmation is weaker than AI intent: {capability['actionId']}"
        )
    if intent["effect"] == "destructive" and capability["confirmation"] != "always":
        raise AppPackageError(
            f"destructive AI intent requires always-confirm Application Action: {capability['actionId']}"
        )


def validate_application_action_manifest(value: dict, app: dict, ai_manifest: dict) -> dict:
    expected = {"schema", "appId", "appVersion", "authority", "execution", "capabilities"}
    if not isinstance(value, dict) or set(value) != expected:
        raise AppPackageError("actions/manifest.json fields are not canonical")
    if value["schema"] != APPLICATION_ACTION_MANIFEST_SCHEMA:
        raise AppPackageError("actions/manifest.json schema is incompatible")
    if value["appId"] != app["id"] or value["appVersion"] != app["version"]:
        raise AppPackageError("Application Action manifest identity does not match app.json")
    if value["authority"] != "none":
        raise AppPackageError("Application Action manifest must not carry authority")
    if value["execution"] != APPLICATION_ACTION_EXECUTION_MODE:
        raise AppPackageError("Application Action manifest cannot grant execution")

    capabilities = value["capabilities"]
    if not isinstance(capabilities, list) or len(capabilities) > 128:
        raise AppPackageError("Application Action capabilities must be a bounded array")

    ai_intents = {intent["id"]: intent for intent in ai_manifest["intents"]}
    seen_actions: set[str] = set()
    for capability in capabilities:
        expected_capability = {
            "schema", "appId", "actionId", "title", "description", "sourceClass", "platform",
            "provider", "binding", "parameters", "riskClass", "confirmation",
            "executionAuthorized", "modelDirectExecutionAuthorized", "provenance",
        }
        if not isinstance(capability, dict) or set(capability) != expected_capability:
            raise AppPackageError("Application Action capability fields are not canonical")
        if capability["schema"] != APPLICATION_ACTION_CAPABILITY_SCHEMA:
            raise AppPackageError("Application Action capability schema is incompatible")
        action_id = capability["actionId"]
        if (
            capability["appId"] != app["id"]
            or not isinstance(action_id, str)
            or len(action_id) > 120
            or ACTION_ID_RE.fullmatch(action_id) is None
            or not action_id.startswith(f"{app['id']}.")
            or action_id in seen_actions
        ):
            raise AppPackageError(
                "Application Action id is invalid, duplicated or not app-namespaced"
            )
        seen_actions.add(action_id)
        if action_id not in ai_intents:
            raise AppPackageError(
                f"Application Action has no matching AI intent: {action_id}"
            )
        _bounded_action_text(capability["title"], "Application Action title", 160)
        _bounded_action_text(capability["description"], "Application Action description", 800)
        _bounded_action_text(capability["provenance"], "Application Action provenance", 320)

        if capability["sourceClass"] != "first-party" or capability["platform"] != "ordax":
            raise AppPackageError("Application Action manifest must remain first-party OrdaX")

        provider = capability["provider"]
        if (
            not isinstance(provider, dict)
            or set(provider) != {"kind", "adapterId", "revision"}
            or provider["kind"] != "first-party-native"
            or not isinstance(provider["adapterId"], str)
            or PROVIDER_ID_RE.fullmatch(provider["adapterId"]) is None
        ):
            raise AppPackageError("Application Action provider is invalid")
        _bounded_action_text(provider["revision"], "Application Action provider revision", 160)

        binding = capability["binding"]
        if not isinstance(binding, dict) or set(binding) != {"payloadSha256"}:
            raise AppPackageError("Application Action binding is invalid")
        if binding["payloadSha256"] is not None:
            raise AppPackageError("first-party Application Action must not claim payload binding")

        parameters = capability["parameters"]
        if not isinstance(parameters, list) or len(parameters) > 24:
            raise AppPackageError("Application Action parameters must be a bounded array")
        normalized_parameters = [_validate_action_parameter(parameter) for parameter in parameters]
        if len({parameter["id"] for parameter in normalized_parameters}) != len(normalized_parameters):
            raise AppPackageError("Application Action parameter ids must be unique")

        _validate_action_risk_confirmation(capability["riskClass"], capability["confirmation"])
        if (
            capability["executionAuthorized"] is not False
            or capability["modelDirectExecutionAuthorized"] is not False
        ):
            raise AppPackageError("Application Action manifest must remain non-executing")
        _validate_action_matches_intent(capability, ai_intents[action_id])
    return value


def validate_application_action_provider_manifest(
    value: dict,
    app: dict,
    action_manifest: dict,
    module_loader,
) -> dict:
    expected = {"schema", "appId", "appVersion", "authority", "execution", "providers"}
    if not isinstance(value, dict) or set(value) != expected:
        raise AppPackageError("actions/providers/manifest.json fields are not canonical")
    if value["schema"] != APPLICATION_ACTION_PROVIDER_MANIFEST_SCHEMA:
        raise AppPackageError("Application Action provider manifest schema is incompatible")
    if value["appId"] != app["id"] or value["appVersion"] != app["version"]:
        raise AppPackageError("Application Action provider manifest identity does not match app.json")
    if value["authority"] != "none" or value["execution"] != APPLICATION_ACTION_PROVIDER_EXECUTION_MODE:
        raise AppPackageError("Application Action provider manifest cannot grant execution")

    providers = value["providers"]
    if not isinstance(providers, list) or not providers or len(providers) > 16:
        raise AppPackageError("Application Action providers must be a bounded non-empty array")

    declared = {}
    for provider in providers:
        if not isinstance(provider, dict) or set(provider) != {
            "kind", "adapterId", "revision", "module", "sha256"
        }:
            raise AppPackageError("Application Action provider descriptor is malformed")
        if provider["kind"] != "first-party-native":
            raise AppPackageError("Application Action provider artifact must be first-party native")
        adapter_id = provider["adapterId"]
        if not isinstance(adapter_id, str) or PROVIDER_ID_RE.fullmatch(adapter_id) is None:
            raise AppPackageError("Application Action provider adapter id is invalid")
        revision = _bounded_action_text(
            provider["revision"],
            "Application Action provider artifact revision",
            160,
        )
        key = (adapter_id, revision)
        if key in declared:
            raise AppPackageError("Application Action provider artifact is duplicated")
        if not isinstance(provider["module"], str):
            raise AppPackageError("Application Action provider module path must be text")
        module = safe_relative(
            provider["module"],
            "Application Action provider module",
        ).as_posix()
        expected_module = f"actions/providers/{adapter_id}.mjs"
        if module != expected_module:
            raise AppPackageError("Application Action provider module path is not canonical")
        digest = provider["sha256"]
        if not isinstance(digest, str) or SHA256_RE.fullmatch(digest) is None:
            raise AppPackageError("Application Action provider artifact SHA-256 is invalid")
        try:
            payload = module_loader(module)
        except (OSError, KeyError) as exc:
            raise AppPackageError(
                f"Application Action provider artifact is unavailable: {module}"
            ) from exc
        if not isinstance(payload, bytes) or not payload or len(payload) > MAX_FILE_BYTES:
            raise AppPackageError("Application Action provider artifact size is outside bounds")
        if sha256_bytes(payload) != digest:
            raise AppPackageError("Application Action provider artifact SHA-256 mismatch")
        declared[key] = module

    required = {
        (capability["provider"]["adapterId"], capability["provider"]["revision"])
        for capability in action_manifest["capabilities"]
    }
    if set(declared) != required:
        raise AppPackageError(
            "Application Action provider artifacts do not exactly cover declared capabilities"
        )
    return value


def validate_compatibility(value: dict, app: dict) -> dict:
    expected = {"schema", "componentId", "componentVersion", "provides", "requires", "state", "authority"}
    if set(value) != expected:
        raise AppPackageError("compatibility descriptor fields are not canonical")
    if value["schema"] != COMPATIBILITY_SCHEMA or value["authority"] != "none":
        raise AppPackageError("compatibility descriptor policy is invalid")
    if value["componentId"] != app["id"] or value["componentVersion"] != app["version"]:
        raise AppPackageError("compatibility identity does not match app.json")

    provides = value["provides"]
    requires = value["requires"]
    if not isinstance(provides, list) or len(provides) > 128:
        raise AppPackageError("compatibility provides list is invalid")
    if not isinstance(requires, list) or len(requires) > 128:
        raise AppPackageError("compatibility requires list is invalid")

    seen_provides: set[tuple[str, int]] = set()
    for entry in provides:
        if not isinstance(entry, dict) or set(entry) != {"id", "major"}:
            raise AppPackageError("compatibility provided contract is malformed")
        cid = entry["id"]
        major = entry["major"]
        if not isinstance(cid, str) or not CONTRACT_ID_RE.fullmatch(cid):
            raise AppPackageError("compatibility provided contract id is invalid")
        if not isinstance(major, int) or isinstance(major, bool) or major <= 0 or major > 10_000:
            raise AppPackageError("compatibility provided contract major is invalid")
        key = (cid, major)
        if key in seen_provides:
            raise AppPackageError("compatibility provided contracts must be unique")
        seen_provides.add(key)

    seen_requires: set[str] = set()
    for entry in requires:
        if not isinstance(entry, dict) or set(entry) != {"id", "minMajor", "maxMajor", "optional"}:
            raise AppPackageError("compatibility required contract is malformed")
        cid = entry["id"]
        minimum = entry["minMajor"]
        maximum = entry["maxMajor"]
        if not isinstance(cid, str) or not CONTRACT_ID_RE.fullmatch(cid) or cid in seen_requires:
            raise AppPackageError("compatibility required contract id is invalid or duplicated")
        seen_requires.add(cid)
        if (
            not isinstance(minimum, int) or isinstance(minimum, bool)
            or not isinstance(maximum, int) or isinstance(maximum, bool)
            or minimum <= 0 or maximum < minimum or maximum > 10_000
        ):
            raise AppPackageError("compatibility required contract range is invalid")
        if not isinstance(entry["optional"], bool):
            raise AppPackageError("compatibility optional flag must be boolean")

    state = value["state"]
    if state is not None:
        if not isinstance(state, dict) or set(state) != {"id", "writeVersion", "readableFrom", "readableThrough"}:
            raise AppPackageError("compatibility state descriptor is malformed")
        sid = state["id"]
        write = state["writeVersion"]
        start = state["readableFrom"]
        end = state["readableThrough"]
        if not isinstance(sid, str) or not CONTRACT_ID_RE.fullmatch(sid):
            raise AppPackageError("compatibility state id is invalid")
        if any(not isinstance(v, int) or isinstance(v, bool) or v <= 0 or v > 1_000_000 for v in (write, start, end)):
            raise AppPackageError("compatibility state version is invalid")
        if start > write or end < write:
            raise AppPackageError("compatibility state readable range excludes writeVersion")
    return value


def discover_app_files(app_root: Path) -> list[PurePosixPath]:
    if app_root.is_symlink() or not app_root.is_dir():
        raise AppPackageError("app root must be a real directory")
    selected = [PurePosixPath("app.json")]
    for root_name in INCLUDED_ROOTS:
        root = app_root / root_name
        if not root.exists():
            continue
        if root.is_symlink() or not root.is_dir():
            raise AppPackageError(f"{root_name} must be a real directory")
        for path in root.rglob("*"):
            if path.is_dir():
                if path.is_symlink():
                    raise AppPackageError(f"symlink directory is forbidden: {path}")
                continue
            relative = PurePosixPath(path.relative_to(app_root).as_posix())
            selected.append(relative)
    selected = sorted(set(selected), key=lambda p: p.as_posix())
    if len(selected) < 2 or len(selected) > MAX_FILES:
        raise AppPackageError("app package file count is outside allowed bounds")
    return selected



REGEX_PREFIX_IDENTIFIERS = {
    "await", "case", "delete", "do", "else", "in", "instanceof",
    "new", "of", "return", "throw", "typeof", "void", "yield",
}
REGEX_PREFIX_PUNCT = set("([{=,:;!?&|+-*%^~<>")


def _regex_literal_allowed(previous_token) -> bool:
    if previous_token is None:
        return True
    kind, value, _ = previous_token
    if kind == "identifier":
        return value in REGEX_PREFIX_IDENTIFIERS
    if kind == "punct":
        return value in REGEX_PREFIX_PUNCT
    return False


def _consume_javascript_regex(source: str, index: int) -> int:
    index += 1
    in_class = False
    while index < len(source):
        char = source[index]
        if char == "\\":
            index += 2
            continue
        if char in {"\n", "\r"}:
            raise AppPackageError("unterminated JavaScript regex literal")
        if char == "[":
            in_class = True
            index += 1
            continue
        if char == "]" and in_class:
            in_class = False
            index += 1
            continue
        if char == "/" and not in_class:
            index += 1
            while index < len(source) and source[index].isalpha():
                index += 1
            return index
        index += 1
    raise AppPackageError("unterminated JavaScript regex literal")


def _javascript_code_tokens(source: str, index: int = 0, *, stop_at_template_brace: bool = False):
    previous_token = None
    brace_depth = 0
    length = len(source)

    while index < length:
        char = source[index]

        if char.isspace():
            index += 1
            continue

        if stop_at_template_brace and char == "}" and brace_depth == 0:
            return index + 1

        if char == "/" and index + 1 < length and source[index + 1] == "/":
            newline = source.find("\n", index + 2)
            index = length if newline < 0 else newline + 1
            continue

        if char == "/" and index + 1 < length and source[index + 1] == "*":
            end = source.find("*/", index + 2)
            if end < 0:
                raise AppPackageError("unterminated JavaScript block comment")
            index = end + 2
            continue

        if char == "/" and _regex_literal_allowed(previous_token):
            index = _consume_javascript_regex(source, index)
            token = ("regex", "", index)
            previous_token = token
            yield token
            continue

        if char in {"'", '"'}:
            quote = char
            token_start = index
            index += 1
            value = []
            while index < length:
                current = source[index]
                if current == "\\":
                    if index + 1 >= length:
                        raise AppPackageError("unterminated JavaScript string escape")
                    value.append(source[index:index + 2])
                    index += 2
                    continue
                if current == quote:
                    index += 1
                    token = ("string", "".join(value), token_start)
                    previous_token = token
                    yield token
                    break
                if current in {"\n", "\r"}:
                    raise AppPackageError("unterminated JavaScript string literal")
                value.append(current)
                index += 1
            else:
                raise AppPackageError("unterminated JavaScript string literal")
            continue

        if char == chr(96):
            token_start = index
            index += 1
            while index < length:
                current = source[index]
                if current == "\\":
                    index += 2
                    continue
                if current == chr(96):
                    index += 1
                    token = ("template", "", token_start)
                    previous_token = token
                    yield token
                    break
                if current == "$" and index + 1 < length and source[index + 1] == "{":
                    nested = _javascript_code_tokens(
                        source,
                        index + 2,
                        stop_at_template_brace=True,
                    )
                    while True:
                        try:
                            nested_token = next(nested)
                        except StopIteration as stopped:
                            index = stopped.value
                            break
                        yield nested_token
                    continue
                index += 1
            else:
                raise AppPackageError("unterminated JavaScript template literal")
            continue

        if char.isalpha() or char in {"_", "$"}:
            token_start = index
            index += 1
            while index < length and (
                source[index].isalnum() or source[index] in {"_", "$"}
            ):
                index += 1
            token = ("identifier", source[token_start:index], token_start)
            previous_token = token
            yield token
            continue

        if char == "{":
            brace_depth += 1
        elif char == "}" and brace_depth > 0:
            brace_depth -= 1

        token = ("punct", char, index)
        previous_token = token
        yield token
        index += 1

    if stop_at_template_brace:
        raise AppPackageError("unterminated JavaScript template expression")
    return index


def _javascript_tokens(source: str):
    yield from _javascript_code_tokens(source)


def literal_module_specifiers(source: str) -> list[str]:
    tokens = list(_javascript_tokens(source))
    specifiers = []

    for offset, token in enumerate(tokens):
        kind, value, _ = token
        if kind != "identifier" or value not in {"import", "export"}:
            continue

        previous = tokens[offset - 1] if offset > 0 else None
        if previous is not None and previous[0] == "punct" and previous[1] == ".":
            continue

        cursor = offset + 1
        if cursor >= len(tokens):
            continue

        next_kind, next_value, _ = tokens[cursor]

        if value == "import":
            if next_kind == "punct" and next_value == ".":
                continue
            if next_kind == "string":
                specifiers.append(next_value)
                continue
            if next_kind == "punct" and next_value == "(":
                if cursor + 1 < len(tokens) and tokens[cursor + 1][0] == "string":
                    specifiers.append(tokens[cursor + 1][1])
                continue

        while cursor < len(tokens):
            current_kind, current_value, _ = tokens[cursor]
            if current_kind == "punct" and current_value == ";":
                break
            if (
                current_kind == "identifier"
                and current_value == "from"
                and cursor + 1 < len(tokens)
                and tokens[cursor + 1][0] == "string"
            ):
                specifiers.append(tokens[cursor + 1][1])
                break
            cursor += 1

    return specifiers


def validate_source_graph(app_root: Path, files: list[PurePosixPath]) -> None:
    available = {p.as_posix() for p in files}
    if "src/runtime.mjs" not in available:
        raise AppPackageError("external app must provide src/runtime.mjs")

    total = 0
    for relative in files:
        path = app_root / Path(*relative.parts)
        payload = read_regular(path, max_bytes=MAX_FILE_BYTES, label=relative.as_posix())
        total += len(payload)
        if total > MAX_TOTAL_BYTES:
            raise AppPackageError("app package source exceeds total size bound")
        if relative.suffix not in SOURCE_EXTENSIONS:
            continue
        try:
            source = payload.decode("utf-8")
        except UnicodeError as exc:
            raise AppPackageError(f"JavaScript source is not UTF-8: {relative}") from exc
        for specifier in literal_module_specifiers(source):
            if not specifier.startswith("."):
                raise AppPackageError(
                    f"bare/remote import is forbidden in portable app package: {relative} -> {specifier}"
                )
            base = PurePosixPath(relative.parent, specifier)
            normalized = PurePosixPath(os.path.normpath(base.as_posix()).replace("\\", "/"))
            if normalized.is_absolute() or ".." in normalized.parts:
                raise AppPackageError(
                    f"relative import escapes app ownership: {relative} -> {specifier}"
                )
            candidates = [normalized]
            if normalized.suffix == "":
                candidates.extend([
                    PurePosixPath(normalized.as_posix() + ".mjs"),
                    PurePosixPath(normalized.as_posix() + ".js"),
                ])
            if not any(candidate.as_posix() in available for candidate in candidates):
                raise AppPackageError(
                    f"portable app package is not self-contained: {relative} -> {specifier}"
                )


def package_path(app_id: str, relative: PurePosixPath) -> str:
    return f"system/apps/{app_id}/{relative.as_posix()}"


def source_records(app_root: Path, app_id: str, files: list[PurePosixPath]) -> list[dict]:
    records = []
    for relative in files:
        payload = (app_root / Path(*relative.parts)).read_bytes()
        records.append({
            "path": package_path(app_id, relative),
            "sha256": sha256_bytes(payload),
            "size": len(payload),
        })
    return records


def zip_info(name: str) -> zipfile.ZipInfo:
    info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_STORED
    info.create_system = 3
    info.external_attr = (stat.S_IFREG | 0o644) << 16
    return info


def render_package_manifest(app: dict, source_commit: str, records: list[dict]) -> dict:
    component = {
        "id": app["id"],
        "title": app["title"],
        "kind": app["kind"],
        "version": app["version"],
        "releaseMode": app["releaseMode"],
        "criticality": app["criticality"],
        "failureDomain": app["failureDomain"],
        "restartScope": app["restartScope"],
        "healthMode": app["healthMode"],
        "owner": app["owner"],
        "dependencies": app["dependencies"],
    }
    return {
        "$schema": PACKAGE_SCHEMA,
        "status": "candidate",
        "component": component,
        "source_commit": source_commit,
        "entrypoint": f"system/apps/{app['id']}/src/runtime.mjs",
        "self_contained_source_graph": True,
        "remote_runtime_dependencies": False,
        "activation_allowed": False,
        "signature_required_before_activation": True,
        "native_adapters_packaged": False,
        "composition_packaged": False,
        "files": records,
    }


def build_package(app_root: Path, source_commit: str, output: Path) -> tuple[dict, bytes]:
    if not SHA40_RE.fullmatch(source_commit):
        raise AppPackageError("source commit must be lowercase 40-hex")
    if output.exists():
        raise AppPackageError("refusing to overwrite package")
    app = validate_app_manifest(load_json(app_root / "app.json", max_bytes=64 * 1024, label="app.json"))
    ai_manifest_path = app_root / "ai" / "manifest.json"
    if not ai_manifest_path.is_file() or ai_manifest_path.is_symlink():
        raise AppPackageError("first-party app must provide ai/manifest.json")
    ai_manifest = validate_app_intelligence_manifest(
        load_json(ai_manifest_path, max_bytes=MAX_AI_MANIFEST_BYTES, label="ai/manifest.json"),
        app,
    )
    action_manifest_path = app_root / "actions" / "manifest.json"
    if not action_manifest_path.is_file() or action_manifest_path.is_symlink():
        raise AppPackageError("first-party app must provide actions/manifest.json")
    action_manifest = validate_application_action_manifest(
        load_json(
            action_manifest_path,
            max_bytes=MAX_ACTION_MANIFEST_BYTES,
            label="actions/manifest.json",
        ),
        app,
        ai_manifest,
    )
    provider_manifest_path = app_root / "actions" / "providers" / "manifest.json"
    if not provider_manifest_path.is_file() or provider_manifest_path.is_symlink():
        raise AppPackageError("first-party app must provide actions/providers/manifest.json")
    validate_application_action_provider_manifest(
        load_json(
            provider_manifest_path,
            max_bytes=MAX_ACTION_PROVIDER_MANIFEST_BYTES,
            label="actions/providers/manifest.json",
        ),
        app,
        action_manifest,
        lambda module: read_regular(
            app_root / Path(*PurePosixPath(module).parts),
            max_bytes=MAX_FILE_BYTES,
            label=module,
        ),
    )
    files = discover_app_files(app_root)
    validate_source_graph(app_root, files)
    records = source_records(app_root, app["id"], files)
    manifest = render_package_manifest(app, source_commit, records)
    manifest_bytes = canonical_json_bytes(manifest)

    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr(zip_info(PACKAGE_MANIFEST_NAME), manifest_bytes)
        for relative in files:
            archive.writestr(
                zip_info(package_path(app["id"], relative)),
                (app_root / Path(*relative.parts)).read_bytes(),
            )
    if output.stat().st_size <= 0 or output.stat().st_size > MAX_PACKAGE_BYTES:
        output.unlink(missing_ok=True)
        raise AppPackageError("built package size is outside allowed bounds")
    return manifest, manifest_bytes


def verify_package(package: Path) -> tuple[dict, bytes]:
    payload = read_regular(package, max_bytes=MAX_PACKAGE_BYTES, label="app package")
    with zipfile.ZipFile(package, "r") as archive:
        infos = archive.infolist()
        names = [info.filename for info in infos]
        if len(names) != len(set(names)) or PACKAGE_MANIFEST_NAME not in names:
            raise AppPackageError("package entries are duplicated or manifest is missing")
        for info in infos:
            safe_relative(info.filename, "package path")
            mode = (info.external_attr >> 16) & 0o170000
            if info.is_dir() or mode == stat.S_IFLNK:
                raise AppPackageError("package contains unsafe entry type")
        manifest_bytes = archive.read(PACKAGE_MANIFEST_NAME)
        try:
            manifest = json.loads(manifest_bytes.decode("utf-8"))
        except (UnicodeError, json.JSONDecodeError) as exc:
            raise AppPackageError("package manifest is invalid JSON") from exc
        if manifest_bytes != canonical_json_bytes(manifest):
            raise AppPackageError("package manifest is not canonical deterministic JSON")
        if manifest.get("$schema") != PACKAGE_SCHEMA or manifest.get("status") != "candidate":
            raise AppPackageError("package manifest schema/status is invalid")
        component = manifest.get("component")
        if not isinstance(component, dict):
            raise AppPackageError("package component identity is missing")
        app_id = component.get("id")
        if not isinstance(app_id, str) or not APP_ID_RE.fullmatch(app_id):
            raise AppPackageError("package component id is invalid")
        if component.get("releaseMode") != "component-slot":
            raise AppPackageError("package component must use component-slot")
        if manifest.get("source_commit") is None or not SHA40_RE.fullmatch(str(manifest["source_commit"])):
            raise AppPackageError("package source commit is invalid")
        if manifest.get("entrypoint") != f"system/apps/{app_id}/src/runtime.mjs":
            raise AppPackageError("package entrypoint is not canonical")
        for key, expected in {
            "self_contained_source_graph": True,
            "remote_runtime_dependencies": False,
            "activation_allowed": False,
            "signature_required_before_activation": True,
            "native_adapters_packaged": False,
            "composition_packaged": False,
        }.items():
            if manifest.get(key) is not expected:
                raise AppPackageError(f"package safety field is invalid: {key}")

        records = manifest.get("files")
        if not isinstance(records, list) or not records or len(records) > MAX_FILES:
            raise AppPackageError("package file records are invalid")
        expected_names = {PACKAGE_MANIFEST_NAME}
        total = 0
        seen = set()
        for record in records:
            if not isinstance(record, dict) or set(record) != {"path", "sha256", "size"}:
                raise AppPackageError("package file record is malformed")
            path = safe_relative(str(record["path"]), "package file path").as_posix()
            if not path.startswith(f"system/apps/{app_id}/"):
                raise AppPackageError("package file crossed app ownership")
            if path in seen:
                raise AppPackageError("package file path is duplicated")
            seen.add(path)
            size = record["size"]
            if not isinstance(size, int) or isinstance(size, bool) or size <= 0 or size > MAX_FILE_BYTES:
                raise AppPackageError("package file size is invalid")
            if not SHA256_RE.fullmatch(str(record["sha256"])):
                raise AppPackageError("package file SHA-256 is invalid")
            body = archive.read(path)
            if len(body) != size or sha256_bytes(body) != record["sha256"]:
                raise AppPackageError(f"package file integrity mismatch: {path}")
            total += size
            if total > MAX_TOTAL_BYTES:
                raise AppPackageError("package total size exceeds bound")
            expected_names.add(path)
        if set(names) != expected_names:
            raise AppPackageError("package archive file set does not match manifest")
        if manifest["entrypoint"] not in seen:
            raise AppPackageError("package entrypoint is not bound by manifest")
        ai_path = f"system/apps/{app_id}/ai/manifest.json"
        if ai_path not in seen:
            raise AppPackageError("package AI manifest is missing")
        try:
            ai_manifest = json.loads(archive.read(ai_path).decode("utf-8"))
        except (UnicodeError, json.JSONDecodeError) as exc:
            raise AppPackageError("package AI manifest is invalid UTF-8 JSON") from exc
        if not isinstance(ai_manifest, dict):
            raise AppPackageError("package AI manifest must be a JSON object")
        ai_manifest = validate_app_intelligence_manifest(
            ai_manifest,
            {"id": app_id, "version": component.get("version")},
        )
        action_path = f"system/apps/{app_id}/actions/manifest.json"
        if action_path not in seen:
            raise AppPackageError("package Application Action manifest is missing")
        try:
            action_manifest = json.loads(archive.read(action_path).decode("utf-8"))
        except (UnicodeError, json.JSONDecodeError) as exc:
            raise AppPackageError(
                "package Application Action manifest is invalid UTF-8 JSON"
            ) from exc
        if not isinstance(action_manifest, dict):
            raise AppPackageError("package Application Action manifest must be a JSON object")
        action_manifest = validate_application_action_manifest(
            action_manifest,
            {"id": app_id, "version": component.get("version")},
            ai_manifest,
        )
        provider_path = f"system/apps/{app_id}/actions/providers/manifest.json"
        if provider_path not in seen:
            raise AppPackageError("package Application Action provider manifest is missing")
        try:
            provider_manifest = json.loads(archive.read(provider_path).decode("utf-8"))
        except (UnicodeError, json.JSONDecodeError) as exc:
            raise AppPackageError(
                "package Application Action provider manifest is invalid UTF-8 JSON"
            ) from exc
        if not isinstance(provider_manifest, dict):
            raise AppPackageError("package Application Action provider manifest must be a JSON object")
        validate_application_action_provider_manifest(
            provider_manifest,
            {"id": app_id, "version": component.get("version")},
            action_manifest,
            lambda module: archive.read(f"system/apps/{app_id}/{module}"),
        )
    return manifest, payload


def render_release_v2(package: Path, compatibility_path: Path) -> tuple[dict, bytes]:
    manifest, package_bytes = verify_package(package)
    app = manifest["component"]
    compatibility = validate_compatibility(
        load_json(compatibility_path, max_bytes=MAX_COMPATIBILITY_BYTES, label="compatibility descriptor"),
        {
            "id": app["id"],
            "version": app["version"],
        },
    )
    compatibility_bytes = canonical_json_bytes(compatibility)
    if len(compatibility_bytes) > MAX_COMPATIBILITY_BYTES:
        raise AppPackageError("compatibility descriptor exceeds size bound")

    with zipfile.ZipFile(package, "r") as archive:
        manifest_bytes = archive.read(PACKAGE_MANIFEST_NAME)

    release = {
        "$schema": RELEASE_SCHEMA_V2,
        "source_repository": SOURCE_REPOSITORY,
        "source_commit": manifest["source_commit"],
        "created_from_ci_recipe": CREATED_FROM_RECIPE,
        "component": {
            "id": app["id"],
            "version": app["version"],
            "release_mode": app["releaseMode"],
            "package_schema": PACKAGE_SCHEMA,
        },
        "package": {
            "name": package.name,
            "sha256": sha256_bytes(package_bytes),
            "size": len(package_bytes),
            "manifest_sha256": sha256_bytes(manifest_bytes),
        },
        "activation": {
            "direct_activation_allowed": False,
            "pending_health_required": True,
        },
        "compatibility": {
            "name": f"{app['id']}.compatibility.json",
            "schema": COMPATIBILITY_SCHEMA,
            "sha256": sha256_bytes(compatibility_bytes),
            "size": len(compatibility_bytes),
        },
    }
    return release, compatibility_bytes


def write_release_v2(package: Path, compatibility_source: Path, output_dir: Path) -> tuple[Path, Path]:
    release, compatibility_bytes = render_release_v2(package, compatibility_source)
    output_dir.mkdir(parents=True, exist_ok=True)
    app_id = release["component"]["id"]
    release_path = output_dir / f"{app_id}.release.json"
    compatibility_path = output_dir / f"{app_id}.compatibility.json"
    for path in (release_path, compatibility_path):
        if path.exists():
            raise AppPackageError(f"refusing to overwrite output: {path}")
    compatibility_path.write_bytes(compatibility_bytes)
    release_path.write_bytes(canonical_json_bytes(release))
    return release_path, compatibility_path


def command_build(args: argparse.Namespace) -> int:
    app_root = Path(args.app_root)
    package_out = Path(args.package_out)
    manifest, _ = build_package(app_root, args.source_commit, package_out)
    release_path, compatibility_path = write_release_v2(
        package_out,
        Path(args.compatibility),
        Path(args.release_dir),
    )
    print("ORDAX_APP_PACKAGE_BUILD=PASS")
    print(f"APP_ID={manifest['component']['id']}")
    print(f"APP_VERSION={manifest['component']['version']}")
    print(f"PACKAGE={package_out}")
    print(f"RELEASE={release_path}")
    print(f"COMPATIBILITY={compatibility_path}")
    print("SIGNING_AUTHORITY=NO")
    print("INSTALL_AUTHORITY=NO")
    return 0


def command_verify(args: argparse.Namespace) -> int:
    manifest, _ = verify_package(Path(args.package))
    release_path = Path(args.release)
    compatibility_path = Path(args.compatibility)
    release = load_json(release_path, max_bytes=256 * 1024, label="release descriptor")
    expected, compatibility_bytes = render_release_v2(Path(args.package), compatibility_path)
    if release != expected or release_path.read_bytes() != canonical_json_bytes(release):
        raise AppPackageError("release descriptor does not match deterministic package identity")
    if compatibility_path.read_bytes() != compatibility_bytes:
        raise AppPackageError("compatibility sidecar is not canonical deterministic JSON")
    print("ORDAX_APP_PACKAGE_VERIFY=PASS")
    print(f"APP_ID={manifest['component']['id']}")
    print("SIGNING_AUTHORITY=NO")
    print("INSTALL_AUTHORITY=NO")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    build = sub.add_parser("build")
    build.add_argument("--app-root", required=True)
    build.add_argument("--source-commit", required=True)
    build.add_argument("--compatibility", required=True)
    build.add_argument("--package-out", required=True)
    build.add_argument("--release-dir", required=True)

    verify = sub.add_parser("verify")
    verify.add_argument("--package", required=True)
    verify.add_argument("--release", required=True)
    verify.add_argument("--compatibility", required=True)

    args = parser.parse_args(argv)
    try:
        return command_build(args) if args.command == "build" else command_verify(args)
    except (AppPackageError, OSError, zipfile.BadZipFile, ValueError) as exc:
        print(f"ORDAX_APP_PACKAGE_ERROR={exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
