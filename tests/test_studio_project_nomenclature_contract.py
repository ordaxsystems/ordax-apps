"""Source-only guard for OrdaX Studio, OS local catalog, and Platform Project naming."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]

class StudioProjectNomenclatureTest(unittest.TestCase):
    def test_current_owner_and_historical_snapshot_are_not_confused(self):
        doc = (ROOT / "docs/PROJECTS-EXTERNALIZATION.md").read_text(encoding="utf-8")
        self.assertIn("ordaxsystems/ordax-os/system/apps/projects", doc)
        self.assertIn("historical repository path", doc.lower())
        self.assertIn("ordax.project-catalog/1", doc)
        self.assertIn("ordax_projects.project_id", doc)
        self.assertIn("not authorize Gate A/B", doc)

    def test_studio_local_creation_does_not_promise_cloud_project(self):
        doc = (ROOT / "docs/STUDIO-PROJECT-ONBOARDING.md").read_text(encoding="utf-8")
        source = (ROOT / "apps/studio/conversation/src/project-entry.mjs").read_text(encoding="utf-8")
        for label in ("workspace.project_create", "ordax_create_project_v1",
                      "ordax_spaces.space_id", "ordax_projects.project_id",
                      "binding.deviceId + binding.project", "Profile Pack"):
            with self.subTest(label=label):
                self.assertIn(label, doc)
        self.assertIn("projectSlug", source)
        self.assertIn("deviceId: device()", source)
        self.assertIn("project: project.slug", source)

if __name__ == "__main__":
    unittest.main()
