from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
COMPUTER = ROOT / "assets" / "computer_access.js"
CONVERSATION = ROOT / "conversation" / "src"
CENTRAL_TURN = ROOT.parent / "central" / "src" / "turn-context.mjs"


class McpNomenclatureTests(unittest.TestCase):
    def test_active_surfaces_name_mcp_as_the_operational_boundary(self) -> None:
        computer = COMPUTER.read_text(encoding="utf-8")
        panel = (CONVERSATION / "plugin-panel.mjs").read_text(encoding="utf-8")
        html = (CONVERSATION / "index.html").read_text(encoding="utf-8")
        central = CENTRAL_TURN.read_text(encoding="utf-8")
        combined = "\n".join((computer, panel, html, central))

        for expected in (
            "MCP OrdaX",
            "cliente MCP",
            "servidor MCP",
        ):
            self.assertIn(expected, combined)

        for stale in (
            "Plugin Studio",
            "Conecte o plugin OrdaX",
            "instalação do plugin",
            "usar o plugin OrdaX",
            "Cadastrar o plugin no ChatGPT",
        ):
            self.assertNotIn(stale, combined)

    def test_internal_compatibility_ids_are_not_authority_names(self) -> None:
        html = (CONVERSATION / "index.html").read_text(encoding="utf-8")
        panel = (CONVERSATION / "plugin-panel.mjs").read_text(encoding="utf-8")
        self.assertIn('id="openPlugin"', html)
        self.assertIn("$('openPlugin')", panel)
        self.assertIn("MCP OrdaX", html)


if __name__ == "__main__":
    unittest.main()
