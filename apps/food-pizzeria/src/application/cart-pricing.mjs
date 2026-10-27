import { calculatePizzaPriceCents } from "../domain/domain.mjs";

// Pure review of transient UI selections against the currently authorized local snapshot.
// The Food pricing rule remains in the domain; this module never writes an order or payment.
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
