#!/usr/bin/env python3
"""Assistant transfer preflight. Read only: validates original blobs and SDK closure."""
from __future__ import annotations
import argparse
import hashlib
import json
import posixpath
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SHA1 = re.compile(r"^[0-9a-f]{40}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
IMPORTS = re.compile(r"""(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"]([^'"]+)['"]|(?:\bnew\s+URL\s*\(\s*['"]([^'"]+)['"])""")
DYNAMIC = re.compile(r"""\bimport\s*\(\s*(?!['"])""")
REQUIRED_SDK = frozenset({
    "system/contracts/intelligence-conversation-capabilities.mjs",
    "system/contracts/personal-ordax.mjs",
    "system/contracts/personal-ordax-store.mjs",
})
MANIFEST_OPS = {"replace-by-manifest", "fold-version-into-manifest"}
OTHER_OPS = {"derive-declarative-manifest", "relocate-style",
             "relocate-and-rewire-sdk", "move-app-owned-localization"}

class AssistantGateError(ValueError):
    pass

def need(value, reason):
    if not value:
        raise AssistantGateError(reason)

def safe_path(value):
    need(isinstance(value, str) and value and len(value) < 250
         and not value.startswith("/") and "\\" not in value
         and all(part not in ("", ".", "..") for part in value.split("/")),
         "unsafe relative migration path")
    return value

def read(root, path):
    p = root / path
    need(p.is_file() and not p.is_symlink() and p.stat().st_size <= 100000,
         "missing/symlinked/oversized migration metadata")
    result = json.loads(p.read_text(encoding="utf-8"))
    need(isinstance(result, dict), "migration metadata must be JSON object")
    return result

def semver(value):
    need(isinstance(value, str) and re.fullmatch(r"\d+\.\d+\.\d+", value),
         "invalid semantic SDK version")
    return tuple(map(int, value.split(".")))

def checkout(root, wanted):
    need(root.is_dir() and (root / ".git").exists(), "checkout .git missing")
    result = subprocess.run(["git", "-C", str(root), "rev-parse", "HEAD"],
                            capture_output=True, text=True, check=False)
    need(result.returncode == 0 and result.stdout.strip() == wanted,
         "wrong pinned OS source/SDK checkout")
    return root


def probe_platform_gate_a(main_checkout: Path) -> dict:
    """Prove absence at one observed main ref; never treat it as install proof."""
    main_checkout = main_checkout.resolve()
    need(main_checkout.is_dir() and (main_checkout / ".git").exists(),
         "canonical platform Git checkout missing")
    def git(*args):
        result = subprocess.run(["git", "-C", str(main_checkout), *args],
                                capture_output=True, text=True, check=False)
        need(result.returncode == 0, "cannot read canonical OS Git state")
        return result.stdout.strip()
    origin = git("remote", "get-url", "origin").removesuffix(".git").rstrip("/")
    need(origin in {"https://github.com/ordaxsystems/ordax-os",
                    "git@github.com:ordaxsystems/ordax-os",
                    "ssh://git@github.com/ordaxsystems/ordax-os"},
         "OS source origin is not the canonical repository")
    need(git("status", "--porcelain", "--untracked-files=normal") == "",
         "canonical OS main checkout is dirty")
    commit = git("rev-parse", "HEAD")
    need(SHA1.fullmatch(commit), "OS main checkout has invalid commit")
    need(git("symbolic-ref", "--short", "HEAD") == "main"
         and git("rev-parse", "refs/remotes/origin/main") == commit,
         "OS Gate A checkout is not verified tracking main")
    tracked = git("ls-files", "-z", "--", "system")
    # git outputs NUL-separated paths; subprocess text preserves NUL.
    tracked_paths = set(filter(None, tracked.split("\0")))
    owned_paths = sorted(p for p in tracked_paths if
                         p.startswith("system/apps/assistant/")
                         or p == "system/services/i18n/catalog/assistant.mjs")
    unresolved_consumers = []
    for name in sorted(tracked_paths):
        if name in owned_paths or not name.endswith((".mjs", ".js", ".ts", ".tsx")):
            continue
        path = main_checkout / name
        need(path.is_file() and not path.is_symlink(),
             "linked/missing platform runtime module")
        code = path.read_text(encoding="utf-8")
        for match in IMPORTS.finditer(code):
            spec = match.group(1) or match.group(2)
            if not spec.startswith("."):
                continue
            resolved = posixpath.normpath(posixpath.join(
                posixpath.dirname(name), spec))
            if (resolved.startswith("system/apps/assistant/")
                    or resolved == "system/services/i18n/catalog/assistant.mjs"):
                unresolved_consumers.append({"module": name, "dependency": resolved})
    package_policy = main_checkout / "docs/contracts/runtime-component-package.json"
    need(package_policy.is_file() and not package_policy.is_symlink(),
         "OS runtime-component package policy is absent")
    policy = json.loads(package_policy.read_text(encoding="utf-8"))
    marker = policy.get("prelaunch_remove_first_pending", {}).get("assistant")
    policy_correct = isinstance(marker, dict) and all((
        marker.get("state") == "platform-source-removed-app-source-pending",
        marker.get("expected_repository") == "ordaxsystems/ordax-apps",
        marker.get("platform_source_absence_required") is True,
        marker.get("distribution_activation_allowed") is False,
    ))
    return {
        "observed_main_commit": commit,
        "tracked_assistant_source": owned_paths,
        "live_assistant_source_imports": unresolved_consumers,
        "pending_policy_fail_closed": policy_correct,
        "platform_gate_a_main_proven": not owned_paths and
            not unresolved_consumers and policy_correct,
    }

def audit(root=ROOT, source_root=None, sdk_root=None,
          current_platform_root=None):
    plan = read(root, "migrations/assistant.externalization.json")
    snap = read(root, "migrations/assistant.source-snapshot.json")
    mapping = read(root, "migrations/assistant.gate-b-transfer-map.json")
    lock = read(root, "platform-sdk.lock.json")
    need(plan.get("app_id") == "assistant"
         and plan.get("target_repository") == "ordaxsystems/ordax-apps"
         and plan.get("distribution_activation_allowed") is False,
         "Assistant owner identity or release authority is invalid")
    source_state = plan.get("source_of_truth_state")
    if source_state == "platform-until-cutover":
        need(plan.get("source_repository_current") == "ordaxsystems/ordax-os"
             and plan.get("source_cutover_allowed") is False,
             "premature Assistant owner cutover/activation")
        need(not (root / "apps/assistant").exists() and not
             (root / "apps/assistant").is_symlink(), "second Assistant source forbidden")
    else:
        need(source_state == "ordax-apps-canonical"
             and plan.get("source_repository_current") == "ordaxsystems/ordax-apps"
             and plan.get("source_path_current") == "apps/assistant"
             and plan.get("source_cutover_allowed") is True,
             "inconsistent canonical Assistant source owner")
        gate_a = plan.get("gate_a_platform_commit")
        handoff = plan.get("source_cutover", {})
        gate_b = plan.get("gate_b", {})
        need(isinstance(gate_a, str) and SHA1.fullmatch(gate_a)
             and handoff.get("platform_absence_proven_at") == gate_a
             and handoff.get("dual_source_allowed") is False
             and gate_b.get("platform_absence_proven") is True
             and gate_b.get("app_source_authority") == "ordaxsystems/ordax-apps"
             and gate_b.get("signed_distribution_verified") is False
             and gate_b.get("native_install_verified") is False
             and gate_b.get("rollback_verified") is False,
             "Assistant Gate A proof or unsigned delivery safety is missing")
    need(snap.get("authority") == "none" and SHA1.fullmatch(str(snap.get("commit")))
         and snap.get("repository") == "ordaxsystems/ordax-os"
         and plan.get("source_snapshot", {}).get("commit") == snap["commit"],
         "snapshot provenance changed")
    need(mapping.get("$schema") == "ordax.assistant-gate-b-transfer-map/1"
         and mapping.get("source_snapshot") == "migrations/assistant.source-snapshot.json"
         and mapping.get("source_commit") == snap["commit"]
         and mapping.get("source_file_count") == snap["file_count"] == 11
         and mapping.get("target_root") == "apps/assistant"
         and mapping.get("target_manifest") == "apps/assistant/app.json"
         and mapping.get("authority") == "none", "transfer map identity invalid")
    rules = mapping.get("rules", {})
    for key in ("dual_source_allowed", "copy_platform_services",
                "copy_host_memory_service", "copy_identity_credentials",
                "copy_native_intelligence_adapter",
                "copy_before_platform_gate_a_main_proof",
                "inline_private_contracts"):
        need(rules.get(key) is False, "forbidden parallel implementation/privilege")
    need(rules.get("use_one_canonical_app_manifest") is True
         and rules.get("app_owned_i18n_injected_via_public_localization") is True,
         "second manifest or localization owner")
    manifest = mapping.get("manifest_replacement", {})
    need(manifest.get("id") == "assistant"
         and manifest.get("owner") == "ordaxsystems/ordax-apps"
         and manifest.get("releaseMode") == "component-slot"
         and manifest.get("release_activation") ==
         "blocked-until-platform-lifecycle-proof",
         "premature install manifest")
    pinned = {safe_path(x["path"]): x for x in snap["files"]}
    need(len(pinned) == len(snap["files"]) == 11, "duplicated or missing source")
    need(all(SHA1.fullmatch(str(x.get("blob_sha"))) and
             type(x.get("size")) is int and 0 < x["size"] < 1048576
             and (p.startswith("system/apps/assistant/") or
                  p == "system/services/i18n/catalog/assistant.mjs")
             for p, x in pinned.items()), "invalid Assistant source blob")
    rows = mapping.get("mappings")
    need(isinstance(rows, list) and len(rows) == 11, "incomplete source transfer")
    seen, mapped, manifest_src = set(), {}, set()
    for entry in rows:
        src, target, op = safe_path(entry["source"]), safe_path(entry["target"]), entry["operation"]
        need(src not in seen and target.startswith("apps/assistant/"),
             "duplicate or escaping app transfer")
        need(op in MANIFEST_OPS | OTHER_OPS and
             (target == "apps/assistant/app.json") == (op in MANIFEST_OPS),
             "unmapped/invalid package operation")
        seen.add(src)
        mapped[src] = entry
        if op in MANIFEST_OPS:
            manifest_src.add(src)
    need(seen == set(pinned), "transfer inventory differs from locked source")
    need(manifest_src == {
        "system/apps/assistant/app.mjs",
        "system/apps/assistant/component.mjs",
        "system/apps/assistant/version.mjs"}, "app manifest inputs changed")
    nonmanifest = [x["target"] for x in rows if x["operation"] not in MANIFEST_OPS]
    need(len(nonmanifest) == len(set(nonmanifest)), "two owners for one target")
    materialized = source_state == "ordax-apps-canonical"
    if materialized:
        for target in nonmanifest + ["apps/assistant/app.json"]:
            file = root / safe_path(target)
            need(file.is_file() and not file.is_symlink(),
                 "missing canonical Assistant source: " + target)
        need(not (root / "apps/assistant/ai/manifest.mjs").exists(),
             "second Assistant AI manifest owner forbidden")
    target_sdk = plan.get("target_sdk", {})
    need(target_sdk.get("minimum_bundle_version") == "1.18.0"
         and target_sdk.get("lock_file") == "platform-sdk.lock.json"
         and set(target_sdk.get("sdk_contract_source_paths", [])) == REQUIRED_SDK
         and target_sdk.get("migration_authorized_by_sdk_pin") is False
         and SHA1.fullmatch(str(lock.get("commit")))
         and SHA256.fullmatch(str(lock.get("sha256")))
         and lock.get("authority") == "none"
         and lock.get("repository") == "ordaxsystems/ordax-os",
         "Assistant missing protected public SDK boundary")
    sdk_sufficient = semver(lock.get("bundle_version")) >= (1, 18, 0)
    required, obligations, blob_proof = set(REQUIRED_SDK), [], False
    resolved_relocations = []
    manual_manifest_rewrites = []
    # App bytes are immutable; map imports virtually rather than copying or
    # silently rewriting files in the production repository.
    deploy_paths = set(nonmanifest + ["apps/assistant/app.json"])
    sdk_package_prefix = "apps/assistant/src/sdk/contracts/"
    sdk_required_by_app = set()

    if source_root is not None:
        base = checkout(source_root.resolve(), snap["commit"])
        for src, record in sorted(pinned.items()):
            path = base / src
            need(path.is_file() and not path.is_symlink(), "missing pinned source")
            payload = path.read_bytes()
            digest = hashlib.sha1(b"blob " + str(len(payload)).encode() +
                                  b"\0" + payload).hexdigest()
            need(len(payload) == record["size"] and digest == record["blob_sha"],
                 "pinned source changed: " + src)
            if src.endswith(".mjs") and mapped[src]["operation"] not in MANIFEST_OPS:
                content = payload.decode("utf-8")
                need(not DYNAMIC.search(content), "nonliteral app import")
                for match in IMPORTS.finditer(content):
                    spec = match.group(1) or match.group(2)
                    need(spec.startswith(".") and "\\" not in spec,
                         "private/nonrelative import")
                    dep = posixpath.normpath(posixpath.join(posixpath.dirname(src), spec))
                    if dep in mapped:
                        category = "manifest-rewire" if mapped[dep]["operation"] in MANIFEST_OPS else "app-owned"
                    elif dep.startswith("system/contracts/"):
                        category = "public-sdk-required"
                        required.add(dep)
                    else:
                        raise AssistantGateError("private platform dependency " + src + " -> " + dep)
                    obligations.append({"from": src, "dependency": dep, "kind": category})
                    app_path = mapped[src]["target"]
                    if category == "manifest-rewire":
                        # This is a deliberate source change, not a silent
                        # substitution of a JS module with a JSON import.
                        need(mapped[dep]["target"] == "apps/assistant/app.json",
                             "manifest import target changed")
                        manual_manifest_rewrites.append({
                            "importer": app_path, "source": src,
                            "dependency": dep,
                            "required_resolution": "app-manifest-metadata",
                        })
                        continue
                    if category == "app-owned":
                        deploy_target = mapped[dep]["target"]
                    else:
                        sdk_required_by_app.add(dep)
                        deploy_target = sdk_package_prefix + posixpath.basename(dep)
                    rewritten = posixpath.relpath(
                        deploy_target, posixpath.dirname(app_path))
                    if not rewritten.startswith("."):
                        rewritten = "./" + rewritten
                    need(posixpath.normpath(posixpath.join(
                        posixpath.dirname(app_path), rewritten)) == deploy_target,
                        "invalid virtual import rewrite")
                    if category == "app-owned":
                        need(deploy_target in deploy_paths,
                             "relocated app import has no target")
                    else:
                        need(deploy_target.startswith(sdk_package_prefix),
                             "SDK module escaped published public boundary")
                    resolved_relocations.append({
                        "importer": app_path, "specifier_before": spec,
                        "specifier_after": rewritten, "dependency": dep,
                        "target": deploy_target, "owner": category,
                    })
        blob_proof = True
    published, sdk_proof = set(), False
    transitive_sdk_sources = set()
    sdk_graph_verified = False
    if sdk_root is not None:
        base = checkout(sdk_root.resolve(), lock["commit"])
        content = (base / safe_path(lock["bundle_path"])).read_bytes()
        need(hashlib.sha256(content).hexdigest() == lock["sha256"],
             "SDK bundle digest drift")
        bundle = json.loads(content.decode("utf-8"))
        need(bundle.get("bundle_version") == lock["bundle_version"]
             and bundle.get("authority") == "none", "SDK lock content drift")
        entries = bundle.get("contracts")
        need(isinstance(entries, list) and entries, "invalid SDK contracts")
        # Multiple schema ids may deliberately share one canonical Git blob.
        # The same source path must never point to two distinct payloads.
        by_path = {}
        for entry in entries:
            path = safe_path(entry["source_path"])
            digest = entry.get("source_git_blob")
            need(path.startswith("system/contracts/") and
                 SHA1.fullmatch(str(digest)), "private/invalid SDK bundle entry")
            if path in by_path:
                need(by_path[path] == digest, "conflicting SDK source blob")
            by_path[path] = digest
        published = set(by_path)
        sdk_proof = True
        # Close the actual JS dependency graph, not merely the direct list
        # from app source. A missing public contract is a real Gate B blocker.
        pending = list(required)
        visited = set()
        missing_paths = set()
        while pending:
            path = pending.pop()
            if path in visited:
                continue
            visited.add(path)
            if path not in by_path:
                missing_paths.add(path)
                continue
            module = base / path
            need(module.is_file() and not module.is_symlink(),
                 "missing published SDK owner module: " + path)
            payload = module.read_bytes()
            digest = hashlib.sha1(b"blob " + str(len(payload)).encode()
                                  + b"\0" + payload).hexdigest()
            need(digest == by_path[path], "SDK canonical Git blob mismatch: " + path)
            code = payload.decode("utf-8")
            need(not DYNAMIC.search(code), "nonliteral published SDK import")
            for match in IMPORTS.finditer(code):
                spec = match.group(1) or match.group(2)
                need(spec.startswith(".") and "\\" not in spec,
                     "published SDK imports private/external module")
                dep = posixpath.normpath(posixpath.join(
                    posixpath.dirname(path), spec))
                need(dep.startswith("system/contracts/"),
                     "SDK dependency escapes canonical contract owner")
                pending.append(dep)
        transitive_sdk_sources = visited - missing_paths
        sdk_graph_verified = (not missing_paths and sdk_sufficient)
        # Check relocatable virtual target for every transitively imported
        # public SDK module. There is no copied source, install or grant.
        for module in transitive_sdk_sources:
            target = sdk_package_prefix + posixpath.basename(module)
            need(target not in deploy_paths, "SDK/app target path collides")
    platform = (probe_platform_gate_a(current_platform_root)
                if current_platform_root is not None else None)
    return {
        "schema": "ordax.assistant-gate-b-preflight/1",
        "source_file_count": len(pinned),
        "mapped_source_count": len(rows),
        "pinned_source_blobs_verified": blob_proof,
        "pinned_sdk_verified": sdk_proof,
        "sdk_version": lock["bundle_version"],
        "required_sdk_version": "1.18.0",
        "sdk_version_sufficient": sdk_sufficient,
        "required_public_sdk_sources": sorted(required),
        "sdk_transitive_source_count": len(transitive_sdk_sources),
        "sdk_graph_verified": sdk_graph_verified,
        "unpublished_contract_sources": sorted((required | transitive_sdk_sources) - published) if sdk_proof else [],
        "import_obligations": obligations,
        "direct_import_count": len(obligations),
        "virtual_relocations": sorted(resolved_relocations, key=lambda x: (x["importer"], x["specifier_before"])),
        "manifest_rewrites_required": manual_manifest_rewrites,
        "virtual_imports_resolved": blob_proof and
            len(resolved_relocations) + len(manual_manifest_rewrites) == len(obligations),
        "platform_gate_a_main_proven":
            platform["platform_gate_a_main_proven"] if platform else False,
        "platform_main_observation": platform,
        "app_source_materialized": materialized,
        "signed_install_verified": False,
        "rollback_verified": False,
        "gate_b_allowed_now": False,
        "authority": "none",
    }

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", type=Path)
    parser.add_argument("--sdk-root", type=Path)
    parser.add_argument("--current-platform-root", type=Path)
    args = parser.parse_args()
    print(json.dumps(audit(source_root=args.source_root,
                          sdk_root=args.sdk_root,
                          current_platform_root=args.current_platform_root),
                     ensure_ascii=False, sort_keys=True, indent=2))

if __name__ == "__main__":
    main()
