import assert from "node:assert/strict";
import test from "node:test";
import { foodOrderActionLabel, nextFoodOrderStatus } from "../src/ui/order-actions.mjs";

test("ações operacionais avançam pedidos até cozinha, entrega e conclusão", () => {
  assert.equal(nextFoodOrderStatus({ status: "received", channel: "pickup" }), "preparing");
  assert.equal(nextFoodOrderStatus({ status: "preparing", channel: "pickup" }), "ready");
  assert.equal(nextFoodOrderStatus({ status: "ready", channel: "delivery" }), "out-for-delivery");
  assert.equal(nextFoodOrderStatus({ status: "out-for-delivery", channel: "delivery" }), "completed");
  assert.equal(nextFoodOrderStatus({ status: "completed", channel: "delivery" }), null);
});

test("ação de conclusão identifica a forma de atendimento de cada canal", () => {
  for (const [channel, label] of [
    ["pickup", "Confirmar retirada"],
    ["counter", "Entregar ao cliente"],
    ["dine-in", "Marcar como servido"],
  ]) {
    const order = { status: "ready", channel };
    assert.equal(nextFoodOrderStatus(order), "completed");
    assert.equal(foodOrderActionLabel(order), label);
  }
  assert.equal(foodOrderActionLabel({ status: "out-for-delivery", channel: "delivery" }), "Concluir entrega");
});

test("etapas de cozinha e despacho mantêm rótulos claros", () => {
  assert.equal(foodOrderActionLabel({ status: "received", channel: "counter" }), "Iniciar preparo");
  assert.equal(foodOrderActionLabel({ status: "preparing", channel: "counter" }), "Marcar como pronto");
  assert.equal(foodOrderActionLabel({ status: "ready", channel: "delivery" }), "Despachar para entrega");
});
