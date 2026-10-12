import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const sdkRoot = process.env.ORDAX_APP_INTELLIGENCE_SDK_ROOT;
if (!sdkRoot) {
  throw new Error("ORDAX_APP_INTELLIGENCE_SDK_ROOT is required");
}

const contractUrl = pathToFileURL(path.join(sdkRoot, "app-intelligence-manifest.mjs")).href;
const {
  APP_INTELLIGENCE_MANIFEST_SCHEMA,
  validateAppIntelligenceManifest,
} = await import(contractUrl);

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);

async function json(relative) {
  return JSON.parse(await readFile(path.join(repoRoot, relative), "utf8"));
}

for (const appId of ["notes", "studio"]) {
  test(`${appId} intelligence manifest conforms to pinned public SDK contract`, async () => {
    const app = await json(`apps/${appId}/app.json`);
    const manifest = await json(`apps/${appId}/ai/manifest.json`);
    const value = validateAppIntelligenceManifest(manifest, {
      appId: app.id,
      appVersion: app.version,
    });
    assert.equal(value.schema, APP_INTELLIGENCE_MANIFEST_SCHEMA);
    assert.equal(value.appId, app.id);
    assert.equal(value.appVersion, app.version);
    assert.equal(value.authority, "none");
    assert.equal(value.execution, "declarative-only");
  });
}

test("pinned public SDK rejects authority and direct execution drift", () => {
  const manifest = {
    schema: APP_INTELLIGENCE_MANIFEST_SCHEMA,
    appId: "fixture",
    appVersion: "1.0.0",
    authority: "none",
    execution: "declarative-only",
    instructions: ["Use only declared capabilities."],
    intents: [],
  };

  assert.throws(
    () => validateAppIntelligenceManifest({ ...manifest, authority: "app" }),
    /must not carry authority/,
  );
  assert.throws(
    () => validateAppIntelligenceManifest({ ...manifest, execution: "direct" }),
    /cannot grant execution/,
  );
});
