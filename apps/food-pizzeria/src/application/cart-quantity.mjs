import { MAX_ORDER_ITEM_QUANTITY } from "../domain/domain.mjs";

function assertCartQuantity(item) {
  if (!Number.isSafeInteger(item?.quantity)
    || item.quantity < 1
    || item.quantity > MAX_ORDER_ITEM_QUANTITY) {
    throw new TypeError("A quantidade do item no carrinho está inválida.");
  }
}

function sameCartItem(left, right) {
  if (left?.type !== right?.type) return false;
  if (right.type === "catalog-product") {
    return left.productId === right.productId
      && left.name === right.name
      && left.category === right.category
      && left.unitPriceCents === right.unitPriceCents;
  }
  if (right.type !== undefined) return false;
  return left.size === right.size
    && left.unitPriceCents === right.unitPriceCents
    && Array.isArray(left.flavorIds)
    && Array.isArray(right.flavorIds)
    && left.flavorIds.length === right.flavorIds.length
    && left.flavorIds.every((flavorId, index) => flavorId === right.flavorIds[index]);
}

export function addFoodCartItem(items, item) {
  if (!Array.isArray(items)) throw new TypeError("O carrinho precisa ser uma lista.");
  assertCartQuantity(item);
  const matchingIndex = items.findIndex((entry) => sameCartItem(entry, item));
  if (matchingIndex === -1) return [...items, { ...item }];

  const matchingItem = items[matchingIndex];
  assertCartQuantity(matchingItem);
  const combinedQuantity = matchingItem.quantity + item.quantity;
  if (combinedQuantity > MAX_ORDER_ITEM_QUANTITY) return [...items, { ...item }];
  return items.map((entry, index) => index === matchingIndex
    ? { ...entry, quantity: combinedQuantity }
    : entry);
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
