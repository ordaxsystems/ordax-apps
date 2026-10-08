#!/usr/bin/env python3
"""G2: load real runtime modules extracted from canonical verified unsigned packages.

This is a bounded smoke test, NOT a host, grant, install or lifecycle proof.
The package builder owns validation and source discovery; the workspace auditor
owns target/ownership discovery. This module invents neither.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

from audit_app_readiness import AuditError, audit_workspace, builder, checked_git_commit

ROOT = Path(__file__).resolve().parents[1]
PROBE = ROOT / "tools" / "probes" / "packaged-runtime-probe.mjs"
SCHEMA = "ordax.app-packaged-runtime-smoke/1"
SOURCE_SHA = builder.SHA40_RE


class RuntimeSmokeError(ValueError):
    pass


def probe_app(root: Path, app_id: str, source_commit: str, output: Path) -> dict:
    """Probe exactly the bytes from a canonical package, not live source files."""
    if not SOURCE_SHA.fullmatch(source_commit):
        raise RuntimeSmokeError("source commit must be exact 40-hex")
    if not PROBE.is_file():
        raise RuntimeSmokeError("canonical Node runtime probe is missing")
    package = output / (app_id + ".zip")
    try:
        manifest, _ = builder.build_package(root / "apps" / app_id, source_commit, package)
        verified, _ = builder.verify_package(package)
        if verified != manifest or manifest["component"]["id"] != app_id:
            raise RuntimeSmokeError(f"{app_id}: package verification differs from build")
        extracted = output / "package"
        with zipfile.ZipFile(package, "r") as archive:
            for record in manifest["files"]:
                relative = builder.safe_relative(record["path"], "verified package member")
                if not isinstance(relative, PurePosixPath):
                    relative = PurePosixPath(relative.as_posix())
                target = extracted.joinpath(*relative.parts)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.read(record["path"]))
        entrypoint = extracted.joinpath(*PurePosixPath(manifest["entrypoint"]).parts)
        result = subprocess.run(
            ["node", str(PROBE), str(entrypoint), app_id, manifest["component"]["version"]],
            cwd=extracted,
            check=False, capture_output=True, text=True, timeout=15,
        )
        if result.returncode != 0:
            raise RuntimeSmokeError(
                f"{app_id}: packaged runtime smoke failed: "
                + (result.stderr.strip() or result.stdout.strip())[-1600:]
            )
        evidence = json.loads(result.stdout.strip())
        if evidence != {
            "schema": "ordax.component-runtime/1",
            "componentId": app_id,
            "version": manifest["component"]["version"],
            "moduleImport": "passed",
            "missingHostPorts": "rejected",
            "authority": "none",
        }:
            raise RuntimeSmokeError(f"{app_id}: unexpected packaged runtime probe evidence")
        return {
            "source_commit": source_commit,
            "component_version": manifest["component"]["version"],
            "module_import": "verified",
            "missing_host_ports": "rejected",
        }
    except (builder.AppPackageError, OSError, ValueError, zipfile.BadZipFile,
            subprocess.TimeoutExpired) as exc:
        raise RuntimeSmokeError(f"{app_id}: {exc}") from exc


def run_audit(root: Path, source_commit: str) -> dict:
    """Derive eligible apps from G0; absence of source/compatibility is not success."""
    try:
        workspace = audit_workspace(root)
    except AuditError as exc:
        raise RuntimeSmokeError(f"canonical workspace is invalid: {exc}") from exc
    verified = 0
    rows = []
    with tempfile.TemporaryDirectory(prefix="ordax-g2-runtime-") as temp:
        for app in workspace["apps"]:
            row = {"app_id": app["app_id"], "source_state": app["source_state"]}
            metadata = app["metadata"]
            if app["source_state"] != "canonical-source":
                row["status"] = "not-assessed-no-canonical-source"
            elif not metadata or not metadata["compatibility"]:
                row["status"] = "not-assessed-no-package-boundary"
            else:
                evidence = probe_app(
                    root, app["app_id"], source_commit,
                    Path(temp) / app["app_id"],
                )
                row["status"] = "verified-packaged-module-smoke"
                row["evidence"] = evidence
                verified += 1
            rows.append(row)
    return {
        "schema": SCHEMA,
        "authority": "none",
        "source_commit": source_commit,
        "summary": {
            "target_count": len(rows),
            "packaged_modules_verified": verified,
            "not_assessed": len(rows) - verified,
            "host_mounts_verified": 0,
            "installs_verified": 0,
            "production_releases_verified": 0,
        },
        "apps": rows,
        "disclaimer": (
            "Imports actual verified candidate-package source using local Node and tests "
            "empty-host-port denial. Does not prove successful host mount, UI rendering, "
            "sandbox isolation, grants, installation, lifecycle, signing, or production."
        ),
    }


def render_markdown(report: dict) -> str:
    lines = [
        "# OrdaX Apps — G2 packaged-runtime smoke",
        "",
        "| App | Source | Pacote/runtime |",
        "| --- | --- | --- |",
    ]
    for row in report["apps"]:
        lines.append(f"| {row['app_id']} | {row['source_state']} | {row['status']} |")
    summary = report["summary"]
    lines.extend([
        "",
        f"**Módulos reais verificados:** {summary['packaged_modules_verified']}/"
        f"{summary['target_count']}; **não avaliados:** {summary['not_assessed']}.",
        "",
        report["disclaimer"],
        "",
    ])
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--format", choices=("json", "markdown"), default="markdown")
    args = parser.parse_args()
    try:
        root = args.root.resolve()
        report = run_audit(root, checked_git_commit(root))
    except (AuditError, RuntimeSmokeError) as exc:
        print(f"ORDAX_PACKAGED_RUNTIME_SMOKE=FAIL\n{exc}", file=sys.stderr)
        return 1
    print(render_markdown(report) if args.format == "markdown" else
          json.dumps(report, indent=2, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
