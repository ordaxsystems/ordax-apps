import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const rootUrl = new URL("../", import.meta.url);
const sdkRoot = process.env.ORDAX_APP_ACTIONS_SDK_ROOT;
if (!sdkRoot) throw new Error("ORDAX_APP_ACTIONS_SDK_ROOT is required");

const contract = await import(
  pathToFileURL(path.join(sdkRoot, "application-action-manifest.mjs")).href
);

async function json(relative) {
  return JSON.parse(await readFile(new URL(relative, rootUrl), "utf8"));
}

for (const appId of ["notes", "studio"]) {
  test(`${appId} action manifest conforms to pinned App SDK 1.11`, async () => {
    const app = await json(`apps/${appId}/app.json`);
    const raw = await json(`apps/${appId}/actions/manifest.json`);
    const manifest = contract.validateApplicationActionManifest(raw, {
      appId: app.id,
      appVersion: app.version,
    });

    assert.equal(manifest.authority, "none");
    assert.equal(manifest.execution, "proposal-only");
    for (const capability of manifest.capabilities) {
      assert.equal(capability.appId, app.id);
      assert.match(capability.actionId, new RegExp(`^${app.id}\\.`));
      assert.equal(capability.sourceClass, "first-party");
      assert.equal(capability.platform, "ordax");
      assert.equal(capability.provider.kind, "first-party-native");
      assert.equal(capability.binding.payloadSha256, null);
      assert.equal(capability.executionAuthorized, false);
      assert.equal(capability.modelDirectExecutionAuthorized, false);
    }
  });
}

test("Studio does not expose raw-path edit capability before resource-grant binding", async () => {
  const raw = await json("apps/studio/actions/manifest.json");
  const actionIds = new Set(raw.capabilities.map((capability) => capability.actionId));
  assert.equal(actionIds.has("studio.edit-file"), false);
  for (const capability of raw.capabilities) {
    assert.equal(capability.parameters.some((parameter) => parameter.id === "path"), false);
  }
});
