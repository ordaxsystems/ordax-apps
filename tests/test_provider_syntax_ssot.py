"""SSOT checks for provider syntax: derive modules from manifests, not CI app-id lists."""
from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools" / "verify_app_actions.py"
spec = importlib.util.spec_from_file_location("verify_app_actions", SCRIPT)
actions = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(actions)


def module_fixture(root: Path, source: str) -> tuple[Path, dict]:
    app = root / "apps" / "demo"
    path = app / "actions" / "providers" / "demo-native.mjs"
    path.parent.mkdir(parents=True)
    path.write_text(source, encoding="utf-8")
    return app, {"providers": [{"module": "actions/providers/demo-native.mjs"}]}


class ProviderSyntaxSsotTests(unittest.TestCase):
    def test_declared_provider_passes_node_syntax_check(self):
        with tempfile.TemporaryDirectory() as temp:
            app, manifest = module_fixture(Path(temp), "export const authority = 'none';\n")
            self.assertEqual(actions.check_provider_syntax(app, manifest), 1)

    def test_invalid_javascript_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            app, manifest = module_fixture(Path(temp), "export const broken = ;\n")
            with self.assertRaisesRegex(SystemExit, "syntax check failed"):
                actions.check_provider_syntax(app, manifest)

    def test_unlisted_provider_module_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            app, manifest = module_fixture(Path(temp), "export const authority = 'none';\n")
            (app / "actions" / "providers" / "undeclared.mjs").write_text(
                "export const hidden = true;\n", encoding="utf-8"
            )
            with self.assertRaisesRegex(SystemExit, "unlisted provider module"):
                actions.check_provider_syntax(app, manifest)

    def test_provider_symlink_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            app, manifest = module_fixture(Path(temp), "export const authority = 'none';\n")
            link = app / "actions" / "providers" / "shadow.mjs"
            link.symlink_to("demo-native.mjs")
            with self.assertRaisesRegex(SystemExit, "symlink forbidden"):
                actions.check_provider_syntax(app, manifest)

    def test_ci_does_not_duplicate_first_party_provider_inventory(self):
        workflow = (ROOT / ".github" / "workflows" / "foundation.yml").read_text(
            encoding="utf-8"
        )
        self.assertIn("verify_app_actions.py --check-provider-syntax", workflow)
        self.assertNotIn("node --check apps/", workflow)
        self.assertNotIn("python3 -m json.tool apps/", workflow)
        self.assertIn("find apps migrations", workflow)


if __name__ == "__main__":
    unittest.main()
