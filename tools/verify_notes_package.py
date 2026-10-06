#!/usr/bin/env python3
"""Fail-closed Notes package proof across the remove-first source cutover.

Before Gate B, this proves that apps/notes is absent. Once the canonical
externalization plan explicitly enables the source cutover, the same check
builds the real Notes package twice, proves byte-for-byte determinism, and
validates the release-v2 inputs with the repository-owned package builder.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PLAN_PATH = ROOT / "migrations" / "notes.externalization.json"
COMPATIBILITY_PATH = ROOT / "migrations" / "notes.compatibility.json"
TARGET_PATH = ROOT / "apps" / "notes"
BUILDER_PATH = ROOT / "tools" / "app-package" / "build.py"


def fail(message: str) -> None:
    raise SystemExit(f"NOTES_PACKAGE_PROOF=FAIL\n{message}")


def load_builder():
    spec = importlib.util.spec_from_file_location("ordax_notes_package_builder", BUILDER_PATH)
    if spec is None or spec.loader is None:
        fail("cannot load canonical app package builder")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def checked_out_commit() -> str:
    try:
        value = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True, stderr=subprocess.DEVNULL
        ).strip()
    except (OSError, subprocess.CalledProcessError) as exc:
        fail(f"cannot resolve checked-out source commit: {exc}")
    if len(value) != 40 or any(char not in "0123456789abcdef" for char in value):
        fail("checked-out source commit is not exact lowercase 40-hex")
    return value


def main() -> None:
    plan = json.loads(PLAN_PATH.read_text(encoding="utf-8"))
    source_cutover_allowed = plan.get("source_cutover_allowed")
    if source_cutover_allowed not in (False, True):
        fail("source_cutover_allowed must be boolean")

    source_present = TARGET_PATH.exists()
    if not source_cutover_allowed:
        if source_present:
            fail("apps/notes exists before Gate A source cutover authorization")
        print("NOTES_PACKAGE_PROOF=PASS")
        print("NOTES_PACKAGE_STATE=BLOCKED_PRE_CUTOVER")
        return

    if not source_present or not TARGET_PATH.is_dir():
        fail("source cutover is enabled but apps/notes is absent")
    if plan.get("source_repository_current") != "washingtonmsdj/ordax-apps":
        fail("source cutover is enabled without ordax-apps canonical ownership")
    if plan.get("source_path_current") != "apps/notes":
        fail("source cutover is enabled with the wrong canonical source path")
    if plan.get("source_of_truth_state") != "ordax-apps-canonical":
        fail("source cutover is enabled without canonical source-of-truth state")

    builder = load_builder()
    source_commit = checked_out_commit()

    with tempfile.TemporaryDirectory(prefix="ordax-notes-package-") as td:
        temp = Path(td)
        out_a = temp / "a"
        out_b = temp / "b"
        out_a.mkdir()
        out_b.mkdir()
        package_a = out_a / "notes.zip"
        package_b = out_b / "notes.zip"

        manifest_a, _ = builder.build_package(TARGET_PATH, source_commit, package_a)
        release_a, compatibility_a = builder.write_release_v2(
            package_a, COMPATIBILITY_PATH, out_a
        )
        manifest_b, _ = builder.build_package(TARGET_PATH, source_commit, package_b)
        release_b, compatibility_b = builder.write_release_v2(
            package_b, COMPATIBILITY_PATH, out_b
        )

        if package_a.read_bytes() != package_b.read_bytes():
            fail("Notes package is not byte-for-byte deterministic")
        if release_a.read_bytes() != release_b.read_bytes():
            fail("Notes release-v2 descriptor is not deterministic")
        if compatibility_a.read_bytes() != compatibility_b.read_bytes():
            fail("Notes compatibility output is not deterministic")
        if manifest_a != manifest_b:
            fail("Notes package manifests differ between identical builds")

        verified_manifest, _ = builder.verify_package(package_a)
        component = verified_manifest.get("component") or {}
        if component.get("id") != "notes":
            fail("built package component id is not notes")
        if component.get("owner") != "washingtonmsdj/ordax-apps":
            fail("built Notes package owner is not ordax-apps")
        if component.get("releaseMode") != "component-slot":
            fail("built Notes package is not component-slot")
        if verified_manifest.get("entrypoint") != "system/apps/notes/src/runtime.mjs":
            fail("built Notes package entrypoint drifted")
        if verified_manifest.get("activation_allowed") is not False:
            fail("package builder must not grant direct Notes activation")
        if verified_manifest.get("signature_required_before_activation") is not True:
            fail("Notes package must require platform trust before activation")

        release = json.loads(release_a.read_text(encoding="utf-8"))
        if release.get("source_repository") != "washingtonmsdj/ordax-apps":
            fail("Notes release source repository is not canonical")
        if release.get("source_commit") != source_commit:
            fail("Notes release is not bound to the checked-out commit")
        if (release.get("component") or {}).get("release_mode") != "component-slot":
            fail("Notes release-v2 component mode drifted")
        activation = release.get("activation") or {}
        if activation.get("direct_activation_allowed") is not False:
            fail("Notes release must remain non-directly-activatable")
        if activation.get("pending_health_required") is not True:
            fail("Notes release must require pending health probation")

        with zipfile.ZipFile(package_a, "r") as archive:
            names = archive.namelist()
        if len(names) != len(set(names)):
            fail("Notes package contains duplicate archive paths")
        for name in names:
            if name == "component-package.json":
                continue
            if not name.startswith("system/apps/notes/"):
                fail(f"Notes package escaped component ownership: {name}")

    print("NOTES_PACKAGE_PROOF=PASS")
    print("NOTES_PACKAGE_STATE=EXTERNAL_SOURCE_DETERMINISTIC")
    print(f"NOTES_PACKAGE_SOURCE_COMMIT={source_commit}")


if __name__ == "__main__":
    main()
