#!/usr/bin/env python3
"""Prepare real, increasing SemVer Notes package fixtures for ephemeral lifecycle CI.

Only creates temporary test sources. Never edits apps/notes or signed releases.
The generated fixture commits exist only in CI; they are not publishable owners.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
NOTES = ROOT / "apps/notes"
COMPATIBILITY = ROOT / "migrations/notes.compatibility.json"
MANIFESTS = (
    "app.json",
    "ai/manifest.json",
    "actions/manifest.json",
    "actions/providers/manifest.json",
    "presentation/manifest.json",
)


def fail(message: str) -> None:
    raise SystemExit("NOTES_LIFECYCLE_FIXTURE=FAIL " + message)


def write_versioned_fixture(label: str, version: str, old_version: str, output: Path) -> str:
    candidate = output / label
    root = candidate / "source"
    if candidate.exists():
        fail(f"{label}: output must be a fresh fixture directory")
    shutil.copytree(NOTES, root, symlinks=False)

    for relative in MANIFESTS:
        path = root / relative
        obj = json.loads(path.read_text(encoding="utf-8"))
        key = "version" if relative == "app.json" else "appVersion"
        if obj.get(key) != old_version:
            fail(f"{label}: {relative} does not match the canonical source version")
        obj[key] = version
        path.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    runtime = root / "src/runtime.mjs"
    content = runtime.read_text(encoding="utf-8")
    original = f'const NOTES_RUNTIME_VERSION = "{old_version}";'
    if content.count(original) != 1:
        fail(f"{label}: runtime identity is not uniquely versioned")
    runtime.write_text(content.replace(original, f'const NOTES_RUNTIME_VERSION = "{version}";'), encoding="utf-8")

    compatibility = json.loads(COMPATIBILITY.read_text(encoding="utf-8"))
    if compatibility.get("componentVersion") != old_version:
        fail(f"{label}: compatibility must match the canonical source version")
    compatibility["componentVersion"] = version
    (candidate / "compatibility.json").write_text(
        json.dumps(compatibility, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    # Fixture contents get an actual Git commit for deterministic signed-test
    # identity instead of invented '1111...'/'2222...' pseudo-commit strings.
    for cmd in (
        ["git", "init", "--quiet", str(root)],
        ["git", "-C", str(root), "add", "--all"],
        ["git", "-C", str(root), "-c", "user.name=OrdaX CI Fixture",
         "-c", "user.email=ci-fixture@ordax.invalid", "-c", "commit.gpgsign=false",
         "commit", "--quiet", "-m", f"test: synthetic Notes {version} update"],
    ):
        subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    commit = subprocess.check_output(
        ["git", "-C", str(root), "rev-parse", "HEAD"], text=True,
    ).strip()
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        fail(f"{label}: invalid local fixture commit")
    (candidate / "source_commit").write_text(commit + "\n", encoding="ascii")
    return commit


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    out = args.out.resolve()
    if out == ROOT or ROOT in out.parents:
        fail("test fixtures must be outside the repository checkout")
    app = json.loads((NOTES / "app.json").read_text(encoding="utf-8"))
    match = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)", app["version"])
    if match is None:
        fail("canonical Notes version is not a simple SemVer")
    major, minor, patch = map(int, match.groups())
    for label, increment in (("failed", 1), ("healthy", 2)):
        version = f"{major}.{minor}.{patch + increment}"
        commit = write_versioned_fixture(label, version, app["version"], out)
        print(f"NOTES_{label.upper()}_UPDATE_VERSION={version} FIXTURE_COMMIT={commit}")
    print("NOTES_LIFECYCLE_FIXTURE=PASS (ephemeral CI, no publication authority)")


if __name__ == "__main__":
    main()
