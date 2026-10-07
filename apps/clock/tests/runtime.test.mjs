import assert from "node:assert/strict"; import test from "node:test";
test("clock uses no privileged platform imports", async () => {
  const source = await import("node:fs/promises").then(fs => fs.readFile(new URL("../src/runtime.mjs", import.meta.url),"utf8"));
  assert.equal(source.includes("eval("), false);
  assert.equal(source.includes("system/"), false);
});
