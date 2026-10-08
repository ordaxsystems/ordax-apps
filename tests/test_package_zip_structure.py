"""Malicious ZIP metadata and compression must be rejected before member reads."""
from __future__ import annotations

import importlib.util
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location(
    "strict_zip_package_fixtures", ROOT / "tests" / "test_app_package_builder.py",
)
fixture_module = importlib.util.module_from_spec(_spec)
assert _spec.loader is not None
_spec.loader.exec_module(fixture_module)
builder = fixture_module.builder


class ZipStructureTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        app = fixture_module.fixture(self.root)
        self.original = self.root / "original.zip"
        self.forged = self.root / "forged.zip"
        builder.build_package(app, fixture_module.SOURCE_COMMIT, self.original)

    def forge(self, *, modify=None, order=None, comment=b""):
        with zipfile.ZipFile(self.original) as archive:
            data = [(info.filename, archive.read(info.filename)) for info in archive.infolist()]
        if order is not None:
            data = order(data)
        with zipfile.ZipFile(self.forged, "w") as out:
            for name, content in data:
                info = builder.zip_info(name)
                if modify is not None:
                    info, content = modify(info, content)
                out.writestr(info, content)
            out.comment = comment

    def test_builder_archive_still_passes_strict_receipt(self):
        manifest, _ = builder.verify_package(self.original)
        self.assertEqual(manifest["component"]["id"], "fixture")

    def test_deflated_member_with_matching_uncompressed_hash_fails_before_read(self):
        def compress(info, payload):
            if info.filename.endswith("/src/runtime.mjs"):
                info.compress_type = zipfile.ZIP_DEFLATED
            return info, payload
        self.forge(modify=compress)
        with patch.object(zipfile.ZipFile, "read", side_effect=AssertionError("read too early")):
            with self.assertRaisesRegex(builder.AppPackageError, "bounded stored"):
                builder.verify_package(self.forged)

    def test_overlarge_declared_member_fails_before_read(self):
        def oversized(info, payload):
            if info.filename.endswith("/src/runtime.mjs"):
                info.compress_type = zipfile.ZIP_DEFLATED
                payload = b"A" * (builder.MAX_FILE_BYTES + 1)
            return info, payload
        self.forge(modify=oversized)
        with patch.object(zipfile.ZipFile, "read", side_effect=AssertionError("read too early")):
            with self.assertRaisesRegex(builder.AppPackageError, "uncompressed size exceeds bound"):
                builder.verify_package(self.forged)

    def test_symlink_metadata_is_rejected_before_content(self):
        def symlink(info, payload):
            if info.filename.endswith("/src/runtime.mjs"):
                info.external_attr = (stat.S_IFLNK | 0o777) << 16
            return info, payload
        self.forge(modify=symlink)
        with self.assertRaisesRegex(builder.AppPackageError, "metadata is not canonical"):
            builder.verify_package(self.forged)

    def test_changed_timestamp_and_permission_are_rejected(self):
        def altered(info, payload):
            if info.filename.endswith("/app.json"):
                info.date_time = (2024, 1, 1, 0, 0, 0)
                info.external_attr = (stat.S_IFREG | 0o777) << 16
            return info, payload
        self.forge(modify=altered)
        with self.assertRaisesRegex(builder.AppPackageError, "metadata is not canonical"):
            builder.verify_package(self.forged)

    def test_unexpected_archive_comment_is_rejected(self):
        self.forge(comment=b"external publication claim")
        with self.assertRaisesRegex(builder.AppPackageError, "archive comment"):
            builder.verify_package(self.forged)

    def test_reordered_archive_members_are_rejected(self):
        self.forge(order=lambda data: [data[0]] + list(reversed(data[1:])))
        with self.assertRaisesRegex(builder.AppPackageError, "source entries must be sorted"):
            builder.verify_package(self.forged)

    def test_noncanonical_zip_member_path_is_rejected(self):
        def dot_segment(info, payload):
            if info.filename.endswith("/src/runtime.mjs"):
                info.filename = info.filename.replace("/src/runtime.mjs", "/src/./runtime.mjs")
            return info, payload
        self.forge(modify=dot_segment)
        with self.assertRaisesRegex(builder.AppPackageError, "safe relative POSIX path"):
            builder.verify_package(self.forged)

    def test_zip_with_extra_member_is_rejected(self):
        def extra(data):
            return data + [("system/apps/fixture/assets/unexpected.bin", b"extra")]
        self.forge(order=extra)
        with self.assertRaisesRegex(builder.AppPackageError, "file set does not match manifest"):
            builder.verify_package(self.forged)


if __name__ == "__main__":
    unittest.main()
