#!/usr/bin/env python3
import hashlib
import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOCK_PATH = ROOT / "migrations" / "notes.platform-sdk.lock.json"
SEMVER_RE = re.compile(
    r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)"
    r"(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$"
)

REQUIRED_CONTRACTS = {
    "ordax.app-activation/1",
    "ordax.app-data/1",
    "ordax.component-manifest/1",
    "ordax.component-runtime/1",
    "ordax.file-space/11",
    "ordax.intelligence/1",
    "ordax.localization/2",
    "prototype-ordax.localization-pack/1",
    "ordax.surface-render-lifecycle/5",
}


def fail(message: str) -> None:
    raise SystemExit(f"NOTES_PLATFORM_SDK=FAIL\n{message}")


def main() -> None:
    lock = json.loads(LOCK_PATH.read_text(encoding="utf-8"))
    expected_keys = {
        "$schema",
        "repository",
        "commit",
        "bundle_path",
        "bundle_schema",
        "bundle_version",
        "sha256",
        "authority",
    }
    if set(lock) != expected_keys:
        fail("Notes SDK lock fields drifted")
    if lock["$schema"] != "ordax.app-sdk-lock/1":
        fail("unexpected Notes SDK lock schema")
    if lock["repository"] != "washingtonmsdj/prototipo-ordax-os":
        fail("Notes SDK repository is not canonical")
    commit = lock["commit"]
    if not isinstance(commit, str) or re.fullmatch(r"[0-9a-f]{40}", commit) is None:
        fail("Notes SDK commit must be exact lowercase 40-hex")
    if lock["bundle_path"] != "sdk/app-sdk-v1/bundle.json":
        fail("unexpected Notes SDK bundle path")
    if lock["bundle_schema"] != "ordax.app-sdk-bundle/1":
        fail("unexpected Notes SDK bundle schema")
    if lock["bundle_version"] != "1.6.0" or SEMVER_RE.fullmatch(lock["bundle_version"]) is None:
        fail("Notes SDK must remain pinned to reviewed 1.6.0")
    if lock["authority"] != "none":
        fail("Notes SDK lock must carry no authority")
    if re.fullmatch(r"[0-9a-f]{64}", str(lock["sha256"])) is None:
        fail("Notes SDK SHA-256 is invalid")

    # The historical lock records provenance, not a redirect-dependent download owner.
    workspace = json.loads((ROOT / "ordax-apps.workspace.json").read_text(encoding="utf-8"))
    current_lock = json.loads((ROOT / "platform-sdk.lock.json").read_text(encoding="utf-8"))
    canonical = workspace.get("platform_repository")
    if canonical != "ordaxsystems/ordax-os" or current_lock.get("repository") != canonical:
        fail("Notes SDK download owner disagrees with the canonical workspace SDK owner")
    url = (
        "https://raw.githubusercontent.com/"
        f"{canonical}/{commit}/{lock['bundle_path']}"
    )
    request = urllib.request.Request(url, headers={"User-Agent": "ordax-notes-sdk-verifier/1"})
    with urllib.request.urlopen(request, timeout=30) as response:
        if response.status != 200:
            fail(f"Notes SDK bundle fetch failed with HTTP {response.status}")
        payload = response.read(1024 * 1024 + 1)
    if len(payload) > 1024 * 1024:
        fail("Notes SDK bundle exceeds 1 MiB")
    if hashlib.sha256(payload).hexdigest() != lock["sha256"]:
        fail("Notes SDK bundle digest mismatch")

    bundle = json.loads(payload.decode("utf-8"))
    if bundle.get("$schema") != lock["bundle_schema"]:
        fail("Notes SDK bundle schema does not match lock")
    if bundle.get("bundle_version") != lock["bundle_version"]:
        fail("Notes SDK bundle version does not match lock")
    if bundle.get("authority") != "none":
        fail("Notes SDK bundle unexpectedly carries authority")
    if bundle.get("compatibility_policy") != "contract-major":
        fail("Notes SDK compatibility policy drifted")

    contracts = bundle.get("contracts")
    if not isinstance(contracts, list) or not contracts:
        fail("Notes SDK contracts are missing")
    schemas = {
        item.get("schema")
        for item in contracts
        if isinstance(item, dict)
    }
    missing = sorted(REQUIRED_CONTRACTS - schemas)
    if missing:
        fail("Notes SDK is missing required contracts: " + ", ".join(missing))

    print("NOTES_PLATFORM_SDK=PASS")
    print(f"SDK_COMMIT={commit}")
    print("SDK_VERSION=1.6.0")
    print(f"SDK_CONTRACT_COUNT={len(contracts)}")
    print("NOTES_LOCALIZATION_MAJOR=2")
    print("NOTES_SURFACE_LIFECYCLE_MAJOR=5")
    print("SDK_AUTHORITY=none")


if __name__ == "__main__":
    main()
