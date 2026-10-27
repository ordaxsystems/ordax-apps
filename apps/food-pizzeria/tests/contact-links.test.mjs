import assert from "node:assert/strict";
import test from "node:test";
import { telephoneHref } from "../src/ui/contact-links.mjs";

test("telephoneHref removes formatting and preserves an international prefix", () => {
  assert.equal(telephoneHref(" +55 (11) 99999-0000 "), "+5511999990000");
});

test("telephoneHref supports local numbers without inventing a country code", () => {
  assert.equal(telephoneHref("(11) 3333-2222"), "1133332222");
});

test("telephoneHref rejects empty values and strings without digits", () => {
  for (const value of ["", "  ", "+", "sem telefone", null, undefined, 11999990000]) {
    assert.equal(telephoneHref(value), null);
  }
});
