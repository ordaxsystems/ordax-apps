import { calculatePizzaPriceCents, MAX_ORDER_ITEM_QUANTITY } from "../domain/domain.mjs";

// Pure review of transient UI selections against the currently authorized local snapshot.
// The Food pricing rule remains in the domain; this module never writes an order or payment.
export function foodCartItemUnitPriceCents(item, snapshot) {
  if (!item || typeof item !== "object" || !Number.isSafeInteger(item.unitPriceCents) || item.unitPriceCents < 0) {
    throw new TypeError("O preço do item no carrinho está inválido.");
  }
  if (item.type === "catalog-product") return item.unitPriceCents;
  try {
    return calculatePizzaPriceCents({
      size: item.size,
      flavorIds: item.flavorIds,
      flavors: snapshot.flavors,
      halfPricePolicy: snapshot.settings.halfPricePolicy,
      pizzaSizes: snapshot.settings.pizzaSizes,
      maxFlavorsPerPizza: snapshot.settings.maxFlavorsPerPizza,
    });
  } catch {
    // Keep a visible draft price if the current menu became invalid; reviewFoodCartPrices
    // remains strict and blocks submission until the draft can be reviewed or corrected.
    return item.unitPriceCents;
  }
}

export function foodCartItemLineTotalCents(item, snapshot) {
  if (!Number.isSafeInteger(item?.quantity) || item.quantity < 1 || item.quantity > MAX_ORDER_ITEM_QUANTITY) {
    throw new TypeError("A quantidade do item no carrinho está inválida.");
  }
  const total = foodCartItemUnitPriceCents(item, snapshot) * item.quantity;
  if (!Number.isSafeInteger(total)) throw new RangeError("O total da linha do carrinho ultrapassa o limite seguro.");
  return total;
}

export function foodCartSubtotalCents(items, snapshot) {
  if (!Array.isArray(items)) throw new TypeError("O carrinho precisa ser uma lista.");
  return items.reduce((subtotal, item) => {
    const next = subtotal + foodCartItemLineTotalCents(item, snapshot);
    if (!Number.isSafeInteger(next)) throw new RangeError("O subtotal do carrinho ultrapassa o limite seguro.");
    return next;
  }, 0);
}

export function reviewFoodCartPrices(cart, snapshot, catalogProducts = []) {
  if (!Array.isArray(cart) || cart.length === 0 || !snapshot?.settings) {
    throw new TypeError("Não há um carrinho válido para conferir.");
  }
  let changed = false;
  const items = cart.map((item) => {
    if (item.type === "catalog-product") {
      const product = catalogProducts.find(({ id }) => id === item.productId);
      if (!product) throw new Error("Um produto do pedido não está mais disponível no catálogo.");
      if (product.priceCents === item.unitPriceCents
        && product.name === item.name && product.category === item.category) return item;
      changed = true;
      return {
        ...item,
        name: product.name,
        category: product.category,
        unitPriceCents: product.priceCents,
      };
    }
    const unitPriceCents = calculatePizzaPriceCents({
      size: item.size,
      flavorIds: item.flavorIds,
      flavors: snapshot.flavors,
      halfPricePolicy: snapshot.settings.halfPricePolicy,
      pizzaSizes: snapshot.settings.pizzaSizes,
      maxFlavorsPerPizza: snapshot.settings.maxFlavorsPerPizza,
    });
    if (unitPriceCents === item.unitPriceCents) return item;
    changed = true;
    return { ...item, unitPriceCents };
  });
  return Object.freeze({ changed, items: Object.freeze(items) });
}
