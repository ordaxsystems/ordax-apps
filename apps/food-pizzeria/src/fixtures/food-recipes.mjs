const line = (ingredientId, small, medium, large) => ({
  ingredientId,
  quantityBaseBySize: { small, medium, large },
});

const common = [
  line("farinha", 120, 180, 260),
  line("molho", 60, 90, 130),
  line("mucarela", 120, 180, 250),
];

const recipes = [
  ["calabresa", [...common, line("calabresa", 70, 110, 160), line("cebola", 15, 25, 40), line("oregano", 1, 2, 3)]],
  ["portuguesa", [...common, line("presunto", 45, 75, 110), line("ovo", 25, 40, 60), line("cebola", 15, 25, 40), line("azeitona", 8, 14, 20)]],
  ["marguerita", [...common, line("tomate", 25, 45, 70), line("manjericao", 2, 4, 7)]],
  ["frango-catupiry", [...common, line("frango", 65, 105, 155), line("catupiry", 35, 60, 90)]],
  ["quatro-queijos", [...common, line("provolone", 25, 40, 60), line("parmesao", 20, 35, 50), line("gorgonzola", 15, 25, 40)]],
  ["pepperoni", [...common, line("pepperoni", 55, 90, 135)]],
];

export function createFoodRecipeSeed() {
  return recipes.map(([flavorKey, recipeLines]) => ({
    flavorId: `ng-${flavorKey}`,
    lines: recipeLines.map(({ ingredientId, quantityBaseBySize }) => ({
      ingredientId,
      quantityBaseBySize: { ...quantityBaseBySize },
    })),
  }));
}
