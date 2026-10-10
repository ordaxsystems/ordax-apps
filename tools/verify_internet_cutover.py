#!/usr/bin/env python3
"""Read-only Internet Gate A preflight using Git as the source of truth.

A pinned snapshot is evidence, never an external app package. The verifier
cannot copy source, grant browser privileges, sign, install, or permit cutover.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLAN_FILE = "migrations/internet.externalization.json"
SCHEMA = "ordax.internet-cutover-preflight/1"
SOURCE_REPO = "ordaxsystems/ordax-os"
TARGET_REPO = "ordaxsystems/ordax-apps"
SOURCE_DIR = "system/apps/internet/"
TRANSLATION = "system/services/i18n/catalog/internet.mjs"
SHA40 = re.compile(r"[0-9a-f]{40}\Z")
SHA256 = re.compile(r"[0-9a-f]{64}\Z")


class InternetCutoverError(RuntimeError):
    pass


def json_file(path: Path) -> dict:
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 256 * 1024:
        raise InternetCutoverError(f"missing, symlinked or oversized JSON: {path}")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, ValueError) as exc:
        raise InternetCutoverError(f"unreadable JSON: {path}") from exc
    if not isinstance(value, dict):
        raise InternetCutoverError(f"JSON object required: {path}")
    return value


def source_path(value: str) -> str:
    if (
        not isinstance(value, str)
        or "\\" in value
        or "\0" in value
        or value.startswith("/")
        or any(part in {"", ".", ".."} for part in value.split("/"))
        or not (value.startswith(SOURCE_DIR) or value == TRANSLATION)
        or not value.endswith((".mjs", ".css"))
    ):
        raise InternetCutoverError(f"non-canonical or non-app-owned snapshot path: {value!r}")
    return value


def version_tuple(value: str) -> tuple[int, int, int]:
    if not isinstance(value, str) or re.fullmatch(r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", value) is None:
        raise InternetCutoverError("invalid App SDK version")
    return tuple(map(int, value.split(".")))


def git(root: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(root), *args], capture_output=True, text=True,
        encoding="utf-8", check=False,
    )
    if result.returncode != 0:
        raise InternetCutoverError(f"Git source proof unavailable: {' '.join(args)}")
    return result.stdout.strip()


def check_inventory(snapshot: dict, plan: dict) -> list[dict]:
    declared = plan.get("source_snapshot")
    if not isinstance(declared, dict) or declared.get("state") != "captured":
        raise InternetCutoverError("Internet source snapshot has not been pinned")
    if snapshot.get("$schema") != "ordax.internet-source-snapshot/1":
        raise InternetCutoverError("snapshot schema mismatch")
    if snapshot.get("authority") != "none":
        raise InternetCutoverError("snapshot must have no authority")
    if snapshot.get("captured_before_gate_a_removal") is not True:
        raise InternetCutoverError("snapshot must predate source removal")
    if snapshot.get("repository") != SOURCE_REPO or declared.get("repository") != SOURCE_REPO:
        raise InternetCutoverError("source owner drift")
    commit = declared.get("commit")
    if not isinstance(commit, str) or SHA40.fullmatch(commit) is None or snapshot.get("commit") != commit:
        raise InternetCutoverError("snapshot commit mismatch")
    if declared.get("inventory_file") != "migrations/internet.source-snapshot.json":
        raise InternetCutoverError("snapshot inventory location drift")
    rows = snapshot.get("files")
    if not isinstance(rows, list) or not rows or len(rows) > 256:
        raise InternetCutoverError("source inventory is empty or oversized")
    paths = []
    for item in rows:
        if not isinstance(item, dict) or set(item) != {"path", "blob_sha", "size"}:
            raise InternetCutoverError("malformed source entry")
        name = source_path(item["path"])
        if not isinstance(item["blob_sha"], str) or SHA40.fullmatch(item["blob_sha"]) is None:
            raise InternetCutoverError("invalid source Git blob identity")
        if type(item["size"]) is not int or not 0 < item["size"] <= 2 * 1024 * 1024:
            raise InternetCutoverError("invalid source file size")
        paths.append(name)
    if paths != sorted(set(paths)):
        raise InternetCutoverError("source paths must be sorted and unique")
    if TRANSLATION not in paths or SOURCE_DIR + "runtime.mjs" not in paths or SOURCE_DIR + "app.mjs" not in paths:
        raise InternetCutoverError("Internet source inventory omitted mandatory owner files")
    if len(paths) != snapshot.get("file_count") or len(paths) != declared.get("file_count"):
        raise InternetCutoverError("source inventory file count drift")
    return rows


def verify_checkout(platform_root: Path, plan: dict, rows: list[dict]) -> None:
    if not platform_root.is_dir() or platform_root.is_symlink():
        raise InternetCutoverError("platform source must be a checked-out directory")
    exact = platform_root.resolve()
    if git(exact, "rev-parse", "--show-toplevel") != str(exact):
        raise InternetCutoverError("platform checkout root mismatch")
    if git(exact, "rev-parse", "HEAD") != plan["source_snapshot"]["commit"]:
        raise InternetCutoverError("platform checkout does not match pinned source commit")
    if git(exact, "status", "--porcelain", "--untracked-files=normal"):
        raise InternetCutoverError("platform checkout is dirty")
    origin = git(exact, "remote", "get-url", "origin").rstrip("/").removesuffix(".git")
    if origin not in {
        "https://github.com/" + SOURCE_REPO,
        "git@github.com:" + SOURCE_REPO,
        "ssh://git@github.com/" + SOURCE_REPO,
    }:
        raise InternetCutoverError("platform checkout origin is not the canonical repository")
    lines = git(exact, "ls-tree", "-r", "-l", "HEAD", "--", SOURCE_DIR[:-1], TRANSLATION).splitlines()
    seen = []
    for line in lines:
        result = re.fullmatch(r"(100644|100755) blob ([0-9a-f]{40})\s+(\d+)\t(.+)", line)
        if result is None or result.group(1) != "100644":
            raise InternetCutoverError("Internet snapshot contains non-regular Git entry")
        name = source_path(result.group(4))
        seen.append({"path": name, "blob_sha": result.group(2), "size": int(result.group(3))})
    if sorted(seen, key=lambda x: x["path"]) != rows:
        raise InternetCutoverError("pinned Git tree differs from the complete Internet source inventory")


def audit(root: Path = ROOT, platform_root: Path | None = None) -> dict:
    plan = json_file(root / PLAN_FILE)
    if plan.get("$schema") != "ordax.app-externalization-plan/1" or plan.get("app_id") != "internet":
        raise InternetCutoverError("wrong Internet externalization plan")
    if (plan.get("source_repository_current"), plan.get("source_path_current")) != (SOURCE_REPO, SOURCE_DIR[:-1]):
        raise InternetCutoverError("Internet current owner mismatch")
    if (plan.get("target_repository"), plan.get("target_path")) != (TARGET_REPO, "apps/internet"):
        raise InternetCutoverError("Internet target owner mismatch")
    if plan.get("source_of_truth_state") != "platform-until-cutover":
        raise InternetCutoverError("Internet no longer has exactly one pre-cutover source")
    if plan.get("source_cutover_allowed") is not False or plan.get("distribution_activation_allowed") is not False:
        raise InternetCutoverError("source/distribution cutover must remain blocked at the pinned-source stage")
    target = root / "apps/internet"
    if target.exists() or target.is_symlink():
        raise InternetCutoverError("duplicate Internet source exists before remove-first Gate A")
    if plan.get("authority") != "none" or (plan.get("source_cutover") or {}).get("mode") != "remove-platform-first":
        raise InternetCutoverError("Internet transfer authority or remove-first policy drift")
    sdk = plan.get("target_sdk") or {}
    lock = json_file(root / "platform-sdk.lock.json")
    if lock.get("repository") != SOURCE_REPO or lock.get("authority") != "none":
        raise InternetCutoverError("App SDK owner/authority mismatch")
    if not isinstance(lock.get("commit"), str) or SHA40.fullmatch(lock["commit"]) is None:
        raise InternetCutoverError("App SDK Git pin invalid")
    if not isinstance(lock.get("sha256"), str) or SHA256.fullmatch(lock["sha256"]) is None:
        raise InternetCutoverError("App SDK digest invalid")
    if sdk.get("lock_file") != "platform-sdk.lock.json" or sdk.get("migration_authorized_by_sdk_pin") is not False:
        raise InternetCutoverError("App SDK lock cannot grant source cutover")
    if version_tuple(sdk.get("minimum_bundle_version")) < (1, 16, 0):
        raise InternetCutoverError("Internet requires canonical first-party-app App SDK 1.16 or newer")
    if version_tuple(lock.get("bundle_version")) < version_tuple(sdk["minimum_bundle_version"]):
        raise InternetCutoverError("App SDK pin is older than the Internet requirement")
    snapshot = json_file(root / "migrations/internet.source-snapshot.json")
    rows = check_inventory(snapshot, plan)
    if platform_root is not None:
        verify_checkout(platform_root, plan, rows)
    return {
        "schema": SCHEMA, "appId": "internet",
        "sourceOwner": SOURCE_REPO, "sourceCommit": snapshot["commit"],
        "sourceFileCount": len(rows), "sourceBytes": sum(item["size"] for item in rows),
        "sdkVersion": lock["bundle_version"],
        "snapshotVerifiedAgainstGit": platform_root is not None,
        "sourceCutoverAuthorized": False, "distributionActivated": False,
        "blockers": [
            "platform-source-still-owned-by-ordax-os",
            "remove-first-gate-a-not-proven",
            "independent-package-and-install-rollback-not-proven",
        ],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--platform-root", type=Path)
    parser.add_argument("--verify-pinned-source", action="store_true")
    parser.add_argument("--require-cutover-ready", action="store_true")
    args = parser.parse_args(argv)
    try:
        if args.verify_pinned_source and args.platform_root is None:
            raise InternetCutoverError("pinned Git proof requires --platform-root")
        report = audit(ROOT, args.platform_root)
        print(json.dumps(report, indent=2, sort_keys=True, ensure_ascii=False))
        if args.require_cutover_ready:
            raise InternetCutoverError("source Gate A and installation/rollback are not proven")
    except InternetCutoverError as exc:
        print(f"INTERNET_CUTOVER=BLOCKED: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
