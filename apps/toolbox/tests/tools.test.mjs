import assert from "node:assert/strict";
import test from "node:test";
import { encodeBase64, decodeBase64, encodeUrlComponent, decodeUrlComponent } from "../src/tools.mjs";

test("Base64 round-trips Unicode text",()=>{const source="OrdaX çã 🚀";assert.equal(decodeBase64(encodeBase64(source)),source);});
test("URL encoding round-trips text",()=>{const source="a b/ç?x=1";assert.equal(decodeUrlComponent(encodeUrlComponent(source)),source);});
