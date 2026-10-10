"""First-party pre-cutover apps must not be copied into ordax-apps prematurely."""
from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from audit_app_readiness import audit_workspace  # noqa: E402
from verify_mvp_app_minimum import audit_mvp_minimum  # noqa: E402


class PlatformOwnerMvpTests(unittest.TestCase):
    def test_platform_owned_apps_have_explicit_fail_closed_source_provenance(self):
        report = audit_workspace(ROOT)
        blocked = [row for row in report["apps"]
                   if row["source_state"] == "platform-until-cutover"]
        # Floor comes from the existing six OS-owned app targets; app identity
        # itself is discovered from the workspace and migration files.
        self.assertGreaterEqual(len(blocked), 6)
        for row in blocked:
            app_id = row["app_id"]
            plan_path = ROOT / "migrations" / (app_id + ".externalization.json")
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            self.assertEqual(plan["$schema"], "ordax.app-externalization-plan/1")
            self.assertEqual(plan["app_id"], app_id)
            self.assertEqual(plan["source_repository_current"], "ordaxsystems/ordax-os")
            self.assertEqual(plan["source_path_current"], "system/apps/" + app_id)
            self.assertEqual(plan["target_repository"], "ordaxsystems/ordax-apps")
            self.assertEqual(plan["target_path"], "apps/" + app_id)
            self.assertEqual(plan["source_of_truth_state"], "platform-until-cutover")
            self.assertIs(plan["source_cutover_allowed"], False)
            self.assertIs(plan["distribution_activation_allowed"], False)
            self.assertEqual(plan["authority"], "none")
            self.assertIn("source-cutover-not-authorized", row["blockers"])
            self.assertFalse((ROOT / "apps" / app_id / "app.json").exists())

    def test_internet_cutover_must_not_duplicate_native_browser_engine(self):
        plan = json.loads((ROOT / "migrations/internet.externalization.json").read_text(
            encoding="utf-8"
        ))
        boundary = plan["runtime_boundary"]
        self.assertEqual(plan["source_of_truth_state"], "platform-until-cutover")
        self.assertIs(plan["source_cutover_allowed"], False)
        self.assertIs(plan["distribution_activation_allowed"], False)
        self.assertEqual(plan["delivery"]["delivery_class"], "bootstrap")
        self.assertFalse((ROOT / "apps/internet").exists())
        sdk = plan["target_sdk"]
        lock = json.loads((ROOT / sdk["lock_file"]).read_text(encoding="utf-8"))
        # Minimum compatibility is a floor, not another mutable SDK pin.
        # The lockfile is the sole source of truth for the deployed SDK version.
        minimum = tuple(int(part) for part in sdk["minimum_bundle_version"].split("."))
        pinned = tuple(int(part) for part in lock["bundle_version"].split("."))
        self.assertEqual(len(minimum), 3)
        self.assertEqual(len(pinned), 3)
        self.assertLessEqual(minimum, pinned)
        self.assertEqual(lock["repository"], plan["source_repository_current"])
        self.assertEqual(sdk["required_boundary"], "browser-contracts-from-published-bundle")
        self.assertIs(sdk["migration_authorized_by_sdk_pin"], False)
        self.assertEqual(boundary["application_ui_and_app_owned_state"], "application")
        for key in (
            "webkitgtk_engine",
            "unprivileged_webview_isolation",
            "network_and_site_permission_policy",
            "native_download_storage_and_filesystem_security",
            "verified_install_update_rollback",
        ):
            self.assertEqual(boundary[key], "platform", key)
        self.assertIs(boundary["private_platform_source_imports_after_cutover_allowed"], False)
        self.assertIs(boundary["second_web_engine_in_app_allowed"], False)

    def test_mvp_matrix_cannot_pretend_platform_owned_apps_are_package_candidates(self):
        report = audit_mvp_minimum(ROOT, minimum_candidates=13)
        blocked = [row for row in report["apps"]
                   if row["source_state"] == "platform-until-cutover"]
        self.assertGreaterEqual(len(blocked), 6)
        for row in blocked:
            self.assertEqual(row["minimum_entry_status"], "blocked-platform-source-cutover")
            self.assertFalse(row["production_installable"])
        self.assertEqual(report["summary"]["verified_public_store_installations"], 0)


if __name__ == "__main__":
    unittest.main()
