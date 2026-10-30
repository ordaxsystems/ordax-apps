export function presentPizzeriaKitchenItem(item) {
  if (item.type === "catalog-product") {
    return {
      title: item.name,
      detail: item.category,
      modifierLabel: "Produto",
      modifiers: [],
    };
  }
  const flavorNames = item.flavors.map(({ name }) => name);
  return {
    title: item.sizeLabel ?? item.size,
    detail: Number.isSafeInteger(item.sliceCount) ? `${item.sliceCount} fatias` : "Fatias não registradas",
    modifierLabel: `${flavorNames.length} ${flavorNames.length === 1 ? "sabor" : "sabores"}`,
    modifiers: flavorNames,
  };
}

export const PIZZERIA_KITCHEN_ITEM_LABEL = Object.freeze({
  singular: "item",
  plural: "itens",
  metricLabel: "Itens na cozinha",
});

export const PIZZERIA_KITCHEN_STAGE_GUIDANCE = Object.freeze({
  all: "Acompanhe cada pedido pelas etapas de produção até a expedição.",
  received: "Abertura da massa: confira tamanho, fatias, sabores e observações antes de iniciar.",
  preparing: "Montagem: confira os sabores e as instruções de cada pizza antes de concluir.",
  ready: "Expedição: confira quantidade, tamanho e sabores antes de liberar o pedido.",
});
