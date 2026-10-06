(() => {
  "use strict";

  const REQUIRED_METHODS = Object.freeze([
    "projectsCatalog",
    "startupProject",
    "bootstrap",
    "selectProject",
    "inventory",
    "readFile",
    "saveFile",
    "previewStatus",
    "previewStart",
    "previewStop",
    "previewCapture",
    "previewLogs",
    "previewImage",
    "executionStatus",
    "taskAdd",
    "checkpoint",
    "productStatus",
    "computerAccessSettings",
    "saveComputerAccessSettings",
    "health",
    "briefing",
    "search",
    "gitDiff",
    "memoryContext",
    "aiSessionsStatus",
    "connectProductAccount",
    "blenderPrepare",
    "blenderInstallBridge",
    "blenderInstances",
    "blenderAdopt",
    "blenderStart",
    "whenReady",
  ]);

  const OPTIONAL_METHODS = Object.freeze([
    "remoteComputerGrants",
    "authorizeRemoteComputerGrant",
    "revokeRemoteComputerGrant",
    "remoteBrowserGrants",
    "authorizeRemoteBrowserGrant",
    "revokeRemoteBrowserGrant",
  ]);

  function validateHost(host) {
    if (!host || typeof host !== "object") {
      throw new TypeError("ORDAX Studio requires a host adapter");
    }
    for (const method of REQUIRED_METHODS) {
      if (typeof host[method] !== "function") {
        throw new TypeError(`ORDAX Studio host adapter is missing: ${method}`);
      }
    }
    for (const method of OPTIONAL_METHODS) {
      if (host[method] !== undefined && typeof host[method] !== "function") {
        throw new TypeError(`ORDAX Studio optional host adapter method is invalid: ${method}`);
      }
    }
    return host;
  }

  const injected = window.ordaxStudioHost ?? window.__ordaxStudioHostAdapter;
  if (!injected) {
    console.error("ORDAX Studio host adapter was not injected by the environment");
    return;
  }

  const host = validateHost(injected);
  if (!window.ordaxStudioHost) {
    Object.defineProperty(window, "ordaxStudioHost", {
      value: Object.freeze(host),
      writable: false,
      configurable: false,
    });
  }
})();
