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
    if (root / "apps" / "files" / "app.json").exists():
        raise FilesCutoverError("Files already has a second canonical app manifest")
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
        if (
            inventory.get("app_id") != "files"
            or inventory.get("repository") != platform
            or inventory.get("commit") != snapshot["commit"]
            or not isinstance(inventory.get("file_count"), int)
            or inventory["file_count"] <= 0
        ):
            raise FilesCutoverError("source snapshot inventory is not pinned to Files")
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
    args = parser.parse_args(argv)
    try:
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
