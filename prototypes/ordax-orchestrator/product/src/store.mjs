import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { MemoryCandidateLedger } from './memory-candidates.mjs';
import { assertSupervisorRole } from './supervisor-role-presets.mjs';
import { canonicalProviderChatUrl } from './conversation-policy.mjs';
import {W3_MAX_ASSISTANT_CHARS} from './provider-recovery-bounds.mjs';
import { buildProjectContinuationPacket } from './continuation-context.mjs';
import { buildTaskHandoffSnapshot } from './task-handoff-snapshot.mjs';
import { searchTaskHistoricalMessages, searchTaskHistoricalMessagesWithMemoryKeys } from './task-message-search.mjs';

const SQLITE_OPEN_RETRY_DELAYS_MS = [0, 40, 80, 160, 320, 640, 1280];
const sqliteOpenWait = new Int32Array(new SharedArrayBuffer(4));
const PROJECT_MEMORY_CATEGORIES = new Set(['entity','structure','fact','decision','constraint','goal','open_loop','reference']);
const PROJECT_MEMORY_SOURCE_TYPES = new Set(['manual','message','checkpoint','import','system']);
export const MESSAGE_PAGE_SIZE = 50;

function isTransientSqliteOpenError(error) {
  const message = String(error?.message || error || '');
  return /disk I\/O error|database is locked|database is busy|SQLITE_(?:IOERR|BUSY|LOCKED)/i.test(message);
}

function openConfiguredDatabase(filePath) {
  let lastError = null;
  for (let attempt = 0; attempt < SQLITE_OPEN_RETRY_DELAYS_MS.length; attempt++) {
    const delay = SQLITE_OPEN_RETRY_DELAYS_MS[attempt];
    if (delay) Atomics.wait(sqliteOpenWait, 0, 0, delay);
    let db = null;
    try {
      db = new DatabaseSync(filePath);
      db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;');
      const journalMode = String(db.prepare('PRAGMA journal_mode').get()?.journal_mode || '').toLowerCase();
      if (journalMode !== 'wal') db.prepare('PRAGMA journal_mode=WAL').get();
      return { db, retryCount: attempt };
    } catch (error) {
      lastError = error;
      try { db?.close(); } catch {}
      if (!isTransientSqliteOpenError(error) || attempt === SQLITE_OPEN_RETRY_DELAYS_MS.length - 1) throw error;
    }
  }
  throw lastError || new Error('sqlite_open_failed');
}

export class Store {
  constructor(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const opened = openConfiguredDatabase(filePath);
    this.db = opened.db;
    this.openRetryCount = opened.retryCount;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workspace_sessions (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ready',
        chat_url TEXT,
        checkpoint TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        sequence INTEGER
      );
      CREATE TABLE IF NOT EXISTS message_assets (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        local_path TEXT NOT NULL,
        alt TEXT,
        width INTEGER,
        height INTEGER,
        sha256 TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_message_assets_message ON message_assets(message_id, created_at, id);
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        error TEXT
      );
      -- Provisional observations are NOT assistant messages or successful runs.
      -- At most one bounded snapshot per Run, updated in place (no stream log).
      CREATE TABLE IF NOT EXISTS run_provisional_outputs (
        run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        source TEXT NOT NULL CHECK(source IN ('beta','dom')),
        observed_kind TEXT NOT NULL DEFAULT 'unverified' CHECK(observed_kind='unverified'),
        first_observed_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_run_provisional_task ON run_provisional_outputs(task_id);
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS checkpoints (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        event_seq INTEGER NOT NULL,
        summary TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(task_id, version)
      );
      CREATE TABLE IF NOT EXISTS task_conversations (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL,
        chat_url TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        context_checkpoint_version INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        ended_at TEXT,
        UNIQUE(task_id, sequence)
      );
      CREATE INDEX IF NOT EXISTS idx_task_conversations_task ON task_conversations(task_id, sequence);
      CREATE TABLE IF NOT EXISTS conversation_completed_runs (
        run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        conversation_id TEXT NOT NULL REFERENCES task_conversations(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_conversation_completed_runs_segment ON conversation_completed_runs(conversation_id);

      CREATE TABLE IF NOT EXISTS project_memory_items (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        category TEXT NOT NULL,
        memory_key TEXT NOT NULL COLLATE NOCASE,
        content TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        source_type TEXT NOT NULL DEFAULT 'manual',
        source_ref TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT,
        UNIQUE(task_id, category, memory_key)
      );
      CREATE INDEX IF NOT EXISTS idx_project_memory_task ON project_memory_items(task_id, status, category, updated_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_project_memory_key_nocase ON project_memory_items(task_id, category, memory_key COLLATE NOCASE);
      CREATE TABLE IF NOT EXISTS action_ledger (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        run_id TEXT,
        action_type TEXT NOT NULL,
        resource_key TEXT,
        status TEXT NOT NULL,
        payload TEXT NOT NULL,
        result TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_action_ledger_task ON action_ledger(task_id, created_at, id);
      CREATE TABLE IF NOT EXISTS approval_ledger (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        action_id TEXT,
        status TEXT NOT NULL,
        reason TEXT,
        created_at TEXT NOT NULL,
        resolved_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_approval_ledger_task ON approval_ledger(task_id, created_at, id);
    `);
    this.ensureColumn('tasks', 'workspace_session_id', 'TEXT');
    this.ensureColumn('tasks', 'draft', "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn('tasks', 'draft_revision', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('tasks', 'draft_updated_at', 'TEXT');
    this.ensureColumn('runs', 'worker_id', 'TEXT');
    this.ensureColumn('runs', 'heartbeat_at', 'TEXT');
    this.ensureColumn('runs', 'observer_mode', 'TEXT');
    this.ensureColumn('runs', 'metrics', 'TEXT');
    this.ensureColumn('messages','sequence','INTEGER');
    this.ensureTaskMessageSequence();
    this.ensureTaskMessageSearchIndex();
    this.memoryCandidates = new MemoryCandidateLedger(this);
    this.workspaceSession = this.ensureWorkspaceSession();
    this.db.prepare("UPDATE tasks SET workspace_session_id=? WHERE workspace_session_id IS NULL OR workspace_session_id=''")
      .run(this.workspaceSession.id);
    this.backfillLegacyCheckpoints();
    this.backfillLegacyConversations();
  }

  now() { return new Date().toISOString(); }

  backfillLegacyCheckpoints() {
    const rows = this.db.prepare(`
      SELECT t.id,t.checkpoint,t.updated_at
      FROM tasks t
      WHERE t.checkpoint IS NOT NULL AND TRIM(t.checkpoint) <> ''
        AND NOT EXISTS (SELECT 1 FROM checkpoints c WHERE c.task_id=t.id)
    `).all();
    for (const row of rows) {
      const eventSeq = Number(this.db.prepare('SELECT COALESCE(MAX(seq),0) AS seq FROM events WHERE task_id=?').get(row.id)?.seq || 0);
      const checkpointId = `checkpoint_${randomUUID()}`;
      this.db.prepare('INSERT INTO checkpoints(id,task_id,version,event_seq,summary,payload,created_at) VALUES(?,?,?,?,?,?,?)')
        .run(checkpointId, row.id, 1, eventSeq, row.checkpoint, JSON.stringify({ migrated_from_legacy: true }), row.updated_at || this.now());
      this.event(row.id, 'task.checkpoint.migrated', { checkpoint_id: checkpointId, version: 1, event_seq: eventSeq });
    }
    return rows.length;
  }

  backfillLegacyConversations() {
    const rows = this.db.prepare(`SELECT id,chat_url,created_at,updated_at FROM tasks WHERE chat_url IS NOT NULL AND TRIM(chat_url) <> '' AND NOT EXISTS (SELECT 1 FROM task_conversations c WHERE c.task_id=tasks.id)`).all();
    for (const row of rows) {
      this.db.prepare('INSERT INTO task_conversations(id,task_id,sequence,chat_url,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
        .run(`conversation_${randomUUID()}`, row.id, 1, row.chat_url, 'active', row.created_at || this.now(), row.updated_at || this.now());
    }
    return rows.length;
  }

  ensureColumn(table, column, type) {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
    if (!columns.includes(column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }

  ensureTaskMessageSequence() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS store_migrations (
        name TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      CREATE TRIGGER IF NOT EXISTS messages_assign_sequence AFTER INSERT ON messages
      WHEN new.sequence IS NULL BEGIN
        UPDATE messages SET sequence=COALESCE((
          SELECT MAX(sequence)+1 FROM messages WHERE task_id=new.task_id AND rowid<>new.rowid
        ),1) WHERE rowid=new.rowid;
      END;
    `);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const migrated=this.db.prepare("SELECT 1 FROM store_migrations WHERE name='task-message-sequence-v1'").get();
      if (!migrated) {
        const rows=this.db.prepare('SELECT rowid,task_id FROM messages ORDER BY rowid').all();
        const nextByTask=new Map();
        const update=this.db.prepare('UPDATE messages SET sequence=? WHERE rowid=?');
        for (const row of rows) {
          const sequence=(nextByTask.get(row.task_id)||0)+1;
          nextByTask.set(row.task_id,sequence);
          update.run(sequence,row.rowid);
        }
        this.db.prepare('INSERT INTO store_migrations(name,applied_at) VALUES(?,?)')
          .run('task-message-sequence-v1',this.now());
      }
      this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_task_sequence ON messages(task_id,sequence);');
      this.db.exec('DROP INDEX IF EXISTS idx_messages_task_time;');
      this.db.exec('COMMIT');
    } catch(error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  ensureTaskMessageSearchIndex() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS store_migrations (
        name TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS task_message_search USING fts5(
        content, task_id UNINDEXED,
        content='messages', content_rowid='rowid',
        tokenize='unicode61 remove_diacritics 2'
      );
      CREATE TRIGGER IF NOT EXISTS task_message_search_insert AFTER INSERT ON messages BEGIN
        INSERT INTO task_message_search(rowid,content,task_id) VALUES(new.rowid,new.content,new.task_id);
      END;
      CREATE TRIGGER IF NOT EXISTS task_message_search_update AFTER UPDATE OF content,task_id ON messages BEGIN
        INSERT INTO task_message_search(task_message_search,rowid,content,task_id)
          VALUES('delete',old.rowid,old.content,old.task_id);
        INSERT INTO task_message_search(rowid,content,task_id) VALUES(new.rowid,new.content,new.task_id);
      END;
      CREATE TRIGGER IF NOT EXISTS task_message_search_delete AFTER DELETE ON messages BEGIN
        INSERT INTO task_message_search(task_message_search,rowid,content,task_id)
          VALUES('delete',old.rowid,old.content,old.task_id);
      END;
    `);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const indexed=this.db.prepare("SELECT 1 FROM store_migrations WHERE name='task-message-search-fts-v1'").get();
      if (!indexed) {
        this.db.prepare("INSERT INTO task_message_search(task_message_search) VALUES('rebuild')").run();
        this.db.prepare('INSERT INTO store_migrations(name,applied_at) VALUES(?,?)')
          .run('task-message-search-fts-v1',this.now());
      }
      this.db.exec('COMMIT');
    } catch(error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  ensureWorkspaceSession() {
    const existing = this.db.prepare("SELECT * FROM workspace_sessions WHERE status='active' ORDER BY created_at LIMIT 1").get();
    if (existing) return { ...existing, metadata: JSON.parse(existing.metadata || '{}') };
    const id = `session_${randomUUID()}`;
    const now = this.now();
    this.db.prepare('INSERT INTO workspace_sessions(id,status,metadata,created_at,updated_at) VALUES(?,?,?,?,?)')
      .run(id, 'active', '{}', now, now);
    return { id, status: 'active', metadata: {}, created_at: now, updated_at: now };
  }

  getWorkspaceSession() {
    const row = this.db.prepare('SELECT * FROM workspace_sessions WHERE id=?').get(this.workspaceSession.id);
    return row ? { ...row, metadata: JSON.parse(row.metadata || '{}') } : null;
  }

  updateWorkspaceMetadata(patch = {}) {
    const current = this.getWorkspaceSession();
    const metadata = { ...(current?.metadata || {}), ...patch };
    const now = this.now();
    this.db.prepare('UPDATE workspace_sessions SET metadata=?,updated_at=? WHERE id=?')
      .run(JSON.stringify(metadata), now, this.workspaceSession.id);
    return this.getWorkspaceSession();
  }

  event(taskId, kind, payload = {}) {
    const now = this.now();
    const result = this.db.prepare('INSERT INTO events(task_id,kind,payload,created_at) VALUES(?,?,?,?)')
      .run(taskId, kind, JSON.stringify(payload), now);
    return Number(result.lastInsertRowid);
  }

  createTask(title = 'Nova tarefa') {
    const id = `task_${randomUUID()}`;
    const now = this.now();
    this.db.prepare('INSERT INTO tasks(id,title,status,workspace_session_id,created_at,updated_at) VALUES(?,?,?,?,?,?)')
      .run(id, title.trim() || 'Nova tarefa', 'ready', this.workspaceSession.id, now, now);
    this.event(id, 'task.created', { title, workspace_session_id: this.workspaceSession.id });
    return this.getTask(id);
  }

  listTasks() {
    // Navigation needs metadata only. Do not clone drafts, checkpoints or provider
    // URLs for every item of a potentially huge sidebar.
    return this.db.prepare(`SELECT t.id,t.title,t.status,t.created_at,t.updated_at,
      COALESCE((SELECT json_extract(e.payload,'$.role') FROM events e
        WHERE e.task_id=t.id AND e.kind='task.supervisor_role'
        ORDER BY e.rowid DESC LIMIT 1),'none') AS supervisor_role,
      (SELECT COUNT(*) FROM task_conversations c WHERE c.task_id=t.id) AS conversation_count,
      CASE WHEN length(trim(COALESCE(t.draft,''))) > 0 THEN 1 ELSE 0 END AS has_draft,
      (SELECT COUNT(*) FROM project_memory_candidates c WHERE c.task_id=t.id AND c.status='pending') AS pending_memory_count
      FROM tasks t ORDER BY t.updated_at DESC`).all();
  }

  // Role is a view-level preference recorded in the existing canonical event
  // ledger. It does not start a model, mutate messages or authorize a Run.
  getTaskSupervisorRole(taskId){
    const row=this.db.prepare("SELECT json_extract(payload,'$.role') role FROM events WHERE task_id=? AND kind='task.supervisor_role' ORDER BY rowid DESC LIMIT 1").get(taskId);
    return row?.role||'none';
  }

  setTaskSupervisorRole(taskId,role){
    const value=assertSupervisorRole(role);
    const task=this.db.prepare('SELECT workspace_session_id FROM tasks WHERE id=?').get(taskId);
    if(!task || task.workspace_session_id!==this.workspaceSession.id)throw Error('task_access_denied');
    if(this.getTaskSupervisorRole(taskId)!==value){
      this.event(taskId,'task.supervisor_role',{role:value});
    }
    return this.getTask(taskId);
  }

  renameTask(taskId, title) {
    const name = String(title ?? '').replace(/\s+/g, ' ').trim();
    if (!name || name.length > 140) throw new Error('invalid_task_title');
    const previous = this.db.prepare('SELECT title FROM tasks WHERE id=?').get(taskId);
    if (!previous) throw new Error('task_not_found');
    if (previous.title !== name) {
      this.db.prepare('UPDATE tasks SET title=?,updated_at=? WHERE id=?').run(name, this.now(), taskId);
      this.event(taskId, 'task.renamed', { previous_title:previous.title, title:name });
    }
    return this.getTask(taskId);
  }

  // Revisions prevent delayed renderer saves from restoring a draft already sent.
  // Draft updates do not reorder Tasks or become conversation messages/events.
  setDraft(taskId, content, revision) {
    const text = String(content ?? '');
    const version = Number(revision);
    if (text.length > 20000) throw new Error('task_draft_too_large');
    if (!Number.isSafeInteger(version) || version < 1) throw new Error('invalid_task_draft_revision');
    if (!this.db.prepare('SELECT id FROM tasks WHERE id=?').get(taskId)) throw new Error('task_not_found');
    this.db.prepare('UPDATE tasks SET draft=?,draft_revision=?,draft_updated_at=? WHERE id=? AND draft_revision<?')
      .run(text, version, this.now(), taskId, version);
    return this.db.prepare('SELECT draft,draft_revision,draft_updated_at FROM tasks WHERE id=?').get(taskId);
  }

  getTaskDraft(taskId) {
    const draft=this.db.prepare(`SELECT draft,draft_revision,draft_updated_at FROM tasks
      WHERE id=? AND workspace_session_id=?`).get(taskId,this.workspaceSession.id);
    if(!draft)throw new Error('task_not_found');
    return draft;
  }

  getTask(id, { messageLimit = null } = {}) {
    const task = this.db.prepare('SELECT * FROM tasks WHERE id=?').get(id);
    if (!task) return null;
    // One snapshot per view: derived metadata reuses these same canonical reads.
    const page = messageLimit == null ? null : this.messagesPage(id, { limit:messageLimit });
    const messages = page ? page.messages : this.messages(id);
    const checkpoint = this.latestCheckpoint(id);
    const conversations = this.listConversations(id);
    const projectMemory = this.projectMemorySummary(id);
    const pendingCount = this.memoryCandidates.pendingCount(id);
    const run=this.db.prepare(`SELECT id,status,error,metrics,started_at,completed_at FROM runs
      WHERE task_id=? ORDER BY rowid DESC LIMIT 1`).get(id);
    let runMetrics={};
    try { runMetrics=JSON.parse(run?.metrics||'{}')||{}; } catch { /* malformed metrics cannot certify delivery */ }
    return {
      ...task,
      supervisor_role:this.getTaskSupervisorRole(id),
      messages,
      ...(page ? { message_page:{ has_more:page.has_more, next_cursor:page.next_cursor, page_size:page.page_size } } : {}),
      events: this.events(id, 100),
      latest_run:run?{
        id:run.id,status:run.status,error:run.error,
        provider_delivery_state:['not_submitted','uncertain','submitted'].includes(runMetrics.provider_delivery_state)
          ?runMetrics.provider_delivery_state:null,
        context_attachment_state:['uploading','confirmed'].includes(runMetrics.context_attachment_state)
          ?runMetrics.context_attachment_state:null,
        context_attachment_filename:typeof runMetrics.context_attachment_filename==='string'&&
          /^ordax-handoff-task_[a-z0-9_-]+-c\d+-[a-f0-9]{12}\.txt$/i.test(runMetrics.context_attachment_filename)
          ?runMetrics.context_attachment_filename:null,
        context_attachment_sha256:typeof runMetrics.context_attachment_sha256==='string'&&
          /^[a-f0-9]{64}$/.test(runMetrics.context_attachment_sha256)
          ?runMetrics.context_attachment_sha256:null,
        submit_attempt_observed:Boolean(runMetrics.submit_attempt_at),
        submission_confirmed:Boolean(runMetrics.submitted_at),
        started_at:run.started_at,completed_at:run.completed_at
      }:null,
      provisional_response:['running','interrupted','error'].includes(task.status)
        ? this.getRunProvisionalOutput(id) : null,
      checkpoint_record: checkpoint,
      pending_approvals: this.pendingApprovals(id),
      conversations,
      project_memory: {
        items: this.listProjectMemory(id),
        summary: projectMemory,
        candidates: this.memoryCandidates.list(id),
        pending_count: pendingCount
      },
      continuation: this.continuationSummary(id, {
        task, checkpoint, conversations, projectMemory, pendingCount,
        totalMessages:page ? page.total_messages : messages.length
      })
    };
  }

  // Read only the latest Run for this Task. A previous failed Run's partial
  // must not appear as the current answer after a newer Run succeeds.
  getRunProvisionalOutput(taskId) {
    return this.db.prepare(`SELECT p.run_id,p.content,p.source,p.observed_kind,p.first_observed_at,p.updated_at
      FROM runs r JOIN run_provisional_outputs p ON p.run_id=r.id AND p.task_id=r.task_id
      WHERE r.task_id=? AND r.status IN ('running','failed','interrupted')
        AND r.rowid=(SELECT MAX(rowid) FROM runs WHERE task_id=?)
      LIMIT 1`).get(taskId, taskId) || null;
  }

  // No event or checkpoint per delta. A disk failure must not turn a partial
  // into a delivered response, and the caller must never resend as a remedy.
  saveRunProvisionalOutput(taskId, runId, content, source='beta') {
    if(typeof content!=='string' || !content.trim()) throw new Error('invalid_provisional_content');
    if(content.length>262144) throw new Error('provisional_input_too_large');
    if(!['beta','dom'].includes(source)) throw new Error('invalid_provisional_source');
    const run=this.db.prepare('SELECT status FROM runs WHERE id=? AND task_id=?').get(runId,taskId);
    if(run?.status!=='running') throw new Error('provisional_run_not_running');
    const text=content.slice(0,65536);
    const existing=this.db.prepare('SELECT content FROM run_provisional_outputs WHERE run_id=?').get(runId);
    // Shorter DOM reads may be stale or momentarily truncated. Preserve the
    // longest observed candidate; a change of equal length remains provisional.
    if(existing && (existing.content===text || text.length<existing.content.length)) return false;
    const now=this.now();
    this.db.prepare(`INSERT INTO run_provisional_outputs
      (run_id,task_id,content,source,observed_kind,first_observed_at,updated_at)
      VALUES(?,?,?,?,'unverified',?,?)
      ON CONFLICT(run_id) DO UPDATE SET content=excluded.content,
        source=excluded.source,updated_at=excluded.updated_at`).run(runId,taskId,text,source,now,now);
    return true;
  }

  // Execution reads only the fields required by the provider conversation policy.
  // Messages, checkpoints and conversation history remain canonical in SQLite.
  getTaskExecutionSnapshot(taskId) {
    const task = this.db.prepare(`SELECT t.id,t.chat_url,
      EXISTS(SELECT 1 FROM messages m WHERE m.task_id=t.id) AS has_messages,
      COALESCE((SELECT MAX(version) FROM checkpoints c WHERE c.task_id=t.id),0) AS checkpoint_version
      FROM tasks t WHERE t.id=?`).get(taskId);
    if (!task) return null;
    const active = this.db.prepare(`SELECT c.*,
      (SELECT COUNT(*) FROM conversation_completed_runs r WHERE r.conversation_id=c.id) AS completed_turns
      FROM task_conversations c WHERE c.task_id=? AND c.status='active'
      ORDER BY c.sequence DESC LIMIT 1`).get(taskId);
    return { ...task, conversations:active ? [active] : [] };
  }

  // Keyset cursors use a monotonic task-local sequence, stable even when timestamps tie.
  // No offset scans, page cache, or replicated history.
  encodeMessageCursor(message, taskId) {
    const sequence=Number(message.sequence);
    if (typeof taskId!=='string'||!taskId||!Number.isSafeInteger(sequence)||sequence<1)
      throw new Error('invalid_message_cursor');
    return Buffer.from(JSON.stringify(['task-message-sequence-v1',taskId,sequence])).toString('base64url');
  }

  decodeMessageCursor(cursor) {
    if (typeof cursor !== 'string' || !/^[A-Za-z0-9_-]{8,512}$/.test(cursor)) throw new Error('invalid_message_cursor');
    try {
      const raw = Buffer.from(cursor, 'base64url');
      const tuple = JSON.parse(raw.toString('utf8'));
      if (raw.toString('base64url') !== cursor || !Array.isArray(tuple) || tuple.length !== 3 ||
        tuple[0] !== 'task-message-sequence-v1' || typeof tuple[1]!=='string' || !tuple[1] || tuple[1].length>256 ||
        !Number.isSafeInteger(tuple[2]) || tuple[2]<1)
        throw new Error('invalid_message_cursor');
      return {taskId:tuple[1],sequence:tuple[2]};
    } catch { throw new Error('invalid_message_cursor'); }
  }

  messagesPage(taskId, { before = null, limit = MESSAGE_PAGE_SIZE } = {}) {
    const size = Number(limit);
    if (!Number.isSafeInteger(size) || size < 1 || size > 100) throw new Error('invalid_message_page_size');
    const messages = this.messages(taskId, { before, limit:size + 1 });
    const hasMore = messages.length > size;
    const page = hasMore ? messages.slice(1) : messages;
    return {
      messages:page,
      has_more:hasMore,
      next_cursor:hasMore ? this.encodeMessageCursor(page[0],taskId) : null,
      page_size:size,
      total_messages:Number(this.db.prepare('SELECT COUNT(*) AS n FROM messages WHERE task_id=?').get(taskId)?.n || 0)
    };
  }

  // The canonical message order is shared by full UI history and bounded context.
  // Fetch assets in one batch instead of querying SQLite once per message.
  messages(taskId, { limit = null, before = null } = {}) {
    const bounded = Number.isSafeInteger(limit) && limit > 0;
    if (!bounded && before != null) throw new Error('invalid_message_cursor');
    const cursor = before == null ? null : this.decodeMessageCursor(before);
    if (cursor&&cursor.taskId!==taskId) return [];
    const rows = bounded
      ? cursor
        ? this.db.prepare(`SELECT id,role,content,created_at,sequence FROM messages WHERE task_id=?
          AND sequence < ? ORDER BY sequence DESC LIMIT ?`).all(taskId,cursor.sequence,limit).reverse()
        : this.db.prepare('SELECT id,role,content,created_at,sequence FROM messages WHERE task_id=? ORDER BY sequence DESC LIMIT ?').all(taskId,limit).reverse()
      : this.db.prepare('SELECT id,role,content,created_at,sequence FROM messages WHERE task_id=? ORDER BY sequence').all(taskId);
    if (!rows.length) return [];
    const assets = new Map();
    // The bounded continuation path needs at most eight messages. For full history,
    // task-scoped assets remain a single indexed query regardless of message count.
    const assetRows = bounded
      ? this.db.prepare(`SELECT message_id,id,kind,mime_type,alt,width,height,sha256,created_at FROM message_assets
          WHERE message_id IN (${rows.map(() => '?').join(',')}) ORDER BY created_at,id`).all(...rows.map(row => row.id))
      : this.db.prepare('SELECT message_id,id,kind,mime_type,alt,width,height,sha256,created_at FROM message_assets WHERE task_id=? ORDER BY created_at,id').all(taskId);
    for (const { message_id, ...asset } of assetRows) {
      if (!assets.has(message_id)) assets.set(message_id, []);
      assets.get(message_id).push({ ...asset, url: `/api/assets/${encodeURIComponent(asset.id)}` });
    }
    return rows.map(row => ({ ...row, assets: assets.get(row.id) || [] }));
  }

  searchHistoricalMessages(taskId, request, { beforeMessage = null, limit = 4 } = {}) {
    const boundary=beforeMessage || this.messages(taskId,{limit:8})[0] || null;
    return searchTaskHistoricalMessages(this.db,taskId,request,{beforeMessage:boundary,limit});
  }

  getAsset(id) { return this.db.prepare('SELECT * FROM message_assets WHERE id=?').get(id) || null; }

  addAsset(taskId, messageId, asset) {
    const id = asset.id || `asset_${randomUUID()}`;
    const now = this.now();
    this.db.prepare(`
      INSERT INTO message_assets(id,task_id,message_id,kind,mime_type,local_path,alt,width,height,sha256,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)
    `).run(id, taskId, messageId, asset.kind || 'image', asset.mimeType, asset.localPath,
      asset.alt || null, asset.width || null, asset.height || null, asset.sha256 || null, now);
    this.event(taskId, 'message.asset_added', { id, message_id: messageId, kind: asset.kind || 'image', mime_type: asset.mimeType });
    return { id, kind: asset.kind || 'image', mime_type: asset.mimeType, alt: asset.alt || null,
      width: asset.width || null, height: asset.height || null, sha256: asset.sha256 || null,
      created_at: now, url: `/api/assets/${encodeURIComponent(id)}` };
  }

  events(taskId, limit = 100) {
    const rows = this.db.prepare('SELECT seq,kind,payload,created_at FROM events WHERE task_id=? ORDER BY seq DESC LIMIT ?').all(taskId, limit);
    return rows.reverse().map(row => ({ ...row, payload: JSON.parse(row.payload) }));
  }

  appendMessage(taskId, role, content) {
    const ownsTransaction=!this.db.isTransaction;
    if(ownsTransaction)this.db.exec('BEGIN IMMEDIATE');
    try {
      const id = `msg_${randomUUID()}`;
      const now = this.now();
      this.db.prepare('INSERT INTO messages(id,task_id,role,content,created_at) VALUES(?,?,?,?,?)')
        .run(id, taskId, role, content, now);
      this.touch(taskId);
      this.event(taskId, 'message.appended', { id, role });
      const message={ id, role, content };
      if (role === 'user') this.memoryCandidates.suggestFromMessage(taskId,message);
      else if (role === 'assistant') this.memoryCandidates.suggestFromAssistantMessage(taskId,message);
      if(ownsTransaction)this.db.exec('COMMIT');
      return { id, role, content, created_at: now, assets: [] };
    } catch(error) {
      if(ownsTransaction&&this.db.isTransaction)this.db.exec('ROLLBACK');
      throw error;
    }
  }

  touch(id) { this.db.prepare('UPDATE tasks SET updated_at=? WHERE id=?').run(this.now(), id); }

  listProjectMemory(taskId, { includeArchived = false } = {}) {
    const where = includeArchived ? 'task_id=?' : "task_id=? AND status='active'";
    return this.db.prepare(`
      SELECT id,task_id,category,memory_key AS key,content,status,source_type,source_ref,created_at,updated_at,archived_at
      FROM project_memory_items WHERE ${where}
      ORDER BY CASE category
        WHEN 'goal' THEN 1 WHEN 'constraint' THEN 2 WHEN 'decision' THEN 3 WHEN 'entity' THEN 4
        WHEN 'structure' THEN 5 WHEN 'fact' THEN 6 WHEN 'open_loop' THEN 7 ELSE 8 END,
        updated_at DESC,id
    `).all(taskId);
  }

  projectMemorySummary(taskId) {
    const rows = this.db.prepare("SELECT category,COUNT(*) AS n FROM project_memory_items WHERE task_id=? AND status='active' GROUP BY category ORDER BY category").all(taskId);
    return {
      total: rows.reduce((sum, row) => sum + Number(row.n || 0), 0),
      by_category: Object.fromEntries(rows.map(row => [row.category, Number(row.n || 0)]))
    };
  }

  upsertProjectMemory(taskId, item = {}) {
    if (!this.db.prepare('SELECT id FROM tasks WHERE id=?').get(taskId)) throw new Error('task_not_found');
    const category = String(item.category || '').trim().toLowerCase();
    const key = String(item.key || '').replace(/\s+/g, ' ').trim();
    const content = String(item.content || '').trim();
    const sourceType = String(item.source_type || 'manual').trim().toLowerCase();
    const sourceRef = item.source_ref == null ? null : String(item.source_ref).trim() || null;
    if (!PROJECT_MEMORY_CATEGORIES.has(category)) throw new Error('invalid_project_memory_category');
    if (!key) throw new Error('project_memory_key_required');
    if (!content) throw new Error('project_memory_content_required');
    if (!PROJECT_MEMORY_SOURCE_TYPES.has(sourceType)) throw new Error('invalid_project_memory_source');
    if (key.length > 160 || content.length > 8000) throw new Error('project_memory_too_large');

    const now = this.now();
    const requestedId = item.id == null ? null : String(item.id).trim() || null;
    const existingById = requestedId ? this.db.prepare('SELECT id FROM project_memory_items WHERE task_id=? AND id=?').get(taskId, requestedId) : null;
    if (requestedId && !existingById) throw new Error('project_memory_not_found');
    const existingByKey = this.db.prepare('SELECT id,memory_key FROM project_memory_items WHERE task_id=? AND category=? AND memory_key COLLATE NOCASE=?').get(taskId, category, key);
    if (existingById && existingByKey && existingById.id !== existingByKey.id) throw new Error('project_memory_key_conflict');
    const id = existingById?.id || existingByKey?.id || `memory_${randomUUID()}`;
    if (existingById || existingByKey) {
      const storedKey = existingById ? key : existingByKey.memory_key;
      this.db.prepare("UPDATE project_memory_items SET category=?,memory_key=?,content=?,status='active',source_type=?,source_ref=?,updated_at=?,archived_at=NULL WHERE id=?")
        .run(category, storedKey, content, sourceType, sourceRef, now, id);
    } else {
      this.db.prepare('INSERT INTO project_memory_items(id,task_id,category,memory_key,content,status,source_type,source_ref,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(id, taskId, category, key, content, 'active', sourceType, sourceRef, now, now);
    }
    this.touch(taskId);
    this.event(taskId, 'project_memory.upserted', { memory_id:id, category, key, source_type:sourceType, source_ref:sourceRef });
    return this.listProjectMemory(taskId).find(row => row.id === id) || null;
  }

  archiveProjectMemory(taskId, memoryId) {
    const row = this.db.prepare('SELECT id,category,memory_key FROM project_memory_items WHERE id=? AND task_id=?').get(memoryId, taskId);
    if (!row) throw new Error('project_memory_not_found');
    const now = this.now();
    this.db.prepare("UPDATE project_memory_items SET status='archived',archived_at=?,updated_at=? WHERE id=?").run(now, now, memoryId);
    this.touch(taskId);
    this.event(taskId, 'project_memory.archived', { memory_id:memoryId, category:row.category, key:row.memory_key });
    return true;
  }

  listConversations(taskId) {
    return this.db.prepare(`
      SELECT c.*, (SELECT COUNT(*) FROM conversation_completed_runs r
        WHERE r.conversation_id=c.id) AS completed_turns
      FROM task_conversations c WHERE c.task_id=?
      ORDER BY c.sequence DESC
    `).all(taskId);
  }

  bindConversation(taskId, url, contextCheckpointVersion = null) {
    const normalized = canonicalProviderChatUrl(url);
    if (!normalized) {
      if (!String(url || '').trim()) return null;
      throw new Error('invalid_provider_conversation_url');
    }
    const now = this.now();
    const exact = this.db.prepare('SELECT * FROM task_conversations WHERE task_id=? AND chat_url=? ORDER BY sequence DESC LIMIT 1').get(taskId, normalized);
    const existing = exact || this.db.prepare('SELECT * FROM task_conversations WHERE task_id=? ORDER BY sequence DESC').all(taskId)
      .find(row => canonicalProviderChatUrl(row.chat_url) === normalized);
    if (existing) {
      this.db.prepare("UPDATE task_conversations SET status='archived',ended_at=COALESCE(ended_at,?),updated_at=? WHERE task_id=? AND id<>? AND status='active'").run(now, now, taskId, existing.id);
      this.db.prepare("UPDATE task_conversations SET status='active',chat_url=?,ended_at=NULL,updated_at=? WHERE id=?").run(normalized, now, existing.id);
      this.db.prepare('UPDATE tasks SET chat_url=?,updated_at=? WHERE id=?').run(normalized, now, taskId);
      return this.db.prepare('SELECT * FROM task_conversations WHERE id=?').get(existing.id);
    }
    this.db.prepare("UPDATE task_conversations SET status='archived',ended_at=?,updated_at=? WHERE task_id=? AND status='active'").run(now, now, taskId);
    const sequence = Number(this.db.prepare('SELECT COALESCE(MAX(sequence),0)+1 AS sequence FROM task_conversations WHERE task_id=?').get(taskId)?.sequence || 1);
    const id = `conversation_${randomUUID()}`;
    this.db.prepare('INSERT INTO task_conversations(id,task_id,sequence,chat_url,status,context_checkpoint_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(id, taskId, sequence, normalized, 'active', contextCheckpointVersion, now, now);
    this.db.prepare('UPDATE tasks SET chat_url=?,updated_at=? WHERE id=?').run(normalized, now, taskId);
    this.event(taskId, 'provider.conversation.bound', { conversation_id:id, sequence, url:normalized, context_checkpoint_version:contextCheckpointVersion });
    return this.db.prepare('SELECT * FROM task_conversations WHERE id=?').get(id);
  }

  setChatUrl(id, url, contextCheckpointVersion = null) { return this.bindConversation(id, url, contextCheckpointVersion); }

  rotateConversation(taskId, reason = 'manual') {
    const now = this.now();
    const active = this.db.prepare("SELECT * FROM task_conversations WHERE task_id=? AND status='active' ORDER BY sequence DESC LIMIT 1").get(taskId);
    if (active) this.db.prepare("UPDATE task_conversations SET status='archived',ended_at=?,updated_at=? WHERE id=?").run(now, now, active.id);
    this.db.prepare('UPDATE tasks SET chat_url=NULL,updated_at=? WHERE id=?').run(now, taskId);
    this.event(taskId, 'provider.conversation.rotated', { reason, previous_conversation_id:active?.id || null, previous_chat_url:active?.chat_url || null });
    return this.getTask(taskId);
  }

  continuationSummary(taskId, snapshot = {}) {
    const task = snapshot.task || this.db.prepare('SELECT id,title,checkpoint,chat_url FROM tasks WHERE id=?').get(taskId);
    if (!task) return null;
    const checkpoint = snapshot.checkpoint === undefined ? this.latestCheckpoint(taskId) : snapshot.checkpoint;
    const totalMessages = snapshot.totalMessages ?? Number(this.db.prepare('SELECT COUNT(*) AS n FROM messages WHERE task_id=?').get(taskId)?.n || 0);
    const conversations = snapshot.conversations || this.listConversations(taskId);
    const projectMemory = snapshot.projectMemory || this.projectMemorySummary(taskId);
    return {
      checkpoint_version: checkpoint?.version || 0,
      checkpoint_summary: checkpoint?.summary || task.checkpoint || '',
      recent_message_count: Math.min(totalMessages, 10),
      total_messages: totalMessages,
      conversation_count: conversations.length,
      structured_memory_count: projectMemory.total,
      pending_memory_candidates: snapshot.pendingCount ?? this.memoryCandidates.pendingCount(taskId),
      structured_memory_by_category: projectMemory.by_category,
      active_conversation: conversations.find(row => row.status === 'active') || null
    };
  }

  buildContinuationPacket(taskId, prompt, { maxChars = 16000 } = {}) {
    // Bounded projection of the SAME SQLite SSOT, never an independent cache.
    // Avoid loading every message, event, candidate and conversation on each send.
    const task = this.db.prepare('SELECT id,title,checkpoint FROM tasks WHERE id=?').get(taskId);
    if (!task) return {prompt:String(prompt||''),manifest:null};
    const checkpoint=this.latestCheckpoint(taskId);
    const recentMessages=this.messages(taskId,{limit:8});
    const totalMessageCount=Number(this.db.prepare('SELECT COUNT(*) AS n FROM messages WHERE task_id=?').get(taskId)?.n||0);
    const memoryItems=this.listProjectMemory(taskId);
    const retrievedMessages=totalMessageCount>recentMessages.length
      ?searchTaskHistoricalMessagesWithMemoryKeys(this.db,taskId,prompt,{beforeMessage:recentMessages[0],limit:4,memoryItems})
      :[];
    return buildProjectContinuationPacket({
      title: task.title,
      checkpoint: checkpoint?.summary || task.checkpoint,
      checkpointVersion: checkpoint?.version || 0,
      memoryItems,
      recentMessages,
      retrievedMessages,
      totalMessageCount,
      request: prompt,
      maxChars
    });
  }

  buildTaskHandoffSnapshot(taskId, { request = '', historyLimit = 8, maxBytes, includeMessageIds = [] } = {}) {
    const task=this.db.prepare('SELECT id,title,checkpoint FROM tasks WHERE id=? AND workspace_session_id=?')
      .get(taskId,this.workspaceSession.id);
    if(!task)throw new Error('task_not_found');
    if(!Array.isArray(includeMessageIds)||includeMessageIds.length>64||
       includeMessageIds.some(id=>typeof id!=='string'||!id.trim()||id.length>180)||
       new Set(includeMessageIds).size!==includeMessageIds.length)
      throw new Error('task_handoff_message_scope_invalid');
    const checkpoint=this.latestCheckpoint(taskId);
    const memoryItems=this.listProjectMemory(taskId);
    for(const item of memoryItems){
      if(!item.source_ref)continue;
      const sourceExists=item.source_type==='message'
        ?this.db.prepare('SELECT 1 AS found FROM messages WHERE id=? AND task_id=?').get(item.source_ref,taskId)
        :item.source_type==='checkpoint'
          ?this.db.prepare('SELECT 1 AS found FROM checkpoints WHERE id=? AND task_id=?').get(item.source_ref,taskId)
          :true;
      if(!sourceExists)throw new Error('task_handoff_source_scope_invalid');
    }
    const recentMessages=this.messages(taskId,{limit:8});
    const totalMessages=Number(this.db.prepare('SELECT COUNT(*) AS n FROM messages WHERE task_id=?').get(taskId)?.n||0);
    const beforeMessage=recentMessages[0]||null;
    const retrievedMessages=beforeMessage&&totalMessages>recentMessages.length
      ?searchTaskHistoricalMessagesWithMemoryKeys(this.db,taskId,request,{
        beforeMessage,limit:historyLimit,memoryItems
      })
      :[];
    const recentIds=new Set(recentMessages.map(message=>message.id));
    const requestedHistory=includeMessageIds.filter(id=>!recentIds.has(id)).map(id=>{
      const row=this.db.prepare('SELECT id,role,content,created_at,sequence FROM messages WHERE id=? AND task_id=?')
        .get(id,taskId);
      if(!row)throw new Error('task_handoff_message_scope_invalid');
      return row;
    });
    const historicalMessages=[...new Map([...retrievedMessages,...requestedHistory]
      .map(message=>[message.id,message])).values()].sort((a,b)=>a.sequence-b.sequence);
    return buildTaskHandoffSnapshot({
      taskId:task.id,title:task.title,
      checkpoint:checkpoint?.summary||task.checkpoint||'',checkpointVersion:checkpoint?.version||0,
      memoryItems,recentMessages,historicalMessages,historyMessageCount:Math.max(0,totalMessages-recentMessages.length),
      generatedAt:this.now(),...(maxBytes==null?{}:{maxBytes})
    });
  }

  buildContinuationPrompt(taskId, prompt, options = {}) {
    const packet=this.buildContinuationPacket(taskId,prompt,options);
    return packet.manifest?packet.prompt:String(prompt||'');
  }

  checkpoint(id, summary, payload = {}) {
    const now = this.now();
    const version = Number(this.db.prepare('SELECT COALESCE(MAX(version),0)+1 AS version FROM checkpoints WHERE task_id=?').get(id)?.version || 1);
    const eventSeq = Number(this.db.prepare('SELECT COALESCE(MAX(seq),0) AS seq FROM events WHERE task_id=?').get(id)?.seq || 0);
    const checkpointId = `checkpoint_${randomUUID()}`;
    this.db.prepare('INSERT INTO checkpoints(id,task_id,version,event_seq,summary,payload,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(checkpointId, id, version, eventSeq, summary, JSON.stringify(payload || {}), now);
    this.db.prepare('UPDATE tasks SET checkpoint=?,updated_at=? WHERE id=?').run(summary, now, id);
    this.event(id, 'task.checkpoint', { checkpoint_id: checkpointId, version, event_seq: eventSeq, summary });
    return this.latestCheckpoint(id);
  }

  latestCheckpoint(taskId) {
    const row = this.db.prepare('SELECT * FROM checkpoints WHERE task_id=? ORDER BY version DESC LIMIT 1').get(taskId);
    return row ? { ...row, payload: JSON.parse(row.payload || '{}') } : null;
  }

  beginProviderRun(taskId, prompt, { draftRevision = null,
    workerId = 'electron-embedded-chatgpt', observerMode = 'auto' } = {}) {
    // Sending preparation is a SINGLE crash-consistent SQLite operation.
    // Crash before COMMIT: no orphan user message, no lost draft, no Run.
    // Crash after COMMIT: the running Run is recovered as interrupted, NEVER
    // automatically re-sent, regardless of whether delivery happened.
    const content = String(prompt || '').trim();
    if (!content) throw new Error('content_required');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const task = this.db.prepare('SELECT draft_revision FROM tasks WHERE id=?').get(taskId);
      if (!task) throw new Error('task_not_found');
      if (this.db.prepare("SELECT 1 FROM runs WHERE task_id=? AND status='running' LIMIT 1").get(taskId))
        throw new Error('task_run_already_active');
      if (draftRevision != null) {
        const nextRevision = Number(draftRevision);
        if (!Number.isSafeInteger(nextRevision) || nextRevision < 1)
          throw new Error('invalid_task_draft_revision');
        if (nextRevision <= Number(task.draft_revision || 0))
          throw new Error('task_draft_revision_conflict');
      }
      const userMessage = this.appendMessage(taskId, 'user', content);
      if (draftRevision != null) {
        const draft = this.setDraft(taskId, '', draftRevision);
        if (draft.draft !== '' || draft.draft_revision !== Number(draftRevision))
          throw new Error('task_draft_revision_conflict');
      }
      const runId = this.startRun(taskId, workerId, observerMode);
      this.db.exec('COMMIT');
      return { userMessage, runId };
    } catch(error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  startRun(taskId, workerId = 'electron-embedded-chatgpt', observerMode = 'auto') {
    const id = `run_${randomUUID()}`;
    const now = this.now();
    this.db.prepare('INSERT INTO runs(id,task_id,status,worker_id,heartbeat_at,observer_mode,started_at) VALUES(?,?,?,?,?,?,?)')
      .run(id, taskId, 'running', workerId, now, observerMode, now);
    this.db.prepare('UPDATE tasks SET status=?,updated_at=? WHERE id=?').run('running', now, taskId);
    this.event(taskId, 'run.started', { run_id: id, worker_id: workerId, observer_mode: observerMode });
    return id;
  }

  recordRunMetrics(taskId, runId, observerMode, metrics = {}) {
    const normalized = {
      observer_mode: observerMode,
      failed_stage: metrics?.failedStage || null,
      response_prompt_expansion_attempted:metrics?.responsePromptExpansionAttempted===true,
      response_prompt_expanded:metrics?.responsePromptExpanded===true,
      provider_delivery_state: ['not_submitted','uncertain','submitted'].includes(metrics?.providerDeliveryState)
        ? metrics.providerDeliveryState : null,
      context_attachment_state:['uploading','confirmed'].includes(metrics?.contextAttachmentState)
        ? metrics.contextAttachmentState : null,
      context_attachment_filename:typeof metrics?.contextAttachmentFilename==='string'&&
        /^ordax-handoff-task_[a-z0-9_-]+-c\d+-[a-f0-9]{12}\.txt$/i.test(metrics.contextAttachmentFilename)
        ? metrics.contextAttachmentFilename : null,
      context_attachment_sha256:typeof metrics?.contextAttachmentSha256==='string'&&
        /^[a-f0-9]{64}$/.test(metrics.contextAttachmentSha256)
        ? metrics.contextAttachmentSha256 : null,
      context_attachment_byte_length:Number.isSafeInteger(metrics?.contextAttachmentByteLength)&&
        metrics.contextAttachmentByteLength>0&&metrics.contextAttachmentByteLength<=1_000_000
        ? metrics.contextAttachmentByteLength : null,
      context_attachment_uploaded_at:Number.isSafeInteger(metrics?.contextAttachmentUploadedAt)&&
        metrics.contextAttachmentUploadedAt>0?metrics.contextAttachmentUploadedAt:null,
      context_attachment_selection_confirmed:metrics?.contextAttachmentSelectionConfirmed===true,
      context_attachment_observation_count:Number.isSafeInteger(metrics?.contextAttachmentObservationCount)&&
        metrics.contextAttachmentObservationCount>=0&&metrics.contextAttachmentObservationCount<=1000
        ?metrics.contextAttachmentObservationCount:0,
      context_attachment_file_input_count:Number.isSafeInteger(metrics?.contextAttachmentFileInputCount)&&
        metrics.contextAttachmentFileInputCount>=0&&metrics.contextAttachmentFileInputCount<=100
        ?metrics.contextAttachmentFileInputCount:0,
      context_attachment_selected_file_count:Number.isSafeInteger(metrics?.contextAttachmentSelectedFileCount)&&
        metrics.contextAttachmentSelectedFileCount>=0&&metrics.contextAttachmentSelectedFileCount<=100
        ?metrics.contextAttachmentSelectedFileCount:0,
      context_attachment_expected_file_selected:metrics?.contextAttachmentExpectedFileSelected===true,
      context_attachment_filename_text_visible:metrics?.contextAttachmentFilenameTextVisible===true,
      context_attachment_filename_attribute_visible:metrics?.contextAttachmentFilenameAttributeVisible===true,
      context_attachment_progress_visible:metrics?.contextAttachmentProgressVisible===true,
      context_attachment_error_visible:metrics?.contextAttachmentErrorVisible===true,
      context_attachment_visible_stable_observations:Number.isSafeInteger(metrics?.contextAttachmentVisibleStableObservations)&&
        metrics.contextAttachmentVisibleStableObservations>=0&&metrics.contextAttachmentVisibleStableObservations<=1000
        ?metrics.contextAttachmentVisibleStableObservations:0,
      run_started_at: metrics?.runStartedAt || null,
      prepare_started_at: metrics?.prepareStartedAt || null,
      health_completed_at: metrics?.healthCompletedAt || null,
      draft_checked_at: metrics?.draftCheckedAt || null,
      conversation_ready_at: metrics?.conversationReadyAt || null,
      observer_ready_at: metrics?.observerReadyAt || null,
      baseline_ready_at: metrics?.baselineReadyAt || null,
      submit_attempt_at: metrics?.submitAttemptAt || null,
      provider_request_seen_at: metrics?.providerRequestSeenAt || null,
      submitted_at: metrics?.submittedAt || null,
      first_delta_at: metrics?.firstDeltaAt || null,
      fast_first_delta_at: metrics?.fastFirstDeltaAt || null,
      beta_first_delta_at: metrics?.betaFirstDeltaAt || null,
      network_first_byte_at: metrics?.networkFirstByteAt || null,
      completed_at: metrics?.completedAt || null,
      ttfs_ms: metrics?.submitAttemptAt && metrics?.firstDeltaAt ? Math.max(0, metrics.firstDeltaAt - metrics.submitAttemptAt) : null,
      prepare_ms: metrics?.runStartedAt && metrics?.submitAttemptAt ? Math.max(0, metrics.submitAttemptAt - metrics.runStartedAt) : null,
      health_ms: metrics?.prepareStartedAt && metrics?.healthCompletedAt ? Math.max(0, metrics.healthCompletedAt - metrics.prepareStartedAt) : null,
      draft_check_ms: metrics?.healthCompletedAt && metrics?.draftCheckedAt ? Math.max(0, metrics.draftCheckedAt - metrics.healthCompletedAt) : null,
      conversation_prepare_ms: metrics?.draftCheckedAt && metrics?.conversationReadyAt ? Math.max(0, metrics.conversationReadyAt - metrics.draftCheckedAt) : null,
      observer_prepare_ms: metrics?.conversationReadyAt && metrics?.observerReadyAt ? Math.max(0, metrics.observerReadyAt - metrics.conversationReadyAt) : null,
      baseline_prepare_ms: metrics?.observerReadyAt && metrics?.baselineReadyAt ? Math.max(0, metrics.baselineReadyAt - metrics.observerReadyAt) : null,
      composer_prepare_ms: metrics?.baselineReadyAt && metrics?.submitAttemptAt ? Math.max(0, metrics.submitAttemptAt - metrics.baselineReadyAt) : null,
      request_seen_ms: metrics?.submitAttemptAt && metrics?.providerRequestSeenAt ? Math.max(0, metrics.providerRequestSeenAt - metrics.submitAttemptAt) : null,
      submit_confirm_ms: metrics?.submitAttemptAt && metrics?.submittedAt ? Math.max(0, metrics.submittedAt - metrics.submitAttemptAt) : null,
      network_ttfs_ms: metrics?.submitAttemptAt && metrics?.networkFirstByteAt ? Math.max(0, metrics.networkFirstByteAt - metrics.submitAttemptAt) : null,
      attempt_to_first_delta_ms: metrics?.submitAttemptAt && metrics?.firstDeltaAt ? Math.max(0, metrics.firstDeltaAt - metrics.submitAttemptAt) : null,
      fast_ttfs_ms: metrics?.submitAttemptAt && metrics?.fastFirstDeltaAt ? Math.max(0, metrics.fastFirstDeltaAt - metrics.submitAttemptAt) : null,
      beta_ttfs_ms: metrics?.submitAttemptAt && metrics?.betaFirstDeltaAt ? Math.max(0, metrics.betaFirstDeltaAt - metrics.submitAttemptAt) : null,
      fast_lead_ms: metrics?.fastFirstDeltaAt && metrics?.betaFirstDeltaAt ? metrics.betaFirstDeltaAt - metrics.fastFirstDeltaAt : null,
      total_ms: metrics?.submitAttemptAt && metrics?.completedAt ? Math.max(0, metrics.completedAt - metrics.submitAttemptAt) : null,
      observer_used: metrics?.observerUsed || 'beta',
      first_observer: metrics?.firstObserver || null,
      fast_seen: Boolean(metrics?.fastSeen),
      beta_seen: Boolean(metrics?.betaSeen),
      fast_delivered: Boolean(metrics?.fastDelivered),
      fast_suppressed: Boolean(metrics?.fastSuppressed),
      fast_suppression_reason: metrics?.fastSuppressionReason || null
    };
    this.db.prepare('UPDATE runs SET observer_mode=?,metrics=? WHERE id=?').run(observerMode, JSON.stringify(normalized), runId);
    this.event(taskId, 'run.metrics', { run_id: runId, ...normalized });
    return normalized;
  }

  recordConversationCompletion(taskId, runId) {
    const run = this.db.prepare('SELECT id,status FROM runs WHERE id=? AND task_id=?').get(runId, taskId);
    if (!run || run.status !== 'succeeded') throw new Error('conversation_run_not_succeeded');
    const active = this.db.prepare(
      "SELECT c.id FROM task_conversations c JOIN tasks t ON t.id=c.task_id AND t.chat_url=c.chat_url WHERE c.task_id=? AND c.status='active' ORDER BY c.sequence DESC LIMIT 1"
    ).get(taskId);
    if (!active) throw new Error('conversation_not_bound');
    const insertion = this.db.prepare(
      'INSERT OR IGNORE INTO conversation_completed_runs(run_id,task_id,conversation_id,created_at) VALUES(?,?,?,?)'
    ).run(runId, taskId, active.id, this.now());
    if (insertion.changes) this.event(taskId,'provider.conversation.turn_completed', { run_id:runId, conversation_id:active.id });
    return this.db.prepare('SELECT COUNT(*) AS n FROM conversation_completed_runs WHERE conversation_id=?').get(active.id).n;
  }

  heartbeatRun(_taskId, runId) {
    const now = this.now();
    this.db.prepare('UPDATE runs SET heartbeat_at=? WHERE id=? AND status=?').run(now, runId, 'running');
  }

  // Commit a provider answer only together with its checkpoint and terminal Run.
  // The optional success callback runs after validating Run ownership, within
  // the SAME SQLite transaction. Failures roll every canonical write back.
  finishRun(taskId, runId, error = null, onConfirmedSuccess = null) {
    if (onConfirmedSuccess != null && (error || typeof onConfirmedSuccess !== 'function'))
      throw new Error('run_finish_success_callback_invalid');
    // A crash must not persist a terminal Run with a still-running Task or
    // leave success events/accounting for a transaction that did not commit.
    // Do not mutate a foreign/already terminal Run or retry provider effects.
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const run = this.db.prepare('SELECT task_id,status FROM runs WHERE id=?').get(runId);
      if (!run || run.task_id !== taskId || run.status !== 'running')
        throw new Error('run_finish_state_invalid');
      const committedReply = onConfirmedSuccess ? onConfirmedSuccess() : null;
      const status = error ? 'failed' : 'succeeded';
      const now = this.now();
      const finalized = this.db.prepare(
        "UPDATE runs SET status=?,completed_at=?,heartbeat_at=?,error=? WHERE id=? AND task_id=? AND status='running'"
      ).run(status, now, now, error, runId, taskId);
      if (finalized.changes !== 1) throw new Error('run_finish_state_invalid');
      const task = this.db.prepare('UPDATE tasks SET status=?,updated_at=? WHERE id=?')
        .run(error ? 'error' : 'ready', now, taskId);
      if (task.changes !== 1) throw new Error('run_finish_task_missing');
      this.event(taskId, error ? 'run.failed' : 'run.succeeded', { run_id: runId, error });
      if (!error) {
        // The confirmed assistant message is authoritative after success.
        // Delete the redundant provisional snapshot in this SAME transaction.
        this.db.prepare('DELETE FROM run_provisional_outputs WHERE run_id=? AND task_id=?')
          .run(runId,taskId);
        const active = this.db.prepare("SELECT 1 FROM task_conversations WHERE task_id=? AND status='active' LIMIT 1").get(taskId);
        if (active) {
          try { this.recordConversationCompletion(taskId, runId); }
          catch (accountingError) {
            this.event(taskId, 'provider.conversation.accounting_failed', {
              run_id:runId, error:String(accountingError?.message || accountingError)
            });
          }
        }
      }
      this.db.exec('COMMIT');
      return committedReply;
    } catch (failure) {
      this.db.exec('ROLLBACK');
      throw failure;
    }
  }

  commitObservedProviderReply(taskId, runId, {
    text, observedAt, chatUrl = null, observerMode = 'beta', runMetrics = null,
    attachAssets = () => []
  } = {}) {
    if (typeof text !== 'string' || typeof observedAt !== 'string' || !observedAt ||
        typeof attachAssets !== 'function') throw new Error('invalid_confirmed_reply');
    return this.finishRun(taskId, runId, null, () => {
      const assistant = this.appendMessage(taskId, 'assistant', text);
      const assets = attachAssets(assistant.id);
      if (!Array.isArray(assets)) throw new Error('invalid_confirmed_assets');
      const summary = text.trim() ? text.slice(0, 800)
        : assets.length ? `[${assets.length} imagem(ns) armazenada(s) localmente]`
          : '[resposta sem conteúdo]';
      this.checkpoint(taskId, `Última resposta observada em ${observedAt}: ${summary}`, {
        run_id: runId, chat_url: chatUrl,
        asset_ids: assets.map(asset => asset.id), observer_mode: observerMode,
        run_metrics: runMetrics
      });
      return { assistant, assets };
    });
  }

  // Recover a reply that the provider demonstrably completed after the local
  // observer failed. The caller supplies a digest from a fresh read-only
  // inspection; every ledger reference is revalidated inside one transaction.
  reconcileObservedProviderReply(taskId, {
    runId,userMessageId,conversationId,chatUrl,promptSha256,responseSha256,text
  }={}) {
    const canonicalUrl=canonicalProviderChatUrl(chatUrl);
    if(typeof text!=='string'||!text.trim()||text.length>W3_MAX_ASSISTANT_CHARS||
       !/^[a-f0-9]{64}$/.test(promptSha256||'')||
       !/^[a-f0-9]{64}$/.test(responseSha256||'')||
       createHash('sha256').update(text,'utf8').digest('hex')!==responseSha256||
       typeof runId!=='string'||typeof userMessageId!=='string'||typeof conversationId!=='string'||!canonicalUrl)
      throw new Error('invalid_provider_reply_reconciliation');

    this.db.exec('BEGIN IMMEDIATE');
    try {
      const task=this.db.prepare('SELECT workspace_session_id,status,chat_url FROM tasks WHERE id=?').get(taskId);
      if(!task||task.workspace_session_id!==this.workspaceSession.id)
        throw new Error('task_access_denied');
      const run=this.db.prepare('SELECT id,status FROM runs WHERE id=? AND task_id=?').get(runId,taskId);
      if(run?.status==='succeeded') {
        const prior=this.db.prepare(`SELECT 1 FROM events WHERE task_id=? AND kind='provider.response.reconciled'
          AND json_extract(payload,'$.run_id')=? AND json_extract(payload,'$.response_sha256')=? LIMIT 1`)
          .get(taskId,runId,responseSha256);
        if(prior) {
          this.db.exec('COMMIT');
          return {reconciled:false,reason:'already_reconciled'};
        }
      }
      if(!run||!['failed','interrupted'].includes(run.status))
        throw new Error('provider_reply_run_not_recoverable');
      if(task.status!=='error'&&task.status!=='interrupted')
        throw new Error('provider_reply_task_state_changed');
      const newestRun=this.db.prepare('SELECT id FROM runs WHERE task_id=? ORDER BY rowid DESC LIMIT 1').get(taskId);
      if(newestRun?.id!==runId||this.db.prepare("SELECT 1 FROM runs WHERE task_id=? AND status='running' LIMIT 1").get(taskId))
        throw new Error('provider_reply_run_not_latest');
      const latestUser=this.db.prepare("SELECT id FROM messages WHERE task_id=? AND role='user' ORDER BY rowid DESC LIMIT 1").get(taskId);
      if(latestUser?.id!==userMessageId)
        throw new Error('provider_reply_user_message_changed');
      const conversation=this.db.prepare(`SELECT c.id FROM task_conversations c JOIN tasks t
        ON t.id=c.task_id AND t.chat_url=c.chat_url
        WHERE c.id=? AND c.task_id=? AND c.chat_url=? AND c.status='active'`).get(conversationId,taskId,canonicalUrl);
      if(!conversation||canonicalProviderChatUrl(task.chat_url)!==canonicalUrl)
        throw new Error('provider_reply_conversation_changed');
      const receiptRow=this.db.prepare(`SELECT payload FROM events WHERE task_id=?
        AND kind='provider.submission.provenance' AND json_extract(payload,'$.run_id')=?
        AND json_extract(payload,'$.message_id')=? ORDER BY seq DESC LIMIT 1`).get(taskId,runId,userMessageId);
      let receipt=null;
      try {receipt=receiptRow?JSON.parse(receiptRow.payload):null;} catch {}
      if(!receipt||receipt.conversation_id!==conversationId||receipt.prompt_sha256!==promptSha256||
         receipt.response_observed!==false||receipt.effect_verified!==false)
        throw new Error('provider_reply_submission_receipt_invalid');

      const now=this.now();
      const finalized=this.db.prepare(`UPDATE runs SET status='succeeded',completed_at=?,heartbeat_at=?,error=NULL
        WHERE id=? AND task_id=? AND status IN ('failed','interrupted')`).run(now,now,runId,taskId);
      if(finalized.changes!==1)throw new Error('provider_reply_run_state_changed');
      const updated=this.db.prepare("UPDATE tasks SET status='ready',updated_at=? WHERE id=? AND status IN ('error','interrupted')").run(now,taskId);
      if(updated.changes!==1)throw new Error('provider_reply_task_state_changed');
      const assistant=this.appendMessage(taskId,'assistant',text);
      this.checkpoint(taskId,`Resposta do ChatGPT recuperada após verificação em ${now}: ${text.slice(0,800)}`,{
        run_id:runId,chat_url:canonicalUrl,observer_mode:'verified-dom-reconciliation'
      });
      this.db.prepare('DELETE FROM run_provisional_outputs WHERE run_id=? AND task_id=?').run(runId,taskId);
      this.event(taskId,'provider.response.reconciled',{
        run_id:runId,user_message_id:userMessageId,conversation_id:conversationId,
        prompt_sha256:promptSha256,response_sha256:responseSha256,
        evidence:'unique_exact_prompt_completed_provider_reply',reconciled_at:now
      });
      this.recordConversationCompletion(taskId,runId);
      this.db.exec('COMMIT');
      return {reconciled:true,assistant};
    } catch(error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  recoverInterruptedRuns(reason='process_interrupted') {
    if (!['process_interrupted','app_shutdown'].includes(reason))
      throw new Error('invalid_interruption_reason');
    // Shared startup and graceful-window-close transaction: a crash or normal
    // close must never leave a submitted Run running after the app disappears.
    // In-flight run-linked actions have uncertain external side effects.
    // Mark them indeterminate; NEVER retry or dispatch them on boot.
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const running = this.db.prepare("SELECT id,task_id FROM runs WHERE status='running'").all();
      const now = this.now();
      const actions = this.db.prepare(
        "SELECT id FROM action_ledger WHERE run_id=? AND task_id=? " +
        "AND status IN ('pending','planning','approved','dispatching') ORDER BY id"
      );
      const stopAction = this.db.prepare(
        "UPDATE action_ledger SET status='indeterminate',updated_at=? WHERE id=? " +
        "AND run_id=? AND status IN ('pending','planning','approved','dispatching')"
      );
      const stopRun = this.db.prepare(
        "UPDATE runs SET status='interrupted',completed_at=?,heartbeat_at=?,error=? " +
        "WHERE id=? AND status='running'"
      );
      const stopTask = this.db.prepare(
        "UPDATE tasks SET status='interrupted',updated_at=? WHERE id=?"
      );
      for (const run of running) {
        for (const action of actions.all(run.id,run.task_id)) {
          if (stopAction.run(now,action.id,run.id).changes===1)
            this.event(run.task_id,'action.indeterminate',{
              action_id:action.id,run_id:run.id,reason
            });
        }
        if (stopRun.run(now,now,reason,run.id).changes!==1) throw new Error('run_recovery_state_changed');
        stopTask.run(now,run.task_id);
        this.event(run.task_id,'run.interrupted',{
          run_id:run.id,reason
        });
      }
      this.db.exec('COMMIT');
      return running.length;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  beginAction(taskId, runId, actionType, resourceKey = null, payload = {}) {
    const id = `action_${randomUUID()}`;
    const now = this.now();
    this.db.prepare('INSERT INTO action_ledger(id,task_id,run_id,action_type,resource_key,status,payload,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(id, taskId, runId || null, actionType, resourceKey, 'pending', JSON.stringify(payload), now, now);
    this.event(taskId, 'action.pending', { action_id: id, action_type: actionType, resource_key: resourceKey });
    return id;
  }

  finishAction(taskId, actionId, status, result = null) {
    if (!['succeeded', 'failed', 'indeterminate', 'cancelled'].includes(status)) throw new Error('invalid_action_status');
    const now = this.now();
    this.db.prepare('UPDATE action_ledger SET status=?,result=?,updated_at=? WHERE id=?')
      .run(status, result == null ? null : JSON.stringify(result), now, actionId);
    this.event(taskId, `action.${status}`, { action_id: actionId, result });
  }

  requestApproval(taskId, actionId = null, reason = '') {
    const id = `approval_${randomUUID()}`;
    const now = this.now();
    this.db.prepare('INSERT INTO approval_ledger(id,task_id,action_id,status,reason,created_at) VALUES(?,?,?,?,?,?)')
      .run(id, taskId, actionId, 'pending', reason || null, now);
    this.event(taskId, 'approval.requested', { approval_id: id, action_id: actionId, reason });
    return id;
  }

  resolveApproval(taskId, approvalId, approved) {
    const status = approved ? 'approved' : 'rejected';
    const now = this.now();
    this.db.prepare('UPDATE approval_ledger SET status=?,resolved_at=? WHERE id=?').run(status, now, approvalId);
    this.event(taskId, `approval.${status}`, { approval_id: approvalId });
  }

  pendingApprovals(taskId) {
    return this.db.prepare("SELECT * FROM approval_ledger WHERE task_id=? AND status='pending' ORDER BY created_at,id").all(taskId);
  }

  close() {
    if (!this.db) return;
    const db = this.db;
    this.db = null;
    db.close();
  }

  buildResumeCapsule(taskId) {
    const task = this.getTask(taskId);
    if (!task) return null;
    return {
      version: 2,
      workspace_session_id: task.workspace_session_id,
      task: { id: task.id, title: task.title, status: task.status, chat_url: task.chat_url },
      checkpoint: task.checkpoint_record,
      recent_messages: task.messages.slice(-8).map(({ role, content, created_at, assets }) => ({
        role, content, created_at, assets: (assets || []).map(({ id, kind, mime_type, alt }) => ({ id, kind, mime_type, alt }))
      })),
      recent_events: task.events.slice(-20),
      pending_approvals: task.pending_approvals,
      conversations: task.conversations,
      project_memory: task.project_memory,
      continuation: task.continuation
    };
  }
}
