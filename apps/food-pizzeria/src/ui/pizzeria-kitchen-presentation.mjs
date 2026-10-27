export function presentPizzeriaKitchenItem(item, pizzaSizes = []) {
  const configuredSize = pizzaSizes.find(({ id }) => id === item.size);
  const flavorNames = item.flavors.map(({ name }) => name);
  return {
    title: item.sizeLabel ?? configuredSize?.label ?? item.size,
    detail: configuredSize?.slices ? `${configuredSize.slices} fatias` : "",
    modifierLabel: `${flavorNames.length} ${flavorNames.length === 1 ? "sabor" : "sabores"}`,
    modifiers: flavorNames,
  };
}

export const PIZZERIA_KITCHEN_ITEM_LABEL = Object.freeze({
  singular: "pizza",
  plural: "pizzas",
  metricLabel: "Pizzas na cozinha",
});

export const PIZZERIA_KITCHEN_STAGE_GUIDANCE = Object.freeze({
  all: "Acompanhe cada pedido pelas etapas de produção até a expedição.",
  received: "Abertura da massa: confira tamanho, fatias, sabores e observações antes de iniciar.",
  preparing: "Montagem: confira os sabores e as instruções de cada pizza antes de concluir.",
  ready: "Expedição: confira quantidade, tamanho e sabores antes de liberar o pedido.",
});
