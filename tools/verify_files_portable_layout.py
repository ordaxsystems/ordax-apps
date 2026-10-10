#!/usr/bin/env python3
"""Prove the portable Files source layout from pinned owners, without packaging.

One source snapshot and one published SDK bundle are the only inventories.
This checker never creates apps/files, a runtime, an archive, or install authority.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import posixpath
import sys
from pathlib import Path

import verify_files_cutover as cutover

SCHEMA = "ordax.files-portable-layout/1"
MAX_FILE_BYTES = 2 * 1024 * 1024
MAX_TOTAL_BYTES = 16 * 1024 * 1024


def derive_layout(source_root: Path, sdk_root: Path, inventory: dict,
                  bundle: dict, dependency_audit: dict) -> dict:
    """Assemble an in-memory deployment path inventory, not source copies."""
    if not dependency_audit.get("sdk_boundary_clean"):
        raise cutover.FilesCutoverError("Files portable layout requires clean public SDK boundary")
    if dependency_audit.get("source_commit") != inventory.get("commit"):
        raise cutover.FilesCutoverError("Files portable layout source commit differs from inventory")
    if dependency_audit.get("sdk_bundle_version") != bundle.get("bundle_version"):
        raise cutover.FilesCutoverError("Files portable layout SDK differs from audited bundle")

    published = {}
    for item in bundle["contracts"]:
        name = cutover.safe_path(item["source_path"])
        digest = item.get("source_git_blob")
        if name in published and published[name] != digest:
            raise cutover.FilesCutoverError("Files published contract has conflicting blob identities")
        published[name] = digest

    sources = {cutover.safe_path(item["path"]): item["git_blob_sha"]
               for item in inventory["files"]}
    contracts = set(dependency_audit["public_contracts"]) | set(
        dependency_audit["transitive_public_contracts"])
    if set(sources) != {item["path"] for item in inventory["files"]}:
        raise cutover.FilesCutoverError("Files source inventory has duplicate paths")
    if contracts & set(sources):
        raise cutover.FilesCutoverError("Files app and SDK cannot own the same module")

    records = []
    virtual = set()
    total = 0

    def include(path: str, root: Path, blob: str, owner: str) -> None:
        nonlocal total
        if not isinstance(blob, str) or cutover.SHA40.fullmatch(blob) is None:
            raise cutover.FilesCutoverError("Files portable source Git blob is invalid")
        source = root / path
        if source.is_symlink() or not source.is_file():
            raise cutover.FilesCutoverError(f"Files portable source is missing: {path}")
        content = source.read_bytes()
        actual = hashlib.sha1(b"blob " + str(len(content)).encode("ascii") + b"\\0" + content).hexdigest()
        if actual != blob:
            raise cutover.FilesCutoverError(f"Files portable source identity mismatch: {path}")
        if not 0 < len(content) <= MAX_FILE_BYTES:
            raise cutover.FilesCutoverError(f"Files portable source exceeds per-file bounds: {path}")
        total += len(content)
        if total > MAX_TOTAL_BYTES:
            raise cutover.FilesCutoverError("Files portable sources exceed package byte limits")
        if path.endswith((".mjs", ".js")):
            target = "src/" + path
        elif path == "system/surface/ui/files.css" and owner == "app":
            target = "assets/files.css"
        else:
            raise cutover.FilesCutoverError(f"Files portable source has no canonical target: {path}")
        if target in virtual:
            raise cutover.FilesCutoverError(f"Files portable path collision: {target}")
        virtual.add(target)
        records.append({
            "source": path,
            "origin": owner,
            "package_path": target,
            "git_blob_sha": blob,
            "size": len(content),
        })

    for path, blob in sorted(sources.items()):
        include(path, source_root, blob, "app")
    for path in sorted(contracts):
        if path not in published:
            raise cutover.FilesCutoverError(f"Files portable contract is not published: {path}")
        include(path, sdk_root, published[path], "sdk")

    # All JavaScript keeps its original OS-relative hierarchy below src/.
    # Validate that every static relative reference remains inside the
    # virtual portable tree, with no rewritten imports or vendored private code.
    for record in records:
        if not record["package_path"].endswith((".mjs", ".js")):
            continue
        root = source_root if record["origin"] == "app" else sdk_root
        text = (root / record["source"]).read_text(encoding="utf-8")
        if cutover.NON_LITERAL_IMPORT_RE.search(text):
            raise cutover.FilesCutoverError("Files portable module uses nonliteral import")
        specs = [next(v for v in match.groups() if v is not None)
                 for match in cutover.SOURCE_IMPORT_RE.finditer(text)]
        specs += [match.group(1) for match in cutover.SOURCE_ASSET_RE.finditer(text)]
        for spec in specs:
            if not spec.startswith(".") or "\\\\" in spec or chr(0) in spec:
                raise cutover.FilesCutoverError("Files portable module contains unsafe import")
            target = posixpath.normpath(posixpath.join(
                posixpath.dirname(record["package_path"]), spec))
            if not target.startswith("src/") or target not in virtual:
                raise cutover.FilesCutoverError(
                    f"Files portable import does not resolve: {record['package_path']} -> {spec}"
                )
    return {
        "schema": SCHEMA,
        "app_id": "files",
        "source_commit": inventory["commit"],
        "sdk_bundle_version": bundle["bundle_version"],
        "sdk_contract_count": len(contracts),
        "app_source_count": len(sources),
        "portable_bytes": total,
        "source_modules_and_assets": records,
        "source_graph_self_contained": True,
        "runtime_entrypoint_provided": False,
        "external_app_manifest_provided": False,
        "package_built": False,
        "source_cutover_authorized": False,
        "distribution_activation": "blocked",
    }


def audit(root: Path, source_root: Path, sdk_root: Path) -> dict:
    root = root.resolve()
    _, plan, sdk_lock = cutover.load_plan(root)
    dependency_audit = cutover.audit_pinned_files_sdk(root, source_root.resolve(),
                                                      sdk_root.resolve(), plan)
    inventory = cutover.validate_source_inventory(root, plan)
    bundle = cutover.read_json(sdk_root / cutover.safe_path(sdk_lock["bundle_path"]))
    return derive_layout(source_root, sdk_root, inventory, bundle, dependency_audit)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--platform-root", type=Path, required=True)
    parser.add_argument("--sdk-platform-root", type=Path, required=True)
    args = parser.parse_args()
    try:
        result = audit(args.root, args.platform_root, args.sdk_platform_root)
    except (cutover.FilesCutoverError, OSError, UnicodeError) as exc:
        print(f"FILES_PORTABLE_LAYOUT=FAIL: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
