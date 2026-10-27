import test from "node:test";
import assert from "node:assert/strict";

import { reviewFoodCartPrices } from "../src/application/cart-pricing.mjs";
import { PREVIEW_CATALOG_PRODUCTS } from "../src/fixtures/mock-data.mjs";
import {
  FOOD_PIZZERIA_STATE_SCHEMA_V6,
  createPizzeriaOrder,
  savePizzeriaFlavor,
  setPizzeriaFlavorAvailability,
  updateFoodPizzeriaSettings,
  validateFoodPizzeriaState,
} from "../src/domain/domain.mjs";
import { createSeedFoodState } from "../src/fixtures/mock-data.mjs";


function timestampAfterFlavorCreation(state, flavorId) {
  const flavor = state.flavors.find(({ id }) => id === flavorId);
  assert.ok(flavor, `Expected seeded flavor ${flavorId}`);
  const createdAt = Date.parse(flavor.createdAt);
  assert.ok(Number.isFinite(createdAt), `Expected valid creation timestamp for ${flavorId}`);
  return new Date(createdAt + 1000).toISOString();
}

function pizzaItem(state, flavorIds = ["ng-calabresa"]) {
  const size = "medium";
  const selected = flavorIds.map((id) => state.flavors.find((flavor) => flavor.id === id));
  const prices = selected.map((flavor) => flavor.pricesCents[size]);
  const unitPriceCents = state.settings.halfPricePolicy === "highest"
    ? Math.max(...prices)
    : Math.ceil(prices.reduce((sum, price) => sum + price, 0) / prices.length);
  return { id: "draft-pizza-1", size, flavorIds, quantity: 2, unitPriceCents };
}

test("unchanged menu prices preserve the draft without mutation", () => {
  const state = createSeedFoodState();
  const item = pizzaItem(state);
  const cart = [item];
  const result = reviewFoodCartPrices(cart, state);
  assert.equal(result.changed, false);
  assert.strictEqual(result.items[0], item);
  assert.equal(result.items[0].unitPriceCents, 4990);
  assert.equal(Object.isFrozen(result.items), true);
  assert.equal(cart[0].unitPriceCents, 4990);
});

test("a changed price requires another review before a new Food order is accepted", () => {
  const state = createSeedFoodState();
  const item = pizzaItem(state);
  const flavor = state.flavors.find(({ id }) => id === item.flavorIds[0]);
  const at = timestampAfterFlavorCreation(state, flavor.id);
  const updated = savePizzeriaFlavor(state, {
    id: flavor.id,
    name: flavor.name,
    description: flavor.description,
    pricesCents: { ...flavor.pricesCents, medium: 5990 },
    at,
  });
  const review = reviewFoodCartPrices([item], updated);
  assert.equal(review.changed, true);
  assert.equal(review.items[0].unitPriceCents, 5990);
  assert.equal(item.unitPriceCents, 4990);
  assert.equal(reviewFoodCartPrices(review.items, updated).changed, false);

  const placed = createPizzeriaOrder(updated, {
    id: "price-review-order",
    historyId: "price-review-history",
    createdAt: at,
    customerName: "Cliente da prévia",
    channel: "pickup",
    items: review.items.map(({ id, size, flavorIds, quantity }) => ({ id, size, flavorIds, quantity })),
  });
  const order = placed.orders.find(({ id }) => id === "price-review-order");
  assert.equal(order.items[0].unitPriceCents, review.items[0].unitPriceCents);
  assert.equal(order.subtotalCents, 11980);
  assert.equal(Object.hasOwn(placed, "inventoryMovements"), false);
});

test("changing the half-and-half pricing policy also requires a new review", () => {
  const state = createSeedFoodState();
  const item = pizzaItem(state, ["ng-calabresa", "ng-portuguesa"]);
  const updated = updateFoodPizzeriaSettings(state, { halfPricePolicy: "average" });
  const review = reviewFoodCartPrices([item], updated);
  assert.equal(review.changed, true);
  assert.equal(review.items[0].unitPriceCents, 5140);
  assert.equal(reviewFoodCartPrices(review.items, updated).changed, false);
});

test("unavailable pizza flavors are never silently accepted at stale prices", () => {
  const state = createSeedFoodState();
  const item = pizzaItem(state);
  const at = timestampAfterFlavorCreation(state, item.flavorIds[0]);
  const inactive = setPizzeriaFlavorAvailability(state, { flavorId: item.flavorIds[0], active: false, at });
  assert.throws(() => reviewFoodCartPrices([item], inactive), /não está disponível/);
  assert.equal(item.unitPriceCents, 4990);
});

test("catalog preview prices are rechecked and removed products block order submission", () => {
  const state = createSeedFoodState();
  const product = PREVIEW_CATALOG_PRODUCTS[0];
  const cart = [{
    id: "draft-product-1",
    type: "catalog-product",
    productId: product.id,
    name: product.name,
    category: product.category,
    quantity: 2,
    unitPriceCents: product.priceCents,
  }];
  assert.equal(reviewFoodCartPrices(cart, state, PREVIEW_CATALOG_PRODUCTS).changed, false);
  const revised = [{ ...product, priceCents: product.priceCents + 100 }];
  const review = reviewFoodCartPrices(cart, state, revised);
  assert.equal(review.changed, true);
  assert.equal(review.items[0].unitPriceCents, product.priceCents + 100);
  assert.equal(cart[0].unitPriceCents, product.priceCents);
  assert.throws(() => reviewFoodCartPrices(cart, state, []), /não está mais disponível/);
});

test("Food order keeps a product price snapshot and excludes products from recipe consumption", () => {
  const state = createSeedFoodState();
  const createdAt = new Date().toISOString();
  const product = PREVIEW_CATALOG_PRODUCTS[0];
  const shared = {
    createdAt,
    customerName: "Cliente da prévia",
    channel: "pickup",
  };
  const pizzaOnly = createPizzeriaOrder(state, {
    ...shared,
    id: "pizza-only-comparison",
    historyId: "pizza-only-comparison-history",
    items: [{ id: "pizza-only-comparison-item", size: "medium", flavorIds: ["ng-calabresa"], quantity: 1 }],
  }).orders[0];
  const mixed = createPizzeriaOrder(state, {
    ...shared,
    id: "mixed-food-order",
    historyId: "mixed-food-order-history",
    catalogProducts: PREVIEW_CATALOG_PRODUCTS,
    items: [
      { id: "mixed-food-pizza", size: "medium", flavorIds: ["ng-calabresa"], quantity: 1 },
      { id: "mixed-food-drink", type: "catalog-product", productId: product.id, quantity: 2 },
    ],
  }).orders[0];

  assert.equal(mixed.items[1].name, product.name);
  assert.equal(mixed.items[1].unitPriceCents, product.priceCents);
  assert.equal(mixed.items[1].lineTotalCents, product.priceCents * 2);
  assert.equal(mixed.subtotalCents, pizzaOnly.subtotalCents + product.priceCents * 2);
  assert.deepEqual(mixed.consumptionSnapshot, pizzaOnly.consumptionSnapshot);
  const invalidPizzaSnapshot = {
    ...state,
    orders: [{ ...mixed, consumptionSnapshot: [] }, ...state.orders],
  };
  assert.throws(() => validateFoodPizzeriaState(invalidPizzaSnapshot), /pizza exigem uma proposta/);
  assert.throws(() => createPizzeriaOrder(state, {
    ...shared,
    id: "unknown-food-product-order",
    historyId: "unknown-food-product-history",
    catalogProducts: PREVIEW_CATALOG_PRODUCTS,
    items: [{ id: "unknown-food-product-item", type: "catalog-product", productId: "unknown-item", quantity: 1 }],
  }), /não está disponível no catálogo/);
  const ownerV6 = {
    ...state,
    schema: FOOD_PIZZERIA_STATE_SCHEMA_V6,
    orders: state.orders.map((order) => ({
      ...order,
      items: order.items.map((item) => {
        if (item.type === "catalog-product") return item;
        const { sliceCount: _sliceCount, ...legacyItem } = item;
        return legacyItem;
      }),
    })),
  };
  assert.throws(() => createPizzeriaOrder(ownerV6, {
    ...shared,
    id: "owner-v6-catalog-order",
    historyId: "owner-v6-catalog-history",
    catalogProducts: PREVIEW_CATALOG_PRODUCTS,
    items: [{ id: "owner-v6-catalog-item", type: "catalog-product", productId: product.id, quantity: 1 }],
  }), /Food v7 ou superior e só são aceitos na prévia local/);
});
