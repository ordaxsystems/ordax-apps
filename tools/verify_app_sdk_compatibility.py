#!/usr/bin/env python3
"""G1: prove declared app requirements exist in the *verified pinned* App SDK.

This module is deliberately offline. The caller (verify_platform_sdk.py) must
verify the pinned SDK bundle digest before passing the bundle to this audit.
App identities, compatibility descriptors and migrations come from the G0
workspace auditor, not a second hand-maintained inventory.
"""
from __future__ import annotations

import re
from pathlib import Path

from audit_app_readiness import AuditError, audit_workspace, builder, read_json

SCHEMA = "ordax.app-sdk-compatibility-audit/1"
SDK_SCHEMA = "ordax.app-sdk-bundle/1"
CONTRACT_SCHEMA = re.compile(r"^([a-z0-9][a-z0-9.-]*)/([1-9][0-9]*)$")


class SdkCompatibilityError(ValueError):
    pass


def published_contracts(bundle: dict) -> dict[str, set[int]]:
    """Index the actual pinned bundle, not an app-specific allowlist."""
    if (
        not isinstance(bundle, dict)
        or bundle.get("$schema") != SDK_SCHEMA
        or bundle.get("compatibility_policy") != "contract-major"
        or bundle.get("authority") != "none"
    ):
        raise SdkCompatibilityError("pinned SDK bundle policy/schema is invalid")
    entries = bundle.get("contracts")
    if not isinstance(entries, list) or not entries:
        raise SdkCompatibilityError("pinned SDK bundle contracts are missing")
    index: dict[str, set[int]] = {}
    for entry in entries:
        if not isinstance(entry, dict) or not isinstance(entry.get("schema"), str):
            raise SdkCompatibilityError("pinned SDK contains an invalid contract entry")
        match = CONTRACT_SCHEMA.fullmatch(entry["schema"])
        if match is None:
            raise SdkCompatibilityError(f"invalid SDK contract schema: {entry['schema']}")
        contract_id, major_text = match.groups()
        major = int(major_text)
        if major > 10_000:
            raise SdkCompatibilityError(f"SDK contract major exceeds supported bound: {contract_id}")
        index.setdefault(contract_id, set()).add(major)
    return index


def audit_compatibility(root: Path, bundle: dict, sdk_commit: str, sdk_repository: str) -> dict:
    """Check required/optional ranges without claiming host or lifecycle execution."""
    if not builder.SHA40_RE.fullmatch(sdk_commit):
        raise SdkCompatibilityError("SDK evidence requires an exact 40-hex pinned commit")
    if not isinstance(sdk_repository, str) or not sdk_repository or "/" not in sdk_repository:
        raise SdkCompatibilityError("SDK evidence requires the canonical repository from the lock")
    index = published_contracts(bundle)
    try:
        workspace = audit_workspace(root)
    except AuditError as exc:
        raise SdkCompatibilityError(f"canonical workspace metadata failed: {exc}") from exc

    rows = []
    verified = 0
    optional_gaps = 0
    for app in workspace["apps"]:
        app_id = app["app_id"]
        metadata = app["metadata"]
        if app["source_state"] != "canonical-source":
            rows.append({
                "app_id": app_id,
                "source_state": app["source_state"],
                "status": "not-assessed-no-canonical-source",
                "resolved_requirements": [],
                "unresolved_optional": [],
            })
            continue
        if not metadata or metadata["compatibility"] is None:
            rows.append({
                "app_id": app_id,
                "source_state": app["source_state"],
                "status": "not-assessed-no-compatibility",
                "resolved_requirements": [],
                "unresolved_optional": [],
            })
            continue

        descriptor = read_json(
            root / metadata["compatibility"],
            f"{app_id} canonical compatibility",
            64 * 1024,
        )
        try:
            manifest = read_json(root / "apps" / app_id / "app.json", f"{app_id} app.json")
            builder.validate_compatibility(descriptor, manifest)
        except (builder.AppPackageError, OSError, ValueError) as exc:
            raise SdkCompatibilityError(f"{app_id}: invalid compatibility descriptor: {exc}") from exc

        resolved = []
        unresolved_optional = []
        for requirement in descriptor["requires"]:
            contract_id = requirement["id"]
            matching = sorted(
                major for major in index.get(contract_id, set())
                if requirement["minMajor"] <= major <= requirement["maxMajor"]
            )
            if not matching:
                label = (
                    f"{contract_id}/{requirement['minMajor']}"
                    if requirement["minMajor"] == requirement["maxMajor"]
                    else f"{contract_id}/{requirement['minMajor']}..{requirement['maxMajor']}"
                )
                if requirement["optional"]:
                    unresolved_optional.append(label)
                    optional_gaps += 1
                    continue
                raise SdkCompatibilityError(
                    f"{app_id}: required SDK contract is not published in pinned bundle: {label}"
                )
            resolved.append({
                "id": contract_id,
                "major": matching[-1],
                "optional": requirement["optional"],
            })

        rows.append({
            "app_id": app_id,
            "source_state": app["source_state"],
            "status": "required-contracts-published",
            "resolved_requirements": resolved,
            "unresolved_optional": unresolved_optional,
        })
        verified += 1

    return {
        "schema": SCHEMA,
        "authority": "none",
        "repository": workspace["repository"],
        "sdk": {
            "repository": sdk_repository,
            "commit": sdk_commit,
            "bundle_version": bundle["bundle_version"],
            "compatibility_policy": "contract-major",
        },
        "summary": {
            "target_count": len(rows),
            "required_contracts_verified_apps": verified,
            "not_assessed_apps": len(rows) - verified,
            "unresolved_optional_requirements": optional_gaps,
            "runtime_executions_verified": 0,
            "lifecycle_install_rollback_verified": 0,
            "production_releases_verified": 0,
        },
        "apps": rows,
        "disclaimer": (
            "Published SDK contract majors are static availability evidence only; "
            "they do not prove host implementation, runtime behavior, grants, "
            "signing, install, rollback, offline reinstall or production activation."
        ),
    }


def render_markdown(report: dict) -> str:
    lines = [
        "# OrdaX Apps — G1 pinned SDK contract compatibility",
        "",
        f"SDK: {report['sdk']['bundle_version']} at {report['sdk']['commit']}.",
        "",
        "| App | Fonte | Contratos SDK | Requisitos opcionais não publicados |",
        "| --- | --- | --- | --- |",
    ]
    for row in report["apps"]:
        resolved = ", ".join(
            f"{entry['id']}/{entry['major']}{' (opcional)' if entry['optional'] else ''}"
            for entry in row["resolved_requirements"]
        ) or "—"
        optional = ", ".join(row["unresolved_optional"]) or "—"
        lines.append(
            f"| {row['app_id']} | {row['source_state']} | {row['status']}: {resolved} | {optional} |"
        )
    summary = report["summary"]
    lines.extend([
        "",
        f"**Verificados:** {summary['required_contracts_verified_apps']}/{summary['target_count']}; "
        f"**não avaliados:** {summary['not_assessed_apps']}; "
        f"**requisitos opcionais ausentes:** {summary['unresolved_optional_requirements']}.",
        "",
        report["disclaimer"],
        "",
    ])
    return "\n".join(lines)
