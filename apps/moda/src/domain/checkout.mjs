// Keep the local checkout bounds aligned with the current Sales order schema.
export const MAX_CHECKOUT_LINES = 64;
export const MAX_CHECKOUT_LINE_QUANTITY = 10_000;

export function normalizeCheckoutLines(lines) {
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > MAX_CHECKOUT_LINES) {
    throw new Error("Adicione de 1 a 64 variantes ao carrinho.");
  }

  const quantitiesBySku = new Map();
  for (const item of lines) {
    const sku = String(item?.sku ?? "").trim();
    if (!sku) throw new Error("Cada item precisa identificar uma variante por SKU.");
    const quantity = Number(item?.quantity);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_CHECKOUT_LINE_QUANTITY) {
      throw new TypeError("A quantidade por variante precisa ficar entre 1 e 10.000 unidades.");
    }
    const totalForSku = (quantitiesBySku.get(sku) ?? 0) + quantity;
    if (totalForSku > MAX_CHECKOUT_LINE_QUANTITY) {
      throw new TypeError("A quantidade somada por SKU excede 10.000 unidades.");
    }
    quantitiesBySku.set(sku, totalForSku);
  }

  return [...quantitiesBySku].map(([sku, quantity]) => ({ sku, quantity }));
}
