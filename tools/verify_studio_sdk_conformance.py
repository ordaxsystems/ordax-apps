#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOCK_PATH = ROOT / "platform-sdk.lock.json"
TEST_PATHS = (
    ROOT / "tests" / "studio_sdk_conformance.mjs",
    ROOT / "tests" / "studio_sdk_v2_conformance.mjs",
    ROOT / "tests" / "studio_sdk_v3_conformance.mjs",
)
MAX_BUNDLE_BYTES = 1024 * 1024
MAX_CONTRACT_BYTES = 512 * 1024
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")

# Only public contract modules required by the portable Studio composition.
# Nothing from system/services, composition, adapters or runtime implementation
# is materialized into the external app workspace.
SOURCE_PATHS = (
    "system/contracts/device-action-envelope.mjs",
    "system/contracts/device-action-envelope-v2.mjs",
    "system/contracts/device-action-result.mjs",
    "system/contracts/device-capabilities.mjs",
    "system/contracts/file-space.mjs",
    "system/contracts/intelligence.mjs",
    "system/contracts/locale-profile.mjs",
    "system/contracts/localization.mjs",
    "system/contracts/memory.mjs",
    "system/contracts/project-catalog.mjs",
    "system/contracts/studio-action-context.mjs",
    "system/contracts/studio-runtime.mjs",
    "system/contracts/studio-runtime-v2.mjs",
    "system/contracts/studio-runtime-v3.mjs",
)


def fail(message: str) -> None:
    raise SystemExit(f"ORDAX_STUDIO_SDK_CONFORMANCE=FAIL\n{message}")


def fetch_bounded(url: str, maximum: int) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "ordax-apps-studio-conformance/1"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            if response.status != 200:
                fail(f"fetch failed with HTTP {response.status}: {url}")
            payload = response.read(maximum + 1)
    except (OSError, urllib.error.URLError) as exc:
        fail(f"could not fetch pinned SDK source: {exc}")
    if not payload or len(payload) > maximum:
        fail(f"fetched SDK source is outside byte bound: {url}")
    return payload


def raw_url(repository: str, commit: str, path: str) -> str:
    encoded_path = urllib.parse.quote(path, safe="/")
    return f"https://raw.githubusercontent.com/{repository}/{commit}/{encoded_path}"


def git_blob_sha1(payload: bytes) -> str:
    prefix = f"blob {len(payload)}\0".encode("ascii")
    return hashlib.sha1(prefix + payload).hexdigest()  # noqa: S324 - Git object identity is SHA-1 by protocol.


def main() -> None:
    lock = json.loads(LOCK_PATH.read_text(encoding="utf-8"))
    repository = lock.get("repository")
    commit = lock.get("commit")
    bundle_path = lock.get("bundle_path")
    expected_bundle_sha256 = lock.get("sha256")

    if repository != "washingtonmsdj/prototipo-ordax-os":
        fail("Studio conformance requires the canonical platform repository")
    if not isinstance(commit, str) or not COMMIT_RE.fullmatch(commit):
        fail("Studio conformance requires an exact platform commit")
    if bundle_path != "sdk/app-sdk-v1/bundle.json":
        fail("Studio conformance requires the canonical App SDK bundle path")
    if not isinstance(expected_bundle_sha256, str) or not re.fullmatch(r"[0-9a-f]{64}", expected_bundle_sha256):
        fail("Studio conformance requires an exact bundle SHA-256")

    bundle_bytes = fetch_bounded(raw_url(repository, commit, bundle_path), MAX_BUNDLE_BYTES)
    if hashlib.sha256(bundle_bytes).hexdigest() != expected_bundle_sha256:
        fail("pinned App SDK bundle digest mismatch")
    try:
        bundle = json.loads(bundle_bytes.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        fail(f"pinned App SDK bundle is invalid JSON: {exc}")
    if bundle.get("authority") != "none" or bundle.get("compatibility_policy") != "contract-major":
        fail("pinned App SDK authority/compatibility policy drifted")

    blobs_by_path: dict[str, set[str]] = {path: set() for path in SOURCE_PATHS}
    for entry in bundle.get("contracts") or []:
        if not isinstance(entry, dict):
            continue
        path = entry.get("source_path")
        blob = entry.get("source_git_blob")
        if path in blobs_by_path:
            if not isinstance(blob, str) or not COMMIT_RE.fullmatch(blob):
                fail(f"SDK contract has invalid Git blob identity: {path}")
            blobs_by_path[path].add(blob)

    for path, blobs in blobs_by_path.items():
        if len(blobs) != 1:
            fail(f"SDK must expose exactly one canonical Git blob for {path}")
        if not path.startswith("system/contracts/"):
            fail(f"Studio conformance source escaped public contract layer: {path}")

    for test_path in TEST_PATHS:
        if not test_path.is_file():
            fail(f"Studio SDK conformance fixture is missing: {test_path.name}")

    with tempfile.TemporaryDirectory(prefix="ordax-studio-sdk-") as temporary:
        temp_root = Path(temporary)
        for source_path, blobs in blobs_by_path.items():
            payload = fetch_bounded(raw_url(repository, commit, source_path), MAX_CONTRACT_BYTES)
            expected_blob = next(iter(blobs))
            if git_blob_sha1(payload) != expected_blob:
                fail(f"Git blob mismatch for pinned SDK contract: {source_path}")
            try:
                payload.decode("utf-8", errors="strict")
            except UnicodeError as exc:
                fail(f"SDK contract is not UTF-8: {source_path}: {exc}")
            target = temp_root / source_path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(payload)

        env = os.environ.copy()
        env["ORDAX_STUDIO_SDK_ROOT"] = str(temp_root / "system" / "contracts")
        try:
            result = subprocess.run(
                ["node", "--test", *(str(path) for path in TEST_PATHS)],
                cwd=ROOT,
                env=env,
                check=False,
                text=True,
                capture_output=True,
                timeout=90,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            fail(f"could not execute Node Studio conformance fixtures: {exc}")
        if result.returncode != 0:
            output = (result.stdout + "\n" + result.stderr).strip()
            fail(f"Studio public-port conformance failed:\n{output}")

    print("ORDAX_STUDIO_SDK_CONFORMANCE=PASS")
    print(f"SDK_COMMIT={commit}")
    print(f"SDK_CONTRACT_MODULE_COUNT={len(SOURCE_PATHS)}")
    print("STUDIO_PUBLIC_PORTS=studio-runtime-v3,memory,intelligence,localization")
    print("STUDIO_COMPATIBILITY_PORTS=studio-runtime-v1,studio-runtime-v2")
    print("RAW_DEVICE_AGENT_EXPORTED=NO")
    print("PORTABLE_STUDIO_AUTHORITY=none")


if __name__ == "__main__":
    main()
