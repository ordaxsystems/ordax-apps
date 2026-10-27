import assert from "node:assert/strict";
import test from "node:test";
import { MAX_ORDER_ITEM_QUANTITY } from "../src/domain/domain.mjs";
import { adjustFoodCartItemQuantity, countFoodCartUnits } from "../src/application/cart-quantity.mjs";

test("contador do PDV soma unidades, não linhas do carrinho", () => {
  assert.equal(countFoodCartUnits([
    { id: "pizza", quantity: 3 },
    { id: "soda", quantity: 2 },
  ]), 5);
  assert.equal(countFoodCartUnits([]), 0);
});

test("ajuste de quantidade cria novo estado e preserva os outros itens", () => {
  const cart = [{ id: "pizza", quantity: 2 }, { id: "soda", quantity: 4 }];
  const updated = adjustFoodCartItemQuantity(cart, 0, 1);

  assert.deepEqual(updated, [{ id: "pizza", quantity: 3 }, { id: "soda", quantity: 4 }]);
  assert.equal(cart[0].quantity, 2);
  assert.equal(updated[1], cart[1]);
});

test("quantidade do PDV respeita o limite definido pelo domínio do pedido", () => {
  const atMaximum = [{ id: "pizza", quantity: MAX_ORDER_ITEM_QUANTITY }];
  assert.throws(() => adjustFoodCartItemQuantity(atMaximum, 0, 1), RangeError);
  assert.throws(() => adjustFoodCartItemQuantity([{ id: "pizza", quantity: 1 }], 0, -1), RangeError);
  assert.throws(() => adjustFoodCartItemQuantity([], 0, 1), RangeError);
  assert.throws(() => adjustFoodCartItemQuantity([{ id: "pizza", quantity: 1 }], 0, 2), TypeError);
});
