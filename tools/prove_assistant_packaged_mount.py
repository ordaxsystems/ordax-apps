#!/usr/bin/env python3
"""Exercise real app runtime bytes from the existing deterministic unsigned ZIP.

This is a source/package and synthetic-DOM mount proof, NOT a signature,
Native WebKit proof, component promotion, Store install or physical boot.
"""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUILDER = ROOT / "tools/app-package/build.py"
APP = ROOT / "apps/assistant"
SMOKE = APP / "tests/packaged-runtime-smoke.mjs"


def run(*args: str) -> str:
    return subprocess.check_output(
        list(args), cwd=ROOT, text=True, stderr=subprocess.STDOUT
    ).strip()


def proof() -> dict:
    source_commit = run("git", "rev-parse", "HEAD")
    if len(source_commit) != 40 or any(x not in "0123456789abcdef" for x in source_commit):
        raise ValueError("Cannot prove an exact canonical source commit")
    with tempfile.TemporaryDirectory(prefix="ordax-assistant-package-mount-") as temp:
        directory = Path(temp)
        package = directory / "assistant.zip"
        release = directory / "assistant.release.json"
        compatibility = directory / "assistant.compatibility.json"
        run(
            sys.executable, str(BUILDER), "build",
            "--app-root", str(APP),
            "--source-commit", source_commit,
            "--compatibility", str(APP / "compatibility.json"),
            "--package-out", str(package),
            "--release-dir", str(directory),
        )
        run(
            sys.executable, str(BUILDER), "verify",
            "--package", str(package),
            "--release", str(release),
            "--compatibility", str(compatibility),
        )
        metadata = json.loads(release.read_text(encoding="utf-8"))
        data = package.read_bytes()
        if hashlib.sha256(data).hexdigest() != metadata["package"]["sha256"]:
            raise ValueError("Canonical package identity changed after verification")
        if metadata["source_commit"] != source_commit:
            raise ValueError("Release is not tied to this source commit")
        if metadata["activation"]["direct_activation_allowed"] is not False:
            raise ValueError("Unsigned candidate cannot directly activate")
        extracted = directory / "extracted"
        with zipfile.ZipFile(package, "r") as archive:
            # Only extract AFTER the canonical receiver has checked every
            # path, size, member mode, hash, import and manifest identity.
            archive.extractall(extracted)
        output = run("node", str(SMOKE), str(extracted))
        report = json.loads(output.splitlines()[-1])
        if (
            report.get("schema") != "ordax.assistant-packaged-mount-proof/1"
            or report.get("componentId") != metadata["component"]["id"]
            or report.get("version") != metadata["component"]["version"]
            or report.get("actualPackagedRuntimeImported") is not True
            or report.get("actualPackagedRuntimeMounted") is not True
            or report.get("actualPackagedRuntimeDestroyed") is not True
            or report.get("nativeEmptyRootRendered") is not True
            or report.get("hostExtensionOwnershipPreserved") is not True
            or report.get("failedMountTeardownVerified") is not True
            or report.get("syntheticIdentitySpaceIntelligenceOnly") is not True
            or report.get("inferenceExecuted") is not False
            or report.get("signedDistributionVerified") is not False
            or report.get("nativeWebKitBootVerified") is not False
        ):
            raise ValueError("Packaged runtime mounted proof is incomplete")
        return {
            **report,
            "sourceCommit": source_commit,
            "packageSha256": metadata["package"]["sha256"],
            "canonicalUnsignedPackageVerified": True,
            "signatureAuthority": False,
            "nativeInstallProven": False,
        }


if __name__ == "__main__":
    try:
        print(json.dumps(proof(), ensure_ascii=False, sort_keys=True))
    except (OSError, ValueError, subprocess.CalledProcessError, zipfile.BadZipFile) as error:
        print(f"ASSISTANT_PACKAGED_MOUNT_PROOF_ERROR={error}", file=sys.stderr)
        if isinstance(error, subprocess.CalledProcessError):
            print(error.output or "", file=sys.stderr)
        raise SystemExit(1) from error
