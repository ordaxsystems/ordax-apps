from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
COMPUTER = (ROOT / "assets" / "computer_access.js").read_text(encoding="utf-8")
SAFETY = (ROOT / "assets" / "computer_safety.js").read_text(encoding="utf-8")
BROWSER = (ROOT / "assets" / "browser_access.js").read_text(encoding="utf-8")


class OwnerGrantAuthorityContractTests(unittest.TestCase):
    def test_ui_has_no_device_link_authority(self) -> None:
        source = COMPUTER + "\n" + SAFETY + "\n" + BROWSER
        for forbidden in (
            "link_id",
            "remoteComputerLink",
            "remoteBrowserLink",
            "custom-device-grant",
            "data?.links",
            "data?.grants",
            "remoteComputerGrants?.links",
            "remoteComputerGrants?.grants",
        ):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, source)

    def test_computer_observe_is_recommended_least_privilege_profile(self) -> None:
        self.assertIn("mode:'computer-observe'", COMPUTER)
        self.assertIn("recommended:true", COMPUTER)
        for capability in (
            "screenshot, clique, digitação, clipboard, filesystem",
            "grant groups",
            "client_id",
        ):
            self.assertIn(capability, COMPUTER)

    def test_multiple_oauth_clients_fail_closed(self) -> None:
        self.assertIn("if(clients.length===1)", COMPUTER)
        self.assertIn("state[key]=null;return null", COMPUTER)
        self.assertIn("Nenhum cliente é escolhido automaticamente", COMPUTER)
        self.assertIn("Seleção obrigatória", COMPUTER)

    def test_safety_uses_canonical_grant_groups_across_clients(self) -> None:
        self.assertIn("activeComputerSafetyGrantGroups", SAFETY)
        self.assertIn("ownerGrantGroups", SAFETY)
        self.assertIn("grant_group_id", SAFETY)
        self.assertIn("profile_key", SAFETY)
        self.assertIn("client_id", SAFETY)
        self.assertIn("revoked_grant_group_ids", SAFETY)
        self.assertNotIn("currentComputerDeviceId", SAFETY)
        self.assertNotIn("activeDeviceComputerGrants", SAFETY)

    def test_browser_authority_requires_exact_client_and_project_scope(self) -> None:
        self.assertIn("selectedBrowserClientId", BROWSER)
        self.assertIn("client_id + space_id + project_id", BROWSER)
        self.assertIn("String(group.client_id||'')===clientId", BROWSER)
        self.assertIn("String(group.space_id||'')===scope.space_id", BROWSER)
        self.assertIn("String(group.project_id||'')===scope.project_id", BROWSER)
        self.assertIn("group.revoked_at", BROWSER)
        self.assertIn("grant.grant_group_id!==grantId", BROWSER)

    def test_browser_grant_creation_fails_closed_without_canonical_scope(self) -> None:
        self.assertIn("space_id + project_id", BROWSER)
        self.assertIn("o slug local não é aceito", BROWSER)
        self.assertIn("Autorizar indisponível", BROWSER)
        self.assertNotIn("authorize_remote_project_browser_grant',link", BROWSER)


if __name__ == "__main__":
    unittest.main()
