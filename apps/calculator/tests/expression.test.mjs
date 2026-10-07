import assert from "node:assert/strict";
import test from "node:test";
import { calculateExpression, formatResult } from "../src/expression.mjs";

test("respects arithmetic precedence and parentheses", () => {
  assert.equal(calculateExpression("2 + 3 * 4"), 14);
  assert.equal(calculateExpression("(2 + 3) * 4"), 20);
});

test("supports power, constants and safe functions", () => {
  assert.equal(calculateExpression("2^3^2"), 512);
  assert.equal(formatResult(calculateExpression("sqrt(81) + abs(-2)")), "11");
  assert.equal(formatResult(calculateExpression("pi")), "3.14159265359");
});

test("accepts decimal comma without eval semantics", () => {
  assert.equal(calculateExpression("1,5 + 2,25"), 3.75);
});

test("rejects unsupported syntax and unsafe numeric results", () => {
  assert.throws(() => calculateExpression("globalThis.process"), SyntaxError);
  assert.throws(() => calculateExpression("1 / 0"), RangeError);
  assert.throws(() => calculateExpression("sqrt(-1)"), RangeError);
});
