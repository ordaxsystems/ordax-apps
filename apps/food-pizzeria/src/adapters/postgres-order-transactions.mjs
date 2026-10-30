import { ORDER_STATUSES, validateFoodPizzeriaState } from "../domain/domain.mjs";
import {
  FOOD_ORDER_COMMIT_RECEIPT_SCHEMA,
  FoodOrderOutcomeUnknownError,
  FoodOrderRejectedError,
  validateFoodOrderCommitReceipt,
} from "../ports/food-order-commit-port.mjs";

// Server-side only. Supabase's browser Data API cannot hold a transaction
// across the Food domain callback. This adapter requires ONE pooled PostgreSQL
// connection, with BEGIN / lock / writes / COMMIT on that same connection.
//
// The Food owner cannot manufacture authorization. A trusted host must supply
// authorizeAction(client, action) from a verified session. The Platform owner
// rechecks the permission inside four narrow SECURITY DEFINER Food operations,
// accessible only to the NOLOGIN ordax_food_executor group role. This adapter
// NEVER reads or writes private relations directly. No browser/service_role,
// production credential, preview or identity fallback is provided.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const ACTIONS = new Set(["order.create", "order.transition", "order.read"]);
const STATUSES = new Set(ORDER_STATUSES);

function reject(message) {
  throw new FoodOrderRejectedError("permission-denied", message);
}
function scopeOf(input) {
  if (!input || input.granted !== true || typeof input !== "object"
    || !UUID.test(input.spaceId) || !UUID.test(input.subjectId)
    || typeof input.epoch !== "string" || !ID.test(input.epoch)) {
    reject("O host não confirmou a identidade e o grant por ação do Food.");
  }
  return Object.freeze({
    spaceId: input.spaceId.toLowerCase(),
    subjectId: input.subjectId.toLowerCase(),
    epoch: input.epoch,
  });
}
function sameScope(a, b) {
  return a && b && a.spaceId === b.spaceId
    && a.subjectId === b.subjectId && a.epoch === b.epoch;
}
function row(result, label) {
  if (!result || !Array.isArray(result.rows) || !Number.isInteger(result.rowCount)) {
    throw new Error(`Resultado PostgreSQL inválido em ${label}.`);
  }
  return result;
}
function inputId(value, name) {
  if (typeof value !== "string" || !ID.test(value)) {
    throw new TypeError(`${name} do Food inválido.`);
  }
  return value;
}

export function createFoodPostgresTransactions({ pool, authorizeAction } = {}) {
  if (typeof pool?.connect !== "function" || typeof authorizeAction !== "function") {
    throw new TypeError("Food PostgreSQL exige conexão server-side e autoridade per-action real.");
  }
  return Object.freeze({
    async transact(work) {
      if (typeof work !== "function") throw new TypeError("Transação Food exige uma função.");
      const db = await pool.connect();
      if (!db || typeof db.query !== "function" || typeof db.release !== "function") {
        throw new TypeError("Driver Food exige client de PostgreSQL com query/release.");
      }
      let opened = false;
      let commitIssued = false;
      let unusable = false;
      try {
        await db.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
        opened = true;
        let bound = null;
        let action = null;
        let locked = null;

        async function verify(requestedAction) {
          if (!ACTIONS.has(requestedAction)) reject("Ação Food desconhecida.");
          // The authorizeAction callback must perform its DB authorization
          // checks and take any necessary membership/session locks itself.
          const scope = scopeOf(await authorizeAction(db, requestedAction));
          if (bound && !sameScope(scope, bound)) {
            reject("A identidade ou o Space mudou durante a transação Food.");
          }
          // The SQL policy called by authorizeAction has already checked
          // the active typed Space. Every subsequent private RPC rechecks it.
          bound = scope;
          action = requestedAction;
          return scope;
        }

        async function lockState(spaceId) {
          if (!bound || bound.spaceId !== spaceId) reject("Leitura Food fora do Space autorizado.");
          if (locked !== null) return locked;
          const result = row(await db.query(
            "select revision, document from private.ordax_food_read_state_v1($1::uuid,$2::uuid,$3::text)",
            [bound.subjectId, spaceId, action],
          ), "estado Food");
          if (result.rowCount !== 1) {
            throw new FoodOrderRejectedError("invalid-command",
              "O Space Food ainda não foi provisionado pelo owner.");
          }
          const document = validateFoodPizzeriaState(result.rows[0].document);
          if (document.revision !== Number(result.rows[0].revision)) {
            throw new FoodOrderOutcomeUnknownError("A revisão persistida do Food está inconsistente.");
          }
          locked = { spaceId, document };
          return locked;
        }

        const tx = Object.freeze({
          authorize: verify,
          async findCommand(spaceId, commandId) {
            inputId(commandId, "Identificador de comando");
            await lockState(spaceId);
            const result = row(await db.query(
              "select space_id, command_id, digest, receipt from private.ordax_food_find_command_v1($1::uuid,$2::uuid,$3::text,$4::text)",
              [bound.subjectId, spaceId, action, commandId],
            ), "histórico Food");
            if (result.rowCount > 1) throw new FoodOrderOutcomeUnknownError("Journal Food duplicado.");
            if (!result.rowCount) return null;
            const item = result.rows[0];
            return {
              spaceId: item.space_id,
              commandId: item.command_id,
              digest: item.digest,
              receipt: item.receipt,
            };
          },
          async readState(spaceId) {
            const state = await lockState(spaceId);
            return structuredClone(state.document);
          },
          async commit(entry) {
            if (!entry || typeof entry !== "object" || !bound
              || !locked || action === "order.read" || !ACTIONS.has(action)) {
              reject("Gravação Food não autorizada.");
            }
            if (bound.spaceId !== entry.spaceId || locked.spaceId !== entry.spaceId) {
              reject("Tentativa de gravação Food em outro Space.");
            }
            const commandId = inputId(entry.commandId, "Comando");
            const orderId = inputId(entry.orderId, "Pedido");
            if (!DIGEST.test(entry.digest) || !STATUSES.has(entry.status)) {
              throw new FoodOrderRejectedError("invalid-command", "Digest ou estado Food inválido.");
            }
            const doc = validateFoodPizzeriaState(entry.nextState);
            if (!Number.isSafeInteger(entry.expectedRevision)
              || doc.revision !== entry.expectedRevision + 1
              || locked.document.revision !== entry.expectedRevision) {
              throw new FoodOrderRejectedError("revision-conflict", "Revisão Food não confere.");
            }
            const prior = bound;
            await verify(action); // live membership/grants rechecked at write boundary
            if (!sameScope(prior, bound)) reject("Revogação durante gravação Food.");
            // The Platform is the SQL authority: one reviewed operation
            // atomically applies CAS + journal + server-created receipt.
            // Browser roles and the Food executor have NO direct table DML.
            const result = row(await db.query(
              "select private.ordax_food_commit_order_v1($1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::bigint,$7::jsonb,$8::text,$9::text) as receipt",
              [bound.subjectId, entry.spaceId, action, commandId, entry.digest,
                entry.expectedRevision, JSON.stringify(doc), orderId, entry.status],
            ), "recibo Food SQL autorizado");
            if (result.rowCount !== 1) {
              throw new FoodOrderOutcomeUnknownError("SQL owner não confirmou o recibo Food.");
            }
            return validateFoodOrderCommitReceipt(result.rows[0].receipt);
          },
        });

        const value = await work(tx);
        commitIssued = true;
        await db.query("COMMIT");
        opened = false;
        return value;
      } catch (error) {
        // SQLSTATE 40001 (serialization_failure) and 40P01 (deadlock_detected)
        // are *explicit transaction aborts* by PostgreSQL, including when
        // returned by COMMIT. They cannot have persisted this transaction.
        // Do not retry invisibly: return the Food CAS conflict contract.
        const knownAbort = error?.code === "40001" || error?.code === "40P01";
        // A lost COMMIT acknowledgement without an explicit SQL abort remains
        // ambiguous. ROLLBACK cannot prove its outcome. Discard the connection.
        if (commitIssued && !knownAbort) unusable = true;
        if (opened) {
          try { await db.query("ROLLBACK"); } catch { unusable = true; }
        }
        if (knownAbort) {
          throw new FoodOrderRejectedError("revision-conflict",
            "Outra transação alterou o Food. Recarregue a revisão antes de enviar outro comando.");
        }
        if (commitIssued || unusable) {
          throw new FoodOrderOutcomeUnknownError(
            "A transação PostgreSQL do Food não confirmou o resultado. Consulte o owner.",
            { cause: error },
          );
        }
        throw error;
      } finally {
        db.release(unusable ? new Error("Food PostgreSQL connection state unknown") : undefined);
      }
    },
  });
}
