import test from "node:test";
import assert from "node:assert/strict";

import { reviewFoodCartPrices } from "../src/application/cart-pricing.mjs";
import {
  createPizzeriaOrder,
  savePizzeriaFlavor,
  setPizzeriaFlavorAvailability,
  updateFoodPizzeriaSettings,
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
