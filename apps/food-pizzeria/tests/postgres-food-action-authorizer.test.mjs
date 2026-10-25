import assert from "node:assert/strict";
import test from "node:test";
import { createFoodPostgresActionAuthorizer } from "../src/adapters/postgres-food-action-authorizer.mjs";

const SUBJECT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SPACE_A = "11111111-1111-4111-8111-111111111111";
const SPACE_B = "22222222-2222-4222-8222-222222222222";

function fixture() {
  let current = { subjectId: SUBJECT, spaceId: SPACE_A, epoch: "identity-epoch-1" };
  let allowed = true;
  let verifiedCalls = 0;
  const queries = [];
  const db = {
    async query(sql, params) {
      queries.push({ sql, params });
      return { rowCount: 1, rows: [{ allowed }] };
    },
  };
  return {
    db, queries,
    authorizer: createFoodPostgresActionAuthorizer({
      getVerifiedBinding: async (client) => {
        assert.equal(client, db);
        verifiedCalls += 1;
        return current;
      },
    }),
    setVerified(next) { current = next; },
    setPermission(next) { allowed = next; },
    get verifiedCalls() { return verifiedCalls; },
  };
}

test("Food cannot instantiate a per-action authority without the real server binding provider", () => {
  assert.throws(() => createFoodPostgresActionAuthorizer(),
    /sessão verificada pelo host server-side/);
  assert.throws(() => createFoodPostgresActionAuthorizer({
    getVerifiedBinding: { subjectId: SUBJECT, spaceId: SPACE_A },
  }), /sessão verificada pelo host server-side/);
});

test("each action uses a fresh canonical SQL check with bound IDs, never string interpolation", async () => {
  const f = fixture();
  for (const action of ["order.create", "order.transition", "order.read"]) {
    const binding = await f.authorizer(f.db, action);
    assert.deepEqual(binding, {
      granted: true, subjectId: SUBJECT, spaceId: SPACE_A, epoch: "identity-epoch-1",
    });
    assert.ok(Object.isFrozen(binding));
  }
  assert.equal(f.verifiedCalls, 3);
  assert.equal(f.queries.length, 3);
  for (const [i, item] of f.queries.entries()) {
    assert.equal(item.sql,
      "select private.ordax_food_action_eligible_v1($1::uuid,$2::uuid,$3::text) as allowed");
    assert.deepEqual(item.params, [SUBJECT, SPACE_A,
      ["order.create", "order.transition", "order.read"][i]]);
    assert.ok(!item.sql.includes(SUBJECT) && !item.sql.includes(SPACE_A));
  }
});

test("an inactive or absent Food grant is always a rejection, not a preview fallback", async () => {
  const f = fixture();
  f.setPermission(false);
  await assert.rejects(f.authorizer(f.db, "order.create"),
    { name: "FoodOrderRejectedError", reason: "permission-denied" });
  assert.equal(f.queries.length, 1);
  assert.equal(f.verifiedCalls, 1);
});

test("unrecognized actions and missing DB capability never inspect identity or issue SQL", async () => {
  const f = fixture();
  for (const action of ["order.delete", "food.settings.update", "", null]) {
    await assert.rejects(f.authorizer(f.db, action),
      { name: "FoodOrderRejectedError", reason: "permission-denied" });
  }
  await assert.rejects(f.authorizer({}, "order.read"),
    { name: "FoodOrderRejectedError", reason: "permission-denied" });
  assert.equal(f.queries.length, 0);
  assert.equal(f.verifiedCalls, 0);
});

test("client-shaped identity data and caller-declared granted fields cannot authorize Food", async () => {
  const f = fixture();
  for (const context of [
    null, {},
    { subjectId: SUBJECT, spaceId: SPACE_A },
    { subjectId: SUBJECT, spaceId: SPACE_A, epoch: "" },
    { subjectId: SUBJECT, spaceId: SPACE_A, epoch: "epoch", granted: true },
    { subjectId: "not-a-uuid", spaceId: SPACE_A, epoch: "epoch" },
    { subjectId: SUBJECT, spaceId: "fake-space", epoch: "epoch" },
  ]) {
    f.setVerified(context);
    await assert.rejects(f.authorizer(f.db, "order.read"),
      { name: "FoodOrderRejectedError", reason: "permission-denied" });
  }
  assert.equal(f.queries.length, 0, "must reject invalid binding BEFORE querying owner");
});

test("Space switch or revocation requires independent verification on each call", async () => {
  const f = fixture();
  assert.equal((await f.authorizer(f.db, "order.create")).spaceId, SPACE_A);
  f.setVerified({ subjectId: SUBJECT, spaceId: SPACE_B, epoch: "identity-epoch-2" });
  f.setPermission(false);
  await assert.rejects(f.authorizer(f.db, "order.create"),
    { name: "FoodOrderRejectedError", reason: "permission-denied" });
  assert.deepEqual(f.queries.map(q => q.params[1]), [SPACE_A, SPACE_B]);
  assert.equal(f.verifiedCalls, 2);
});

test("malformed policy SQL response never becomes an implicit grant", async () => {
  const identity = async () => ({
    subjectId: SUBJECT, spaceId: SPACE_A, epoch: "epoch-1",
  });
  const authorize = createFoodPostgresActionAuthorizer({ getVerifiedBinding: identity });
  for (const result of [
    null,
    { rowCount: 0, rows: [] },
    { rowCount: 1, rows: [{ allowed: "true" }] },
    { rowCount: 1, rows: [{ allowed: null }] },
    { rowCount: 2, rows: [{ allowed: true }, { allowed: true }] },
  ]) {
    await assert.rejects(authorize({ query: async () => result }, "order.transition"),
      { name: "FoodOrderRejectedError", reason: "permission-denied" });
  }
});
