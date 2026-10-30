export function nextFoodOrderStatus(order) {
  if (order.status === "received") return "preparing";
  if (order.status === "preparing") return "ready";
  if (order.status === "ready") return order.channel === "delivery" ? "out-for-delivery" : "completed";
  if (order.status === "out-for-delivery") return "completed";
  return null;
}

export function foodOrderActionLabel(order, nextStatus = nextFoodOrderStatus(order)) {
  if (nextStatus === "preparing") return "Iniciar preparo";
  if (nextStatus === "ready") return "Marcar como pronto";
  if (nextStatus === "out-for-delivery") return "Despachar para entrega";
  if (nextStatus === "completed") {
    if (order.status === "out-for-delivery") return "Concluir entrega";
    if (order.channel === "pickup") return "Confirmar retirada";
    if (order.channel === "counter") return "Entregar ao cliente";
    if (order.channel === "dine-in") return "Marcar como servido";
    return "Concluir pedido";
  }
  return "";
}
