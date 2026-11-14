import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "../src/ui/file-space-controls.mjs"), "utf8");

test("selected files open only through the injected File Space text reader", () => {
  const openStart = source.indexOf("const openTextFile = async");
  const openEnd = source.indexOf("const activateSelectedPath", openStart);
  assert.ok(openStart >= 0 && openEnd > openStart);
  const open = source.slice(openStart, openEnd);

  assert.match(open, /port\.readTextFile\(path\)/);
  assert.match(open, /validateTextForRequest\(await port\.readTextFile\(path\), path\)/);
  assert.doesNotMatch(open, /node:fs|readFileSync|fetch\(/);
});

test("selection routes directories to navigation and files to text preview", () => {
  const start = source.indexOf("const activateSelectedPath =");
  const end = source.indexOf("const transferToCurrentDirectory", start);
  assert.ok(start >= 0 && end > start);
  const activation = source.slice(start, end);

  assert.match(activation, /selected\.kind === "directory"/);
  assert.match(activation, /void load\(selected\.path\)/);
  assert.match(activation, /void openTextFile\(selected\.path\)/);
});

test("navigation history remains bounded and local to the controller instance", () => {
  assert.match(source, /MAX_NAVIGATION_HISTORY = 64/);
  assert.match(source, /navigationHistory = \[\]/);
  assert.match(source, /navigationIndex = -1/);
  assert.match(source, /slice\(-MAX_NAVIGATION_HISTORY\)/);
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
});
