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
// authorizeAction(client, action) that validates the authenticated subject,
// active account/session, membership and PER-ACTION grants against the
// canonical SQL owner within the current transaction. Without it we refuse to
// initialize; no service_role/browser/preview fallback is provided.
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
          const validSpace = row(await db.query(
            "select s.space_id from public.ordax_spaces s where s.space_id = $1::uuid and s.state = 'active' and s.domain = 'food' and s.subtype = 'pizzeria' for share",
            [scope.spaceId],
          ), "Space autorizado");
          if (validSpace.rowCount !== 1) reject("Space Food indisponível ou não autorizado.");
          bound = scope;
          action = requestedAction;
          return scope;
        }

        async function lockState(spaceId) {
          if (!bound || bound.spaceId !== spaceId) reject("Leitura Food fora do Space autorizado.");
          if (locked !== null) return locked;
          const result = row(await db.query(
            "select revision, document from private.ordax_food_space_state where space_id = $1::uuid for update",
            [spaceId],
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
              "select space_id, command_id, digest, receipt from private.ordax_food_command_journal where space_id = $1::uuid and command_id = $2::text",
              [spaceId, commandId],
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
            const updated = row(await db.query(
              "update private.ordax_food_space_state set revision = $2::bigint, document = $3::jsonb, updated_at = pg_catalog.clock_timestamp() where space_id = $1::uuid and revision = $4::bigint returning revision",
              [entry.spaceId, doc.revision, JSON.stringify(doc), entry.expectedRevision],
            ), "CAS Food");
            if (updated.rowCount !== 1) {
              throw new FoodOrderRejectedError("revision-conflict", "Outro pedido alterou a revisão Food.");
            }

            // The generated commit UUID appears in BOTH receipt and journal
            // from the same SQL statement; never mint a receipt client-side.
            const result = row(await db.query(
              `with commit_token as (select pg_catalog.gen_random_uuid() as id)
               insert into private.ordax_food_command_journal (
                 space_id, command_id, digest, actor_user_id, order_id, status,
                 revision, commit_id, receipt
               )
               select $1::uuid, $2::text, $3::text, $4::uuid, $5::text,
                 $6::text, $7::bigint, t.id,
                 pg_catalog.jsonb_build_object(
                   'schema','ordax.food-order-commit-receipt/1',
                   'spaceId',$1::text, 'commandId',$2::text,
                   'orderId',$5::text, 'status',$6::text,
                   'revision',$7::bigint, 'commitId',t.id::text
                 )
               from commit_token t returning receipt`,
              [entry.spaceId, commandId, entry.digest, bound.subjectId,
                orderId, entry.status, doc.revision],
            ), "journal durável Food");
            if (result.rowCount !== 1) {
              throw new FoodOrderOutcomeUnknownError("Journal Food não confirmou o comando.");
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
        if (opened) {
          try { await db.query("ROLLBACK"); } catch { unusable = true; }
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
