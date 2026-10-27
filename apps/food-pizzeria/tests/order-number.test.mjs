import assert from "node:assert/strict";
import test from "node:test";
import { formatFoodOrderNumber } from "../src/ui/order-number.mjs";

test("food order labels preserve seeded numeric sequence ids", () => {
  assert.equal(formatFoodOrderNumber("ng-order-1047"), "#1047");
  assert.equal(formatFoodOrderNumber("order-1001"), "#1001");
});

test("random order UUIDs use a readable stable reference with enough entropy", () => {
  assert.equal(formatFoodOrderNumber("ecbb439e-50d5-42e8-a7d1-c399a4e1b203"), "#99A4E1B203");
  assert.notEqual(
    formatFoodOrderNumber("ecbb439e-50d5-42e8-a7d1-c399a4e1b203"),
    formatFoodOrderNumber("ecbb439e-50d5-42e8-a7d1-c300a4e1b203"),
  );
});

test("order number formatter rejects missing identifiers", () => {
  assert.throws(() => formatFoodOrderNumber(""), /identificador/);
  assert.throws(() => formatFoodOrderNumber(null), /identificador/);
});
