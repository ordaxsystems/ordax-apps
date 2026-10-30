import assert from "node:assert/strict";
import test from "node:test";
import {
  createPizzeriaOrder,
  isValidPizzeriaDeliveryAddress,
  isValidPizzeriaDeliveryPhone,
} from "../src/domain/domain.mjs";
import { createSeedFoodState } from "../src/fixtures/mock-data.mjs";

test("delivery phone validation matches the Food domain digit and text limits", () => {
  for (const phone of ["(11) 3333-2222", "+55 (11) 98888-7766", "11987654321"]) {
    assert.equal(isValidPizzeriaDeliveryPhone(phone), true, phone);
  }
  for (const phone of ["", "   ", "119876543", "+55 (11) 98888-7766 0", "\0(11) 98888-7766", "x".repeat(33)]) {
    assert.equal(isValidPizzeriaDeliveryPhone(phone), false, String(phone));
  }
});

test("delivery address validation trims and enforces the Food order text bound", () => {
  assert.equal(isValidPizzeriaDeliveryAddress(" Rua das Flores, 10 — Centro "), true);
  for (const address of ["", "  ", null, "\0Rua", "x".repeat(241)]) {
    assert.equal(isValidPizzeriaDeliveryAddress(address), false, String(address));
  }
});

test("Food refuses delivery orders with invalid contact or a blank address", () => {
  const state = createSeedFoodState();
  const input = {
    id: "delivery-validation-order",
    historyId: "delivery-validation-history",
    createdAt: new Date().toISOString(),
    customerName: "Cliente entrega",
    phone: "(11) 98888-7766",
    channel: "delivery",
    address: "Rua das Flores, 10",
    deliveryFeeCents: 500,
    items: [{ id: "delivery-validation-item", size: "medium", flavorIds: ["ng-calabresa"], quantity: 1 }],
  };

  assert.throws(() => createPizzeriaOrder(state, { ...input, phone: "119876543" }), /DDD e número/);
  assert.throws(() => createPizzeriaOrder(state, { ...input, phone: "   " }), /telefone do cliente/);
  assert.throws(() => createPizzeriaOrder(state, { ...input, address: "   " }), /endereço para pedido/);
});
