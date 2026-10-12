import { assertSurfaceRenderLifecycle } from "../sdk/contracts/surface-render-lifecycle.mjs";
import { validateProjectsDeviceAgentStatus } from "../device-agent-status.mjs";
import { translateProjectsMessage } from "../i18n/messages.mjs";

const PROJECTS_WINDOW_SELECTOR = '[data-window-id="projects"]';
const PROJECTS_EXTENSION_SELECTOR = '[data-app-extension="projects"]';
const STATUS_SELECTOR = '[data-projects-device-agent-status]';

export function projectsDeviceAgentMessageId(statusValue) {
  const status = validateProjectsDeviceAgentStatus(statusValue);
  return status.state === "ready"
    ? "projects.deviceAgent.ready"
    : "projects.deviceAgent.degraded";
}

export function mountProjectsDeviceAgentStatus(
  root,
  statusValue,
  surfaceLifecycle,
) {
  if (!root || typeof root.querySelector !== "function" || !root.ownerDocument) {
    throw new TypeError("Projects Device Agent status requires a Surface root");
  }
  const status = validateProjectsDeviceAgentStatus(statusValue);
  const lifecycle = assertSurfaceRenderLifecycle(surfaceLifecycle);
  const localization = lifecycle.localization;
  const documentObject = root.ownerDocument;
  let destroyed = false;

  const render = () => {
    if (destroyed) return;
    const slot = root.querySelector(
      `${PROJECTS_WINDOW_SELECTOR} ${PROJECTS_EXTENSION_SELECTOR}`,
    );
    const summary = slot?.querySelector(".ordax-projects-summary") ?? null;
    if (!summary) return;

    let badge = summary.querySelector(STATUS_SELECTOR);
    if (!badge) {
      badge = documentObject.createElement("span");
      badge.className = "ordax-projects-summary-item";
      badge.dataset.projectsDeviceAgentStatus = "";
      summary.append(badge);
    }
    badge.dataset.state = status.state;
    badge.textContent = translateProjectsMessage(localization.getLocale(), projectsDeviceAgentMessageId(status), {
      count: status.capabilityCount,
    });
  };

  const unsubscribeLocalization = localization.subscribe(() => render());
  const unsubscribeRender = lifecycle.subscribeRender(() => render());
  render();

  return Object.freeze({
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribeRender();
      unsubscribeLocalization();
      root.querySelector(
        `${PROJECTS_WINDOW_SELECTOR} ${PROJECTS_EXTENSION_SELECTOR} ${STATUS_SELECTOR}`,
      )?.remove();
    },
  });
}
