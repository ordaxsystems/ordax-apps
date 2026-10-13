#!/usr/bin/env python3
"""Unsigned Files package proof with NO source-owner cutover or activation.

Consumes only the pinned OS Git snapshot and canonical public SDK bundle.
All Files application bytes live in a disposable directory until this process
exits. The canonical source and native file services remain owned by OS.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import verify_files_cutover as cutover
import verify_files_portable_layout as portable

ROOT = Path(__file__).resolve().parents[1]
BUILDER_FILE = ROOT / "tools" / "app-package" / "build.py"
spec = importlib.util.spec_from_file_location("files_ephemeral_official_builder", BUILDER_FILE)
builder = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(builder)


class FilesProofError(RuntimeError):
    pass


def _write(root: Path, relative: str, content: bytes) -> None:
    target = root / cutover.safe_path(relative)
    if target.exists() or target.is_symlink():
        raise FilesProofError("staged Files path is duplicated")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(content)


def _json(value: dict) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")


def _original_manifests(platform_root: Path) -> dict:
    # Import the original validated manifests from the Git-pinned OS checkout,
    # never reconstruct their AI intents, capabilities or app identity by hand.
    script = r'''
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
const root = process.argv[1];
const read = async (name) => import(pathToFileURL(resolve(root, name)).href);
const { filesApp } = await read("system/apps/files/app.mjs");
const { filesIntelligenceManifest } = await read("system/apps/files/ai/manifest.mjs");
const { filesApplicationActionManifest } = await read("system/apps/files/actions/manifest.mjs");
const { applicationActionProviderArtifact } =
  await read("system/apps/files/actions/providers/files-native.mjs");
console.log(JSON.stringify({
  app: filesApp, ai: filesIntelligenceManifest,
  actions: filesApplicationActionManifest,
  provider: applicationActionProviderArtifact
}));
'''
    result = subprocess.run(
        ["node", "--input-type=module", "--eval", script, str(platform_root)],
        capture_output=True, text=True, check=True, timeout=40,
    )
    if len(result.stdout) > 128 * 1024:
        raise FilesProofError("source manifest projection exceeds bounds")
    data = json.loads(result.stdout)
    component = data["app"]["component"]
    if (
        data["app"]["id"] != "files"
        or component["id"] != "files"
        or component["version"] != "0.1.0"
        or component["owner"] != "system/apps/files"
        or component["releaseMode"] != "bundled"
        or data["ai"]["appId"] != "files"
        or data["ai"]["appVersion"] != component["version"]
        or data["actions"]["appId"] != "files"
        or data["actions"]["appVersion"] != component["version"]
        or data["actions"]["execution"] != "proposal-only"
        or data["provider"]["authority"] != "none"
        or data["provider"]["execution"] != "unavailable"
    ):
        raise FilesProofError("historical Files component/AI/action identity drifted")
    return data


def prove(root: Path, platform_root: Path, sdk_root: Path) -> dict:
    root, platform_root, sdk_root = root.resolve(), platform_root.resolve(), sdk_root.resolve()
    _, plan, sdk_pin = cutover.load_plan(root)
    if (
        plan["source_repository_current"] != "ordaxsystems/ordax-os"
        or plan["source_cutover_allowed"] is not False
        or plan["distribution_activation_allowed"] is not False
        or (root / "apps/files").exists()
    ):
        raise FilesProofError("refusing to create a parallel Files owner")
    layout = portable.audit(root, platform_root, sdk_root)
    if (
        layout["app_source_count"] != 10
        or not layout["canonical_package_source_graph_verified"]
        or layout["distribution_activation"] != "blocked"
        or layout["source_commit"] != plan["source_snapshot"]["commit"]
        or layout["sdk_bundle_version"] != sdk_pin["bundle_version"]
    ):
        raise FilesProofError("pinned Files portable graph is not verified")
    manifests = _original_manifests(platform_root)
    component = manifests["app"]["component"]
    app = {
        key: component[key] for key in (
            "schema", "id", "title", "kind", "version", "releaseMode",
            "criticality", "failureDomain", "restartScope", "healthMode",
            "owner", "dependencies",
        )
    }
    app.update({
        "releaseMode": "component-slot", "restartScope": "component",
        "healthMode": "runtime", "owner": "ordaxsystems/ordax-apps",
    })
    ai = manifests["ai"]
    actions = dict(manifests["actions"])
    if len(actions["capabilities"]) != 1 or actions["capabilities"][0]["actionId"] != "files.browse":
        raise FilesProofError("original Files actions exceed authorized read-only scope")
    capability = actions["capabilities"][0]
    original_params = capability["parameters"]
    if len(original_params) != 1 or original_params[0]["id"] != "location" or original_params[0]["type"] != "string":
        raise FilesProofError("Files historical browse input shape drifted")
    # OS validator expands absent cross-type fields to null. The canonical
    # external builder accepts only the explicit, type-compatible parameters.
    parameter = original_params[0]
    if any(parameter.get(name) is not None for name in ("minimum", "maximum", "values", "schemes")):
        raise FilesProofError("historical Files browse parameter changed its constraints")
    actions["capabilities"] = [{
        **capability,
        "parameters": [{
            key: parameter[key] for key in ("id", "type", "required", "maxLength")
        }],
        "provenance": "ordax-apps:ephemeral-files-candidate/actions/manifest.json",
    }]
    provider = manifests["provider"]
    if provider["appId"] != "files" or provider["adapterId"] != "files-native" or provider["revision"] != "1":
        raise FilesProofError("Files original provider identity drifted")
    provider_bytes = portable.PROVIDER_ENTRYPOINT_BYTES
    provider_manifest = {
        "schema": "ordax.application-action-provider-manifest/1",
        "appId": "files", "appVersion": app["version"],
        "authority": "none", "execution": "unavailable",
        "providers": [{
            "kind": "first-party-native", "adapterId": provider["adapterId"],
            "revision": provider["revision"],
            "module": portable.PACKAGE_PROVIDER_ENTRYPOINT,
            "sha256": hashlib.sha256(provider_bytes).hexdigest(),
        }],
    }
    compatibility = {
        "schema": "ordax.component-compatibility/1",
        "componentId": "files", "componentVersion": app["version"],
        "provides": [{"id": "ordax.component-runtime", "major": 1}],
        "requires": [
            {"id": cid, "minMajor": major, "maxMajor": major, "optional": False}
            for cid, major in (
                ("ordax.file-space", 11),
                ("ordax.localization", 2),
                ("ordax.surface-render-lifecycle", 5),
            )
        ],
        "state": None, "authority": "none",
    }
    # This only declares required ABI. The current host may not inject those
    # ports into verified external slots; a package passing here is NOT installable.
    for record in layout["source_modules_and_assets"]:
        if record["origin"] not in {"app", "sdk"}:
            raise FilesProofError("unrecognized Files payload provenance")
    with tempfile.TemporaryDirectory(prefix="ordax-files-proof-") as temp:
        staging = Path(temp)
        app_root = staging / "files"
        for record in layout["source_modules_and_assets"]:
            parent = platform_root if record["origin"] == "app" else sdk_root
            source_path = parent / record["source"]
            if not source_path.is_file() or source_path.is_symlink():
                raise FilesProofError("invalid Files source file")
            content = source_path.read_bytes()
            blob = hashlib.sha1(b"blob " + str(len(content)).encode() + bytes([0]) + content).hexdigest()
            if blob != record["git_blob_sha"]:
                raise FilesProofError("Files original Git blob mismatch")
            _write(app_root, record["package_path"], content)
        _write(app_root, portable.PACKAGE_RUNTIME_ENTRYPOINT, portable.ENTRYPOINT_BYTES)
        _write(app_root, portable.PACKAGE_PROVIDER_ENTRYPOINT, provider_bytes)
        for name, body in {
            "app.json": app,
            "ai/manifest.json": ai,
            "actions/manifest.json": actions,
            "actions/providers/manifest.json": provider_manifest,
        }.items():
            _write(app_root, name, _json(body))
        compatibility_path = staging / "compatibility.json"
        compatibility_path.write_bytes(_json(compatibility))
        # Exact immutable Apps repository identity: no pretend Files commit.
        source_commit = subprocess.check_output(
            ["git", "-C", str(root), "rev-parse", "HEAD"],
            text=True, timeout=10,
        ).strip()
        if len(source_commit) != 40:
            raise FilesProofError("Apps checkout revision invalid")
        packages = []
        for index in range(2):
            output = staging / f"candidate-{index}" / "files.zip"
            manifest, _ = builder.build_package(app_root, source_commit, output)
            verified, _ = builder.verify_package(output)
            if manifest != verified:
                raise FilesProofError("canonical Files candidate verification mismatch")
            release_dir = staging / f"candidate-{index}" / "release"
            release_path, compat_copy = builder.write_release_v2(output, compatibility_path, release_dir)
            release = json.loads(release_path.read_text("utf-8"))
            if release["activation"]["direct_activation_allowed"] is not False:
                raise FilesProofError("Files candidate incorrectly grants direct activation")
            if release["activation"]["pending_health_required"] is not True:
                raise FilesProofError("Files candidate does not require live probation")
            if compat_copy.read_bytes() != builder.canonical_json_bytes(compatibility):
                raise FilesProofError("Files compatibility descriptor bytes drifted")
            packages.append((hashlib.sha256(output.read_bytes()).hexdigest(), release["package"]["sha256"]))
        if packages[0] != packages[1] or packages[0][0] != packages[0][1]:
            raise FilesProofError("unsigned Files candidate was not deterministic")
        result = {
            "schema": "ordax.files-ephemeral-candidate-proof/1",
            "app_id": "files",
            "original_os_commit": layout["source_commit"],
            "pinned_sdk_version": layout["sdk_bundle_version"],
            "original_app_blobs_verified": layout["app_source_count"],
            "public_contract_blobs_verified": layout["sdk_contract_count"],
            "canonical_source_graph_verified": True,
            "deterministic_package_sha256": packages[0][0],
            "release_v2_candidate_verified": True,
            "source_of_truth_repository": "ordaxsystems/ordax-os",
            "second_permanent_files_source_created": False,
            "signed_install_verified": False,
            "bootstrap_delivery_verified": False,
            "distribution_activation_allowed": False,
        }
    if (root / "apps/files").exists():
        raise FilesProofError("ephemeral build contaminated persistent Apps source")
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--platform-root", type=Path, required=True)
    parser.add_argument("--sdk-platform-root", type=Path, required=True)
    options = parser.parse_args()
    try:
        print(json.dumps(
            prove(options.root, options.platform_root, options.sdk_platform_root),
            indent=2, sort_keys=True, ensure_ascii=False,
        ))
        return 0
    except (OSError, ValueError, KeyError, FilesProofError, cutover.FilesCutoverError,
            builder.AppPackageError, subprocess.CalledProcessError,
            subprocess.TimeoutExpired) as exc:
        print(f"FILES_EPHEMERAL_CANDIDATE=FAIL: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
