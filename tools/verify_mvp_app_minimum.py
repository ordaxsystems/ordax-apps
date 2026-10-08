#!/usr/bin/env python3
"""MVP minimum-entry matrix derived from the canonical workspace and Store inventory.

No new app list, Store catalog, trust record, grants or installation authority.
A catalog INPUT is an unsigned build candidate; it is not a Store installation.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools" / "app-package"))
from audit_app_readiness import AuditError, audit_workspace, read_json  # noqa: E402
from catalog_inventory import (  # noqa: E402
    CatalogInventoryError,
    discover_catalog_apps,
)

SCHEMA = "ordax.mvp-app-minimum-entry-audit/1"


class MvpMinimumError(ValueError):
    pass


def audit_mvp_minimum(root: Path, minimum_candidates: int = 0) -> dict:
    """Fail closed on an inconsistent Store input, report *all* planned apps."""
    if not isinstance(minimum_candidates, int) or isinstance(minimum_candidates, bool) or minimum_candidates < 0:
        raise MvpMinimumError("minimum candidate count must be nonnegative integer")
    root = root.resolve()
    try:
        inventory = audit_workspace(root)
        eligible = discover_catalog_apps(root / "apps", root / "migrations")
    except (AuditError, CatalogInventoryError) as exc:
        raise MvpMinimumError(str(exc)) from exc

    eligible_by_id = {entry["appId"]: entry for entry in eligible}
    if len(eligible_by_id) != len(eligible):
        raise MvpMinimumError("Store inventory repeated an app id")
    by_id = {entry["app_id"]: entry for entry in inventory["apps"]}
    if not set(eligible_by_id).issubset(by_id):
        raise MvpMinimumError("Store input contains an app outside the canonical workspace")

    expected = set()
    for row in inventory["apps"]:
        if row["source_state"] != "canonical-source" or not row["metadata"]:
            continue
        descriptor = row["metadata"]["compatibility"]
        if descriptor is None:
            continue
        manifest = read_json(root / "apps" / row["app_id"] / "app.json", row["app_id"] + " manifest")
        if manifest["releaseMode"] == "component-slot":
            expected.add(row["app_id"])
    if set(eligible_by_id) != expected:
        missing = sorted(expected - set(eligible_by_id))
        unexpected = sorted(set(eligible_by_id) - expected)
        raise MvpMinimumError(
            f"canonical Store inventory diverged: missing={missing}, unexpected={unexpected}"
        )

    if len(eligible) < minimum_candidates:
        raise MvpMinimumError(
            f"MVP catalog input regression: {len(eligible)} eligible, floor={minimum_candidates}"
        )

    rows = []
    for row in inventory["apps"]:
        app_id = row["app_id"]
        source = row["source_state"]
        blockers = list(row["blockers"])
        if app_id in eligible_by_id:
            status = "unsigned-store-catalog-input"
            if source != "canonical-source" or not row["metadata"]["metadata_verified"]:
                raise MvpMinimumError(f"{app_id}: Store candidate without canonical verified metadata")
            if row["metadata"]["compatibility"] is None:
                raise MvpMinimumError(f"{app_id}: Store candidate without compatibility descriptor")
        elif source == "canonical-source":
            status = "blocked-missing-component-package-boundary"
            if "missing-compatibility-descriptor" not in blockers:
                blockers.append("unsupported-component-delivery")
        elif source == "platform-until-cutover":
            status = "blocked-platform-source-cutover"
        else:
            status = "blocked-no-canonical-source"
        rows.append({
            "app_id": app_id,
            "source_state": source,
            "minimum_entry_status": status,
            "blockers": sorted(set(blockers)),
            "component_version": row["metadata"]["version"] if row["metadata"] else None,
            "production_installable": False,
        })

    return {
        "schema": SCHEMA,
        "authority": "none",
        "source_repository": inventory["repository"],
        "summary": {
            "target_count": len(rows),
            "unsigned_catalog_inputs": len(eligible),
            "blocked": len(rows) - len(eligible),
            "minimum_catalog_input_floor": minimum_candidates,
            "verified_public_store_installations": 0,
            "production_releases_verified": 0,
        },
        "apps": rows,
        "disclaimer": (
            "Inputs are derived only from the existing G0 workspace and canonical "
            "Store catalog inventory. They are NOT signed catalog publications or "
            "verified installed apps. Store UI, lifecycle, trust, production publication "
            "and activation stay with their existing OS owners."
        ),
    }


def markdown(report: dict) -> str:
    lines = [
        "# OrdaX Apps — mínimo comum para entrada no MVP",
        "",
        "| App | Fonte/ownership | Preparação mínima | Bloqueios |",
        "| --- | --- | --- | --- |",
    ]
    for row in report["apps"]:
        lines.append(
            f"| {row['app_id']} | {row['source_state']} | "
            f"{row['minimum_entry_status']} | {', '.join(row['blockers']) or '—'} |"
        )
    summary = report["summary"]
    lines.extend([
        "",
        f"**Alvos:** {summary['target_count']}; "
        f"**entradas não assinadas com pacote canônico:** {summary['unsigned_catalog_inputs']}; "
        f"**bloqueados:** {summary['blocked']}; "
        "**instalações públicas verificadas:** 0.",
        "",
        report["disclaimer"],
        "",
    ])
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--minimum-candidates", type=int, default=0)
    parser.add_argument("--format", choices=("json", "markdown"), default="markdown")
    args = parser.parse_args(argv)
    try:
        report = audit_mvp_minimum(args.root, args.minimum_candidates)
    except (AuditError, MvpMinimumError) as exc:
        print(f"ORDAX_MVP_MINIMUM=FAIL\n{exc}", file=sys.stderr)
        return 1
    print(markdown(report) if args.format == "markdown"
          else json.dumps(report, indent=2, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
