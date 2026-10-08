// G2 contract smoke: import the *verified package's* real entrypoint.
// This Node process is not an OrdaX host, sandbox or lifecycle simulator.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [entrypoint, expectedId, expectedVersion] = process.argv.slice(2);
if (!entrypoint || !expectedId || !expectedVersion) {
  throw new Error("expected package entrypoint, component id and version");
}

const module = await import(pathToFileURL(resolve(entrypoint)).href);
const runtime = module.componentRuntime;
if (!runtime || typeof runtime !== "object") {
  throw new Error("package entrypoint must export componentRuntime");
}
if (runtime.schema !== "ordax.component-runtime/1") {
  throw new Error("exported component runtime schema drifted");
}
if (runtime.componentId !== expectedId) {
  throw new Error("exported component runtime identity drifted");
}
if (runtime.version !== expectedVersion) {
  throw new Error("exported component runtime version differs from package component");
}
if (typeof runtime.mount !== "function") {
  throw new Error("exported component runtime has no mount function");
}

let refusedMissingPorts = false;
try {
  await runtime.mount({});
} catch (error) {
  if (!(error instanceof TypeError)) {
    throw new Error("runtime failed with non-contract error for missing host ports", { cause: error });
  }
  refusedMissingPorts = true;
}
if (!refusedMissingPorts) {
  throw new Error("component mounted without mandatory host ports");
}

process.stdout.write(JSON.stringify({
  schema: runtime.schema,
  componentId: runtime.componentId,
  version: runtime.version,
  moduleImport: "passed",
  missingHostPorts: "rejected",
  authority: "none",
}) + "\n");
