const ingredients = [
  ["mucarela", "Muçarela", "Laticínios", "g", 3500, 3000, 3690],
  ["calabresa", "Calabresa", "Frios", "g", 8000, 4000, 2890],
  ["molho", "Molho de tomate", "Mercearia", "g", 12000, 5000, 1590],
  ["farinha", "Farinha", "Mercearia", "g", 25000, 8000, 799],
  ["catupiry", "Catupiry", "Laticínios", "g", 1200, 2000, 4290],
  ["refrigerante", "Refrigerante lata", "Bebidas", "un", 36, 12, 650],
  ["presunto", "Presunto", "Frios", "g", 4000, 1500, 3190],
  ["ovo", "Ovo", "Mercearia", "g", 2400, 1200, 1600],
  ["azeitona", "Azeitona", "Mercearia", "g", 1800, 500, 2090],
  ["tomate", "Tomate", "Hortifruti", "g", 3000, 1000, 1290],
  ["manjericao", "Manjericão", "Hortifruti", "g", 300, 100, 1590],
  ["provolone", "Provolone", "Laticínios", "g", 2000, 500, 4990],
  ["parmesao", "Parmesão", "Laticínios", "g", 1500, 500, 5690],
  ["gorgonzola", "Gorgonzola", "Laticínios", "g", 1000, 400, 6290],
  ["frango", "Frango desfiado", "Frios", "g", 5000, 2000, 2490],
  ["pepperoni", "Pepperoni", "Frios", "g", 2000, 500, 5490],
  ["cebola", "Cebola", "Hortifruti", "g", 3000, 1000, 690],
  ["oregano", "Orégano", "Mercearia", "g", 250, 80, 3990],
].map(([id, name, group, unit, openingBase, minimumBase, unitCostCents]) => ({
  id, name, group, unit, openingBase, minimumBase, unitCostCents,
}));

const line = (ingredientId, small, medium, large) => ({
  ingredientId,
  quantityBaseBySize: { small, medium, large },
});

const common = [line("farinha", 120, 180, 260), line("molho", 60, 90, 130), line("mucarela", 120, 180, 250)];
const recipes = [
  ["calabresa", [...common, line("calabresa", 70, 110, 160), line("cebola", 15, 25, 40), line("oregano", 1, 2, 3)]],
  ["portuguesa", [...common, line("presunto", 45, 75, 110), line("ovo", 25, 40, 60), line("cebola", 15, 25, 40), line("azeitona", 8, 14, 20)]],
  ["marguerita", [...common, line("tomate", 25, 45, 70), line("manjericao", 2, 4, 7)]],
  ["frango-catupiry", [...common, line("frango", 65, 105, 155), line("catupiry", 35, 60, 90)]],
  ["quatro-queijos", [...common, line("provolone", 25, 40, 60), line("parmesao", 20, 35, 50), line("gorgonzola", 15, 25, 40)]],
  ["pepperoni", [...common, line("pepperoni", 55, 90, 135)]],
].map(([flavorKey, lines]) => ({ flavorId: `ng-${flavorKey}`, lines }));

export function createPizzeriaInventorySeed() {
  return {
    ingredients: ingredients.map(({ openingBase, ...ingredient }) => ({ ...ingredient })),
    openingBalances: ingredients.map(({ id, openingBase }) => ({ ingredientId: id, quantityBase: openingBase })),
    recipes: recipes.map(({ flavorId, lines }) => ({
      flavorId,
      lines: lines.map(({ ingredientId, quantityBaseBySize }) => ({
        ingredientId,
        quantityBaseBySize: { ...quantityBaseBySize },
      })),
    })),
  };
}
