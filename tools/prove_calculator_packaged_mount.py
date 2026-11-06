#!/usr/bin/env python3
"""Exercise the real Calculator from the already verified Store candidate ZIP.

This proves deterministic package content, portable module mount and teardown
against Surface lifecycle v5/localization v2. It does NOT prove Windows host
integration, signature authority, production installation or physical boot.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
BUILDER = ROOT / "tools/app-package/build.py"
SMOKE = ROOT / "apps/calculator/tests/mount_contract.test.mjs"


def run(*args: str, env: dict | None = None) -> str:
    return subprocess.check_output(
        args, cwd=ROOT, env=env, text=True, stderr=subprocess.STDOUT, timeout=90,
    )


def prove(candidate: Path) -> dict:
    # No second builder, signer or catalog. Use ONLY the ZIP already prepared
    # and verified by the canonical Store publication candidate workflow.
    if not candidate.is_dir():
        raise ValueError("Verified Calculator candidate directory is missing")
    source_commit = run("git", "rev-parse", "HEAD").strip()
    if not re.fullmatch(r"[0-9a-f]{40}", source_commit):
        raise ValueError("An exact Git source revision is required")

    package = candidate / "calculator.zip"
    release = candidate / "calculator.release.json"
    compatibility = candidate / "calculator.compatibility.json"
    run(
        sys.executable, str(BUILDER), "verify",
        "--package", str(package),
        "--release", str(release),
        "--compatibility", str(compatibility),
    )
    metadata = json.loads(release.read_text(encoding="utf-8"))
    if metadata["source_commit"] != source_commit:
        raise ValueError("Candidate source commit does not match the checkout")
    if metadata["component"]["id"] != "calculator" or metadata["component"]["version"] != "0.2.1":
        raise ValueError("Calculator release identity/version drifted")
    if metadata["activation"]["direct_activation_allowed"] is not False:
        raise ValueError("Unsigned candidate must not activate directly")
    package_bytes = package.read_bytes()
    digest = hashlib.sha256(package_bytes).hexdigest()
    if digest != metadata["package"]["sha256"]:
        raise ValueError("Candidate package bytes differ from release")

    with tempfile.TemporaryDirectory(prefix="ordax-calculator-package-mount-") as temp:
        extracted = Path(temp) / "extracted"
        with zipfile.ZipFile(package, "r") as archive:
            # The canonical builder verified ZIP member names, permissions,
            # size, content hashes and module imports before extraction.
            archive.extractall(extracted)
        env = dict(
            os.environ,
            ORDAX_CALCULATOR_VERIFIED_PACKAGE_ROOT=str(extracted),
            ORDAX_CALCULATOR_COMPATIBILITY_PATH=str(compatibility),
        )
        output = run("node", "--test", str(SMOKE), env=env)
        matches = re.findall(r"^# pass (\d+)$", output, re.MULTILINE)
        failures = re.findall(r"^# fail (\d+)$", output, re.MULTILINE)
        if not matches or int(matches[-1]) < 7 or not failures or int(failures[-1]) != 0:
            raise ValueError("Calculator mounted runtime behavior is incomplete")

    return {
        "schema": "ordax.calculator-packaged-mount-proof/1",
        "componentId": "calculator",
        "version": metadata["component"]["version"],
        "sourceCommit": source_commit,
        "packageSha256": digest,
        "verifiedPackageRuntimeMounted": True,
        "stylesheetAndCleanupVerified": True,
        "calculatorOperationVerified": True,
        "existingSurfaceLocalizationContractsVerified": True,
        "signatureAuthority": False,
        "windowsHostIntegrationProven": False,
        "physicalInstallProven": False,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verified-candidate-dir", type=Path, required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(prove(args.verified_candidate_dir), ensure_ascii=False, sort_keys=True))
    except (OSError, ValueError, KeyError, TypeError, subprocess.CalledProcessError,
            subprocess.TimeoutExpired, zipfile.BadZipFile) as error:
        print(f"CALCULATOR_PACKAGED_MOUNT_PROOF_ERROR={error}", file=sys.stderr)
        if isinstance(error, subprocess.CalledProcessError):
            print(error.output or "", file=sys.stderr)
        raise SystemExit(1) from error
