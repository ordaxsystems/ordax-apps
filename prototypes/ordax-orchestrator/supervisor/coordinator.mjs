import { randomUUID } from 'node:crypto';

// Supervises the EXISTING Flow Task/Run ledger; no second database, task queue,
// chat transport or direct computer executor is created by this module.
const TYPES = new Set(['send_message', 'hold', 'complete']);
const ACTION = 'supervisor.plan';
const MAX_MESSAGE = 6000;
const MAX_REASON = 500;

function boundedText(value, max, label) {
  if (typeof value !== 'string' || !value.trim() ||
      value.length > max || value.includes('\0')) throw new Error('invalid_' + label);
  return value.trim();
}

export function validateSupervisorDecision(value, expectedTaskId) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !['type', 'taskId', 'content', 'reason'].includes(key))) {
    throw new Error('invalid_supervisor_decision');
  }
  if (!TYPES.has(value.type) || value.taskId !== expectedTaskId) {
    throw new Error('invalid_supervisor_decision');
  }
  const reason = boundedText(value.reason, MAX_REASON, 'reason');
  if (value.type === 'send_message') {
    const content = boundedText(value.content, MAX_MESSAGE, 'message');
    return { type: value.type, taskId: expectedTaskId, reason, content };
  }
  if (value.content !== undefined && value.content !== null && value.content !== '') {
    throw new Error('unexpected_supervisor_message');
  }
  return { type: value.type, taskId: expectedTaskId, reason };
}

export class SupervisorCoordinator {
  constructor({ store, planner, chat, authorizeTask, enabled = false,
    environment = 'internal', actorId, tenantId = null } = {}) {
    if (!store?.db || typeof store.getTaskExecutionSnapshot !== 'function' ||
        typeof store.event !== 'function' || typeof store.requestApproval !== 'function') {
      throw new Error('canonical_flow_store_required');
    }
    if (typeof planner?.decide !== 'function' || typeof authorizeTask !== 'function') {
      throw new Error('supervisor_ports_required');
    }
    if (!['internal', 'external'].includes(environment)) throw new Error('invalid_environment');
    this.store = store;
    this.planner = planner;
    this.chat = chat;
    this.authorizeTask = authorizeTask;
    this.enabled = enabled === true;
    this.environment = environment;
    this.actorId = boundedText(actorId, 128, 'actor');
    this.tenantId = environment === 'external'
      ? boundedText(tenantId, 128, 'tenant') : null;

    // Same canonical SQLite action_ledger. Unique per environment/tenant/key.
    // This index applies only to a new action type; Flow/Gratis is untouched.
    store.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS ux_lab_supervisor_request ON action_ledger(task_id,action_type,resource_key) WHERE action_type='supervisor.plan' AND resource_key IS NOT NULL");
  }

  requireEnabled() {
    if (!this.enabled) throw new Error('supervisor_disabled');
  }

  authorize(taskId, operation) {
    const decision = this.authorizeTask({
      actorId: this.actorId, tenantId: this.tenantId,
      environment: this.environment, taskId, operation
    });
    // No Promise: all authorization must be synchronous before any local effect.
    if (decision !== true) throw new Error('supervisor_access_denied');
  }

  assertRequestIdentity(taskId, requestKey, objective) {
    const row = this.store.db.prepare(
      'SELECT payload FROM action_ledger WHERE task_id=? AND action_type=? AND resource_key=?'
    ).get(taskId, ACTION, requestKey);
    if (!row) return false;
    const saved = JSON.parse(row.payload);
    if (saved.objective !== objective || saved.actorId !== this.actorId ||
        saved.environment !== this.environment || saved.tenantId !== this.tenantId) {
      throw new Error('supervisor_request_conflict');
    }
    return true;
  }
  getAction(taskId, requestKey) {
    const row = this.store.db.prepare(
      'SELECT * FROM action_ledger WHERE task_id=? AND action_type=? AND resource_key=?'
    ).get(taskId, ACTION, requestKey);
    if (!row) return null;
    const approval = this.store.db.prepare(
      'SELECT id,status FROM approval_ledger WHERE task_id=? AND action_id=? ORDER BY created_at LIMIT 1'
    ).get(taskId, row.id);
    return {
      actionId: row.id,
      status: row.status,
      approvalId: approval?.id || null,
      approvalStatus: approval?.status || null,
      decision: row.result ? JSON.parse(row.result)?.decision || null : null
    };
  }

  // Recovery is read-only. An interrupted planning/dispatching action remains
  // uncertain until external reconciliation; it is never silently retried.
  listRecoverable({ taskId }) {
    this.requireEnabled();
    const tid = boundedText(taskId, 180, 'task_id');
    this.authorize(tid, 'review');
    if (!this.store.getTaskExecutionSnapshot(tid)) throw new Error('task_not_found');
    const rows = this.store.db.prepare(
      "SELECT a.id,a.status,a.payload,a.result,a.updated_at,p.id AS approval_id,p.status AS approval_status " +
      "FROM action_ledger a LEFT JOIN approval_ledger p ON " +
      "p.action_id=a.id AND p.task_id=a.task_id " +
      "WHERE a.task_id=? AND a.action_type=? AND a.status IN " +
      "('planning','pending_approval','approved','dispatching','indeterminate') " +
      "ORDER BY a.updated_at DESC,a.id DESC LIMIT 25"
    ).all(tid,ACTION);
    const filtered = [];
    for (const row of rows) {
      const scope = JSON.parse(row.payload);
      if (scope.actorId !== this.actorId ||
          scope.tenantId !== this.tenantId ||
          scope.environment !== this.environment) continue;
      const payload = row.result ? JSON.parse(row.result) : null;
      const decision = payload?.decision
        ? validateSupervisorDecision(payload.decision, tid) : null;
      filtered.push({
        taskId:tid,actionId:row.id,status:row.status,
        approvalId:row.approval_id || null,
        approvalStatus:row.approval_status || null,
        decision,
        requiresReconciliation:['planning','dispatching','indeterminate'].includes(row.status),
        updatedAt:row.updated_at
      });
    }
    return filtered;
  }

  async plan({ taskId, requestId, objective }) {
    this.requireEnabled();
    const tid = boundedText(taskId, 180, 'task_id');
    const rid = boundedText(requestId, 120, 'request_id');
    const goal = boundedText(objective, 4000, 'objective');
    this.authorize(tid, 'plan');
    if (!this.store.getTaskExecutionSnapshot(tid)) throw new Error('task_not_found');
    const requestKey = [this.environment, this.tenantId || 'owner', rid].join(':');

    if (this.assertRequestIdentity(tid, requestKey, goal)) return this.getAction(tid, requestKey);

    // Reserve an ID before calling the paid model. Do not re-plan on uncertain
    // responses or after a crash; status "planning" requires reconciliation.
    const actionId = 'action_' + randomUUID();
    const now = this.store.now();
    try {
      this.store.db.prepare(
        'INSERT INTO action_ledger(id,task_id,run_id,action_type,resource_key,status,payload,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)'
      ).run(actionId, tid, null, ACTION, requestKey, 'planning',
        JSON.stringify({ objective: goal, environment: this.environment,
          tenantId: this.tenantId, actorId: this.actorId }), now, now);
    } catch (error) {
      // Another worker won the idempotency race; do not retry the model.
      if (this.assertRequestIdentity(tid, requestKey, goal)) return this.getAction(tid, requestKey);
      throw error;
    }
    this.store.event(tid, 'supervisor.planning', { action_id: actionId, environment: this.environment });
    try {
      const snapshot = this.store.getTaskExecutionSnapshot(tid);
      const modelDecision = await this.planner.decide({
        taskId: tid, objective: goal,
        environment: this.environment,
        checkpointVersion: snapshot.checkpoint_version,
        hasMessages: Boolean(snapshot.has_messages)
      });
      const decision = validateSupervisorDecision(modelDecision, tid);
      this.store.db.exec('SAVEPOINT supervisor_record_plan');
      try {
        const newStatus = decision.type === 'send_message' ? 'pending_approval' : 'complete';
        this.store.db.prepare(
          "UPDATE action_ledger SET status=?,result=?,updated_at=? WHERE id=? AND status='planning'"
        ).run(newStatus, JSON.stringify({ decision }), this.store.now(), actionId);
        if (decision.type === 'send_message') {
          this.store.requestApproval(tid, actionId, 'Approve one supervisor-proposed chat message');
        }
        this.store.event(tid, 'supervisor.plan.recorded', {
          action_id: actionId, decision_type: decision.type
        });
        this.store.db.exec('RELEASE SAVEPOINT supervisor_record_plan');
      } catch (error) {
        this.store.db.exec('ROLLBACK TO SAVEPOINT supervisor_record_plan');
        this.store.db.exec('RELEASE SAVEPOINT supervisor_record_plan');
        throw error;
      }
    } catch (error) {
      this.store.db.prepare(
        "UPDATE action_ledger SET status='indeterminate',updated_at=? WHERE id=? AND status='planning'"
      ).run(this.store.now(), actionId);
      this.store.event(tid, 'supervisor.plan.indeterminate', { action_id: actionId });
      throw error;
    }
    return this.getAction(tid, requestKey);
  }

  approve({ taskId, actionId, approvalId, explicitOwnerApproval = false }) {
    this.requireEnabled();
    const tid = boundedText(taskId, 180, 'task_id');
    this.authorize(tid, 'approve');
    if (explicitOwnerApproval !== true) throw new Error('explicit_approval_required');
    const action = this.store.db.prepare(
      'SELECT * FROM action_ledger WHERE id=? AND task_id=? AND action_type=?'
    ).get(actionId, tid, ACTION);
    const approval = this.store.db.prepare(
      'SELECT * FROM approval_ledger WHERE id=? AND task_id=? AND action_id=?'
    ).get(approvalId, tid, actionId);
    if (action?.status !== 'pending_approval' || approval?.status !== 'pending') {
      throw new Error('approval_not_pending');
    }
    this.store.db.exec('SAVEPOINT supervisor_approve');
    try {
      const row = this.store.db.prepare(
        "UPDATE approval_ledger SET status='approved',resolved_at=? WHERE id=? AND status='pending'"
      ).run(this.store.now(), approvalId);
      if (row.changes !== 1) throw new Error('approval_raced');
      const change = this.store.db.prepare(
        "UPDATE action_ledger SET status='approved',updated_at=? WHERE id=? AND status='pending_approval'"
      ).run(this.store.now(), actionId);
      if (change.changes !== 1) throw new Error('action_raced');
      this.store.event(tid, 'supervisor.plan.approved', { action_id: actionId, approval_id: approvalId });
      this.store.db.exec('RELEASE SAVEPOINT supervisor_approve');
    } catch (error) {
      this.store.db.exec('ROLLBACK TO SAVEPOINT supervisor_approve');
      this.store.db.exec('RELEASE SAVEPOINT supervisor_approve');
      throw error;
    }
    return { actionId, status: 'approved' };
  }

  async dispatch({ taskId, actionId }) {
    this.requireEnabled();
    const tid = boundedText(taskId, 180, 'task_id');
    this.authorize(tid, 'dispatch');
    if (typeof this.chat?.send !== 'function') throw new Error('chat_port_unavailable');
    const action = this.store.db.prepare(
      'SELECT * FROM action_ledger WHERE id=? AND task_id=? AND action_type=?'
    ).get(actionId, tid, ACTION);
    if (!action || action.status !== 'approved') throw new Error('action_not_approved');
    const approval = this.store.db.prepare(
      "SELECT id FROM approval_ledger WHERE task_id=? AND action_id=? AND status='approved'"
    ).get(tid, actionId);
    if (!approval) throw new Error('approved_receipt_required');
    const decision = validateSupervisorDecision(JSON.parse(action.result).decision, tid);
    if (decision.type !== 'send_message') throw new Error('not_a_message_plan');
    const claim = this.store.db.prepare(
      "UPDATE action_ledger SET status='dispatching',updated_at=? WHERE id=? AND status='approved'"
    ).run(this.store.now(), actionId);
    if (claim.changes !== 1) throw new Error('action_already_dispatched');
    // No automatic replay after failure; the worker may have accepted the send.
    this.store.event(tid, 'supervisor.chat.dispatching', { action_id: actionId });
    try {
      const receipt = await this.chat.send({
        taskId: tid, content: decision.content, actionId, newSession: false
      });
      if (!receipt || receipt.confirmed !== true) throw new Error('unconfirmed_chat_delivery');
      this.store.finishAction(tid, actionId, 'succeeded', {
        runId: receipt.runId || null
      });
      return { actionId, status: 'succeeded' };
    } catch {
      this.store.finishAction(tid, actionId, 'indeterminate', {
        reason: 'send_or_receipt_unknown_no_automatic_retry'
      });
      return { actionId, status: 'indeterminate' };
    }
  }
}
