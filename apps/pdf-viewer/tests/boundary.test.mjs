import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
test("pdf-viewer stays inside the portable app boundary", async () => {
  const source = await readFile(new URL("../src/runtime.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("/__ordax/native"), false);
  assert.equal(source.includes("fetch("), false);
  assert.equal(source.includes("eval("), false);
  assert.equal(source.includes("new Function"), false);
});
