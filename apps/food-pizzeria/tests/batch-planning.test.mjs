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

test("batch planner consolidates ingredient quantities from the current recipes", () => {
  const state = createSeedFoodState(Date.parse("2026-10-27T12:00:00.000Z"));
  const plan = calculatePizzeriaBatchConsumption(state, {
    size: "small",
    flavorQuantities: [
      { flavorId: "ng-calabresa", quantity: 2 },
      { flavorId: "ng-marguerita", quantity: 3 },
    ],
  });

  assert.equal(plan.sizeId, "small");
  assert.equal(plan.totalPizzas, 5);
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

test("batch planner rejects empty, duplicate, oversized and unavailable production requests", () => {
  const state = createSeedFoodState(Date.parse("2026-10-27T12:00:00.000Z"));
  const oneFlavor = [{ flavorId: "ng-calabresa", quantity: 1 }];
  assert.throws(() => calculatePizzeriaBatchConsumption(state, { size: "small", flavorQuantities: [] }), /ao menos uma pizza/);
  assert.throws(() => calculatePizzeriaBatchConsumption(state, {
    size: "small",
    flavorQuantities: [...oneFlavor, ...oneFlavor],
  }), /uma única vez/);
  assert.throws(() => calculatePizzeriaBatchConsumption(state, {
    size: "small",
    flavorQuantities: [{ flavorId: "ng-calabresa", quantity: 10001 }],
  }), /quantidades inteiras/);
  assert.throws(() => calculatePizzeriaBatchConsumption(state, { size: "unknown", flavorQuantities: oneFlavor }), /tamanho ativo/);

  const missingRecipe = {
    ...state,
    recipes: state.recipes.filter(({ flavorId }) => flavorId !== "ng-calabresa"),
  };
  assert.throws(() => calculatePizzeriaBatchConsumption(missingRecipe, { size: "small", flavorQuantities: oneFlavor }), /ficha técnica/);
});

test("menu displays the batch plan using recipe units without implying inventory writes", () => {
  const snapshot = createSeedFoodState(Date.parse("2026-10-27T12:00:00.000Z"));
  const batchPlanResult = calculatePizzeriaBatchConsumption(snapshot, {
    size: "small",
    flavorQuantities: [{ flavorId: "ng-calabresa", quantity: 2 }],
  });
  const html = renderMenuPage({
    PIZZA_SIZES: snapshot.settings.pizzaSizes,
    PREVIEW_CATALOG_PRODUCTS: [],
    PREVIEW_INGREDIENTS: FOOD_RECIPE_INGREDIENT_FIXTURES,
    snapshot,
    recipeFlavorId: null,
    recipeDraftLines: [],
    editFlavorId: null,
    busy: false,
    button: (label, action) => `<button data-action="${action}">${label}</button>`,
    money: (cents) => `R$ ${(cents / 100).toFixed(2)}`,
    escapeHtml: (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]),
    timeLabel: () => "agora",
    flavorForm: () => "<form id=flavor-form></form>",
    emptyState: () => "",
    batchPlanSize: "small",
    batchPlanQuantities: { "ng-calabresa": 2 },
    batchPlanResult,
    batchPlanError: null,
  });

  assert.match(html, /id="batch-plan-form"/);
  assert.match(html, /Planejar um lote/);
  assert.match(html, /2 pizzas pequena/);
  assert.match(html, /Farinha/);
  assert.match(html, /240 g/);
  assert.match(html, /não altera o estoque/);
});
