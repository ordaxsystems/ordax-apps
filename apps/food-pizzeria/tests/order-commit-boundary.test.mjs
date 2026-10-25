import assert from "node:assert/strict";
import test from "node:test";

import { createFoodCommand } from "../src/application/commands.mjs";
import {
  FOOD_ORDER_COMMIT_PORT_SCHEMA,
  FOOD_ORDER_COMMIT_RECEIPT_SCHEMA,
  FoodOrderOutcomeUnknownError,
  assertFoodOrderCommitPort,
  submitFoodOrderCommand,
  validateFoodOrderCommitReceipt,
} from "../src/ports/food-order-commit-port.mjs";

function command(type = "order.create") {
  return createFoodCommand({
    type,
    payload: type === "order.create"
      ? { id: "food-order-101" }
      : type === "order.transition"
        ? { orderId: "food-order-101", nextStatus: "preparing" }
        : { halfPricePolicy: "average" },
    commandId: "food-command-101",
    expectedRevision: 7,
    issuedAt: "2026-10-25T04:00:00.000Z",
  });
}

function receipt(value = {}) {
  return {
    schema: FOOD_ORDER_COMMIT_RECEIPT_SCHEMA,
    spaceId: "space-pizzeria-1",
    commandId: "food-command-101",
    orderId: "food-order-101",
    status: "received",
    revision: 8,
    commitId: "durable-receipt-101",
    ...value,
  };
}

function fakePort({ commit, initialBinding } = {}) {
  let currentBinding = initialBinding ?? {
    spaceId: "space-pizzeria-1",
    subjectId: "account-owner-1",
    epoch: "session-1",
  };
  let writes = 0;
  return {
    schema: FOOD_ORDER_COMMIT_PORT_SCHEMA,
    getBinding: () => currentBinding,
    commitOrderCommand: async (request) => {
      writes += 1;
      return commit ? commit(request) : receipt();
    },
    setBinding(next) { currentBinding = next; },
    get writes() { return writes; },
  };
}

test("Food order write boundary does not synthesize a backend, Space grant or local storage fallback", async () => {
  assert.throws(() => assertFoodOrderCommitPort(null), /port transacional Food autorizado/);
  assert.throws(() => assertFoodOrderCommitPort({
    schema: FOOD_ORDER_COMMIT_PORT_SCHEMA,
    getBinding() { return {}; },
  }), /port transacional Food autorizado/);
  await assert.rejects(submitFoodOrderCommand(undefined, command()), /port transacional Food autorizado/);
  const port = fakePort();
  await assert.rejects(submitFoodOrderCommand(port, command("food.settings.update")),
    /somente aceita criação\/transição/);
  assert.equal(port.writes, 0);
});

test("host-provided transaction receipt is checked for exact order, Space, status and revision", async () => {
  const port = fakePort();
  const result = await submitFoodOrderCommand(port, command());
  assert.deepEqual(result, receipt());
  assert.ok(Object.isFrozen(result));
  assert.equal(port.writes, 1);
  const transitionPort = fakePort({
    commit: () => receipt({ status: "preparing" }),
  });
  assert.equal((await submitFoodOrderCommand(transitionPort, command("order.transition"))).status,
    "preparing");
});

test("Food refuses invalid host bindings before executing any command", async () => {
  for (const binding of [
    null,
    { spaceId: "", subjectId: "account-owner-1", epoch: "session-1" },
    { spaceId: "space-pizzeria-1", subjectId: "account-owner-1", epoch: "session-1", grant: "fake" },
    { spaceId: "space-pizzeria-1", subjectId: "owner", epoch: "" },
  ]) {
    const port = fakePort({ initialBinding: binding === null ? {} : binding });
    await assert.rejects(submitFoodOrderCommand(port, command()), /vínculo|identificador|campos/);
    assert.equal(port.writes, 0);
  }
});

test("wrong-Space, wrong-order, wrong-command or wrong-revision receipts are never accepted", async () => {
  const changes = [
    { spaceId: "space-pizzeria-2" },
    { orderId: "food-order-102" },
    { commandId: "food-command-102" },
    { revision: 9 },
    { revision: 7 },
    { status: "completed" },
    { commitId: "" },
    { schema: "ordax.food-order-commit-receipt/999" },
    { untrustedExtra: "value" },
  ];
  for (const change of changes) {
    const port = fakePort({ commit: () => receipt(change) });
    await assert.rejects(submitFoodOrderCommand(port, command()),
      { name: "FoodOrderOutcomeUnknownError" });
    assert.equal(port.writes, 1);
  }
});

test("Space switch while a command is pending refuses late success and never retries", async () => {
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const port = fakePort({ commit: () => pending });
  const run = submitFoodOrderCommand(port, command());
  // Allow the async port call to start, then invalidate the host binding.
  assert.equal(port.writes, 1);
  port.setBinding({ spaceId: "space-pizzeria-2", subjectId: "account-owner-1", epoch: "session-2" });
  finish(receipt());
  await assert.rejects(run, { name: "FoodOrderOutcomeUnknownError" });
  assert.equal(port.writes, 1);
});

test("logout after a provider error yields unknown outcome, not a silent duplicate retry", async () => {
  let port;
  port = fakePort({
    commit() {
      port.setBinding(null);
      throw new Error("transport result unknown");
    },
  });
  await assert.rejects(submitFoodOrderCommand(port, command()),
    { name: "FoodOrderOutcomeUnknownError" });
  assert.equal(port.writes, 1);
});

test("owner errors with an unchanged Space binding remain explicit", async () => {
  const denied = new Error("Space grants denied by owner");
  const port = fakePort({ commit: () => { throw denied; } });
  await assert.rejects(submitFoodOrderCommand(port, command()), (error) => error === denied);
  assert.equal(port.writes, 1);
});

test("receipt validator requires a minimal private-data-free durable acknowledgement", () => {
  const actual = validateFoodOrderCommitReceipt(receipt());
  assert.deepEqual(Object.keys(actual).sort(),
    ["commandId", "commitId", "orderId", "revision", "schema", "spaceId", "status"].sort());
  for (const value of [{}, receipt({ customerName: "Não compartilhar" }), receipt({ revision: -1 })]) {
    assert.throws(() => validateFoodOrderCommitReceipt(value));
  }
  assert.equal(new FoodOrderOutcomeUnknownError("pendente").name, "FoodOrderOutcomeUnknownError");
});
