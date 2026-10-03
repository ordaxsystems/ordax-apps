#!/usr/bin/env python3
import hashlib
import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOCK_PATH = ROOT / "platform-sdk.lock.json"

EXPECTED_CONTRACTS = {
    "ordax.component-manifest/1",
    "ordax.intelligence/1",
    "ordax.memory/1",
    "prototype-ordax.localization-pack/1",
}


def fail(message: str) -> None:
    raise SystemExit(f"ORDAX_PLATFORM_SDK=FAIL\n{message}")


def main() -> None:
    lock = json.loads(LOCK_PATH.read_text(encoding="utf-8"))
    if lock.get("$schema") != "ordax.app-sdk-lock/1":
        fail("unexpected SDK lock schema")
    if lock.get("repository") != "washingtonmsdj/prototipo-ordax-os":
        fail("SDK repository is not canonical")
    commit = lock.get("commit")
    if not isinstance(commit, str) or len(commit) != 40 or any(ch not in "0123456789abcdef" for ch in commit):
        fail("SDK commit must be an exact lowercase 40-hex commit")
    if lock.get("bundle_path") != "sdk/app-sdk-v1/bundle.json":
        fail("unexpected SDK bundle path")
    if lock.get("bundle_schema") != "ordax.app-sdk-bundle/1":
        fail("unexpected SDK bundle schema")
    if lock.get("bundle_version") != "1.0.0":
        fail("unexpected SDK bundle version")
    if lock.get("authority") != "none":
        fail("SDK lock must not carry authority")

    expected_hash = lock.get("sha256")
    if not isinstance(expected_hash, str) or len(expected_hash) != 64:
        fail("SDK SHA-256 pin is invalid")

    url = (
        "https://raw.githubusercontent.com/"
        f"{lock['repository']}/{commit}/{lock['bundle_path']}"
    )
    request = urllib.request.Request(url, headers={"User-Agent": "ordax-apps-sdk-verifier/1"})
    with urllib.request.urlopen(request, timeout=30) as response:
        if response.status != 200:
            fail(f"SDK bundle fetch failed with HTTP {response.status}")
        content = response.read(1024 * 1024 + 1)
    if len(content) > 1024 * 1024:
        fail("SDK bundle exceeds 1 MiB bound")

    actual_hash = hashlib.sha256(content).hexdigest()
    if actual_hash != expected_hash:
        fail("SDK bundle digest mismatch")

    bundle = json.loads(content.decode("utf-8"))
    if bundle.get("$schema") != lock["bundle_schema"]:
        fail("fetched SDK schema does not match lock")
    if bundle.get("bundle_version") != lock["bundle_version"]:
        fail("fetched SDK version does not match lock")
    if bundle.get("authority") != "none":
        fail("fetched SDK unexpectedly carries authority")
    if bundle.get("compatibility_policy") != "contract-major":
        fail("SDK compatibility policy drifted")

    contracts = bundle.get("contracts")
    if not isinstance(contracts, list) or not contracts:
        fail("SDK contracts must be a non-empty list")
    schemas = {entry.get("schema") for entry in contracts if isinstance(entry, dict)}
    if not EXPECTED_CONTRACTS.issubset(schemas):
        missing = sorted(EXPECTED_CONTRACTS - schemas)
        fail(f"SDK is missing required contracts: {', '.join(missing)}")

    print("ORDAX_PLATFORM_SDK=PASS")
    print(f"SDK_COMMIT={commit}")
    print(f"SDK_VERSION={bundle['bundle_version']}")
    print(f"SDK_CONTRACT_COUNT={len(contracts)}")
    print("SDK_AUTHORITY=none")


if __name__ == "__main__":
    main()
