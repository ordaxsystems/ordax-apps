from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
COMPUTER = ROOT / "assets" / "computer_access.js"
ACCOUNT = ROOT / "assets" / "product_account.js"
STUDIO = ROOT / "assets" / "studio.js"
HOST = ROOT / "src" / "host_contract.js"


class RemoteComputerGrantBoundaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.computer = COMPUTER.read_text(encoding="utf-8")
        cls.account = ACCOUNT.read_text(encoding="utf-8")
        cls.studio = STUDIO.read_text(encoding="utf-8")
        cls.host = HOST.read_text(encoding="utf-8")

    def test_portable_ui_exposes_only_reviewed_owner_profiles(self) -> None:
        for mode in (
            "interactive-computer-control",
            "computer-filesystem",
            "computer-clipboard",
            "computer-process-control",
        ):
            self.assertIn(mode, self.computer)
        self.assertNotIn("full-computer-control", self.computer)
        self.assertNotIn("terminal.exec", self.computer)

    def test_portable_ui_has_no_control_plane_or_token_implementation(self) -> None:
        combined = "\n".join((self.computer, self.account))
        for forbidden in (
            "/v3/product/device-computer-grants",
            "Authorization: Bearer",
            "access_token",
            "CloudflareControlPlane",
            "ProductRemoteClient",
        ):
            self.assertNotIn(forbidden, combined)

    def test_remote_grant_methods_are_optional_host_capabilities(self) -> None:
        for method in (
            "remoteComputerGrants",
            "authorizeRemoteComputerGrant",
            "revokeRemoteComputerGrant",
        ):
            self.assertIn(method, self.host)
            self.assertIn(method, self.studio)
        required_block = self.host.split("const REQUIRED_METHODS", 1)[1].split("]);", 1)[0]
        self.assertNotIn("remoteComputerGrants", required_block)
        self.assertIn("const OPTIONAL_METHODS", self.host)

    def test_product_login_emits_state_only_event_without_credentials(self) -> None:
        self.assertIn("ordax:product-account-connected", self.account)
        event_line = next(line for line in self.account.splitlines() if "ordax:product-account-connected" in line)
        self.assertNotIn("password", event_line.lower())
        self.assertNotIn("token", event_line.lower())
        self.assertNotIn("localStorage", self.account)
        self.assertNotIn("sessionStorage", self.account)

    def test_remote_and_local_authority_are_presented_as_independent_gates(self) -> None:
        self.assertIn("As duas autoriza??es s?o necess?rias", self.computer)
        self.assertIn("Isso n?o cria grant remoto", self.computer)


if __name__ == "__main__":
    unittest.main()

