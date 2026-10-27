export function formatFoodOrderNumber(orderId) {
  if (typeof orderId !== "string" || !orderId) throw new TypeError("O pedido precisa ter um identificador.");
  const sequence = orderId.match(/(?:^|-)order-(\d+)$/i)?.[1];
  const label = sequence ?? orderId.replaceAll("-", "").slice(-6).toUpperCase();
  return `#${label}`;
}
