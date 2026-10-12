#!/usr/bin/env python3
"""Fail-closed OS->Apps Internet Gate A handoff without any dual executable source.

This audit does not copy source, install an app, or grant release authority.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import sys

APP_OWNER = "ordaxsystems/ordax-apps"
PENDING = {
    "state": "platform-source-removed-app-source-pending",
    "expected_repository": APP_OWNER,
    "platform_source_absence_required": True,
    "distribution_activation_allowed": False,
}
REQUIRED_HOST = (
    "system/surface/runtime/ordax_browser_host.py",
    "system/adapters/native/browser-session.mjs",
    "system/adapters/web/browser-session.mjs",
)


class InternetCrossRepoGateError(ValueError):
    pass


def verify(report: dict, policy: dict, pinned_source_paths: set[str]) -> str:
    if report.get("schema") != "ordax.internet-externalization-preflight/1":
        raise InternetCrossRepoGateError("source audit schema mismatch")
    if (report.get("source_cutover_allowed") is not False or
            report.get("distribution_activation_allowed") is not False):
        raise InternetCrossRepoGateError("source audit claimed premature delivery authority")
    drift = report.get("current_platform_source")
    gate = report.get("gate_a_platform_consumers")
    if not isinstance(drift, dict) or not isinstance(gate, dict):
        raise InternetCrossRepoGateError("current platform tree and Gate A inventory both required")
    if (gate.get("schema") != "ordax.internet-gate-a-platform-consumers/1" or
            gate.get("platform_commit") != drift.get("current_platform_commit")):
        raise InternetCrossRepoGateError("cross-commit Gate A evidence cannot be trusted")
    if not isinstance(pinned_source_paths, set) or len(pinned_source_paths) != 13:
        raise InternetCrossRepoGateError("expected 13 pinned Internet product files")
    if (report.get("source_file_count") != len(pinned_source_paths) or
            report.get("source_snapshot_ready") is not True):
        raise InternetCrossRepoGateError("pinned snapshot evidence incomplete")
    if policy.get("$schema") != "prototype-ordax.runtime-component-package-policy/1":
        raise InternetCrossRepoGateError("OS executable policy schema invalid")
    if any(not isinstance(policy.get(key), list) for key in (
        "native_loopback_broker_supported_components",
        "native_loopback_broker_health_mutation_components",
        "runtime_health_bridge_supported_components",
        "supported_components",
    )):
        raise InternetCrossRepoGateError("OS runtime scope missing")
    pending = policy.get("prelaunch_remove_first_pending")
    if not isinstance(pending, dict):
        raise InternetCrossRepoGateError("missing canonical remove-first Gate A map")
    if policy.get("canonical_package_source_repository_by_component", {}).get("internet") is not None:
        raise InternetCrossRepoGateError("Internet claimed external executable source before Gate B")

    if (drift.get("snapshot_current") is True and drift.get("current_file_count") == 13 and
            drift.get("changed") == [] and drift.get("added") == [] and drift.get("deleted") == [] and
            set(gate.get("owned_source_paths", [])) == pinned_source_paths and
            gate.get("host_boundary_intact") is True and
            "internet" not in pending):
        return "platform-is-sole-current-owner"

    if (drift.get("snapshot_current") is False and drift.get("current_file_count") == 0 and
            drift.get("changed") == [] and drift.get("added") == [] and
            set(drift.get("deleted", [])) == pinned_source_paths and
            gate.get("owned_source_paths") == [] and
            gate.get("consumer_imports") == [] and
            gate.get("literal_source_path_references") == [] and
            gate.get("ignored_source_symlinks") == [] and
            gate.get("absence_preflight_ready") is True and
            gate.get("host_boundary_intact") is True and
            set(gate.get("retained_host_paths", [])) == set(REQUIRED_HOST) and
            pending.get("internet") == PENDING and
            all("internet" not in policy[key] for key in (
                "native_loopback_broker_supported_components",
                "native_loopback_broker_health_mutation_components",
                "runtime_health_bridge_supported_components",
                "supported_components",
            ))):
        return "platform-source-absent-await-gate-b"

    raise InternetCrossRepoGateError("partial Internet removal, foreign source, drift or premature authority")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", type=Path, required=True)
    ap.add_argument("--platform-root", type=Path, required=True)
    ns = ap.parse_args(argv)
    try:
        report = json.loads(ns.report.read_text(encoding="utf-8"))
        policy = json.loads((ns.platform_root / "docs/contracts/runtime-component-package.json").read_text(encoding="utf-8"))
        snapshot = json.loads((Path(__file__).resolve().parents[1] / "migrations/internet.source-snapshot.json").read_text(encoding="utf-8"))
        actual = verify(report, policy, {row["path"] for row in snapshot["files"]})
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
        print("INTERNET_CROSS_REPO_GATE=BLOCKED\n" + str(exc), file=sys.stderr)
        return 1
    print("INTERNET_CROSS_REPO_GATE=PASS")
    print("INTERNET_OWNER_PHASE=" + actual)
    print("INTERNET_DISTRIBUTION_ACTIVATION=BLOCKED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
