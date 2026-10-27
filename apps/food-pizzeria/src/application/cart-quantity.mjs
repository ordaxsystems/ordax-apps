import { MAX_ORDER_ITEM_QUANTITY } from "../domain/domain.mjs";

function assertCartQuantity(item) {
  if (!Number.isSafeInteger(item?.quantity)
    || item.quantity < 1
    || item.quantity > MAX_ORDER_ITEM_QUANTITY) {
    throw new TypeError("A quantidade do item no carrinho está inválida.");
  }
}

export function countFoodCartUnits(items) {
  if (!Array.isArray(items)) throw new TypeError("O carrinho precisa ser uma lista.");
  const count = items.reduce((total, item) => {
    assertCartQuantity(item);
    const next = total + item.quantity;
    if (!Number.isSafeInteger(next)) throw new RangeError("A quantidade total do carrinho ultrapassa o limite seguro.");
    return next;
  }, 0);
  return count;
}

export function adjustFoodCartItemQuantity(items, index, change) {
  if (!Array.isArray(items)) throw new TypeError("O carrinho precisa ser uma lista.");
  if (!Number.isSafeInteger(index) || index < 0 || index >= items.length) {
    throw new RangeError("O item selecionado não existe no carrinho.");
  }
  if (change !== -1 && change !== 1) throw new TypeError("A quantidade só pode variar uma unidade por vez.");
  const item = items[index];
  assertCartQuantity(item);
  const quantity = item.quantity + change;
  if (quantity < 1 || quantity > MAX_ORDER_ITEM_QUANTITY) {
    throw new RangeError("A quantidade do item deve ficar entre 1 e " + MAX_ORDER_ITEM_QUANTITY + ".");
  }
  return items.map((entry, entryIndex) => entryIndex === index ? { ...item, quantity } : entry);
}
