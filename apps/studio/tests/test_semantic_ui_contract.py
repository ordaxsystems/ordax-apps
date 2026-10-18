from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "conversation" / "src" / "index.html").read_text(encoding="utf-8")
APP = json.loads((ROOT / "app.json").read_text(encoding="utf-8"))
MAP = json.loads((ROOT / "presentation" / "semantic-ui.json").read_text(encoding="utf-8"))
SOURCE = (ROOT / "assets" / "semantic_ui.js").read_text(encoding="utf-8")
WINDOWS_BUILDER = (ROOT.parents[1] / "tools" / "assistant-host" / "build-windows.mjs").read_text(encoding="utf-8")

class StudioSemanticUiContractTests(unittest.TestCase):
    def test_manifest_is_non_authoritative_and_privacy_first(self) -> None:
        self.assertEqual(MAP["schema"], "ordax-apps.ui-semantic-map/1"); self.assertEqual(MAP["appId"], "studio"); self.assertEqual(MAP["appVersion"], APP["version"]); self.assertEqual(MAP["authority"], "none"); self.assertEqual(MAP["execution"], "descriptive-only"); self.assertFalse(MAP["privacy"]["captureInputValues"]); self.assertFalse(MAP["privacy"]["captureCredentials"])
    def test_every_declared_id_selector_exists_in_portable_studio(self) -> None:
        ids=[]
        for item in MAP["elements"]:
            self.assertRegex(item["id"], r"^[a-z][a-z0-9.-]{1,80}$"); self.assertTrue(item["selector"].startswith("#"), item); self.assertIn(f'id="{item["selector"][1:]}"', HTML, item); ids.append(item["id"])
        self.assertEqual(len(ids), len(set(ids))); self.assertGreaterEqual(len(ids),15)
    def test_snapshot_source_is_observation_only(self) -> None:
        self.assertIn('execution: "read-only"', SOURCE); self.assertIn("capturedInputValues: false", SOURCE)
        for forbidden in (".click(","dispatchEvent(","sendInputEvent","fetch(","XMLHttpRequest","localStorage","sessionStorage","document.cookie","Authorization","access_token","password"): self.assertNotIn(forbidden,SOURCE)
    def test_text_inputs_are_explicitly_redacted(self) -> None:
        self.assertIn('element.matches("input, textarea, select, [contenteditable=true]")', SOURCE); self.assertRegex(SOURCE,re.compile(r'return "";'))
    def test_runtime_observer_matches_packaged_semantic_ids_and_selectors(self) -> None:
        for item in MAP["elements"]: self.assertIn(f'["{item["id"]}", "{item["selector"]}", "{item["role"]}", "{item["surface"]}"]', SOURCE, item)
    def test_portable_page_loads_semantic_observer_before_interactive_modules(self) -> None:
        semantic='<script src="../../assets/semantic_ui.js"></script>'; studio='<script type="module" src="./app.mjs"></script>'; self.assertIn(semantic,HTML); self.assertLess(HTML.index(semantic),HTML.index(studio))
    def test_windows_portable_packages_semantics_but_not_agentic_test_plans(self) -> None:
        self.assertIn("['ai', 'actions', 'presentation']", WINDOWS_BUILDER); self.assertNotIn("['ai', 'actions', 'presentation', 'testing']", WINDOWS_BUILDER)

if __name__ == "__main__": unittest.main()
