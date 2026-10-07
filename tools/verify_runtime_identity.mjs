#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "..");
const APPS = resolve(ROOT, "apps");
const EXPECTED_SCHEMA = "ordax.component-runtime/1";

const dirs = (await readdir(APPS, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

let checked = 0;
for (const appId of dirs) {
  const appPath = resolve(APPS, appId, "app.json");
  const runtimePath = resolve(APPS, appId, "src", "runtime.mjs");
  let app;
  try {
    app = JSON.parse(await readFile(appPath, "utf8"));
    await readFile(runtimePath);
  } catch (error) {
    if (error?.code === "ENOENT") continue;
    throw error;
  }
  if (app?.kind !== "app" || app?.releaseMode !== "component-slot") continue;

  const module = await import(pathToFileURL(runtimePath).href);
  const runtime = module?.componentRuntime;
  if (!runtime || typeof runtime !== "object") {
    throw new Error(`${appId}: src/runtime.mjs must export componentRuntime`);
  }
  if (runtime.schema !== EXPECTED_SCHEMA) {
    throw new Error(`${appId}: runtime schema drifted: ${String(runtime.schema)}`);
  }
  if (runtime.componentId !== app.id) {
    throw new Error(`${appId}: runtime componentId ${String(runtime.componentId)} != app.json id ${app.id}`);
  }
  if (runtime.version !== app.version) {
    throw new Error(`${appId}: runtime version ${String(runtime.version)} != app.json version ${app.version}`);
  }
  if (typeof runtime.mount !== "function") {
    throw new Error(`${appId}: runtime must expose mount(context)`);
  }
  checked += 1;
}

if (checked === 0) throw new Error("no component-slot app runtimes were checked");
console.log("ORDAX_APP_RUNTIME_IDENTITY=PASS");
console.log(`APP_RUNTIME_IDENTITY_COUNT=${checked}`);
