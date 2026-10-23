// Test-only integration dependencies. Never included in the Assistant runtime.
// CI supplies the observed canonical OS checkout already used by Gate B.
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { access } from "node:fs/promises";

const configuredRoot = process.env.ORDAX_ASSISTANT_TEST_OS_ROOT;
const root = resolve(configuredRoot ?? ".ordax-assistant-os-main");
const requiredSources = [
  "system/services/personal-ordax/runtime.mjs",
  "system/services/intelligence/work-canvas.mjs",
  "system/services/apps/activation.mjs",
  "system/composition/native/main.mjs",
];

const sourceChecks = await Promise.all(requiredSources.map(async (path) => {
  try {
    await access(resolve(root, path));
    return true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return false;
  }
}));

export const platformRuntimeAvailable = sourceChecks.every(Boolean);
if (configuredRoot && !platformRuntimeAvailable) {
  throw new Error(`Configured OrdaX OS test checkout is incomplete: ${root}`);
}

export function platformSourceUrl(path) {
  const target = resolve(root, path);
  if (!target.startsWith(root + sep)) throw new TypeError("Test source escaped OS checkout");
  return pathToFileURL(target);
}

export let createPersonalOrdaxRuntime = null;
export let projectPersonalWorkCanvas = null;
export let createAppActivationChannel = null;

if (platformRuntimeAvailable) {
  const [personal, canvas, activation] = await Promise.all([
    import(platformSourceUrl("system/services/personal-ordax/runtime.mjs")),
    import(platformSourceUrl("system/services/intelligence/work-canvas.mjs")),
    import(platformSourceUrl("system/services/apps/activation.mjs")),
  ]);
  createPersonalOrdaxRuntime = personal.createPersonalOrdaxRuntime;
  projectPersonalWorkCanvas = canvas.projectPersonalWorkCanvas;
  createAppActivationChannel = activation.createAppActivationChannel;
}
