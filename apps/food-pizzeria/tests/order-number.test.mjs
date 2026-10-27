import assert from "node:assert/strict";
import test from "node:test";
import { formatFoodOrderNumber } from "../src/ui/order-number.mjs";

test("food order labels preserve seeded numeric sequence ids", () => {
  assert.equal(formatFoodOrderNumber("ng-order-1047"), "#1047");
  assert.equal(formatFoodOrderNumber("order-1001"), "#1001");
});

test("random order UUIDs use a readable stable suffix instead of accidental trailing digits", () => {
  assert.equal(formatFoodOrderNumber("ecbb439e-50d5-42e8-a7d1-c399a4e1b203"), "#E1B203");
});

test("order number formatter rejects missing identifiers", () => {
  assert.throws(() => formatFoodOrderNumber(""), /identificador/);
  assert.throws(() => formatFoodOrderNumber(null), /identificador/);
});
