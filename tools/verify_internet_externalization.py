#!/usr/bin/env python3
"""Fail-closed read-only Internet remove-first source/transfer preflight.

No source is copied, installed, published, promoted or activated here.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLAN = "migrations/internet.externalization.json"
SNAPSHOT = "migrations/internet.source-snapshot.json"
MAP = "migrations/internet.gate-b-transfer-map.json"
LOCK = "platform-sdk.lock.json"
SHA1_RE = re.compile(r"[a-f0-9]{40}\Z")
SHA256_RE = re.compile(r"[a-f0-9]{64}\Z")
SCHEMA = "ordax.internet-externalization-preflight/1"

class InternetExternalizationError(ValueError):
    pass

def reject(message: str):
    raise InternetExternalizationError(message)

def load(root: Path, path: str) -> dict:
    filename = root / path
    if filename.is_symlink() or not filename.is_file() or filename.stat().st_size > 100_000:
        reject(f"missing/symlinked/oversize canonical file: {path}")
    try:
        value = json.loads(filename.read_text(encoding="utf-8"))
    except (ValueError, UnicodeError, OSError) as exc:
        raise InternetExternalizationError(f"invalid JSON: {path}") from exc
    if not isinstance(value, dict):
        reject(f"expected JSON object: {path}")
    return value

def version(value: str) -> tuple[int, int, int]:
    if not isinstance(value, str) or not re.fullmatch(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)", value):
        reject("SDK version is not canonical semantic version")
    return tuple(map(int, value.split(".")))

def current_source_drift(platform_root: Path, pinned_files: list[dict]) -> dict:
    """Compare source HEAD Git blobs to historical snapshot, without mutation.

    A snapshot is immutable evidence, not an automatic representation of the
    current product. This comparator reports all changed/added/deleted paths
    so Gate A can recapture the exact current candidate before cutover.
    """
    if platform_root.is_symlink() or not platform_root.is_dir():
        reject("current platform must be a real checkout")
    checkout = platform_root.resolve()

    def git(*args: str) -> str:
        proc = subprocess.run(
            ["git", "-C", str(checkout), *args],
            capture_output=True, text=True, encoding="utf-8", check=False,
        )
        if proc.returncode:
            reject("unable to read current platform source Git tree: " + " ".join(args))
        return proc.stdout.strip()

    if git("rev-parse", "--show-toplevel") != str(checkout):
        reject("current platform checkout root mismatch")
    if git("status", "--porcelain", "--untracked-files=normal"):
        reject("current platform checkout is dirty")
    origin = git("remote", "get-url", "origin").rstrip("/").removesuffix(".git")
    if origin not in {
        "https://github.com/ordaxsystems/ordax-os",
        "git@github.com:ordaxsystems/ordax-os",
        "ssh://git@github.com/ordaxsystems/ordax-os",
    }:
        reject("current platform checkout does not have canonical Git origin")
    names = git(
        "ls-tree", "-r", "--name-only", "HEAD", "--",
        "system/apps/internet", "system/services/i18n/catalog/internet.mjs",
    ).splitlines()
    observed = {}
    for name in names:
        if not (name.startswith("system/apps/internet/")
                or name == "system/services/i18n/catalog/internet.mjs"):
            reject("unexpected current platform source path")
        observed[name] = git("rev-parse", "HEAD:" + name)
        if not SHA1_RE.fullmatch(observed[name]):
            reject("invalid current Git blob SHA")
    pinned = {item["path"]: item["blob_sha"] for item in pinned_files}
    changed = sorted(name for name in observed.keys() & pinned.keys()
                     if observed[name] != pinned[name])
    return {
        "current_platform_commit": git("rev-parse", "HEAD"),
        "snapshot_current": not changed and observed.keys() == pinned.keys(),
        "changed": changed,
        "added": sorted(observed.keys() - pinned.keys()),
        "deleted": sorted(pinned.keys() - observed.keys()),
        "current_file_count": len(observed),
    }


def check_portability_rewrites(platform_root: Path, mapping: dict,
                               published_contracts: set[str]) -> dict:
    """Inspect the verified Git snapshot; never materialize a second app.

    Return source-level relocation obligations rather than claiming that an
    independently executable package exists. All imports must resolve to an
    app-owned source blob, a published public SDK contract, or a declared
    manifest replacement. Native/system service imports are forbidden.
    """
    import posixpath

    entries = mapping["mappings"]
    targets = {row["source"]: row["target"] for row in entries}
    operations = {row["source"]: row["operation"] for row in entries}
    sources = set(targets)
    import_re = re.compile(
        r"""(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"]([^'"]+)['"]"""
        r"""|\bnew\s+URL\s*\(\s*['"]([^'"]+)['"]"""
    )
    obligations = []
    imports_scanned = 0
    for row in entries:
        source = row["source"]
        destination = targets[source]
        if not source.endswith((".mjs", ".js")):
            continue
        if row["operation"] in {"replace-by-manifest", "fold-version-into-manifest"}:
            continue
        src = platform_root / source
        if not src.is_file() or src.is_symlink():
            reject(f"portable source missing/unsafe: {source}")
        code = src.read_text(encoding="utf-8")
        if re.search(r"""\bimport\s*\(\s*(?!['"])""", code):
            reject(f"non-literal dynamic Internet import: {source}")
        for match in import_re.finditer(code):
            specifier = match.group(1) or match.group(2)
            imports_scanned += 1
            if not specifier.startswith("."):
                reject(f"unsupported non-relative portability import: {source}")
            resolved = posixpath.normpath(posixpath.join(posixpath.dirname(source), specifier))
            dependency_target = None
            rewritten_specifier = None
            if resolved in sources:
                operation = operations[resolved]
                if operation in {"replace-by-manifest", "fold-version-into-manifest"}:
                    requirement = "manifest-replacement"
                else:
                    requirement = "relocate-app-owned-import"
                    dependency_target = targets[resolved]
                    rewritten_specifier = posixpath.relpath(
                        dependency_target, posixpath.dirname(destination)
                    )
                    if not rewritten_specifier.startswith("."):
                        rewritten_specifier = "./" + rewritten_specifier
                    if posixpath.normpath(posixpath.join(
                        posixpath.dirname(destination), rewritten_specifier
                    )) != dependency_target:
                        reject(f"unresolvable relocated Internet import: {source} -> {resolved}")
            elif resolved in published_contracts and resolved.startswith("system/contracts/"):
                requirement = "resolve-public-sdk-contract"
            else:
                reject(f"unmapped or private Internet import: {source} -> {resolved}")
            obligations.append({
                "source": source, "target": destination,
                "specifier": specifier, "resolved": resolved,
                "requirement": requirement,
                "target_dependency": dependency_target,
                "rewritten_specifier": rewritten_specifier,
            })
    return {
        "schema": "ordax.internet-portability-rewrites/1",
        "source_imports_scanned": imports_scanned,
        "obligations": sorted(obligations, key=lambda item: (item["source"], item["specifier"])),
        "runtime_package_ready": False,
        "copy_source_without_rewiring_allowed": False,
    }


def audit(root: Path = ROOT, *, platform_root: Path | None = None,
          current_platform_root: Path | None = None) -> dict:
    root = root.resolve()
    plan, snapshot, mapping, lock = (load(root, name) for name in (PLAN, SNAPSHOT, MAP, LOCK))
    if plan.get("$schema") != "ordax.app-externalization-plan/1" or plan.get("app_id") != "internet":
        reject("canonical Internet plan identity mismatch")
    if plan.get("source_repository_current") != "ordaxsystems/ordax-os" or plan.get("source_path_current") != "system/apps/internet":
        reject("Internet platform source owner drifted")
    if plan.get("target_repository") != "ordaxsystems/ordax-apps" or plan.get("target_path") != "apps/internet":
        reject("Internet external target owner drifted")
    if plan.get("source_of_truth_state") != "platform-until-cutover":
        reject("Internet cannot claim a second source before Gate A")
    if plan.get("source_cutover_allowed") is not False or plan.get("distribution_activation_allowed") is not False:
        reject("Internet cutover/distribution requires independent explicit evidence")
    if plan.get("authority") != "none":
        reject("Internet migration manifest must not grant authority")
    cutover = plan.get("source_cutover") or {}
    for key in ("prelaunch_only", "platform_absence_proof_required_before_copy", "sdk_public_boundary_required_before_snapshot"):
        if cutover.get(key) is not True:
            reject(f"remove-first gate requires {key}")
    if cutover.get("dual_source_allowed") is not False or cutover.get("mode") != "remove-platform-first":
        reject("Internet cutover must not allow dual source")
    if (root / "apps/internet").exists() or (root / "apps/internet").is_symlink():
        reject("apps/internet source exists before verified Gate A platform absence")

    ss = plan.get("source_snapshot") or {}
    if ss.get("state") != "captured" or ss.get("repository") != "ordaxsystems/ordax-os":
        reject("pre-removal snapshot not captured by plan")
    if ss.get("transfer_map") != MAP:
        reject("Internet plan must link to one canonical Gate B transfer map")
    prelaunch = plan.get("prelaunch_state") or {}
    if prelaunch != {
        "production_user_data_present": False,
        "legacy_user_data_migration_required": False,
        "developer_seed_data_can_be_reset": True,
        "host_owned_browser_storage_is_not_app_source": True,
    }:
        reject("prelaunch/no-user-data boundary must remain explicit")
    gates = plan.get("gate_status") or {}
    if gates != {
        "platform_absence_proven": False,
        "source_materialized_in_ordax_apps": False,
        "component_package_install_verified": False,
        "rollback_verified": False,
        "bootstrap_install_verified": False,
    }:
        reject("cannot mark Gate A/B or distribution verified without real evidence")
    if ss.get("inventory_file") != SNAPSHOT or ss.get("file_count") != 13:
        reject("pre-removal snapshot inventory pointer/count drifted")
    if snapshot.get("$schema") != "ordax.internet-source-snapshot/1":
        reject("canonical Internet source snapshot schema mismatch")
    if snapshot.get("repository") != ss["repository"] or snapshot.get("commit") != ss.get("commit"):
        reject("source snapshot commit not identical to canonical plan")
    if not isinstance(snapshot.get("commit"), str) or not SHA1_RE.fullmatch(snapshot["commit"]):
        reject("source snapshot requires exact lower-case Git commit")
    if snapshot.get("captured_before_gate_a_removal") is not True or snapshot.get("authority") != "none":
        reject("source snapshot cannot claim cutover or grant authority")
    sources = snapshot.get("files")
    if not isinstance(sources, list) or len(sources) != 13 or snapshot.get("file_count") != len(sources):
        reject("expected exactly thirteen pinned Internet product blobs")
    source_files: dict[str, dict] = {}
    for item in sources:
        if not isinstance(item, dict) or set(item) != {"path", "blob_sha", "size"}:
            reject("source blob inventory has unexpected fields")
        path, blob, size = item["path"], item["blob_sha"], item["size"]
        if not isinstance(path, str) or not (path.startswith("system/apps/internet/") or path == "system/services/i18n/catalog/internet.mjs"):
            reject("Internet source snapshot contains platform-owned host code")
        if ".." in Path(path).parts or "\\" in path or "//" in path:
            reject("unsafe source pathname")
        if not isinstance(blob, str) or not SHA1_RE.fullmatch(blob):
            reject("source Git blob SHA malformed")
        if not isinstance(size, int) or isinstance(size, bool) or not 0 < size < 4 * 1024 * 1024:
            reject("invalid Internet source file size")
        if path in source_files:
            reject("duplicate source blob path")
        source_files[path] = item
    required = {"system/apps/internet/runtime.mjs", "system/apps/internet/app.mjs",
                "system/apps/internet/component.mjs", "system/apps/internet/version.mjs",
                "system/apps/internet/internet.css",
                "system/apps/internet/ui/browser-controls.mjs",
                "system/services/i18n/catalog/internet.mjs"}
    if not required.issubset(source_files):
        reject("Internet snapshot is missing essential app-owned source")

    if mapping.get("$schema") != "ordax.internet-gate-b-transfer-map/1" or mapping.get("source_snapshot") != SNAPSHOT:
        reject("Gate B must derive from one canonical inventory")
    if mapping.get("source_commit") != snapshot["commit"] or mapping.get("source_file_count") != len(sources):
        reject("Gate B does not point to the same immutable source commit and file count")
    if mapping.get("target_root") != "apps/internet" or mapping.get("target_manifest") != "apps/internet/app.json":
        reject("Gate B target root/manifest mismatch")
    if mapping.get("authority") != "none":
        reject("Gate B mapping must not grant authority")
    rules = mapping.get("rules") or {}
    for key in ("dual_source_allowed", "copy_platform_host_implementation",
                "copy_webkitgtk_engine", "copy_native_download_or_permission_adapters",
                "source_copied_before_gate_a_absence_proof"):
        if rules.get(key) is not False:
            reject(f"unsafe Internet transfer rule: {key}")
    if rules.get("public_platform_contracts_consumed_via_sdk_or_injected_ports") is not True:
        reject("external app must consume SDK contracts / authorized host ports")
    manifest = mapping.get("manifest_replacement") or {}
    if manifest.get("schema") != "ordax.component-manifest/1" or manifest.get("id") != "internet":
        reject("external component manifest identity mismatch")
    if manifest.get("kind") != "app" or manifest.get("releaseMode") != "component-slot":
        reject("external Internet must use the platform component lifecycle")
    if manifest.get("owner") != "ordaxsystems/ordax-apps" or manifest.get("version") != "0.3.0":
        reject("manifest owner/version differs from pinned Internet app")
    if manifest.get("release_activation") != "blocked-until-platform-lifecycle-proof":
        reject("candidate must remain inactive until install/rollback proof")
    entries = mapping.get("mappings")
    if not isinstance(entries, list) or len(entries) != len(sources):
        reject("every pinned source needs a Gate B mapping")
    operations = {"relocate", "relocate-and-rewire-manifest-import",
                  "relocate-and-rewire-public-sdk-imports", "replace-by-manifest",
                  "fold-version-into-manifest", "move-app-owned-localization"}
    mapped = set()
    target_count: dict[str, int] = {}
    for entry in entries:
        if not isinstance(entry, dict) or set(entry) != {"source", "operation", "target"}:
            reject("invalid transfer map entry")
        source, operation, target = (entry["source"], entry["operation"], entry["target"])
        if source not in source_files or source in mapped or operation not in operations:
            reject("duplicate/unknown source or transfer operation")
        if not isinstance(target, str) or not target.startswith("apps/internet/") or "\\" in target or ".." in Path(target).parts:
            reject("Gate B target escapes application source root")
        mapped.add(source)
        target_count[target] = target_count.get(target, 0) + 1
        if source.endswith(("/app.mjs", "/component.mjs")) or source == "system/apps/internet/version.mjs":
            if target != "apps/internet/app.json":
                reject("legacy component identity must be replaced by manifest")
        elif target == "apps/internet/app.json":
            reject("non-identity app source must not be folded into manifest")
    if mapped != set(source_files) or target_count.get("apps/internet/app.json") != 3:
        reject("source inventory and unique external destinations diverged")
    if any(count != 1 for target, count in target_count.items() if target != "apps/internet/app.json"):
        reject("multiple source files would overwrite the same target")

    if lock.get("$schema") != "ordax.app-sdk-lock/1" or lock.get("repository") != "ordaxsystems/ordax-os":
        reject("App SDK lock owner mismatch")
    sdk = plan.get("target_sdk") or {}
    if sdk.get("lock_file") != LOCK or sdk.get("migration_authorized_by_sdk_pin") is not False:
        reject("SDK pin cannot grant migration authority")
    if version(lock.get("bundle_version")) < version(sdk.get("minimum_bundle_version")):
        reject("external Internet requires newer public App SDK")
    if not SHA1_RE.fullmatch(str(lock.get("commit"))) or not SHA256_RE.fullmatch(str(lock.get("sha256"))):
        reject("SDK pin missing immutable hash")
    if lock.get("authority") != "none":
        reject("SDK publication cannot grant OS authority")

    confirmed = False
    if platform_root is not None:
        if not platform_root.is_dir() or platform_root.is_symlink():
            reject("platform checkout must be a real directory")
        p = platform_root.resolve()

        def git_read(*args: str) -> str:
            result = subprocess.run(
                ["git", "-C", str(p), *args],
                capture_output=True, text=True, encoding="utf-8", check=False,
            )
            if result.returncode != 0:
                reject("canonical Git checkout proof unavailable: " + " ".join(args))
            return result.stdout.strip()

        if git_read("rev-parse", "--show-toplevel") != str(p):
            reject("platform checkout root mismatch")
        if git_read("status", "--porcelain", "--untracked-files=normal"):
            reject("platform Git checkout is dirty")
        origin = git_read("remote", "get-url", "origin").rstrip("/").removesuffix(".git")
        if origin not in {
            "https://github.com/ordaxsystems/ordax-os",
            "git@github.com:ordaxsystems/ordax-os",
            "ssh://git@github.com/ordaxsystems/ordax-os",
        }:
            reject("platform checkout does not have canonical Git origin")
        tree_paths = git_read(
            "ls-tree", "-r", "--name-only", "HEAD", "--",
            "system/apps/internet", "system/services/i18n/catalog/internet.mjs",
        ).splitlines()
        if set(tree_paths) != set(source_files) or len(tree_paths) != len(source_files):
            reject("canonical Git tree has a missing or unexpected Internet source blob")
        git = subprocess.run(["git", "-C", str(p), "rev-parse", "HEAD"],
                             capture_output=True, text=True, check=False)
        if git.returncode != 0 or git.stdout.strip() != snapshot["commit"]:
            reject("checked-out platform source is not exact pinned snapshot commit")
        observed = {}
        paths = [p / "system/apps/internet", p / "system/services/i18n/catalog/internet.mjs"]
        for item in paths:
            if item.is_dir() and not item.is_symlink():
                observed.update({f.relative_to(p).as_posix(): f for f in item.rglob("*") if f.is_file()})
            elif item.is_file() and not item.is_symlink():
                observed[item.relative_to(p).as_posix()] = item
            else:
                reject("platform source snapshot does not contain expected Internet files")
        if set(observed) != set(source_files):
            reject("pinned platform source inventory does not match actual checkout")
        for path, f in observed.items():
            if f.is_symlink():
                reject("Internet source snapshot contains symlink")
            content = f.read_bytes()
            sha1 = hashlib.sha1(b"blob " + str(len(content)).encode("ascii") + b"\0" + content).hexdigest()
            expected = source_files[path]
            if len(content) != expected["size"] or sha1 != expected["blob_sha"]:
                reject(f"pinned Internet source Git blob checksum mismatch: {path}")
        confirmed = True

    portability = None
    if confirmed:
        # Canonical platform checkout proves exact Git blobs before any
        # source import is used to plan the external package.
        bundle_path = platform_root / "sdk/app-sdk-v1/bundle.json"
        if not bundle_path.is_file() or bundle_path.is_symlink():
            reject("published SDK inventory unavailable in source checkout")
        bundle = json.loads(bundle_path.read_text(encoding="utf-8"))
        contracts = {entry["source_path"] for entry in bundle.get("contracts", [])}
        portability = check_portability_rewrites(platform_root, mapping, contracts)

    drift = (current_source_drift(current_platform_root, sources)
             if current_platform_root is not None else None)

    return {
        "schema": SCHEMA, "app_id": "internet", "source_commit": snapshot["commit"],
        "source_file_count": len(source_files),
        "source_bytes": sum(f["size"] for f in source_files.values()),
        "transfer_mapping_count": len(mapped),
        "checked_out_blob_integrity_verified": confirmed,
        "current_platform_source": drift,
        "portability_rewrites": portability,
        "source_cutover_allowed": False,
        "distribution_activation_allowed": False,
        "source_snapshot_ready": True,
        "remaining_gates": [
            "remove-platform-source-and-prove-platform-boot-without-internet",
            "materialize-external-package-only-after-gate-a",
            "signed-or-trusted-install-stage-health-promote",
            "offline-reinstall-and-rollback",
            "bootstrap-presence-in-initial-image",
        ],
    }

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--platform-root", type=Path, default=None)
    parser.add_argument("--current-platform-root", type=Path, default=None)
    parser.add_argument("--require-current-source", action="store_true")
    parser.add_argument("--require-cutover-ready", action="store_true")
    args = parser.parse_args(argv)
    try:
        report = audit(ROOT, platform_root=args.platform_root,
                       current_platform_root=args.current_platform_root)
        if args.require_current_source and (
            report["current_platform_source"] is None
            or not report["current_platform_source"]["snapshot_current"]
        ):
            reject("Internet snapshot differs from current platform source: " +
                   json.dumps(report["current_platform_source"], sort_keys=True))
        if args.require_cutover_ready:
            reject("Gate A source removal and independent install/rollback have not been proven")
    except InternetExternalizationError as exc:
        print("INTERNET_EXTERNALIZATION=FAIL\n" + str(exc), file=sys.stderr)
        return 1
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
