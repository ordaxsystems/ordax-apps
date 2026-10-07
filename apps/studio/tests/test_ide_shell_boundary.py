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
    assert "accountSelect.value" in source
    assert "providerSelect.value" in source
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


def test_assistant_selection_works_before_first_chat_and_has_shortcuts():
    source = (ROOT / "assets" / "ide_shell.js").read_text(encoding="utf-8")
    assert "draftSelection" in source
    assert "syncDraftSelection" in source
    assert "select.disabled=!connected.length" in source
    assert "select.disabled=!options.length" in source
    assert "if(active())void updateChat" in source
    assert "event.ctrlKey||event.metaKey" in source
    assert "event.shiftKey&&String(event.key).toLowerCase()==='n'" in source
    assert "/^[1-9]$/.test(event.key)" in source
    assert "event.altKey&&String(event.key).toLowerCase()==='c'" in source


def test_ide_layout_is_project_scoped_and_accessible():
    html = (ROOT / "src" / "index.html").read_text(encoding="utf-8-sig")
    layout = (ROOT / "assets" / "ide_layout.js").read_text(encoding="utf-8")
    css = (ROOT / "assets" / "ide_shell.css").read_text(encoding="utf-8")
    assert 'id="sidebarResizeHandle"' in html
    assert 'id="assistantResizeHandle"' in html
    assert 'role="separator"' in html
    assert '../assets/ide_layout.js' in html
    assert "ide-layout-v1" in layout
    assert "shellProject()" in layout
    assert "localStorage.setItem(storageKey(currentProject)" in layout
    assert "setPointerCapture" in layout
    assert "ArrowLeft" in layout and "ArrowRight" in layout
    assert "event.altKey&&event.key==='0'" in layout
    assert "--ide-sidebar-width" in css
    assert "--ide-assistant-width" in css
    assert "body.ideResizing iframe" in css


def test_layout_state_does_not_duplicate_assistant_runtime_ssot():
    layout = (ROOT / "assets" / "ide_layout.js").read_text(encoding="utf-8")
    for forbidden in (
        "assistantState",
        "assistantCreateChat",
        "account_id",
        "provider_id",
        "model_id",
        "conversations",
        "messages",
    ):
        assert forbidden not in layout


def test_web_ai_is_primary_assistant_surface_with_local_mode_secondary():
    html = (ROOT / "src" / "index.html").read_text(encoding="utf-8-sig")
    surface = (ROOT / "assets" / "assistant_surface.js").read_text(encoding="utf-8")
    css = (ROOT / "assets" / "assistant_surface.css").read_text(encoding="utf-8")
    assert 'id="assistantWebMode"' in html
    assert 'id="assistantLocalMode"' in html
    assert 'id="assistantWebSlot"' in html
    assert 'id="localAssistantPanel"' in html
    assert '../assets/assistant_surface.js' in html
    assert '../assets/assistant_surface.css' in html
    assert "var mode='web'" in surface
    assert "ordax-assistant-surface" in surface
    assert "ResizeObserver" in surface
    assert "presentAssistantSurface" in surface
    assert "window.chrome" not in surface
    assert "window.pywebview" not in surface
    assert "presentAssistantSurface" in contract
    assert "chatgpt.com" not in html
    assert "iframe" not in surface
    assert ".localAssistantPanel" in css


def test_studio_opens_directly_into_three_column_shell():
    html = (ROOT / "src" / "index.html").read_text(encoding="utf-8-sig")
    source = (ROOT / "assets" / "studio.js").read_text(encoding="utf-8")
    assert 'id="projectHome" class="homeShell hidden"' in html
    assert 'id="workspace" class="workspace"' in html
    assert 'id="workspace" class="workspace hidden"' not in html
    assert "$('projectHome').classList.add('hidden')" in source
    assert "$('workspace').classList.remove('hidden')" in source
    assert "state.projects[0]?.slug" in source
    assert "openProject(target,{stayInWorkspace:true})" in source
    assert "backToProjects()" in source
    assert "window.ordaxAssistantSurface?.refresh()" in source


def test_studio_release_is_056():
    import json
    app = json.loads((ROOT / "app.json").read_text(encoding="utf-8"))
    ai = json.loads((ROOT / "ai" / "manifest.json").read_text(encoding="utf-8"))
    actions = json.loads((ROOT / "actions" / "manifest.json").read_text(encoding="utf-8"))
    assert app["version"] == "0.5.6"
    assert ai["appVersion"] == "0.5.6"
    assert actions["appVersion"] == "0.5.6"
