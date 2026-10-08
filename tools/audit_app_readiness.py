#!/usr/bin/env python3
"""Read-only G0 audit: canonical app source, metadata and known distribution gates.

Never signs, installs, publishes or activates components. Invalid metadata or
duplicate source ownership fails closed; planned apps and gates are reported.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUILDER = ROOT / "tools" / "app-package" / "build.py"
REPOSITORY = "ordaxsystems/ordax-apps"
SCHEMA = "ordax.app-readiness-audit/1"
BOOTSTRAP = frozenset({"files", "internet"})

spec = importlib.util.spec_from_file_location("ordax_readiness_builder", BUILDER)
builder = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(builder)


class AuditError(RuntimeError):
    pass


def read_json(path: Path, label: str, max_bytes: int = 256 * 1024) -> dict:
    try:
        return builder.load_json(path, max_bytes=max_bytes, label=label)
    except (builder.AppPackageError, OSError, ValueError) as exc:
        raise AuditError(f"{label}: {exc}") from exc


def read_migration(root: Path, app_id: str) -> dict | None:
    path = root / "migrations" / f"{app_id}.externalization.json"
    if not path.exists():
        return None
    value = read_json(path, f"{app_id} migration")
    if value.get("app_id") != app_id:
        raise AuditError(f"{app_id}: migration identity mismatch")
    return value


def compatibility_path(root: Path, app_id: str) -> Path | None:
    paths = [
        root / "apps" / app_id / "compatibility.json",
        root / "migrations" / f"{app_id}.compatibility.json",
    ]
    present = [p for p in paths if p.exists()]
    if len(present) > 1:
        raise AuditError(f"{app_id}: duplicate compatibility sources")
    if not present:
        return None
    if present[0].is_symlink() or not present[0].is_file():
        raise AuditError(f"{app_id}: compatibility must be a regular file")
    return present[0]


def validate_metadata(root: Path, app_id: str) -> dict:
    app_root = root / "apps" / app_id
    if app_root.is_symlink() or not app_root.is_dir():
        raise AuditError(f"{app_id}: app root must be a real directory")
    try:
        app = builder.validate_app_manifest(
            read_json(app_root / "app.json", f"{app_id} app.json", 64 * 1024)
        )
        if app["id"] != app_id or app["owner"] != REPOSITORY:
            raise AuditError(f"{app_id}: app source identity/owner mismatch")
        ai = builder.validate_app_intelligence_manifest(
            read_json(app_root / "ai" / "manifest.json", f"{app_id} ai/manifest.json"), app
        )
        actions = builder.validate_application_action_manifest(
            read_json(app_root / "actions" / "manifest.json", f"{app_id} actions/manifest.json"),
            app, ai,
        )
        builder.validate_application_action_provider_manifest(
            read_json(
                app_root / "actions" / "providers" / "manifest.json",
                f"{app_id} actions/providers/manifest.json",
            ),
            app,
            actions,
            lambda module: builder.read_regular(
                app_root / builder.safe_relative(module, "provider module"),
                max_bytes=builder.MAX_FILE_BYTES,
                label=f"{app_id}/{module}",
            ),
        )
        compatibility = compatibility_path(root, app_id)
        if compatibility is not None:
            builder.validate_compatibility(
                read_json(compatibility, f"{app_id} compatibility", 64 * 1024), app
            )
    except (builder.AppPackageError, OSError, ValueError) as exc:
        raise AuditError(f"{app_id}: invalid canonical metadata: {exc}") from exc

    return {
        "version": app["version"],
        "compatibility": compatibility.relative_to(root).as_posix() if compatibility else None,
        "ai_manifest": True,
        "action_manifest": True,
        "provider_manifest": True,
        "presentation_manifest": (app_root / "presentation" / "manifest.json").is_file(),
        "file_associations": (app_root / "associations" / "manifest.json").is_file(),
        "metadata_verified": compatibility is not None,
    }


def audit_workspace(root: Path = ROOT) -> dict:
    """Inventory and metadata proof only; no release/runtime proof."""
    root = root.resolve()
    workspace = read_json(root / "ordax-apps.workspace.json", "workspace")
    if (
        workspace.get("role") != "first-party-app-source"
        or workspace.get("authority") != "none"
        or workspace.get("source_of_truth_policy") != "single-repository-per-app"
    ):
        raise AuditError("workspace ownership/authority policy is invalid")
    targets = workspace.get("first_party_app_targets")
    structural = workspace.get("structural_surfaces_owned_by_platform")
    if (
        not isinstance(targets, list) or not targets
        or any(not isinstance(v, str) or not builder.APP_ID_RE.fullmatch(v) for v in targets)
        or len(set(targets)) != len(targets)
    ):
        raise AuditError("workspace app targets are invalid or duplicated")
    if (
        not isinstance(structural, list)
        or any(not isinstance(v, str) for v in structural)
        or len(set(structural)) != len(structural)
        or set(targets) & set(structural)
    ):
        raise AuditError("structural surfaces cannot be first-party app targets")

    apps_root = root / "apps"
    if not apps_root.is_dir() or apps_root.is_symlink():
        raise AuditError("apps/ must be a real directory")
    for directory in apps_root.iterdir():
        if directory.is_symlink():
            raise AuditError(f"apps/: symlink forbidden: {directory.name}")
        if directory.is_dir() and (directory / "app.json").exists() and directory.name not in targets:
            raise AuditError(f"unlisted canonical app source: {directory.name}")

    rows = []
    for app_id in targets:
        manifest = apps_root / app_id / "app.json"
        migration = read_migration(root, app_id)
        blockers = []
        metadata = None
        if manifest.exists():
            if migration and migration.get("source_repository_current") not in (None, REPOSITORY):
                raise AuditError(f"{app_id}: platform owns source; duplicate app source forbidden")
            if migration and migration.get("source_path_current") not in (None, f"apps/{app_id}"):
                raise AuditError(f"{app_id}: migration source path contradicts app source")
            metadata = validate_metadata(root, app_id)
            source_state = "canonical-source"
            if not metadata["metadata_verified"]:
                blockers.append("missing-compatibility-descriptor")
        else:
            if (apps_root / app_id).is_dir():
                source_state = "planned-no-manifest"
            elif migration and migration.get("source_repository_current") not in (None, REPOSITORY):
                source_state = "platform-until-cutover"
            elif app_id in BOOTSTRAP:
                source_state = "bootstrap-candidate"
            else:
                source_state = "planned-no-source"
            blockers.append("no-canonical-app-manifest")
            if migration and migration.get("source_cutover_allowed") is False:
                blockers.append("source-cutover-not-authorized")
        if migration:
            if migration.get("distribution_activation_allowed") is False:
                blockers.append("production-activation-not-authorized")
            if migration.get("cutover_scope") == "distribution" and migration.get("cutover_allowed") is False:
                blockers.append("distribution-cutover-not-authorized")
        rows.append({
            "app_id": app_id,
            "source_state": source_state,
            "metadata": metadata,
            "blockers": sorted(set(blockers)),
            "release_evidence": {
                "package_build": "not-assessed",
                "install_rollback": "not-assessed",
                "production_activation": (
                    "blocked-by-known-gate"
                    if "production-activation-not-authorized" in blockers
                    or "distribution-cutover-not-authorized" in blockers
                    else "not-assessed"
                ),
            },
        })
    sources = sum(r["source_state"] == "canonical-source" for r in rows)
    verified = sum(bool(r["metadata"] and r["metadata"]["metadata_verified"]) for r in rows)
    return {
        "schema": SCHEMA,
        "authority": "none",
        "repository": REPOSITORY,
        "summary": {
            "target_count": len(rows),
            "canonical_source_count": sources,
            "metadata_verified_count": verified,
            "not_yet_canonical_count": len(rows) - sources,
            "production_releases_verified": 0,
        },
        "apps": rows,
        "disclaimer": (
            "Metadata validation does not prove runtime, package, signing, publication, "
            "install, rollback, offline reinstall or production activation."
        ),
    }


def render_markdown(report: dict) -> str:
    lines = [
        "# OrdaX Apps — auditoria G0 de prontidão",
        "",
        "> Inventário gerado do workspace e manifests; não autoriza distribuição.",
        "",
        "| App | Fonte | Metadados | Bloqueios conhecidos | Release |",
        "| --- | --- | --- | --- | --- |",
    ]
    for row in report["apps"]:
        status = "validado" if row["metadata"] and row["metadata"]["metadata_verified"] else "pendente"
        blockers = ", ".join(row["blockers"]) or "nenhum gate conhecido nesta auditoria"
        release = row["release_evidence"]["production_activation"]
        lines.append(
            f"| §{row['app_id']}§ | {row['source_state']} | {status} | {blockers} | {release} |"
        )
    summary = report["summary"]
    lines.extend([
        "",
        f"**Alvos:** {summary['target_count']}; **source canônico:** "
        f"{summary['canonical_source_count']}; **metadados validados:** "
        f"{summary['metadata_verified_count']}.",
        "",
        report["disclaimer"],
        "",
    ])
    return "\n".join(lines).replace("§", chr(96))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--format", choices=("json", "markdown"), default="json")
    args = parser.parse_args(argv)
    try:
        report = audit_workspace(args.root)
    except AuditError as exc:
        print(f"ORDAX_APP_READINESS=FAIL\n{exc}", file=sys.stderr)
        return 1
    print(render_markdown(report) if args.format == "markdown" else
          json.dumps(report, indent=2, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
