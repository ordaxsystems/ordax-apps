(() => {
  "use strict";

  const MAX_TEXT = 240;
  const DEFINITIONS = Object.freeze([
    ["navigation.home", "#openHome", "button", "navigation"],
    ["navigation.activity", "#openActivity", "button", "navigation"],
    ["navigation.context", "#openContext", "button", "navigation"],
    ["project.open", "#openProject", "button", "project"],
    ["project.search", "#projectFilter", "searchbox", "project"],
    ["project.list", "#projectList", "list", "project"],
    ["editor.content", "#projectEditor", "textbox", "editor"],
    ["editor.review", "#projectReview", "button", "editor"],
    ["editor.apply", "#projectApply", "button", "editor"],
    ["terminal.argv", "#terminalArgv", "textbox", "terminal"],
    ["terminal.review", "#terminalReview", "button", "terminal"],
    ["terminal.run", "#terminalRun", "button", "terminal"],
    ["git.status", "#studioGitStatus", "button", "git"],
    ["git.diff", "#studioGitDiff", "button", "git"],
    ["git.result", "#studioGitResult", "region", "git"],
    ["search.query", "#studioSearchQuery", "searchbox", "search"],
    ["search.run", "#studioSearchRun", "button", "search"],
    ["search.results", "#studioSearchResult", "region", "search"],
    ["conversation.messages", "#messages", "log", "conversation"],
    ["conversation.prompt", "#prompt", "textbox", "conversation"],
    ["conversation.send", "#send", "button", "conversation"],
    ["conversation.stop", "#stop", "button", "conversation"],
    ["preview.surface", "#previewCanvas", "region", "preview"],
    ["preview.status", "#previewStatus", "status", "preview"],
    ["preview.address", "#previewAddress", "textbox", "preview"],
    ["runtime.state", "#runtimeState", "status", "runtime"],
    ["runtime.device", "#runtimeDevice", "combobox", "runtime"],
    ["runtime.project", "#runtimeProject", "combobox", "runtime"],
    ["runtime.connect", "#runtimeConnect", "button", "runtime"],
    ["mcp.open", "#openPlugin", "button", "mcp"],
    ["mcp.check", "#pluginCheck", "button", "mcp"],
    ["mcp.status", "#pluginService", "status", "mcp"],
    ["continuity.read", "#studioContinuityRead", "button", "continuity"],
    ["continuity.review", "#studioContinuityReview", "button", "continuity"],
    ["continuity.apply", "#studioContinuityApply", "button", "continuity"],
    ["continuity.result", "#studioContinuityResult", "region", "continuity"],
  ].map(([id, selector, role, surface]) => Object.freeze({ id, selector, role, surface })));

  function visible(element) {
    if (!element || element.hidden || element.getAttribute("aria-hidden") === "true") return false;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return false;
    return element.getClientRects().length > 0;
  }

  function boundedText(element) {
    if (!element) return "";
    if (element.matches("input, textarea, select, [contenteditable=true]")) return "";
    return String(element.innerText || element.textContent || "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
  }

  function publicLabel(element) {
    if (!element) return "";
    return String(element.getAttribute("aria-label") || element.getAttribute("title") || (element.matches("button") ? element.textContent : "") || "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
  }

  function describe(definition) {
    const element = document.querySelector(definition.selector);
    if (!element) return Object.freeze({ ...definition, present: false, visible: false });
    return Object.freeze({
      ...definition,
      present: true,
      visible: visible(element),
      disabled: Boolean(element.disabled || element.getAttribute("aria-disabled") === "true"),
      checked: element.matches("input[type=checkbox], input[type=radio]") ? Boolean(element.checked) : undefined,
      selected: element.getAttribute("aria-selected") === null ? undefined : element.getAttribute("aria-selected") === "true",
      label: publicLabel(element),
      text: boundedText(element),
    });
  }

  function snapshot() {
    return Object.freeze({
      schema: "ordax.studio-semantic-ui-snapshot/1",
      appId: "studio",
      authority: "none",
      execution: "read-only",
      capturedInputValues: false,
      elements: Object.freeze(DEFINITIONS.map(describe)),
    });
  }

  const api = Object.freeze({ids: Object.freeze(DEFINITIONS.map(item => item.id)), snapshot, describe(id) { const definition = DEFINITIONS.find(item => item.id === id); return definition ? describe(definition) : null; }});
  Object.defineProperty(window, "ordaxStudioSemanticUI", {value: api, writable: false, configurable: false});
})();
