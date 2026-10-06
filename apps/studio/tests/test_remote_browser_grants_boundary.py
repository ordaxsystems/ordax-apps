from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BROWSER = ROOT / "assets" / "browser_access.js"
STUDIO = ROOT / "assets" / "studio.js"
HOST = ROOT / "src" / "host_contract.js"
INDEX = ROOT / "src" / "index.html"


class RemoteBrowserGrantBoundaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.browser = BROWSER.read_text(encoding="utf-8")
        cls.studio = STUDIO.read_text(encoding="utf-8")
        cls.host = HOST.read_text(encoding="utf-8")
        cls.index = INDEX.read_text(encoding="utf-8")

    def test_browser_is_first_class_project_view(self) -> None:
        self.assertIn('data-view="browser"', self.index)
        self.assertIn('id="browserCanvas"', self.index)
        self.assertIn('browser_access.js', self.index)
        self.assertIn("Navegador gerenciado", self.browser)
        self.assertIn("project-browser-automation", self.browser)

    def test_browser_owner_methods_are_optional_host_capabilities(self) -> None:
        for method in (
            "remoteBrowserGrants",
            "authorizeRemoteBrowserGrant",
            "revokeRemoteBrowserGrant",
        ):
            self.assertIn(method, self.host)
            self.assertIn(method, self.studio)
        required_block = self.host.split("const REQUIRED_METHODS", 1)[1].split("]);", 1)[0]
        self.assertNotIn("remoteBrowserGrants", required_block)

    def test_ui_does_not_own_product_tokens_or_control_plane_routes(self) -> None:
        for forbidden in (
            "/v3/product/project-capability-grants",
            "Authorization: Bearer",
            "access_token",
            "ProductRemoteClient",
        ):
            self.assertNotIn(forbidden, self.browser)

    def test_browser_grant_does_not_expand_into_computer_control(self) -> None:
        self.assertIn("Não concede Computer Control", self.browser)
        self.assertIn("Não concede Computer Control, clipboard, filesystem, terminal ou Full Access", self.browser)
        self.assertNotIn("computer.click", self.browser)
        self.assertNotIn("computer.hotkey", self.browser)
        self.assertNotIn("full-computer-control", self.browser)

    def test_missing_browser_grant_has_no_desktop_fallback(self) -> None:
        self.assertIn("falha explicitamente", self.browser)
        self.assertIn("não converte essa ausência em cliques por coordenada", self.browser)
        self.assertNotIn("computer_click", self.browser)
        self.assertNotIn("computer_hotkey", self.browser)


if __name__ == "__main__":
    unittest.main()
