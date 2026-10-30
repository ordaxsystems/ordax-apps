import assert from "node:assert/strict";
import test from "node:test";
import { MAX_ORDER_ITEM_QUANTITY } from "../src/domain/domain.mjs";
import { addFoodCartItem, adjustFoodCartItemQuantity, countFoodCartUnits } from "../src/application/cart-quantity.mjs";

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

test("adicionar a mesma pizza agrega quantidade sem criar linha duplicada", () => {
  const first = { id: "pizza-1", size: "medium", flavorIds: ["calabresa"], quantity: 2, unitPriceCents: 4990 };
  const second = { id: "pizza-2", size: "medium", flavorIds: ["calabresa"], quantity: 3, unitPriceCents: 4990 };
  const cart = addFoodCartItem([first], second);

  assert.deepEqual(cart, [{ ...first, quantity: 5 }]);
  assert.equal(first.quantity, 2);
});

test("itens idênticos somam até o limite; quantidade excedente vira outra linha", () => {
  const existing = { id: "pizza-1", size: "small", flavorIds: ["marguerita"], quantity: 48, unitPriceCents: 3990 };
  const addition = { id: "pizza-2", size: "small", flavorIds: ["marguerita"], quantity: 3, unitPriceCents: 3990 };
  const cart = addFoodCartItem([existing], addition);

  assert.deepEqual(cart.map(({ quantity }) => quantity), [48, 3]);
  assert.equal(countFoodCartUnits(cart), 51);
});

test("não agrega pizzas ou produtos com configuração ou preço congelado diferente", () => {
  const existing = { id: "soda-1", type: "catalog-product", productId: "soda", name: "Refrigerante", category: "Bebidas", quantity: 1, unitPriceCents: 1200 };
  const addition = { ...existing, id: "soda-2", unitPriceCents: 1300 };
  const changedFlavor = { id: "pizza-2", size: "medium", flavorIds: ["portuguesa"], quantity: 1, unitPriceCents: 4990 };
  const pizza = { id: "pizza-1", size: "medium", flavorIds: ["calabresa"], quantity: 1, unitPriceCents: 4990 };

  assert.equal(addFoodCartItem([existing], addition).length, 2);
  assert.equal(addFoodCartItem([pizza], changedFlavor).length, 2);
});
