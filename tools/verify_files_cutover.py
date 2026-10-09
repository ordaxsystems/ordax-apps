#!/usr/bin/env python3
"""Fail-closed, read-only Files source cutover preflight.

Plan mode checks canonical ownership, migration gates and the pinned SDK lock.
Platform mode additionally checks an exact clean platform checkout for source
absence, stale couplings and retained platform-owned ports. Neither mode copies
source, grants authority or proves production distribution.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = "ordax.files-cutover-preflight/1"
TARGET = "ordaxsystems/ordax-apps"
SHA40 = re.compile(r"^[0-9a-f]{40}$")
REQUIRED_CONTRACTS = frozenset({
    "ordax.app-activation/1",
    "ordax.app-intelligence-manifest/1",
    "ordax.application-action-capability/1",
    "ordax.application-action-manifest/1",
    "ordax.component-manifest/1",
    "ordax.component-runtime/1",
    "ordax.file-space/11",
    "ordax.localization/2",
    "ordax.surface-render-lifecycle/5",
    "prototype-ordax.localization-pack/1",
})
FORBIDDEN_REMOVAL_PREFIXES = (
    "system/contracts/",
    "system/adapters/",
    "system/services/files/",
)


class FilesCutoverError(RuntimeError):
    pass


def read_json(path: Path) -> dict:
    try:
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 256 * 1024:
            raise FilesCutoverError(f"missing, linked or oversized JSON: {path}")
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise FilesCutoverError(f"cannot read JSON: {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise FilesCutoverError(f"JSON object required: {path}")
    return value


def safe_path(value: str) -> str:
    if not isinstance(value, str) or not value or value.startswith("/") or "\\" in value:
        raise FilesCutoverError("unsafe relative source path")
    parts = value.split("/")
    if any(part in ("", ".", "..") for part in parts):
        raise FilesCutoverError("unsafe relative source path")
    if PurePosixPath(value).as_posix() != value:
        raise FilesCutoverError("non-canonical relative source path")
    return value


def sha_or_none(value: object, label: str) -> None:
    if value is not None and (not isinstance(value, str) or not SHA40.fullmatch(value)):
        raise FilesCutoverError(f"{label} must be an exact Git SHA or null")


def semver_tuple(value: str) -> tuple[int, int, int]:
    if not isinstance(value, str) or not re.fullmatch(r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", value):
        raise FilesCutoverError("SDK bundle version must be stable semantic version")
    return tuple(int(part) for part in value.split("."))


def load_plan(root: Path) -> tuple[dict, dict, dict]:
    """Validate ownership and contract claims; do not imply Gate A is complete."""
    workspace = read_json(root / "ordax-apps.workspace.json")
    plan = read_json(root / "migrations" / "files.externalization.json")
    sdk = read_json(root / "platform-sdk.lock.json")
    platform = workspace.get("platform_repository")
    if (
        workspace.get("authority") != "none"
        or workspace.get("source_of_truth_policy") != "single-repository-per-app"
        or not isinstance(platform, str)
        or "files" not in workspace.get("first_party_app_targets", [])
        or "files" in workspace.get("structural_surfaces_owned_by_platform", [])
    ):
        raise FilesCutoverError("workspace ownership policy is invalid")
    if (
        plan.get("$schema") != "ordax.app-externalization-plan/1"
        or plan.get("app_id") != "files"
        or plan.get("target_repository") != TARGET
        or plan.get("target_path") != "apps/files"
        or plan.get("source_repository_current") != platform
        or plan.get("source_path_current") != "system/apps/files"
        or plan.get("source_of_truth_state") != "platform-until-cutover"
        or plan.get("authority") != "none"
        or plan.get("distribution_activation_allowed") is not False
    ):
        raise FilesCutoverError("Files migration identity, owner or distribution gate is invalid")
    # Before Gate A, even an unmanifested runtime is a duplicate source.
    # A later verified cutover may populate this directory without creating a second owner.
    target_source = root / "apps" / "files"
    if not plan.get("source_cutover_allowed") and (target_source.exists() or target_source.is_symlink()):
        raise FilesCutoverError("Files already has a second canonical source before Gate A")
    cutover = plan.get("source_cutover")
    if (
        not isinstance(cutover, dict)
        or cutover.get("mode") != "remove-platform-first"
        or cutover.get("dual_source_allowed") is not False
        or cutover.get("platform_absence_proof_required_before_copy") is not True
        or cutover.get("sdk_public_boundary_required_before_snapshot") is not True
        or cutover.get("temporary_app_absence_allowed") is not True
    ):
        raise FilesCutoverError("remove-first source cutover policy is invalid")
    if not isinstance(plan.get("source_cutover_allowed"), bool):
        raise FilesCutoverError("source cutover authorization must be boolean")

    target_sdk = plan.get("target_sdk")
    if (
        not isinstance(target_sdk, dict)
        or target_sdk.get("lock_file") != "platform-sdk.lock.json"
        or sdk.get("authority") != "none"
        or sdk.get("repository") != platform
        or sdk.get("bundle_schema") != "ordax.app-sdk-bundle/1"
        or semver_tuple(sdk.get("bundle_version")) < semver_tuple(target_sdk.get("minimum_bundle_version"))
    ):
        raise FilesCutoverError("Files requires a compatible, pinned public App SDK")
    sha_or_none(sdk.get("commit"), "SDK commit")
    if sdk.get("commit") is None or not re.fullmatch(r"[0-9a-f]{64}", str(sdk.get("sha256"))):
        raise FilesCutoverError("SDK commit and bundle digest must be pinned")
    required = plan.get("platform_contracts_required")
    if not isinstance(required, list) or len(required) != len(set(required)) or not REQUIRED_CONTRACTS.issubset(required):
        raise FilesCutoverError("Files public contract requirements are incomplete")

    gates = plan.get("gate_a_platform_removal")
    if not isinstance(gates, dict):
        raise FilesCutoverError("missing Gate A removal inventory")
    removed = gates.get("remove_owned_source")
    couplings = gates.get("remove_platform_implementation_couplings")
    retained = gates.get("retain_platform_owned")
    if (
        not isinstance(removed, list) or not removed
        or not isinstance(couplings, list) or not couplings
        or not isinstance(retained, list) or not retained
    ):
        raise FilesCutoverError("Gate A paths must be non-empty lists")
    if any(not isinstance(path, str) for path in removed + retained):
        raise FilesCutoverError("Gate A path must be text")
    removed = [safe_path(path) for path in removed]
    retained = [safe_path(path) for path in retained]
    if len(set(removed)) != len(removed) or len(set(retained)) != len(retained):
        raise FilesCutoverError("Gate A paths must be unique")
    if "system/apps/files" not in removed or "system/contracts/file-space.mjs" not in retained:
        raise FilesCutoverError("Gate A cannot omit Files source or File Space platform contract")
    if any(path.startswith(FORBIDDEN_REMOVAL_PREFIXES) for path in removed):
        raise FilesCutoverError("Gate A cannot remove platform-owned contracts or adapters")
    if set(removed) & set(retained):
        raise FilesCutoverError("Gate A cannot both remove and retain a path")
    for coupling in couplings:
        if not isinstance(coupling, dict) or set(coupling) != {"path", "forbidden_literals"}:
            raise FilesCutoverError("Gate A coupling descriptor is invalid")
        path = safe_path(coupling["path"])
        literals = coupling["forbidden_literals"]
        if path in removed or not isinstance(literals, list) or not literals:
            raise FilesCutoverError("Gate A coupling is not independently verifiable")
        if any(not isinstance(literal, str) or not literal or len(literal) > 160 for literal in literals):
            raise FilesCutoverError("Gate A coupling literal is invalid")
    paths = [entry["path"] for entry in couplings]
    if len(paths) != len(set(paths)):
        raise FilesCutoverError("Gate A coupling paths are duplicated")

    snapshot = plan.get("source_snapshot")
    if not isinstance(snapshot, dict) or snapshot.get("repository") != platform:
        raise FilesCutoverError("source snapshot owner is invalid")
    sha_or_none(snapshot.get("commit"), "source snapshot commit")
    sha_or_none(plan.get("gate_a_platform_commit"), "Gate A platform commit")
    if plan["source_cutover_allowed"]:
        if (
            snapshot.get("state") != "captured"
            or snapshot.get("commit") is None
            or not snapshot.get("inventory_file")
            or plan.get("gate_a_platform_commit") is None
            or snapshot["commit"] == plan["gate_a_platform_commit"]
        ):
            raise FilesCutoverError("cutover cannot be authorized without distinct snapshot and Gate A pins")
        inventory_path = root / safe_path(snapshot["inventory_file"])
        inventory = read_json(inventory_path)
        entries = inventory.get("files")
        if (
            inventory.get("$schema") != "ordax.source-snapshot-inventory/1"
            or inventory.get("app_id") != "files"
            or inventory.get("repository") != platform
            or inventory.get("commit") != snapshot["commit"]
            or not isinstance(entries, list) or not entries
            or not isinstance(inventory.get("file_count"), int)
            or isinstance(inventory["file_count"], bool)
            or inventory["file_count"] != len(entries)
        ):
            raise FilesCutoverError("source snapshot inventory is not pinned to Files")
        snapshot_paths = []
        for entry in entries:
            if not isinstance(entry, dict) or set(entry) != {"path", "git_blob_sha"}:
                raise FilesCutoverError("source snapshot entry must pin a Git blob")
            path = safe_path(entry["path"])
            sha_or_none(entry["git_blob_sha"], "source snapshot Git blob")
            if entry["git_blob_sha"] is None or not any(
                path == removed_root or path.startswith(removed_root + "/")
                for removed_root in removed
            ):
                raise FilesCutoverError("source snapshot contains unowned or unpinned source")
            snapshot_paths.append(path)
        if (
            len(snapshot_paths) != len(set(snapshot_paths))
            or "system/apps/files/app.mjs" not in snapshot_paths
        ):
            raise FilesCutoverError("source snapshot must include unique Files app source")
    delivery = plan.get("delivery")
    if (
        not isinstance(delivery, dict)
        or delivery.get("store_is_install_authority") is not False
        or delivery.get("install_owner") != "platform-component-lifecycle"
        or delivery.get("auto_install") is not False
    ):
        raise FilesCutoverError("Files delivery cannot mint install authority")
    unresolved = plan.get("unresolved_capabilities")
    if not isinstance(unresolved, list) or not unresolved or any(
        not isinstance(item, dict) or not item.get("id") or item.get("state") == "ready"
        for item in unresolved
    ):
        raise FilesCutoverError("unresolved capability gates cannot be silently marked ready")
    return workspace, plan, sdk


def inspect_platform(platform_root: Path, plan: dict, observed_commit: str, *, dirty: bool = False) -> dict:
    """Inspect exact platform tree; no file mutation and no Git network requests."""
    sha_or_none(observed_commit, "observed platform commit")
    if observed_commit is None:
        raise FilesCutoverError("observed platform commit is required")
    if not platform_root.is_dir() or platform_root.is_symlink():
        raise FilesCutoverError("platform checkout must be a real directory")
    gates = plan["gate_a_platform_removal"]
    present = [
        path for path in gates["remove_owned_source"]
        if (platform_root / path).exists() or (platform_root / path).is_symlink()
    ]
    remaining = []
    missing_coupling_owners = []
    for item in gates["remove_platform_implementation_couplings"]:
        path = item["path"]
        file = platform_root / path
        if file.is_symlink() or not file.is_file():
            missing_coupling_owners.append(path)
            continue
        try:
            source = file.read_text(encoding="utf-8")
        except (OSError, UnicodeError) as exc:
            raise FilesCutoverError(f"cannot inspect platform coupling: {path}") from exc
        for literal in item["forbidden_literals"]:
            if literal in source:
                remaining.append({"path": path, "literal": literal})
    missing_ports = [
        path for path in gates["retain_platform_owned"]
        if (platform_root / path).is_symlink() or not (platform_root / path).is_file()
    ]
    return {
        "observed_commit": observed_commit,
        "dirty_checkout": dirty,
        "remaining_source": present,
        "remaining_couplings": remaining,
        "missing_coupling_owners": missing_coupling_owners,
        "missing_retained_platform_ports": missing_ports,
    }



def _git_bytes(platform_root: Path, *args: str) -> bytes:
    """Read exact local Git objects; never fetch, checkout, write or run shell."""
    try:
        return subprocess.run(
            ["git", "-C", str(platform_root), *args],
            check=True, capture_output=True, timeout=20,
        ).stdout
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        raise FilesCutoverError(f"cannot prove Git history ({' '.join(args[:2])})") from exc


def _git_text(platform_root: Path, *args: str) -> str:
    try:
        return _git_bytes(platform_root, *args).decode("utf-8").strip()
    except UnicodeError as exc:
        raise FilesCutoverError("Git metadata is not UTF-8") from exc


def _verify_git_checkout(platform_root: Path, plan: dict) -> str:
    """Require a clean checkout at the expected platform origin, not an arbitrary folder."""
    if platform_root.is_symlink() or not platform_root.is_dir():
        raise FilesCutoverError("platform checkout must be a real directory")
    top = _git_text(platform_root, "rev-parse", "--show-toplevel")
    if Path(top).resolve() != platform_root.resolve():
        raise FilesCutoverError("platform checkout must be the Git worktree root")
    expected = plan["source_repository_current"]
    allowed = {
        f"https://github.com/{expected}",
        f"https://github.com/{expected}.git",
        f"git@github.com:{expected}",
        f"git@github.com:{expected}.git",
        f"ssh://git@github.com/{expected}",
        f"ssh://git@github.com/{expected}.git",
    }
    origin = _git_text(platform_root, "config", "--get", "remote.origin.url")
    if origin not in allowed:
        raise FilesCutoverError("Git origin does not match the canonical platform repository")
    if _git_bytes(platform_root, "status", "--porcelain", "--untracked-files=all").strip():
        raise FilesCutoverError("platform Git checkout contains uncommitted or untracked files")
    return _git_text(platform_root, "rev-parse", "HEAD")


def _tree_files(platform_root: Path, commit: str, removed_paths: list[str]) -> list[dict]:
    """Read the complete tracked app-owned tree at a commit, preserving Git blob identity."""
    sha_or_none(commit, "tree commit")
    if commit is None:
        raise FilesCutoverError("source tree requires a pinned commit")
    if not removed_paths:
        raise FilesCutoverError("source tree paths must not be empty")
    raw = _git_bytes(platform_root, "ls-tree", "-r", "-z", commit, "--", *removed_paths)
    result = []
    seen = set()
    for entry in raw.split(b"\0"):
        if not entry:
            continue
        try:
            metadata, name = entry.split(b"\t", 1)
            mode, kind, blob = metadata.decode("ascii").split(" ")
            path = safe_path(name.decode("utf-8"))
        except (ValueError, UnicodeError) as exc:
            raise FilesCutoverError("invalid Git tree entry") from exc
        if kind != "blob" or mode not in ("100644", "100755"):
            raise FilesCutoverError(f"non-regular app-owned Git source: {path}")
        if not SHA40.fullmatch(blob):
            raise FilesCutoverError(f"invalid Git blob id: {path}")
        if not any(path == prefix or path.startswith(prefix + "/") for prefix in removed_paths):
            raise FilesCutoverError(f"Git source outside app-owned removal inventory: {path}")
        if path in seen:
            raise FilesCutoverError(f"duplicate Git source path: {path}")
        seen.add(path)
        result.append({"path": path, "git_blob_sha": blob})
    return sorted(result, key=lambda item: item["path"])


def capture_source_snapshot(platform_root: Path, plan: dict) -> dict:
    """Generate derived inventory from the platform's Git tree; output only, no writes."""
    if plan["source_cutover_allowed"]:
        raise FilesCutoverError("cannot capture initial source snapshot after cutover authorization")
    commit = _verify_git_checkout(platform_root, plan)
    entries = _tree_files(
        platform_root, commit, plan["gate_a_platform_removal"]["remove_owned_source"]
    )
    if not entries or "system/apps/files/app.mjs" not in {item["path"] for item in entries}:
        raise FilesCutoverError("Files source must exist before Gate A removal")
    return {
        "$schema": "ordax.source-snapshot-inventory/1",
        "app_id": "files",
        "repository": plan["source_repository_current"],
        "commit": commit,
        "file_count": len(entries),
        "files": entries,
    }


def verify_source_history(platform_root: Path, plan: dict, inventory: dict) -> dict:
    """Prove snapshot and Gate A against real Git commits, not asserted JSON alone."""
    gate_commit = plan["gate_a_platform_commit"]
    source_commit = plan["source_snapshot"]["commit"]
    if gate_commit is None or source_commit is None:
        raise FilesCutoverError("Gate A and source snapshot commits must be pinned")
    head = _verify_git_checkout(platform_root, plan)
    if head != gate_commit:
        raise FilesCutoverError("checkout HEAD differs from pinned Gate A commit")
    if source_commit == gate_commit:
        raise FilesCutoverError("snapshot and Gate A cannot be the same commit")
    _git_bytes(platform_root, "cat-file", "-e", f"{source_commit}^{{commit}}")
    _git_bytes(platform_root, "cat-file", "-e", f"{gate_commit}^{{commit}}")
    _git_bytes(platform_root, "merge-base", "--is-ancestor", source_commit, gate_commit)

    owned = plan["gate_a_platform_removal"]["remove_owned_source"]
    actual_snapshot = _tree_files(platform_root, source_commit, owned)
    if not actual_snapshot or "system/apps/files/app.mjs" not in {
        item["path"] for item in actual_snapshot
    }:
        raise FilesCutoverError("pinned source commit does not contain the Files app")
    if inventory.get("files") != actual_snapshot:
        raise FilesCutoverError("snapshot inventory differs from Git blobs or is incomplete")
    if _tree_files(platform_root, gate_commit, owned):
        raise FilesCutoverError("Gate A Git commit still contains app-owned Files source")
    for path in plan["gate_a_platform_removal"]["retain_platform_owned"]:
        record = _git_bytes(platform_root, "ls-tree", gate_commit, "--", path)
        if not record or b" blob " not in record:
            raise FilesCutoverError(f"Gate A removed platform-owned port: {path}")
    for coupling in plan["gate_a_platform_removal"]["remove_platform_implementation_couplings"]:
        path = coupling["path"]
        content = _git_bytes(platform_root, "show", f"{gate_commit}:{path}")
        for literal in coupling["forbidden_literals"]:
            if literal.encode("utf-8") in content:
                raise FilesCutoverError(f"Gate A retains Files implementation coupling: {path}")
    return {
        "verified": True,
        "snapshot_commit": source_commit,
        "gate_a_commit": gate_commit,
        "snapshot_file_count": len(actual_snapshot),
        "origin": plan["source_repository_current"],
    }


def report(root: Path = ROOT, platform_root: Path | None = None,
           observed_commit: str | None = None, *, dirty: bool = False) -> dict:
    workspace, plan, sdk = load_plan(root.resolve())
    blockers = []
    if not plan["source_cutover_allowed"]:
        blockers.append("source-cutover-not-authorized")
    if plan["gate_a_platform_commit"] is None:
        blockers.append("gate-a-platform-commit-not-pinned")
    if plan["source_snapshot"]["commit"] is None:
        blockers.append("source-snapshot-not-captured")
    inspection = None
    source_history = {"verified": False, "status": "not-assessed"}
    if platform_root is None:
        blockers.append("platform-absence-not-inspected")
    else:
        inspection = inspect_platform(platform_root.resolve(), plan, observed_commit, dirty=dirty)
        if inspection["dirty_checkout"]:
            blockers.append("platform-checkout-dirty")
        if inspection["observed_commit"] != plan["gate_a_platform_commit"]:
            blockers.append("platform-commit-does-not-match-gate-a")
        if inspection["remaining_source"]:
            blockers.append("platform-files-source-still-present")
        if inspection["remaining_couplings"]:
            blockers.append("platform-files-implementation-couplings-remain")
        if inspection["missing_coupling_owners"]:
            blockers.append("platform-coupling-owner-missing")
        if inspection["missing_retained_platform_ports"]:
            blockers.append("platform-owned-file-space-ports-missing")
        if plan["source_cutover_allowed"]:
            try:
                inventory_path = root.resolve() / safe_path(plan["source_snapshot"]["inventory_file"])
                source_history = verify_source_history(
                    platform_root.resolve(), plan, read_json(inventory_path)
                )
            except FilesCutoverError as exc:
                blockers.append("source-git-history-not-proven")
                source_history = {"verified": False, "status": "blocked", "reason": str(exc)}
    return {
        "schema": SCHEMA,
        "authority": "none",
        "app_id": "files",
        "source_repository": plan["source_repository_current"],
        "target_repository": plan["target_repository"],
        "target_path": plan["target_path"],
        "sdk_pin": {"version": sdk["bundle_version"], "commit": sdk["commit"]},
        "public_contracts_declared": plan["platform_contracts_required"],
        "unresolved_capabilities": plan["unresolved_capabilities"],
        "source_cutover": {
            "ready": not blockers,
            "blockers": sorted(set(blockers)),
            "platform_inspection": inspection,
            "source_history_evidence": source_history,
        },
        "distribution_activation": "blocked",
        "disclaimer": (
            "A clean source-removal preflight does not authorize copying Files, "
            "grant access, verify runtime behavior or activate production distribution."
        ),
    }


def git_checkout_state(path: Path) -> tuple[str, bool]:
    def git(*args: str) -> str:
        try:
            return subprocess.run(
                ["git", "-C", str(path), *args],
                check=True, capture_output=True, text=True, timeout=10,
            ).stdout.strip()
        except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
            raise FilesCutoverError(f"cannot verify platform Git checkout: {exc}") from exc
    head = git("rev-parse", "HEAD")
    sha_or_none(head, "platform HEAD")
    return head, bool(git("status", "--porcelain"))


def render_markdown(value: dict) -> str:
    cutover = value["source_cutover"]
    lines = [
        "# Files — preflight de extração",
        "",
        f"- Source atual: {value['source_repository']}",
        f"- Target: {value['target_repository']}/{value['target_path']}",
        f"- App SDK pinado: {value['sdk_pin']['version']} ({value['sdk_pin']['commit']})",
        f"- Cutover autorizado: {'sim' if cutover['ready'] else 'não'}",
        f"- Ativação em produção: {value['distribution_activation']}",
        "",
        "## Bloqueios",
        "",
    ]
    lines.extend(f"- {blocker}" for blocker in cutover["blockers"])
    if not cutover["blockers"]:
        lines.append("- Nenhum bloqueio nesta preflight; outras provas ainda são obrigatórias.")
    if cutover["platform_inspection"]:
        check = cutover["platform_inspection"]
        lines.extend(["", "## Inspeção do checkout", ""])
        lines.append(f"- Commit observado: {check['observed_commit']}")
        lines.append(f"- Source ainda presente: {', '.join(check['remaining_source']) or 'nenhum'}")
        lines.append(f"- Couplings restantes: {len(check['remaining_couplings'])}")
        lines.append(f"- Ports ausentes: {', '.join(check['missing_retained_platform_ports']) or 'nenhum'}")
    lines.extend(["", value["disclaimer"], ""])
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--platform-root", type=Path)
    parser.add_argument("--format", choices=("json", "markdown"), default="json")
    parser.add_argument("--require-cutover-ready", action="store_true")
    parser.add_argument(
        "--emit-source-snapshot", action="store_true",
        help="Print a derived, read-only Git blob inventory before Gate A (no writes)",
    )
    args = parser.parse_args(argv)
    try:
        if args.emit_source_snapshot:
            if args.platform_root is None or args.format != "json" or args.require_cutover_ready:
                raise FilesCutoverError("snapshot output requires --platform-root and JSON format")
            _, plan, _ = load_plan(args.root.resolve())
            print(json.dumps(
                capture_source_snapshot(args.platform_root, plan),
                indent=2, ensure_ascii=False, sort_keys=True,
            ))
            return 0
        head, dirty = git_checkout_state(args.platform_root) if args.platform_root else (None, False)
        result = report(args.root, args.platform_root, head, dirty=dirty)
    except FilesCutoverError as exc:
        print(f"ORDAX_FILES_CUTOVER_PREFLIGHT=FAIL\n{exc}", file=sys.stderr)
        return 1
    print(render_markdown(result) if args.format == "markdown"
          else json.dumps(result, indent=2, ensure_ascii=False, sort_keys=True))
    return 2 if args.require_cutover_ready and not result["source_cutover"]["ready"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
