#!/usr/bin/env python3
"""Audit the OrdaX Apps -> OrdaX OS repository-owner handoff.

Read-only; no GitHub redirects, release claims, package permission changes,
Git source rewriting or automatic physical transfers.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
OLD_OWNER = "washingtonmsdj"
NEW_OWNER = "ordaxsystems"
PLATFORM_NAME = "prototipo-ordax-os"
CANONICAL_APPS = "ordaxsystems/ordax-apps"
IMMUTABLE_PLATFORM_ID = "1371063347"
SOURCE_PATHS = ("tools/", "apps/", ".github/workflows/", "sdk/")
ACTIVE_DOCS = frozenset({
    "docs/ARCHITECTURE.md",
    "docs/PROJECTS-EXTERNALIZATION.md",
    "docs/FILES-EXTERNALIZATION.md",
})
ACTIVE_CONFIGS = frozenset({
    "platform-sdk.lock.json",
    "ordax-apps.workspace.json",
})


def validate(workspace: dict, lock: dict) -> dict:
    if workspace.get("$schema") != "ordax.apps-workspace/1":
        raise ValueError("unexpected apps workspace schema")
    if workspace.get("authority") != "none":
        raise ValueError("workspace cannot grant authority")
    if workspace.get("role") != "first-party-app-source":
        raise ValueError("apps ownership role drift")
    migration = workspace.get("repository_migration")
    if not isinstance(migration, dict):
        raise ValueError("missing namespace transfer policy")
    expected = {
        "canonical_repository": CANONICAL_APPS,
        "target_platform_repository": f"{NEW_OWNER}/{PLATFORM_NAME}",
        "current_runtime_repository": "ordaxsystems/ordax-runtime",
        "target_runtime_repository": "ordaxsystems/ordax-runtime",
        "current_control_plane_repository": "ordaxsystems/ordax-control-plane",
        "target_control_plane_repository": "ordaxsystems/ordax-control-plane",
    }
    for field, value in expected.items():
        if migration.get(field) != value:
            raise ValueError(f"namespace migration {field} drifted")
    for field in (
        "redirect_dependency_allowed", "mirror_repository_allowed",
        "dual_authority_allowed", "rename_during_transfer_allowed",
        "provenance_rewrite_allowed",
    ):
        if migration.get(field) is not False:
            raise ValueError(f"unsafe namespace authority policy: {field}")
    if migration.get("transfer_first_then_repoint") is not True:
        raise ValueError("physical GitHub transfer must precede source repoint")
    if migration.get("status") != "cutover-complete":
        raise ValueError("OrdaX Apps own migration state drifted")

    current = migration.get("current_platform_repository")
    if current not in (f"{OLD_OWNER}/{PLATFORM_NAME}", expected["target_platform_repository"]):
        raise ValueError("unrecognized physical platform repository")
    if workspace.get("platform_repository") != current:
        raise ValueError("workspace platform owner differs from migration SSOT")
    if lock.get("$schema") != "ordax.app-sdk-lock/1":
        raise ValueError("invalid platform SDK lock schema")
    if lock.get("repository") != current:
        raise ValueError("platform SDK lock owner differs from workspace SSOT")
    if lock.get("bundle_path") != "sdk/app-sdk-v1/bundle.json":
        raise ValueError("noncanonical platform SDK bundle path")
    if lock.get("bundle_schema") != "ordax.app-sdk-bundle/1" or lock.get("authority") != "none":
        raise ValueError("platform SDK lock authority/schema drift")
    if not re.fullmatch(r"[0-9a-f]{40}", lock.get("commit", "")):
        raise ValueError("platform SDK exact commit is invalid")
    if not re.fullmatch(r"[0-9a-f]{64}", lock.get("sha256", "")):
        raise ValueError("platform SDK exact SHA is invalid")
    return {
        "phase": "pre-transfer" if current.startswith(f"{OLD_OWNER}/") else "post-transfer-source",
        "current_platform": current,
        "target_platform": expected["target_platform_repository"],
        "platform_repository_id": IMMUTABLE_PLATFORM_ID,
        "sdk_commit": lock["commit"],
        "sdk_sha256": lock["sha256"],
    }


def operational_path(path: str) -> bool:
    return (
        path in ACTIVE_DOCS
        or path in ACTIVE_CONFIGS
        or any(path.startswith(prefix) for prefix in SOURCE_PATHS)
    )


def stale_references(root: Path, legacy: str) -> dict:
    grep = subprocess.run(
        ["git", "grep", "--null", "-l", "-I", "-F", legacy, "--"],
        cwd=root, check=False, capture_output=True, timeout=45,
    )
    if grep.returncode not in (0, 1):
        raise RuntimeError("cannot inspect tracked platform references")
    paths = [
        part.decode("utf-8")
        for part in grep.stdout.split(b"\x00")
        if part
    ]
    # No file-wide exemptions: any stale reference in tools, apps or
    # workflows is treated as operational after the physical transfer.
    operational = sorted(path for path in paths if operational_path(path))
    archival = sorted(path for path in paths if not operational_path(path))
    return {"operational_paths": operational, "historical_paths": archival}


def evaluate(root: Path) -> dict:
    workspace = json.loads((root / "ordax-apps.workspace.json").read_text(encoding="utf-8"))
    lock = json.loads((root / "platform-sdk.lock.json").read_text(encoding="utf-8"))
    state = validate(workspace, lock)
    old = f"{OLD_OWNER}/{PLATFORM_NAME}"
    paths = stale_references(root, old)
    # The Apps process cannot attest the OS repo's GitHub ID on its own.
    # Passing in pre-transfer phase NEVER constitutes permission to transfer.
    ready = state["phase"] == "post-transfer-source" and not paths["operational_paths"]
    return {
        "$schema": "ordax.apps-platform-namespace-handoff/1",
        "authority": "none",
        **state,
        "operational_old_owner_files": len(paths["operational_paths"]),
        "historical_old_owner_files": len(paths["historical_paths"]),
        "sample_operational_old_owner_paths": paths["operational_paths"][:15],
        "source_conformance_after_transfer": ready,
        "github_physical_transfer_verified": False,
        "release_signature_verified": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--require-post-transfer-source", action="store_true")
    args = parser.parse_args()
    try:
        report = evaluate(ROOT)
        print(json.dumps(report, indent=2, ensure_ascii=False))
        if args.require_post_transfer_source and not report["source_conformance_after_transfer"]:
            return 1
        return 0
    except (ValueError, KeyError, RuntimeError, OSError, subprocess.SubprocessError) as exc:
        print(f"ORDAX_APPS_PLATFORM_OWNER_HANDOFF=FAIL: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
