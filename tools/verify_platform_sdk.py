#!/usr/bin/env python3
import hashlib
import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOCK_PATH = ROOT / "platform-sdk.lock.json"
BUNDLE_VERSION_RE = re.compile(
    r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)"
    r"(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$"
)

EXPECTED_CONTRACTS = {
    "ordax.app-activation/1",
    "ordax.component-manifest/1",
    "ordax.component-runtime/1",
    "ordax.device-action-receipt/1",
    "ordax.device-action-request/1",
    "ordax.device-action-request/2",
    "ordax.device-agent-capabilities/1",
    "ordax.device-agent-capability-reader/1",
    "ordax.file-space/11",
    "ordax.first-party-app-delivery-policy/1",
    "ordax.intelligence/1",
    "ordax.localization/1",
    "prototype-ordax.localization-pack/1",
    "ordax.memory/1",
    "ordax.project-catalog/1",
    "ordax.studio-action-context/1",
    "ordax.studio-runtime/1",
    "ordax.studio-runtime/2",
    "ordax.surface-render-lifecycle/4",
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

    bundle_version = lock.get("bundle_version")
    if not isinstance(bundle_version, str) or not BUNDLE_VERSION_RE.fullmatch(bundle_version):
        fail("SDK bundle version must be a valid semantic version")
    if bundle_version.split(".", 1)[0] != "1":
        fail("SDK lock must remain on reviewed App SDK bundle major 1")
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
    if bundle.get("bundle_version") != bundle_version:
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
    print(f"SDK_VERSION={bundle_version}")
    print(f"SDK_CONTRACT_COUNT={len(contracts)}")
    print("SDK_AUTHORITY=none")


if __name__ == "__main__":
    main()
