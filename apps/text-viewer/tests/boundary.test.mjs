import assert from "node:assert/strict";import test from "node:test";import{readFile}from"node:fs/promises";
test("viewer stays on public ports",async()=>{const s=await readFile(new URL("../src/runtime.mjs",import.meta.url),"utf8");assert.equal(s.includes("/__ordax/native"),false);assert.equal(s.includes("fetch("),false);assert.equal(s.includes("input type=\"file\""),false);});
