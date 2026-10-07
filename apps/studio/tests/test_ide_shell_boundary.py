from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_studio_uses_three_column_ide_shell():
    html = (ROOT / "src" / "index.html").read_text(encoding="utf-8-sig")
    assert 'class="projectSidebar ideSidebar"' in html
    assert 'class="assistantPane"' in html
    assert 'class="workspacePane"' in html
    assert 'id="assistantChatTabs"' in html
    assert 'id="assistantAccount"' in html
    assert 'id="assistantProvider"' in html
    assert 'data-view="computer"' in html


def test_workspace_tools_live_on_right_panel():
    html = (ROOT / "src" / "index.html").read_text(encoding="utf-8-sig")
    assert 'data-view="preview"' in html
    assert 'data-view="browser"' in html
    assert 'data-view="overview"' in html
    assert 'data-view="sessions"' in html
    assert 'data-view="files"' in html
    assert 'data-view="git"' in html
    assert 'data-view="computer"' in html


def test_assistant_shell_uses_runtime_ssot_not_browser_local_storage():
    source = (ROOT / "assets" / "ide_shell.js").read_text(encoding="utf-8")
    contract = (ROOT / "src" / "host_contract.js").read_text(encoding="utf-8")
    assert "assistantState" in source
    assert "assistantCreateChat" in source
    assert "assistantSelectChat" in source
    assert "assistantUpdateChat" in source
    assert "assistantCloseChat" in source
    assert "localStorage" not in source
    assert "openai:gpt-4o" not in source
    assert "xai:grok" not in source
    assert "anthropic:claude" not in source
    for method in (
        "assistantCatalog",
        "assistantState",
        "assistantCreateChat",
        "assistantSelectChat",
        "assistantUpdateChat",
        "assistantCloseChat",
    ):
        assert method in contract


def test_legacy_controller_routes_views_through_workspace_tabs():
    source = (ROOT / "assets" / "studio.js").read_text(encoding="utf-8")
    assert "document.querySelectorAll('.workspaceTab')" in source
    assert "view='preview'" in source
    assert "'previewCanvas'" in source
