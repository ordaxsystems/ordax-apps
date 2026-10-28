import test from "node:test";
import assert from "node:assert/strict";

import {
  calculatePizzeriaBatchConsumption,
  updateFoodPizzeriaSettings,
} from "../src/domain/domain.mjs";
import { createSeedFoodState } from "../src/fixtures/mock-data.mjs";
import { FOOD_RECIPE_INGREDIENT_FIXTURES } from "../src/fixtures/food-recipes.mjs";
import { renderMenuPage } from "../src/ui/views/menu.mjs";

function quantitiesByIngredient(plan) {
  return Object.fromEntries(plan.ingredients.map(({ ingredientId, quantityBase }) => [ingredientId, quantityBase]));
}

function renderMenu(snapshot, overrides = {}) {
  return renderMenuPage({
    PIZZA_SIZES: snapshot.settings.pizzaSizes,
    PREVIEW_CATALOG_PRODUCTS: [],
    PREVIEW_INGREDIENTS: FOOD_RECIPE_INGREDIENT_FIXTURES,
    snapshot,
    recipeFlavorId: "ng-calabresa",
    recipeDraftLines: [],
    editFlavorId: null,
    busy: false,
    button: (label, action, { disabled = false, extra = "" } = {}) => `<button data-action="${action}" ${disabled ? "disabled" : ""} ${extra}>${label}</button>`,
    money: (cents) => `R$ ${(cents / 100).toFixed(2)}`,
    escapeHtml: (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]),
    timeLabel: () => "agora",
    flavorForm: () => "<form id=flavor-form></form>",
    emptyState: () => "",
    batchPlanSize: "small",
    batchPlanLines: [{ id: "batch-line-1", flavorIds: ["ng-calabresa"], quantity: "0" }],
    maxFlavorsPerPizza: snapshot.settings.maxFlavorsPerPizza,
    batchPlanResult: null,
    batchPlanError: null,
    ...overrides,
  });
}

test("batch planner consolidates ingredient quantities from the current recipes", () => {
  const state = createSeedFoodState(Date.parse("2026-10-27T12:00:00.000Z"));
  const plan = calculatePizzeriaBatchConsumption(state, {
    size: "small",
    pizzaLines: [
      { flavorIds: ["ng-calabresa"], quantity: 2 },
      { flavorIds: ["ng-marguerita"], quantity: 3 },
    ],
  });

  assert.equal(plan.sizeId, "small");
  assert.equal(plan.totalPizzas, 5);
  assert.deepEqual(plan.compositions, [
    { flavorNames: ["Calabresa"], quantity: 2 },
    { flavorNames: ["Marguerita"], quantity: 3 },
  ]);
  assert.deepEqual(quantitiesByIngredient(plan), {
    farinha: 600,
    molho: 300,
    mucarela: 600,
    calabresa: 140,
    cebola: 30,
    oregano: 2,
    tomate: 75,
    manjericao: 6,
  });
  assert.equal(Object.isFrozen(plan.ingredients), true);
});

test("batch planner calculates a four-flavor composition with the Food portion rule", () => {
  const state = createSeedFoodState(Date.parse("2026-10-27T12:00:00.000Z"));
  const plan = calculatePizzeriaBatchConsumption(state, {
    size: "small",
    pizzaLines: [{
      flavorIds: ["ng-calabresa", "ng-frango-catupiry", "ng-marguerita", "ng-pepperoni"],
      quantity: 2,
    }],
  });

  assert.equal(plan.totalPizzas, 2);
  assert.deepEqual(plan.compositions, [{
    flavorNames: ["Calabresa", "Frango com Catupiry", "Marguerita", "Pepperoni"],
    quantity: 2,
  }]);
  assert.equal(Object.isFrozen(plan.compositions), true);
  assert.equal(Object.isFrozen(plan.compositions[0].flavorNames), true);
  assert.equal(quantitiesByIngredient(plan).farinha, 240);
  const grouped = calculatePizzeriaBatchConsumption(state, {
    size: "small",
    pizzaLines: [
      { flavorIds: ["ng-calabresa", "ng-marguerita"], quantity: 1 },
      { flavorIds: ["ng-marguerita", "ng-calabresa"], quantity: 2 },
    ],
  });
  assert.deepEqual(grouped.compositions, [{ flavorNames: ["Calabresa", "Marguerita"], quantity: 3 }]);
});

test("batch planner validates per-pizza compositions, total volume and recipe availability", () => {
  const state = createSeedFoodState(Date.parse("2026-10-27T12:00:00.000Z"));
  const oneFlavor = [{ flavorIds: ["ng-calabresa"], quantity: 1 }];
  assert.throws(() => calculatePizzeriaBatchConsumption(state, { size: "small", pizzaLines: [] }), /ao menos uma pizza/);
  assert.throws(() => calculatePizzeriaBatchConsumption(state, {
    size: "small",
    pizzaLines: [{ flavorIds: [], quantity: 1 }],
  }), /ao menos um sabor/);
  assert.throws(() => calculatePizzeriaBatchConsumption(state, {
    size: "small",
    pizzaLines: [{ flavorIds: ["ng-calabresa", "ng-calabresa"], quantity: 1 }],
  }), /sabores diferentes/);
  assert.throws(() => calculatePizzeriaBatchConsumption(state, {
    size: "small",
    pizzaLines: [{ flavorIds: ["ng-calabresa", "ng-frango-catupiry", "ng-marguerita", "ng-pepperoni", "ng-portuguesa"], quantity: 1 }],
  }), /um a 4 sabores/);
  assert.throws(() => calculatePizzeriaBatchConsumption(state, {
    size: "small",
    pizzaLines: [{ flavorIds: ["ng-calabresa"], quantity: 10001 }],
  }), /quantidades inteiras/);
  assert.throws(() => calculatePizzeriaBatchConsumption(state, {
    size: "small",
    pizzaLines: [...oneFlavor, { flavorIds: ["ng-marguerita"], quantity: 10000 }],
  }), /no máximo 10\.000 pizzas/);
  assert.throws(() => calculatePizzeriaBatchConsumption(state, { size: "unknown", pizzaLines: oneFlavor }), /tamanho ativo/);

  const missingRecipe = {
    ...state,
    recipes: state.recipes.filter(({ flavorId }) => flavorId !== "ng-calabresa"),
  };
  assert.throws(() => calculatePizzeriaBatchConsumption(missingRecipe, { size: "small", pizzaLines: oneFlavor }), /ficha técnica/);
  const unavailableFlavor = {
    ...state,
    flavors: state.flavors.map((flavor) => flavor.id === "ng-calabresa" ? { ...flavor, active: false } : flavor),
  };
  assert.throws(() => calculatePizzeriaBatchConsumption(unavailableFlavor, { size: "small", pizzaLines: oneFlavor }), /indisponível/);
});

test("menu displays the batch plan using recipe units without implying inventory writes", () => {
  const snapshot = createSeedFoodState(Date.parse("2026-10-27T12:00:00.000Z"));
  const batchPlanResult = calculatePizzeriaBatchConsumption(snapshot, {
    size: "small",
    pizzaLines: [{ flavorIds: ["ng-calabresa"], quantity: 2 }],
  });
  const html = renderMenu(snapshot, {
    recipeFlavorId: null,
    batchPlanLines: [{ id: "batch-line-1", flavorIds: ["ng-calabresa"], quantity: "2" }],
    batchPlanResult,
  });

  assert.match(html, /id="batch-plan-form"/);
  assert.match(html, /Planejar um lote/);
  assert.match(html, /2 pizzas pequena/);
  assert.match(html, /2×<\/b><span>Calabresa<\/span>/);
  assert.match(html, /Farinha/);
  assert.match(html, /240 g/);
  assert.match(html, /não altera o estoque/);
  assert.equal((html.match(/data-action="clear-batch-plan"/g) ?? []).length, 1,
    "the displayed result has only one clear action");
  assert.match(html, /aria-label="Limpar resultado do pré-preparo">Limpar lote/);
  assert.doesNotMatch(html, /Limpar quantidades/);
});

test("batch planner keeps one contextual clear action before a result exists", () => {
  const snapshot = createSeedFoodState(Date.parse("2026-10-27T12:00:00.000Z"));
  const html = renderMenu(snapshot);

  assert.equal((html.match(/data-action="clear-batch-plan"/g) ?? []).length, 1);
  assert.match(html, /aria-label="Limpar combinações do pré-preparo">Limpar combinações/);
  assert.doesNotMatch(html, /Limpar lote/);
  assert.match(html, /aria-label="Indisponibilizar sabor Calabresa"/);
});

test("recipe editor disables duplicate ingredients but preserves each row's current choice", () => {
  const snapshot = createSeedFoodState(Date.parse("2026-10-27T12:00:00.000Z"));
  const html = renderMenu(snapshot, {
    recipeDraftLines: [
      { ingredientId: "farinha", quantityBaseBySize: { small: 137, medium: 180, large: 260 } },
      { ingredientId: "molho", quantityBaseBySize: { small: 60, medium: 90, large: 130 } },
    ],
  });
  const selectors = [...html.matchAll(/<select name="ingredient-\d+"[\s\S]*?<\/select>/g)].map(([markup]) => markup);
  assert.equal(selectors.length, 2);
  assert.match(selectors[0], /value="farinha" selected\s*>Farinha · g/);
  assert.match(selectors[0], /value="molho"\s+disabled\s*>Molho de tomate · g · já usado/);
  assert.match(selectors[1], /value="molho" selected\s*>Molho de tomate · g/);
  assert.match(selectors[1], /value="farinha"\s+disabled\s*>Farinha · g · já usado/);
  assert.match(html, new RegExp(`name="quantity-0-small" type="number" min="1" step="1" value="137"`));
  assert.match(html, /aria-label="Remover Farinha da ficha técnica de Calabresa"/);
});
