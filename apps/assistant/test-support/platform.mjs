// Test-only integration dependencies. Never included in the Assistant runtime.
// CI supplies the observed canonical OS checkout already used by Gate B.
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(process.env.ORDAX_ASSISTANT_TEST_OS_ROOT ?? ".ordax-assistant-os-main");
export function platformSourceUrl(path) {
  const target = resolve(root, path);
  if (!target.startsWith(root + sep)) throw new TypeError("Test source escaped OS checkout");
  return pathToFileURL(target);
}

export const { createPersonalOrdaxRuntime } = await import(platformSourceUrl("system/services/personal-ordax/runtime.mjs"));
export const { projectPersonalWorkCanvas } = await import(platformSourceUrl("system/services/intelligence/work-canvas.mjs"));
export const { createAppActivationChannel } = await import(platformSourceUrl("system/services/apps/activation.mjs"));
