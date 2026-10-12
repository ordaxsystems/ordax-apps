#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOCK_PATH = ROOT / "platform-sdk.lock.json"
TEST_PATH = ROOT / "tests" / "app_actions_sdk_conformance.mjs"
MAX_BUNDLE_BYTES = 1024 * 1024
MAX_CONTRACT_BYTES = 512 * 1024
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")

SOURCE_PATHS = (
    "system/contracts/component-manifest.mjs",
    "system/contracts/application-action-capability.mjs",
    "system/contracts/application-action-manifest.mjs",
    "system/contracts/application-action-provider.mjs",
)


def fail(message: str) -> None:
    raise SystemExit(f"ORDAX_APP_ACTIONS_SDK_CONFORMANCE=FAIL\n{message}")


def fetch_bounded(url: str, maximum: int) -> bytes:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "ordax-apps-action-conformance/1"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            if response.status != 200:
                fail(f"fetch failed with HTTP {response.status}: {url}")
            payload = response.read(maximum + 1)
    except OSError as exc:
        fail(f"could not fetch pinned SDK source: {exc}")
    if not payload or len(payload) > maximum:
        fail(f"fetched SDK source is outside byte bound: {url}")
    return payload


def raw_url(repository: str, commit: str, path: str) -> str:
    return f"https://raw.githubusercontent.com/{repository}/{commit}/{path}"


def git_blob_sha1(payload: bytes) -> str:
    prefix = f"blob {len(payload)}\0".encode("ascii")
    return hashlib.sha1(prefix + payload).hexdigest()  # noqa: S324 - Git object identity.


def main() -> None:
    lock = json.loads(LOCK_PATH.read_text(encoding="utf-8"))
    repository = lock.get("repository")
    commit = lock.get("commit")
    bundle_path = lock.get("bundle_path")
    expected_bundle_sha256 = lock.get("sha256")

    if repository != "ordaxsystems/ordax-os":
        fail("canonical platform repository is required")
    if not isinstance(commit, str) or COMMIT_RE.fullmatch(commit) is None:
        fail("exact lowercase platform commit is required")
    if bundle_path != "sdk/app-sdk-v1/bundle.json":
        fail("canonical App SDK bundle path is required")
    if not isinstance(expected_bundle_sha256, str) or re.fullmatch(r"[0-9a-f]{64}", expected_bundle_sha256) is None:
        fail("exact App SDK bundle SHA-256 is required")

    bundle_bytes = fetch_bounded(raw_url(repository, commit, bundle_path), MAX_BUNDLE_BYTES)
    if hashlib.sha256(bundle_bytes).hexdigest() != expected_bundle_sha256:
        fail("pinned App SDK bundle digest mismatch")
    bundle = json.loads(bundle_bytes.decode("utf-8"))

    version = bundle.get("bundle_version")
    match = re.fullmatch(
        r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)"
        r"(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?",
        version or "",
    )
    if match is None:
        fail("App SDK bundle version is invalid")
    major, minor, _patch = (int(part) for part in match.groups()[:3])
    if major != 1 or minor < 12:
        fail("Application Action provider conformance requires App SDK >=1.12")
    if bundle.get("authority") != "none":
        fail("pinned App SDK unexpectedly carries authority")

    blobs_by_path: dict[str, set[str]] = {path: set() for path in SOURCE_PATHS}
    schemas = set()
    for entry in bundle.get("contracts") or []:
        if not isinstance(entry, dict):
            continue
        schema = entry.get("schema")
        if isinstance(schema, str):
            schemas.add(schema)
        source_path = entry.get("source_path")
        if source_path in blobs_by_path:
            blob = entry.get("source_git_blob")
            if not isinstance(blob, str) or COMMIT_RE.fullmatch(blob) is None:
                fail(f"invalid Git blob identity for {source_path}")
            blobs_by_path[source_path].add(blob)

    for schema in (
        "ordax.application-action-capability/1",
        "ordax.application-action-manifest/1",
        "ordax.application-action-provider/1",
        "ordax.application-action-provider-invocation/1",
        "ordax.application-action-provider-result/1",
    ):
        if schema not in schemas:
            fail(f"App SDK does not publish {schema}")
    for source_path, blobs in blobs_by_path.items():
        if len(blobs) != 1:
            fail(f"App SDK must expose exactly one canonical Git blob for {source_path}")

    if not TEST_PATH.is_file():
        fail("Application Actions SDK conformance fixture is missing")

    with tempfile.TemporaryDirectory(prefix="ordax-app-actions-sdk-") as temporary:
        contract_root = Path(temporary)
        for source_path, blobs in blobs_by_path.items():
            payload = fetch_bounded(raw_url(repository, commit, source_path), MAX_CONTRACT_BYTES)
            if git_blob_sha1(payload) != next(iter(blobs)):
                fail(f"Git blob mismatch for pinned SDK contract: {source_path}")
            target = contract_root / Path(source_path).name
            target.write_bytes(payload)

        env = os.environ.copy()
        env["ORDAX_APP_ACTIONS_SDK_ROOT"] = str(contract_root)
        result = subprocess.run(
            ["node", "--test", str(TEST_PATH)],
            cwd=ROOT,
            env=env,
            check=False,
            text=True,
            capture_output=True,
            timeout=60,
        )
        if result.returncode != 0:
            fail(
                "public Application Action manifest conformance failed:\n"
                + (result.stdout + "\n" + result.stderr).strip()
            )

    print("ORDAX_APP_ACTIONS_SDK_CONFORMANCE=PASS")
    print(f"SDK_COMMIT={commit}")
    print(f"SDK_VERSION={version}")
    print("CONTRACT=ordax.application-action-manifest/1")
    print("PROVIDER_CONTRACT=ordax.application-action-provider/1")
    print("FIRST_PARTY_MANIFESTS=notes,studio")
    print("AUTHORITY=none")


if __name__ == "__main__":
    main()
