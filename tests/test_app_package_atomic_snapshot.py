"""Atomic deterministic package publishing and one-read payload snapshots."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location(
    "package_snapshot_fixtures", ROOT / "tests" / "test_app_package_builder.py",
)
fixtures = importlib.util.module_from_spec(_spec)
assert _spec.loader is not None
_spec.loader.exec_module(fixtures)
builder = fixtures.builder


class PackageSnapshotAtomicTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.app = fixtures.fixture(self.root)
        self.out = self.root / "fixture.zip"

    def staging(self):
        return list(self.root.glob(".fixture.zip.stage-*.zip"))

    def test_source_runtime_bytes_are_read_only_once_even_when_tree_changes(self):
        source = self.app / "src" / "runtime.mjs"
        initial = source.read_bytes()
        original_read = builder.read_regular
        counts = {"runtime": 0}

        def read_and_modify(path, *, max_bytes, label):
            data = original_read(path, max_bytes=max_bytes, label=label)
            if Path(path) == source:
                counts["runtime"] += 1
                source.write_bytes(b'import "node:fs";\\nexport const componentRuntime = {};\\n')
            return data

        with patch.object(builder, "read_regular", side_effect=read_and_modify):
            builder.build_package(self.app, fixtures.SOURCE_COMMIT, self.out)
        self.assertEqual(counts["runtime"], 1)
        with zipfile.ZipFile(self.out) as archive:
            self.assertEqual(
                archive.read("system/apps/fixture/src/runtime.mjs"), initial,
            )
        self.assertEqual(builder.verify_package(self.out)[0]["component"]["id"], "fixture")
        self.assertFalse(self.staging())

    def test_manifest_change_after_initial_validation_fails_before_publish(self):
        app_path = self.app / "app.json"
        original_read = builder.read_regular
        changed = False

        def change_during_initial_read(path, *, max_bytes, label):
            nonlocal changed
            data = original_read(path, max_bytes=max_bytes, label=label)
            if Path(path) == app_path and not changed:
                changed = True
                value = json.loads(data)
                value["title"] = "Changed after initial validation"
                app_path.write_text(json.dumps(value), encoding="utf-8")
            return data

        with patch.object(builder, "read_regular", side_effect=change_during_initial_read):
            with self.assertRaisesRegex(builder.AppPackageError, "manifest identity differs"):
                builder.build_package(self.app, fixtures.SOURCE_COMMIT, self.out)
        self.assertFalse(self.out.exists())
        self.assertFalse(self.staging())

    def test_mid_archive_write_failure_never_exposes_partial_output(self):
        original_write = zipfile.ZipFile.writestr

        def fail_runtime_write(archive, name, data, *args, **kwargs):
            filename = name.filename if isinstance(name, zipfile.ZipInfo) else name
            if filename.endswith("/src/runtime.mjs"):
                raise OSError("injected archive write failure")
            return original_write(archive, name, data, *args, **kwargs)

        with patch.object(zipfile.ZipFile, "writestr", fail_runtime_write):
            with self.assertRaisesRegex(OSError, "injected archive write failure"):
                builder.build_package(self.app, fixtures.SOURCE_COMMIT, self.out)
        self.assertFalse(self.out.exists())
        self.assertFalse(self.staging())

    def test_exclusive_publish_refuses_concurrent_target_and_cleans_staging(self):
        def destination_created_by_another_writer(source, target):
            Path(target).write_bytes(b"other writer's file")
            raise FileExistsError("destination exists")

        with patch.object(builder.os, "link", side_effect=destination_created_by_another_writer):
            with self.assertRaisesRegex(builder.AppPackageError, "refusing to overwrite"):
                builder.build_package(self.app, fixtures.SOURCE_COMMIT, self.out)
        self.assertEqual(self.out.read_bytes(), b"other writer's file")
        self.assertFalse(self.staging())

    def test_failed_atomic_publish_leaves_no_destination_or_staging(self):
        with patch.object(builder.os, "link", side_effect=OSError("filesystem rejects hardlinks")):
            with self.assertRaisesRegex(OSError, "filesystem rejects hardlinks"):
                builder.build_package(self.app, fixtures.SOURCE_COMMIT, self.out)
        self.assertFalse(self.out.exists())
        self.assertFalse(self.staging())

    def test_existing_final_zip_is_preserved(self):
        self.out.write_bytes(b"existing candidate")
        with self.assertRaisesRegex(builder.AppPackageError, "refusing to overwrite"):
            builder.build_package(self.app, fixtures.SOURCE_COMMIT, self.out)
        self.assertEqual(self.out.read_bytes(), b"existing candidate")
        self.assertFalse(self.staging())


if __name__ == "__main__":
    unittest.main()
