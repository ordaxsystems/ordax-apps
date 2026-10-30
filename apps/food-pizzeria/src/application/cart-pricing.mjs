import { calculatePizzaPriceCents } from "../domain/domain.mjs";

// Pure review of transient UI selections against the currently authorized local snapshot.
// The Food pricing rule remains in the domain; this module never writes an order or payment.
export function reviewFoodCartPrices(cart, snapshot) {
  if (!Array.isArray(cart) || cart.length === 0 || !snapshot?.settings) {
    throw new TypeError("Não há um carrinho válido para conferir.");
  }
  let changed = false;
  const items = cart.map((item) => {
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
