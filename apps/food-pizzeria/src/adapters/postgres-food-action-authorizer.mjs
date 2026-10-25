import { FoodOrderRejectedError } from "../ports/food-order-commit-port.mjs";

// Server-only bridge to the canonical Space role policy proposed in
// ordax-platform. This bridge is inert until that boundary is reviewed,
// migrated and EXECUTE is granted to a dedicated least-privilege server role.
// It MUST NOT be wired to the Food preview or invoked in a browser.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EPOCH = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const ACTIONS = new Set(["order.read", "order.create", "order.transition"]);
const LOOKUP_SQL = "select private.ordax_food_verify_action_v1($1::uuid,$2::uuid,$3::text) as allowed";

function denied() {
  return new FoodOrderRejectedError("permission-denied",
    "O owner do Space não confirmou permissão para esta ação Food.");
}

function verifiedIdentity(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== 3
    || !Object.hasOwn(value, "subjectId")
    || !Object.hasOwn(value, "spaceId")
    || !Object.hasOwn(value, "epoch")
    || !UUID.test(value.subjectId)
    || !UUID.test(value.spaceId)
    || typeof value.epoch !== "string"
    || !EPOCH.test(value.epoch)) {
    throw denied();
  }
  return Object.freeze({
    subjectId: value.subjectId.toLowerCase(),
    spaceId: value.spaceId.toLowerCase(),
    epoch: value.epoch,
  });
}

// getVerifiedBinding(client) MUST be implemented by the real server-host
// transport from authenticated session + currently selected Space. It may
// not read these IDs or epoch from a Food request body, client grant hint,
// localStorage or a model-generated action. No default implementation exists.
export function createFoodPostgresActionAuthorizer({ getVerifiedBinding } = {}) {
  if (typeof getVerifiedBinding !== "function") {
    throw new TypeError("Autoridade Food exige sessão verificada pelo host server-side.");
  }
  return async function authorizeFoodAction(db, action) {
    if (typeof db?.query !== "function" || !ACTIONS.has(action)) throw denied();
    const context = verifiedIdentity(await getVerifiedBinding(db));
    // A positive lookup is derived from canonical server-side Auth eligibility,
    // Space owner / active members and the exact requested Food action. Passing
    // a syntactically valid subject/Space is never a grant.
    const result = await db.query(LOOKUP_SQL, [
      context.subjectId, context.spaceId, action,
    ]);
    if (!result || result.rowCount !== 1
      || !Array.isArray(result.rows)
      || result.rows.length !== 1
      || result.rows[0].allowed !== true) {
      throw denied();
    }
    return Object.freeze({
      granted: true,
      subjectId: context.subjectId,
      spaceId: context.spaceId,
      epoch: context.epoch,
    });
  };
}
