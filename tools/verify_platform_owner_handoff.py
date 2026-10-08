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
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
OLD_OWNER = "washingtonmsdj"
NEW_OWNER = "ordaxsystems"
PLATFORM_NAME = "prototipo-ordax-os"
CANONICAL_APPS = "ordaxsystems/ordax-apps"
IMMUTABLE_PLATFORM_ID = "1371063347"
# The workspace migration contract selects exactly one owner at a time.
# The future slug is not authorized until the physical GitHub identity matches.
POST_TRANSFER_PLATFORM_TARGETS = frozenset({
    f"{NEW_OWNER}/{PLATFORM_NAME}",
    f"{NEW_OWNER}/ordax-os",
})
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
    target = migration.get("target_platform_repository")
    if target not in POST_TRANSFER_PLATFORM_TARGETS:
        raise ValueError("unrecognized platform rename destination")
    expected = {
        "canonical_repository": CANONICAL_APPS,
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
    if current not in (f"{OLD_OWNER}/{PLATFORM_NAME}", target):
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
        "target_platform": target,
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



# Exact, historically issued assertions remain evidence; never exempt a
# whole source/workflow file or a checkout URL. Extra references fail closed.
def verified_historical_assertions(root: Path, path: str, old: str) -> bool:
    allowed = {
        "tools/verify_notes_platform_sdk.py": [
            f'if lock["repository"] != "{old}":',
        ],
        "tools/verify_notes_production_trust.py": [
            f'if lock.get("repository") != "{old}":',
        ],
        "tools/verify_notes_externalization.py": [
            f'if source_snapshot.get("repository") != "{old}":',
            f'"repository": "{old}",',
        ],
        ".github/workflows/foundation.yml": [
            f'assert repository == "{old}"',
        ],
        ".github/workflows/store-catalog-candidate.yml": [
            f'assert repository == "{old}"',
        ],
        ".github/workflows/notes-unsigned-candidate.yml": [
            f"'repository': '{old}',",
        ],
    }
    expected = allowed.get(path)
    if expected is None:
        return False
    try:
        lines = (root / path).read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError):
        return False
    actual = [line.strip() for line in lines if old in line]
    return actual == expected


def live_externalization_source(root: Path, path: str) -> bool:
    """Live platform-owned sources in migration plans are operational SSOT."""
    if not (path.startswith("migrations/") and path.endswith(".externalization.json")):
        return False
    data = json.loads((root / path).read_text(encoding="utf-8"))
    return (
        data.get("source_of_truth_state") == "platform-until-cutover"
        and data.get("source_cutover_allowed") is False
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
    operational = sorted(
        path for path in paths
        if (operational_path(path) or live_externalization_source(root, path))
        and not verified_historical_assertions(root, path, legacy)
    )
    archival = sorted(
        path for path in paths
        if not (operational_path(path) or live_externalization_source(root, path))
        or verified_historical_assertions(root, path, legacy)
    )
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



def verify_physical_owner(state: dict) -> bool:
    """Verify immutable GitHub identity, never infer authority from redirects."""
    target = state.get("target_platform")
    if target not in POST_TRANSFER_PLATFORM_TARGETS:
        raise ValueError("invalid physical platform destination")
    if state.get("source_conformance_after_transfer") is not True:
        raise ValueError("source contracts must be post-transfer before physical verification")
    if state.get("current_platform") != target or state.get("platform_repository_id") != IMMUTABLE_PLATFORM_ID:
        raise ValueError("source owner or immutable repository ID drifted")
    request = urllib.request.Request(
        f"https://api.github.com/repos/{target}",
        headers={
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "ordax-apps-platform-owner-handoff",
        },
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        if response.status != 200:
            raise ValueError("canonical GitHub repository metadata is unavailable")
        payload = response.read(1024 * 1024 + 1)
    if len(payload) > 1024 * 1024:
        raise ValueError("canonical GitHub metadata exceeds size limit")
    data = json.loads(payload)
    if not isinstance(data, dict):
        raise ValueError("canonical GitHub metadata is not an object")
    if data.get("id") != int(IMMUTABLE_PLATFORM_ID) or data.get("full_name") != target:
        raise ValueError("GitHub owner or immutable repository ID mismatch")
    if data.get("archived") is not False or data.get("default_branch") != "main":
        raise ValueError("canonical GitHub repository is archived or its default branch drifted")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--require-post-transfer-source", action="store_true")
    parser.add_argument("--require-physical-owner", action="store_true")
    args = parser.parse_args()
    try:
        report = evaluate(ROOT)
        if args.require_post_transfer_source and not report["source_conformance_after_transfer"]:
            print(json.dumps(report, indent=2, ensure_ascii=False))
            return 1
        if args.require_physical_owner:
            report["github_physical_transfer_verified"] = verify_physical_owner(report)
        print(json.dumps(report, indent=2, ensure_ascii=False))
        return 0
    except (ValueError, KeyError, RuntimeError, OSError, subprocess.SubprocessError, urllib.error.URLError) as exc:
        print(f"ORDAX_APPS_PLATFORM_OWNER_HANDOFF=FAIL: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
