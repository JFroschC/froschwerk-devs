import { mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

type Row = Record<string, unknown>;

const databasePath = process.env.HARNESS_DB_PATH
  ? resolve(process.env.HARNESS_DB_PATH)
  : resolve(dirname(fileURLToPath(import.meta.url)), "../.data/harness.sqlite");
let database: DatabaseSync | undefined;

const schemaSql = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'Tool',
  workspace_path TEXT NOT NULL DEFAULT '',
  start_command TEXT NOT NULL DEFAULT '',
  test_command TEXT NOT NULL DEFAULT '',
  auto_process_enabled INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'codex',
  status TEXT NOT NULL DEFAULT 'offline',
  max_concurrency INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Ready',
  priority TEXT NOT NULL DEFAULT 'Medium',
  assignee_agent_id TEXT REFERENCES agents(id),
  active_run_id TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  parent_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  plan_id TEXT,
  plan_sequence INTEGER,
  created_by TEXT NOT NULL DEFAULT 'user',
  origin_key TEXT,
  obsolete_at TEXT,
  obsolete_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS task_acceptance_criteria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS task_dependencies (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE(task_id, depends_on_task_id)
);
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_type TEXT NOT NULL,
  author_id TEXT,
  author_name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  attempt_no INTEGER NOT NULL DEFAULT 1,
  input_json TEXT NOT NULL DEFAULT '{}',
  output_json TEXT NOT NULL DEFAULT '{}',
  summary TEXT NOT NULL DEFAULT '',
  error TEXT,
  process_id INTEGER,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_leases (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  run_id TEXT NOT NULL UNIQUE REFERENCES agent_runs(id) ON DELETE CASCADE,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_requests (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  role TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  command TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'running',
  started_at TEXT NOT NULL,
  finished_at TEXT,
  duration_ms INTEGER,
  input_chars INTEGER NOT NULL DEFAULT 0,
  output_chars INTEGER NOT NULL DEFAULT 0,
  estimated_input_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_output_tokens INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  prompt_hash TEXT NOT NULL DEFAULT '',
  prompt_preview TEXT NOT NULL DEFAULT '',
  response_preview TEXT NOT NULL DEFAULT '',
  error TEXT
);
CREATE TABLE IF NOT EXISTS task_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS test_reports (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agent_run_id TEXT REFERENCES agent_runs(id),
  status TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  checks_json TEXT NOT NULL DEFAULT '[]',
  logs TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agent_run_id TEXT REFERENCES agent_runs(id),
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  project_id TEXT DEFAULT 'project-agent-harness' REFERENCES projects(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL,
  sender_id TEXT,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS manager_conversations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'open',
  mode TEXT NOT NULL DEFAULT 'status',
  summary TEXT NOT NULL DEFAULT '',
  latest_reply TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE TABLE IF NOT EXISTS manager_conversation_entries (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES manager_conversations(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS manager_questions (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES manager_conversations(id) ON DELETE CASCADE,
  question_key TEXT NOT NULL,
  question TEXT NOT NULL,
  options_json TEXT NOT NULL DEFAULT '[]',
  required INTEGER NOT NULL DEFAULT 1,
  answer TEXT,
  answered_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(conversation_id, question_key)
);
CREATE TABLE IF NOT EXISTS project_analysis_snapshots (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  snapshot_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS manager_plans (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  conversation_id TEXT REFERENCES manager_conversations(id) ON DELETE SET NULL,
  analysis_snapshot_id TEXT REFERENCES project_analysis_snapshots(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'awaiting_confirmation',
  title TEXT NOT NULL DEFAULT 'Manager-Plan',
  summary TEXT NOT NULL DEFAULT '',
  assumptions_json TEXT NOT NULL DEFAULT '[]',
  risks_json TEXT NOT NULL DEFAULT '[]',
  actions_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  confirmed_at TEXT,
  applied_at TEXT
);
CREATE TABLE IF NOT EXISTS manager_plan_tasks (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES manager_plans(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'create_tasks',
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'Medium',
  sequence INTEGER NOT NULL DEFAULT 0,
  acceptance_json TEXT NOT NULL DEFAULT '[]',
  parent_client_id TEXT,
  parent_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  depends_on_client_ids_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0,
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(plan_id, client_id)
);

CREATE INDEX IF NOT EXISTS idx_acceptance_task_order ON task_acceptance_criteria(task_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_comments_task_created ON comments(task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_runs_task_created ON agent_runs(task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_status ON agent_runs(agent_id, status);
CREATE INDEX IF NOT EXISTS idx_agent_leases_agent_expiry ON agent_leases(agent_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_agent_requests_project_started ON agent_requests(project_id, started_at);
CREATE INDEX IF NOT EXISTS idx_agent_requests_run_started ON agent_requests(run_id, started_at);
CREATE INDEX IF NOT EXISTS idx_task_events_task_created ON task_events(task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_test_reports_task_created ON test_reports(task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_artifacts_task_created ON artifacts(task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_manager_conversations_project_updated ON manager_conversations(project_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_manager_conversation_entries_created ON manager_conversation_entries(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_manager_questions_conversation ON manager_questions(conversation_id, answered_at);
CREATE INDEX IF NOT EXISTS idx_analysis_snapshots_project_created ON project_analysis_snapshots(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_manager_plans_project_updated ON manager_plans(project_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_manager_plan_tasks_plan_order ON manager_plan_tasks(plan_id, sort_order);
`;

function id(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function timestamp() {
  return new Date().toISOString();
}

function tokenEstimate(text: string) {
  return Math.ceil(text.length / 4);
}

function preview(text: string, limit = 1200) {
  return text.length > limit ? `${text.slice(0, limit)}\n[… gekürzt …]` : text;
}

export function startAgentRequest(input: { projectId?: string; taskId?: string; runId?: string; agentId?: string; role: string; provider: string; model?: string; command?: string; prompt: string }) {
  const db = getDatabase();
  const requestId = id("request");
  const startedAt = timestamp();
  db.prepare(`INSERT INTO agent_requests (id, project_id, task_id, run_id, agent_id, role, provider, model, command, status, started_at, input_chars, estimated_input_tokens, prompt_hash, prompt_preview)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, ?)`).run(
    requestId, input.projectId ?? null, input.taskId ?? null, input.runId ?? null, input.agentId ?? null,
    input.role, input.provider, input.model ?? "", input.command ?? "", startedAt, input.prompt.length,
    tokenEstimate(input.prompt), createHash("sha256").update(input.prompt).digest("hex"), preview(input.prompt),
  );
  return { requestId, startedAt };
}

export function finishAgentRequest(requestId: string, input: { status: string; response?: string; error?: string; inputTokens?: number; outputTokens?: number; totalTokens?: number; startedAt?: string }) {
  const db = getDatabase();
  const finishedAt = timestamp();
  const started = input.startedAt ? Date.parse(input.startedAt) : undefined;
  const durationMs = started && Number.isFinite(started) ? Math.max(0, Date.parse(finishedAt) - started) : null;
  const response = input.response ?? "";
  db.prepare(`UPDATE agent_requests SET status = ?, finished_at = ?, duration_ms = ?, output_chars = ?, estimated_output_tokens = ?, input_tokens = ?, output_tokens = ?, total_tokens = ?, response_preview = ?, error = ? WHERE id = ?`).run(
    input.status, finishedAt, durationMs, response.length, tokenEstimate(response), input.inputTokens ?? null, input.outputTokens ?? null,
    input.totalTokens ?? (input.inputTokens !== undefined && input.outputTokens !== undefined ? input.inputTokens + input.outputTokens : null), preview(response), input.error ?? null, requestId,
  );
}

export function listAgentRequests(projectId?: string, limit = 25) {
  const db = getDatabase();
  return db.prepare(`SELECT id, project_id AS projectId, task_id AS taskId, run_id AS runId, agent_id AS agentId, role, provider, model, command, status, started_at AS startedAt, finished_at AS finishedAt, duration_ms AS durationMs, input_chars AS inputChars, output_chars AS outputChars, estimated_input_tokens AS estimatedInputTokens, estimated_output_tokens AS estimatedOutputTokens, input_tokens AS inputTokens, output_tokens AS outputTokens, total_tokens AS totalTokens, prompt_hash AS promptHash, prompt_preview AS promptPreview, response_preview AS responsePreview, error FROM agent_requests WHERE (? IS NULL OR project_id = ?) ORDER BY started_at DESC, id DESC LIMIT ?`).all(projectId ?? null, projectId ?? null, Math.max(1, Math.min(limit, 100))) as Row[];
}

export function agentRequestSummary(projectId?: string) {
  const db = getDatabase();
  const row = db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END), 0) AS running, COALESCE(SUM(COALESCE(total_tokens, estimated_input_tokens + estimated_output_tokens)), 0) AS tokens, COALESCE(SUM(duration_ms), 0) AS durationMs FROM agent_requests WHERE (? IS NULL OR project_id = ?)`).get(projectId ?? null, projectId ?? null) as Row;
  return { count: Number(row.count ?? 0), running: Number(row.running ?? 0), tokens: Number(row.tokens ?? 0), durationMs: Number(row.durationMs ?? 0) };
}

function getDatabase() {
  if (!database) {
    mkdirSync(dirname(databasePath), { recursive: true });
    const openedDatabase = new DatabaseSync(databasePath);
    try {
      openedDatabase.exec(schemaSql);
      migrateProjects(openedDatabase);
      migrateChatMessages(openedDatabase);
      migrateAgents(openedDatabase);
      migrateTasks(openedDatabase);
      migrateManagerOrchestration(openedDatabase);
      seedDatabase(openedDatabase);
      ensureDefaultAgents(openedDatabase);
      recoverStaleAgentRequests(openedDatabase);
      database = openedDatabase;
    } catch (error) {
      openedDatabase.close();
      throw error;
    }
  }
  return database!;
}

function recoverStaleAgentRequests(db: DatabaseSync) {
  const configured = Number(process.env.AGENT_REQUEST_STALE_TIMEOUT_MS ?? 35 * 60 * 1000);
  const timeoutMs = Number.isFinite(configured) && configured > 0 ? configured : 35 * 60 * 1000;
  const cutoff = new Date(Date.now() - timeoutMs).toISOString();
  const finishedAt = timestamp();
  db.prepare(`UPDATE agent_requests SET status = 'timeout', finished_at = ?, duration_ms = MAX(0, CAST((julianday(?) - julianday(started_at)) * 86400000 AS INTEGER)), error = COALESCE(error, 'Request wurde nach Ablauf der Stale-Grenze ohne Abschluss markiert.') WHERE status = 'running' AND started_at < ?`).run(finishedAt, finishedAt, cutoff);
}

function leaseDurationMs() {
  const configured = Number(process.env.AGENT_LEASE_TTL_MS ?? 120_000);
  return Number.isFinite(configured) && configured >= 30_000 ? configured : 120_000;
}

function testerRecoveryLimit() {
  const configured = Number(process.env.TESTER_RECOVERY_LIMIT ?? 3);
  return Number.isSafeInteger(configured) && configured > 0 ? configured : 3;
}

function recoverStaleAgentRuns(db: DatabaseSync) {
  const now = timestamp();
  const staleRuns = db.prepare(`
    SELECT runs.id, runs.task_id AS taskId, runs.role, runs.attempt_no AS attemptNo,
      tasks.retry_count AS retryCount, tasks.max_retries AS maxRetries
    FROM agent_runs AS runs
    LEFT JOIN agent_leases AS leases ON leases.run_id = runs.id
    JOIN tasks ON tasks.id = runs.task_id
    WHERE runs.role IN ('developer', 'tester')
      AND runs.status IN ('queued', 'running')
      AND (leases.run_id IS NULL OR leases.expires_at < ?)
  `).all(now) as Row[];
  if (!staleRuns.length) return;

  db.exec("BEGIN IMMEDIATE");
  try {
    for (const run of staleRuns) {
      let reason;
      if (run.role === "tester") {
        const exhausted = Number(run.attemptNo) >= testerRecoveryLimit();
        const nextStatus = exhausted ? "Blocked" : "Review";
        reason = exhausted
          ? "Testerprozess ist wiederholt ohne Ergebnis abgebrochen. Der Autoprozess wurde für dieses Ticket angehalten."
          : "Tester-Lauf wurde nach Prozessabbruch oder abgelaufener Lease automatisch freigegeben.";
        const reportId = id("report");
        db.prepare("UPDATE agent_runs SET status = 'blocked', summary = ?, error = ?, process_id = NULL, finished_at = ? WHERE id = ? AND status IN ('queued', 'running')").run(reason, reason, now, run.id);
        db.prepare("INSERT INTO test_reports (id, task_id, agent_run_id, status, summary, checks_json, logs, created_at) VALUES (?, ?, ?, 'blocked', ?, '[]', '', ?)").run(reportId, run.taskId, run.id, reason, now);
        db.prepare("UPDATE tasks SET status = ?, active_run_id = NULL, assignee_agent_id = NULL, updated_at = ? WHERE id = ? AND active_run_id = ?").run(nextStatus, now, run.taskId, run.id);
        addCommentInternal(db, String(run.taskId), "tester", "agent-tester-1", "QA Bot", `${reason}${exhausted ? "" : " Ein Neustart ist möglich."}`, now);
        addEventInternal(db, String(run.taskId), "tester.run_recovered", "manager", "agent-manager", { runId: run.id, reportId, reason, nextStatus, exhausted }, now);
      } else {
        const retryCount = Number(run.retryCount ?? 0) + 1;
        const exhausted = retryCount >= Number(run.maxRetries ?? 3);
        const nextStatus = exhausted ? "Blocked" : "Ready";
        reason = exhausted
          ? "Entwicklerprozess ist wiederholt ohne Abschluss abgebrochen. Das Ticket wurde nach Erreichen der Retry-Grenze blockiert."
          : "Entwicklerprozess wurde nach Prozessabbruch oder abgelaufener Lease automatisch freigegeben.";
        db.prepare("UPDATE agent_runs SET status = 'failed', summary = ?, error = ?, process_id = NULL, finished_at = ? WHERE id = ? AND status IN ('queued', 'running')").run(reason, "STALE_RUN_RECOVERED", now, run.id);
        db.prepare("UPDATE tasks SET status = ?, retry_count = ?, active_run_id = NULL, assignee_agent_id = NULL, updated_at = ? WHERE id = ? AND active_run_id = ?").run(nextStatus, retryCount, now, run.taskId, run.id);
        addCommentInternal(db, String(run.taskId), "manager", "agent-manager", "Mira", reason, now);
        addEventInternal(db, String(run.taskId), "developer.run_recovered", "manager", "agent-manager", { runId: run.id, reason, nextStatus, retryCount, exhausted }, now);
      }
      db.prepare("DELETE FROM agent_leases WHERE run_id = ?").run(run.id);
      db.prepare("UPDATE agent_requests SET status = 'timeout', finished_at = ?, duration_ms = MAX(0, CAST((julianday(?) - julianday(started_at)) * 86400000 AS INTEGER)), error = COALESCE(error, ?) WHERE run_id = ? AND status = 'running'").run(now, now, reason, run.id);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function migrateProjects(db: DatabaseSync) {
  const columns = db.prepare("PRAGMA table_info(projects)").all() as Row[];
  if (!columns.some((column) => column.name === "key")) {
    db.exec("ALTER TABLE projects ADD COLUMN key TEXT");
    if (columns.some((column) => column.name === "project_key")) db.exec("UPDATE projects SET key = project_key WHERE key IS NULL OR key = ''");
    db.exec("UPDATE projects SET key = id WHERE key IS NULL OR key = ''");
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_key_unique ON projects(key)");
  }
  const additions = [
    ["type", "TEXT NOT NULL DEFAULT 'Tool'"],
    ["workspace_path", "TEXT NOT NULL DEFAULT ''"],
    ["start_command", "TEXT NOT NULL DEFAULT ''"],
    ["test_command", "TEXT NOT NULL DEFAULT ''"],
    ["auto_process_enabled", "INTEGER NOT NULL DEFAULT 0"],
    ["status", "TEXT NOT NULL DEFAULT 'active'"],
  ];
  for (const [name, definition] of additions) {
    if (!columns.some((column) => column.name === name)) db.exec(`ALTER TABLE projects ADD COLUMN ${name} ${definition}`);
  }
  db.prepare("UPDATE projects SET workspace_path = ? WHERE id = 'project-agent-harness' AND workspace_path = ''").run(process.cwd());
  db.prepare("UPDATE projects SET start_command = 'npm run dev' WHERE id = 'project-agent-harness' AND start_command = ''").run();
  db.prepare("UPDATE projects SET test_command = 'npm test' WHERE id = 'project-agent-harness' AND test_command = ''").run();
}

function migrateTasks(db: DatabaseSync) {
  const columns = db.prepare("PRAGMA table_info(tasks)").all() as Row[];
  const additions = [
    ["description", "TEXT NOT NULL DEFAULT ''"],
    ["status", "TEXT NOT NULL DEFAULT 'Ready'"],
    ["priority", "TEXT NOT NULL DEFAULT 'Medium'"],
    ["assignee_agent_id", "TEXT"],
    ["active_run_id", "TEXT"],
    ["plan_sequence", "INTEGER"],
    ["retry_count", "INTEGER NOT NULL DEFAULT 0"],
    ["max_retries", "INTEGER NOT NULL DEFAULT 3"],
  ];
  for (const [name, definition] of additions) {
    if (!columns.some((column) => column.name === name)) db.exec(`ALTER TABLE tasks ADD COLUMN ${name} ${definition}`);
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_project_status_priority ON tasks(project_id, status, priority)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_assignee_status ON tasks(assignee_agent_id, status)");
}

function migrateManagerOrchestration(db: DatabaseSync) {
  const taskColumns = db.prepare("PRAGMA table_info(tasks)").all() as Row[];
  const additions = [
    ["parent_task_id", "TEXT"],
    ["plan_id", "TEXT"],
    ["created_by", "TEXT NOT NULL DEFAULT 'user'"],
    ["origin_key", "TEXT"],
    ["obsolete_at", "TEXT"],
    ["obsolete_reason", "TEXT"],
  ];
  for (const [name, definition] of additions) {
    if (!taskColumns.some((column) => column.name === name)) db.exec(`ALTER TABLE tasks ADD COLUMN ${name} ${definition}`);
  }
  const runColumns = db.prepare("PRAGMA table_info(agent_runs)").all() as Row[];
  if (!runColumns.some((column) => column.name === "process_id")) db.exec("ALTER TABLE agent_runs ADD COLUMN process_id INTEGER");
  const planTaskColumns = db.prepare("PRAGMA table_info(manager_plan_tasks)").all() as Row[];
  if (!planTaskColumns.some((column) => column.name === "sequence")) db.exec("ALTER TABLE manager_plan_tasks ADD COLUMN sequence INTEGER NOT NULL DEFAULT 0");
  db.exec("UPDATE manager_plan_tasks SET sequence = (sort_order + 1) * 10 WHERE sequence = 0");
  db.exec("UPDATE tasks SET plan_sequence = (SELECT sequence FROM manager_plan_tasks WHERE manager_plan_tasks.task_id = tasks.id) WHERE plan_id IS NOT NULL AND plan_sequence IS NULL AND EXISTS (SELECT 1 FROM manager_plan_tasks WHERE manager_plan_tasks.task_id = tasks.id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_manager_plan_tasks_plan_sequence ON manager_plan_tasks(plan_id, sequence, sort_order)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_plan ON tasks(plan_id)");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_origin_key_unique ON tasks(origin_key) WHERE origin_key IS NOT NULL");
}

function migrateChatMessages(db: DatabaseSync) {
  const columns = db.prepare("PRAGMA table_info(chat_messages)").all() as Row[];
  if (!columns.some((column) => column.name === "project_id")) db.exec("ALTER TABLE chat_messages ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE CASCADE");
  db.prepare("UPDATE chat_messages SET project_id = 'project-agent-harness' WHERE project_id IS NULL").run();
  db.exec("CREATE INDEX IF NOT EXISTS idx_chat_messages_project_created ON chat_messages(project_id, created_at)");
}

function migrateAgents(db: DatabaseSync) {
  const columns = db.prepare("PRAGMA table_info(agents)").all() as Row[];
  if (!columns.some((column) => column.name === "provider")) {
    db.exec("ALTER TABLE agents ADD COLUMN provider TEXT NOT NULL DEFAULT 'codex'");
  }
  db.prepare("UPDATE agents SET provider = 'codex' WHERE id IN ('agent-manager', 'agent-developer-1')").run();
  db.prepare("UPDATE agents SET provider = 'claude' WHERE id = 'agent-developer-2'").run();
}

function ensureDefaultAgents(db: DatabaseSync) {
  const now = timestamp();
  const insert = db.prepare("INSERT OR IGNORE INTO agents (id, name, role, provider, status, max_concurrency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  insert.run("agent-developer-2", "Dev Agent 2", "developer", "claude", "offline", 1, now, now);
}

function seedDatabase(db: DatabaseSync) {
  const existing = db.prepare("SELECT COUNT(*) AS count FROM projects").get() as { count: number };
  if (Number(existing.count) > 0) return;
  const now = timestamp();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("INSERT INTO projects (id, key, name, description, type, workspace_path, start_command, test_command, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("project-agent-harness", "FW", "Agent Harness", "Lokales Multi-Agent-Taskboard", "Tool", process.cwd(), "npm run dev", "npm test", "active", now, now);
    db.prepare("INSERT INTO agents (id, name, role, provider, status, max_concurrency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("agent-manager", "Mira", "manager", "codex", "online", 1, now, now);
    db.prepare("INSERT INTO agents (id, name, role, provider, status, max_concurrency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("agent-developer-1", "Dev Agent", "developer", "codex", "online", 2, now, now);
    db.prepare("INSERT INTO agents (id, name, role, provider, status, max_concurrency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("agent-tester-1", "QA Bot", "tester", "codex", "online", 2, now, now);
    const tasks = [
      ["FW-104", "Taskboard-Grundlayout und Navigation", "Ein übersichtliches Board für Projekte und Agentenläufe aufbauen.", "Done", "High", "agent-developer-1"],
      ["FW-108", "Manager-Chat mit Ticketaktionen", "Der Hauptmanager soll Tickets aus dem Chat anlegen und den nächsten Lauf starten können.", "In Progress", "Urgent", "agent-developer-1"],
      ["FW-111", "Testergebnisse direkt am Ticket speichern", "Testberichte, Logs und eine klare Pass/Fail-Rückmeldung am Ticket ablegen.", "Testing", "High", "agent-tester-1"],
      ["FW-115", "MCP-Schnittstelle für Codex vorbereiten", "Werkzeuge definieren, mit denen Codex Tickets lesen, kommentieren und Status ändern kann.", "Ready", "Medium", "agent-developer-1"],
      ["FW-118", "Retry- und Blockade-Regeln definieren", "Verhindern, dass ein fehlerhaftes Ticket endlos zwischen Entwickler und Tester pendelt.", "Review", "Low", "agent-manager"],
    ];
    const criteria: Record<string, string[]> = {
      "FW-104": ["Statusspalten sind sichtbar", "Tickets können geöffnet werden"],
      "FW-108": ["Chat ist sichtbar", "Neues Ticket kann aus einer Nachricht entstehen", "Nächste Aufgabe kann gestartet werden"],
      "FW-111": ["Testergebnis hat einen Status", "Fehler enthalten Reproduktionsschritte", "Manager erhält eine Rückmeldung"],
      "FW-115": ["Tool-Vertrag ist dokumentiert", "Statusänderungen sind eingeschränkt", "Agentenläufe sind nachvollziehbar"],
      "FW-118": ["Maximale Versuche sind sichtbar", "Blocked eskaliert an den Benutzer"],
    };
    const insertTask = db.prepare("INSERT INTO tasks (id, project_id, title, description, status, priority, assignee_agent_id, retry_count, max_retries, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    const insertCriteria = db.prepare("INSERT INTO task_acceptance_criteria (task_id, text, sort_order) VALUES (?, ?, ?)");
    for (const [taskId, title, description, status, priority, assignee] of tasks) {
      insertTask.run(taskId, "project-agent-harness", title, description, status, priority, assignee, 0, 3, now, now);
      for (const [order, text] of (criteria[taskId] ?? []).entries()) insertCriteria.run(taskId, text, order);
    }
    const insertComment = db.prepare("INSERT INTO comments (id, task_id, author_type, author_id, author_name, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
    insertComment.run("comment-fw104-manager", "FW-104", "manager", "agent-manager", "Mira", "Vom Tester bestätigt und abgeschlossen.", now);
    insertComment.run("comment-fw104-tester", "FW-104", "tester", "agent-tester-1", "QA Bot", "Board-Navigation und responsive Ansicht geprüft.", now);
    insertComment.run("comment-fw108-manager", "FW-108", "manager", "agent-manager", "Mira", "Phase 2 gestartet. UI zuerst, API-Adapter folgt.", now);
    insertComment.run("comment-fw111-tester", "FW-111", "tester", "agent-tester-1", "QA Bot", "Prüfe zunächst den aktuellen Kommentarfluss.", now);
    const insertChat = db.prepare("INSERT INTO chat_messages (id, sender_type, sender_id, body, created_at) VALUES (?, ?, ?, ?, ?)");
    insertChat.run("chat-welcome-1", "manager", "agent-manager", "Guten Morgen. Ich habe 5 Tickets im Projekt Agent Harness. FW-108 ist aktuell der nächste aktive Schritt.", now);
    insertChat.run("chat-welcome-2", "manager", "agent-manager", "Du kannst mir Aufgaben in normaler Sprache geben. Ich erstelle daraus ein Ticket und halte den Verlauf direkt am Board fest.", now);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function mapTask(db: DatabaseSync, row: Row) {
  const comments = db.prepare("SELECT id, author_name AS author, author_type AS role, body AS text, created_at AS createdAt FROM comments WHERE task_id = ? ORDER BY created_at ASC, id ASC").all(row.id) as Row[];
  const acceptance = db.prepare("SELECT text FROM task_acceptance_criteria WHERE task_id = ? ORDER BY sort_order ASC, id ASC").all(row.id) as Row[];
  const dependencies = db.prepare("SELECT depends_on_task_id AS taskId FROM task_dependencies WHERE task_id = ? ORDER BY depends_on_task_id ASC").all(row.id) as Row[];
  const testReport = db.prepare("SELECT id, status, summary, checks_json AS checksJson, logs, created_at AS createdAt FROM test_reports WHERE task_id = ? ORDER BY created_at DESC, id DESC LIMIT 1").get(row.id) as Row | undefined;
  const updated = new Date(String(row.updatedAt)).getTime();
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    project: row.project,
    assignee: row.assignee,
    parentTaskId: row.parentTaskId ?? null,
    planId: row.planId ?? null,
    planSequence: row.planSequence === null || row.planSequence === undefined ? null : Number(row.planSequence),
    createdBy: row.createdBy ?? "user",
    originKey: row.originKey ?? null,
    obsoleteAt: row.obsoleteAt ?? null,
    obsoleteReason: row.obsoleteReason ?? null,
    dependencies: dependencies.map((dependency) => dependency.taskId),
    acceptance: acceptance.map((item) => item.text),
    comments: comments.map((comment) => ({ ...comment, role: comment.role === "tester" ? "Tester" : comment.role === "developer" || comment.role === "agent" ? "Entwickler" : comment.role === "user" ? "Du" : "Manager", createdAt: formatRelative(String(comment.createdAt)) })),
    updatedAt: formatRelative(String(row.updatedAt), updated),
    retryCount: row.retryCount,
    maxRetries: row.maxRetries,
    activeRunId: row.activeRunId,
    activeRunStatus: row.activeRunStatus,
    activeRunRole: row.activeRunRole,
    testReport: testReport ? {
      id: testReport.id,
      status: testReport.status,
      summary: testReport.summary,
      checks: JSON.parse(String(testReport.checksJson ?? "[]")),
      logs: testReport.logs,
    } : undefined,
  };
}

function formatRelative(value: string, _timestamp = Date.parse(value)) {
  if (!Number.isFinite(_timestamp)) return value;
  const minutes = Math.max(0, Math.round((Date.now() - _timestamp) / 60000));
  if (minutes < 1) return "gerade eben";
  if (minutes < 60) return `vor ${minutes} Min.`;
  if (minutes < 1440) return `vor ${Math.round(minutes / 60)} Std.`;
  return new Date(_timestamp).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
}

function mapAgent(row: Row) {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    provider: row.provider,
    status: row.status,
    maxConcurrency: row.maxConcurrency,
  };
}

function mapProject(row: Row) {
  const ticketCount = Number(row.ticketCount ?? 0);
  const doneCount = Number(row.doneCount ?? 0);
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    type: row.type,
    workspacePath: row.workspacePath,
    startCommand: row.startCommand,
    testCommand: row.testCommand,
    autoProcessEnabled: Boolean(row.autoProcessEnabled),
    status: row.status,
    ticketCount,
    doneCount,
    progress: ticketCount ? Math.round((doneCount / ticketCount) * 100) : 0,
    runCount: Number(row.runCount ?? 0),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function listProjects(includeArchived = false) {
  const db = getDatabase();
  const rows = db.prepare(`SELECT projects.id, projects.key, projects.name, projects.description,
    projects.type, projects.workspace_path AS workspacePath, projects.start_command AS startCommand,
    projects.test_command AS testCommand, projects.auto_process_enabled AS autoProcessEnabled, projects.status, projects.created_at AS createdAt, projects.updated_at AS updatedAt,
    (SELECT COUNT(*) FROM tasks WHERE tasks.project_id = projects.id) AS ticketCount,
    (SELECT COUNT(*) FROM tasks WHERE tasks.project_id = projects.id AND tasks.status = 'Done') AS doneCount,
    (SELECT COUNT(*) FROM agent_runs JOIN tasks ON tasks.id = agent_runs.task_id WHERE tasks.project_id = projects.id) AS runCount
    FROM projects WHERE (? = 1 OR projects.status != 'archived') ORDER BY projects.status = 'archived', projects.updated_at DESC`).all(includeArchived ? 1 : 0) as Row[];
  return rows.map(mapProject);
}

export function getProject(projectId: string) {
  return listProjects(true).find((project) => project.id === projectId);
}

export function createProject(input: { key: string; name: string; description?: string; type?: string; workspacePath?: string; startCommand?: string; testCommand?: string }) {
  const db = getDatabase();
  const key = input.key.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "-");
  const name = input.name.trim();
  if (!key || !name) throw new Error("Projektname und Projektschlüssel sind erforderlich");
  const now = timestamp();
  const projectId = `project-${crypto.randomUUID()}`;
  db.prepare("INSERT INTO projects (id, key, name, description, type, workspace_path, start_command, test_command, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)").run(projectId, key, name, input.description?.trim() ?? "", input.type?.trim() || "Tool", input.workspacePath?.trim() ?? "", input.startCommand?.trim() ?? "", input.testCommand?.trim() ?? "", now, now);
  return getProject(projectId);
}

export function updateProject(projectId: string, patch: { key?: string; name?: string; description?: string; type?: string; workspacePath?: string; startCommand?: string; testCommand?: string; autoProcessEnabled?: boolean }) {
  const db = getDatabase();
  if (!getProject(projectId)) return undefined;
  const now = timestamp();
  const key = patch.key === undefined ? null : patch.key.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "-");
  db.prepare("UPDATE projects SET key = COALESCE(?, key), name = COALESCE(?, name), description = COALESCE(?, description), type = COALESCE(?, type), workspace_path = COALESCE(?, workspace_path), start_command = COALESCE(?, start_command), test_command = COALESCE(?, test_command), auto_process_enabled = COALESCE(?, auto_process_enabled), updated_at = ? WHERE id = ?").run(key, patch.name?.trim() ?? null, patch.description?.trim() ?? null, patch.type?.trim() ?? null, patch.workspacePath?.trim() ?? null, patch.startCommand?.trim() ?? null, patch.testCommand?.trim() ?? null, patch.autoProcessEnabled === undefined ? null : patch.autoProcessEnabled ? 1 : 0, now, projectId);
  return getProject(projectId);
}

export function archiveProject(projectId: string) {
  const db = getDatabase();
  if (!getProject(projectId)) return undefined;
  const activeRuns = db.prepare("SELECT COUNT(*) AS count FROM agent_runs JOIN tasks ON tasks.id = agent_runs.task_id WHERE tasks.project_id = ? AND agent_runs.status IN ('queued', 'running')").get(projectId) as { count: number };
  if (Number(activeRuns.count) > 0) throw new Error("Ein Projekt mit aktiven Agentenläufen kann nicht archiviert werden");
  db.prepare("UPDATE projects SET status = 'archived', updated_at = ? WHERE id = ?").run(timestamp(), projectId);
  return getProject(projectId);
}

export function listAgents() {
  const db = getDatabase();
  return (db.prepare("SELECT id, name, role, provider, status, max_concurrency AS maxConcurrency FROM agents ORDER BY CASE role WHEN 'manager' THEN 0 WHEN 'developer' THEN 1 ELSE 2 END, id").all() as Row[]).map(mapAgent);
}

export function getAgent(agentId: string) {
  const db = getDatabase();
  const row = db.prepare("SELECT id, name, role, provider, status, max_concurrency AS maxConcurrency FROM agents WHERE id = ?").get(agentId) as Row | undefined;
  return row ? mapAgent(row) : undefined;
}

export function updateAgent(agentId: string, patch: { provider?: string; status?: string; maxConcurrency?: number }) {
  const provider = patch.provider === undefined ? undefined : patch.provider.toLowerCase();
  if (provider !== undefined && provider !== "codex" && provider !== "claude") throw new Error("Provider muss codex oder claude sein");
  const db = getDatabase();
  if (!getAgent(agentId)) return undefined;
  const now = timestamp();
  db.prepare("UPDATE agents SET provider = COALESCE(?, provider), status = COALESCE(?, status), max_concurrency = COALESCE(?, max_concurrency), updated_at = ? WHERE id = ?").run(provider ?? null, patch.status ?? null, patch.maxConcurrency ?? null, now, agentId);
  return getAgent(agentId);
}

export function listTasks(projectId?: string) {
  const db = getDatabase();
  recoverStaleAgentRuns(db);
  const rows = db.prepare(`SELECT tasks.id, tasks.project_id AS projectId, tasks.title, tasks.description, tasks.status, tasks.priority,
    tasks.updated_at AS updatedAt, tasks.retry_count AS retryCount, tasks.max_retries AS maxRetries,
    tasks.parent_task_id AS parentTaskId, tasks.plan_id AS planId, tasks.plan_sequence AS planSequence, tasks.created_by AS createdBy, tasks.origin_key AS originKey,
    tasks.obsolete_at AS obsoleteAt, tasks.obsolete_reason AS obsoleteReason,
    tasks.active_run_id AS activeRunId, active_runs.status AS activeRunStatus, active_runs.role AS activeRunRole,
    projects.name AS project, COALESCE(agents.name, 'Manager') AS assignee
    FROM tasks JOIN projects ON projects.id = tasks.project_id
    LEFT JOIN agents ON agents.id = tasks.assignee_agent_id
    LEFT JOIN agent_runs AS active_runs ON active_runs.id = tasks.active_run_id
    WHERE (? IS NULL OR tasks.project_id = ?)
    ORDER BY CASE tasks.status WHEN 'In Progress' THEN 0 WHEN 'Testing' THEN 1 WHEN 'Review' THEN 2 WHEN 'Ready' THEN 3 WHEN 'Done' THEN 4 ELSE 5 END,
      CASE WHEN tasks.status = 'Ready' AND tasks.plan_id IS NOT NULL AND tasks.plan_sequence IS NOT NULL THEN 0 ELSE 1 END,
      CASE WHEN tasks.status = 'Ready' AND tasks.plan_id IS NOT NULL THEN tasks.plan_sequence ELSE NULL END ASC,
      CASE tasks.priority WHEN 'Urgent' THEN 0 WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END, tasks.created_at ASC`).all(projectId ?? null, projectId ?? null) as Row[];
  return rows.map((row) => mapTask(db, row));
}

export function createTask(input: { title: string; description?: string; priority?: string; acceptance?: string[]; projectId?: string }) {
  const db = getDatabase();
  const now = timestamp();
  let taskId = "";
  db.exec("BEGIN IMMEDIATE");
  try {
    const targetProjectId = input.projectId ?? "project-agent-harness";
    if (!getProject(targetProjectId)) throw new Error("Projekt wurde nicht gefunden");
    taskId = nextTaskId(db, targetProjectId);
    db.prepare("INSERT INTO tasks (id, project_id, title, description, status, priority, retry_count, max_retries, created_at, updated_at) VALUES (?, ?, ?, ?, 'Ready', ?, 0, 3, ?, ?)").run(taskId, targetProjectId, input.title.trim(), input.description?.trim() ?? "Noch keine Beschreibung hinterlegt.", input.priority ?? "Medium", now, now);
    const criteria = input.acceptance?.length ? input.acceptance : ["Akzeptanzkriterien ergänzen"];
    const insertCriteria = db.prepare("INSERT INTO task_acceptance_criteria (task_id, text, sort_order) VALUES (?, ?, ?)");
    for (const [order, text] of criteria.entries()) insertCriteria.run(taskId, text, order);
    addCommentInternal(db, taskId, "manager", "agent-manager", "Mira", "Ticket aus dem Manager-Cockpit angelegt.", now);
    addEventInternal(db, taskId, "task.created", "manager", "agent-manager", { title: input.title }, now);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return listTasks(input.projectId).find((task) => task.id === taskId);
}

export function updateTask(taskId: string, patch: { title?: string; description?: string; status?: string; priority?: string; assignee?: string; acceptance?: string[] }) {
  const db = getDatabase();
  const row = db.prepare("SELECT id, status, active_run_id AS activeRunId, obsolete_at AS obsoleteAt FROM tasks WHERE id = ?").get(taskId) as Row | undefined;
  if (!row) return undefined;
  if (row.obsoleteAt && patch.status !== undefined) throw new Error("Ein archiviertes, obsoletes Ticket kann nicht wieder in den Workflow verschoben werden");
  if (row.activeRunId && patch.status !== undefined && patch.status !== row.status) throw new Error("Der Status eines Tickets mit aktivem Agentenlauf kann nicht manuell geändert werden");
  const agentId = patch.assignee === "Tester" ? "agent-tester-1" : patch.assignee === "Entwickler" ? "agent-developer-1" : patch.assignee === "Manager" ? "agent-manager" : undefined;
  const now = timestamp();
  db.exec("BEGIN IMMEDIATE");
  try {
    const acceptance = Array.isArray(patch.acceptance) ? patch.acceptance.map((item) => String(item).trim()).filter(Boolean) : undefined;
    const resetRetries = row.status === "Blocked" && patch.status === "Ready";
    db.prepare("UPDATE tasks SET title = COALESCE(?, title), description = COALESCE(?, description), status = COALESCE(?, status), priority = COALESCE(?, priority), assignee_agent_id = COALESCE(?, assignee_agent_id), retry_count = CASE WHEN ? THEN 0 ELSE retry_count END, updated_at = ? WHERE id = ?").run(patch.title?.trim() || null, patch.description?.trim() ?? null, patch.status ?? null, patch.priority ?? null, agentId ?? null, resetRetries ? 1 : 0, now, taskId);
    if (acceptance) {
      db.prepare("DELETE FROM task_acceptance_criteria WHERE task_id = ?").run(taskId);
      const insertCriteria = db.prepare("INSERT INTO task_acceptance_criteria (task_id, text, sort_order) VALUES (?, ?, ?)");
      for (const [order, text] of acceptance.entries()) insertCriteria.run(taskId, text, order);
    }
    addEventInternal(db, taskId, "task.updated", "manager", "agent-manager", patch, now);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return listTasks().find((task) => task.id === taskId);
}

function addCommentInternal(db: DatabaseSync, taskId: string, authorType: string, authorId: string, authorName: string, body: string, now: string) {
  db.prepare("INSERT INTO comments (id, task_id, author_type, author_id, author_name, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id("comment"), taskId, authorType, authorId, authorName, body, now);
}

function addEventInternal(db: DatabaseSync, taskId: string, eventType: string, actorType: string, actorId: string, payload: unknown, now: string) {
  db.prepare("INSERT INTO task_events (task_id, event_type, actor_type, actor_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(taskId, eventType, actorType, actorId, JSON.stringify(payload), now);
}

export function listTaskEvents(taskId: string) {
  const db = getDatabase();
  const rows = db.prepare("SELECT id, event_type AS eventType, actor_type AS actorType, actor_id AS actorId, payload_json AS payloadJson, created_at AS createdAt FROM task_events WHERE task_id = ? ORDER BY created_at ASC, id ASC").all(taskId) as Row[];
  return rows.map((row) => ({
    id: row.id,
    eventType: row.eventType,
    actorType: row.actorType,
    actorId: row.actorId,
    payload: JSON.parse(String(row.payloadJson ?? "{}")) as unknown,
    createdAt: row.createdAt,
  }));
}

export function addComment(taskId: string, input: { authorType?: string; authorId?: string; authorName?: string; body: string; runId?: string }) {
  const db = getDatabase();
  const now = timestamp();
  db.exec("BEGIN IMMEDIATE");
  try {
    addCommentInternal(db, taskId, input.authorType ?? "user", input.authorId ?? "owner", input.authorName ?? "Du", input.body.trim(), now);
    addEventInternal(db, taskId, "comment.created", input.authorType ?? "user", input.authorId ?? "owner", { body: input.body, runId: input.runId }, now);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return listTasks().find((task) => task.id === taskId);
}

const allowedMcpStatusTransitions: Record<string, string[]> = {
  Ready: ["In Progress", "Blocked"],
  "In Progress": ["Review", "Blocked"],
  Review: ["Testing", "Changes Requested", "Blocked"],
  Testing: ["Done", "Changes Requested", "Blocked"],
  "Changes Requested": ["In Progress", "Ready", "Blocked"],
  Blocked: ["Ready"],
  Done: [],
};

export function transitionTaskStatus(taskId: string, input: { status: string; actorType: string; actorId: string; reason?: string; runId?: string }) {
  const db = getDatabase();
  const now = timestamp();
  let fromStatus: string | undefined;
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db.prepare("SELECT status, obsolete_at AS obsoleteAt FROM tasks WHERE id = ?").get(taskId) as { status: string; obsoleteAt?: string | null } | undefined;
    if (!row) { db.exec("ROLLBACK"); return undefined; }
    if (row.obsoleteAt) throw new Error("Ein archiviertes, obsoletes Ticket kann nicht wieder in den Workflow verschoben werden");
    fromStatus = row.status;
    const allowedTargets = allowedMcpStatusTransitions[fromStatus] ?? [];
    if (!allowedTargets.includes(input.status)) throw new Error(`Statuswechsel von ${fromStatus} nach ${input.status} ist nicht erlaubt`);
    db.prepare("UPDATE tasks SET status = ?, retry_count = CASE WHEN ? THEN 0 ELSE retry_count END, updated_at = ? WHERE id = ?").run(input.status, fromStatus === "Blocked" && input.status === "Ready" ? 1 : 0, now, taskId);
    addEventInternal(db, taskId, "mcp.status_changed", input.actorType, input.actorId, { fromStatus, toStatus: input.status, reason: input.reason ?? "", runId: input.runId }, now);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return listTasks().find((task) => task.id === taskId);
}

export function claimNextTask(agentId = "agent-developer-1", requestedTaskId?: string, projectId?: string) {
  const db = getDatabase();
  recoverStaleAgentRuns(db);
  const now = timestamp();
  db.exec("BEGIN IMMEDIATE");
  try {
    const activeDeveloperRuns = db.prepare("SELECT COUNT(*) AS count FROM agent_runs WHERE agent_id = ? AND status IN ('queued', 'running')").get(agentId) as { count: number };
    const agent = db.prepare("SELECT max_concurrency FROM agents WHERE id = ? AND role = 'developer'").get(agentId) as { max_concurrency: number } | undefined;
    if (!agent) { db.exec("COMMIT"); return { task: undefined, reason: "unknown_agent" }; }
    if (Number(activeDeveloperRuns.count) >= Number(agent.max_concurrency)) { db.exec("COMMIT"); return { task: undefined, reason: "developer_capacity" }; }
    const nextQuery = requestedTaskId
      ? `SELECT tasks.id FROM tasks WHERE tasks.id = ? AND (? IS NULL OR tasks.project_id = ?) AND tasks.status IN ('Ready', 'Changes Requested') AND tasks.active_run_id IS NULL AND tasks.retry_count < tasks.max_retries
        AND NOT EXISTS (SELECT 1 FROM task_dependencies d JOIN tasks dependency ON dependency.id = d.depends_on_task_id WHERE d.task_id = tasks.id AND dependency.status != 'Done') LIMIT 1`
      : `SELECT tasks.id FROM tasks WHERE (? IS NULL OR tasks.project_id = ?) AND tasks.status = 'Ready' AND tasks.active_run_id IS NULL AND tasks.retry_count < tasks.max_retries
        AND NOT EXISTS (SELECT 1 FROM task_dependencies d JOIN tasks dependency ON dependency.id = d.depends_on_task_id WHERE d.task_id = tasks.id AND dependency.status != 'Done')
        ORDER BY CASE WHEN tasks.plan_id IS NOT NULL AND tasks.plan_sequence IS NOT NULL THEN 0 ELSE 1 END,
          CASE WHEN tasks.plan_id IS NOT NULL AND tasks.plan_sequence IS NOT NULL THEN tasks.plan_sequence ELSE NULL END ASC,
          CASE tasks.priority WHEN 'Urgent' THEN 0 WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END,
          tasks.created_at ASC LIMIT 1`;
    const next = (requestedTaskId ? db.prepare(nextQuery).get(requestedTaskId, projectId ?? null, projectId ?? null) : db.prepare(nextQuery).get(projectId ?? null, projectId ?? null)) as { id: string } | undefined;
    if (!next) { db.exec("COMMIT"); return { task: undefined, reason: requestedTaskId ? "task_not_ready" : "no_ready_task" }; }
    const runId = id("run");
    const previousAttempt = db.prepare("SELECT COALESCE(MAX(attempt_no), 0) AS attemptNo FROM agent_runs WHERE task_id = ? AND role = 'developer'").get(next.id) as Row;
    const attemptNo = Number(previousAttempt.attemptNo ?? 0) + 1;
    const claimed = db.prepare("UPDATE tasks SET status = 'In Progress', assignee_agent_id = ?, active_run_id = ?, updated_at = ? WHERE id = ? AND status IN ('Ready', 'Changes Requested') AND active_run_id IS NULL").run(agentId, runId, now, next.id);
    if (Number(claimed.changes) !== 1) throw new Error(`Ticket ${next.id} konnte nicht atomar reserviert werden`);
    db.prepare("INSERT INTO agent_runs (id, task_id, agent_id, role, status, attempt_no, input_json, created_at, started_at) VALUES (?, ?, ?, 'developer', 'running', ?, '{}', ?, ?)").run(runId, next.id, agentId, attemptNo, now, now);
    db.prepare("INSERT INTO agent_leases (id, task_id, agent_id, run_id, acquired_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)").run(id("lease"), next.id, agentId, runId, now, new Date(Date.now() + leaseDurationMs()).toISOString());
    addEventInternal(db, next.id, "task.claimed", "manager", "agent-manager", { runId, agentId }, now);
    db.exec("COMMIT");
    return { task: listTasks(projectId).find((task) => task.id === next.id), runId };
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function getAgentRun(runId: string) {
  const db = getDatabase();
  const row = db.prepare(`SELECT agent_runs.id AS runId, agent_runs.task_id AS taskId, agent_runs.agent_id AS agentId,
    agent_runs.role, agent_runs.status, agent_runs.attempt_no AS attemptNo, agent_runs.input_json AS inputJson,
    agent_runs.output_json AS outputJson, agent_runs.summary, agent_runs.error, agent_runs.process_id AS processId, agent_runs.started_at AS startedAt,
    agent_runs.finished_at AS finishedAt, agents.name AS agentName, agents.provider
    FROM agent_runs JOIN agents ON agents.id = agent_runs.agent_id WHERE agent_runs.id = ?`).get(runId) as Row | undefined;
  if (!row) return undefined;
  return { ...row, task: listTasks().find((task) => task.id === row.taskId) };
}

export function listAgentRuns(taskId?: string, projectId?: string) {
  const db = getDatabase();
  recoverStaleAgentRuns(db);
  const rows = db.prepare(`SELECT agent_runs.id AS runId, agent_runs.task_id AS taskId, agent_runs.agent_id AS agentId,
    agent_runs.role, agent_runs.status, agent_runs.attempt_no AS attemptNo, agent_runs.summary, agent_runs.error, agent_runs.process_id AS processId,
    agent_runs.started_at AS startedAt, agent_runs.finished_at AS finishedAt, agent_runs.created_at AS createdAt,
    agents.name AS agentName, agents.provider
    FROM agent_runs JOIN agents ON agents.id = agent_runs.agent_id JOIN tasks ON tasks.id = agent_runs.task_id
    WHERE (? IS NULL OR agent_runs.task_id = ?)
      AND (? IS NULL OR tasks.project_id = ?)
    ORDER BY agent_runs.created_at DESC, agent_runs.id DESC`).all(taskId ?? null, taskId ?? null, projectId ?? null, projectId ?? null) as Row[];
  return rows;
}

export function setAgentRunProcessId(runId: string, processId?: number) {
  const db = getDatabase();
  db.prepare("UPDATE agent_runs SET process_id = ? WHERE id = ? AND status IN ('queued', 'running')").run(processId ?? null, runId);
  return getAgentRun(runId);
}

export function renewAgentRunLease(runId: string) {
  const db = getDatabase();
  const now = timestamp();
  const expiresAt = new Date(Date.now() + leaseDurationMs()).toISOString();
  const result = db.prepare(`UPDATE agent_leases SET expires_at = ?
    WHERE run_id = ?
      AND EXISTS (SELECT 1 FROM agent_runs WHERE agent_runs.id = agent_leases.run_id AND agent_runs.status IN ('queued', 'running'))
      AND EXISTS (SELECT 1 FROM tasks WHERE tasks.id = agent_leases.task_id AND tasks.active_run_id = agent_leases.run_id)`).run(expiresAt, runId);
  if (Number(result.changes) > 0) {
    db.prepare("UPDATE agent_runs SET started_at = COALESCE(started_at, ?) WHERE id = ?").run(now, runId);
  }
  return { renewed: Number(result.changes) > 0, expiresAt };
}

export function startTesterRun(taskId: string, agentId = "agent-tester-1", projectId?: string) {
  const db = getDatabase();
  recoverStaleAgentRuns(db);
  const now = timestamp();
  db.exec("BEGIN IMMEDIATE");
  try {
    const agent = db.prepare("SELECT max_concurrency FROM agents WHERE id = ? AND role = 'tester'").get(agentId) as { max_concurrency: number } | undefined;
    if (!agent) { db.exec("COMMIT"); return { runId: undefined, reason: "unknown_tester" }; }
    const active = db.prepare("SELECT COUNT(*) AS count FROM agent_runs WHERE agent_id = ? AND status IN ('queued', 'running')").get(agentId) as { count: number };
    if (Number(active.count) >= Number(agent.max_concurrency)) { db.exec("COMMIT"); return { runId: undefined, reason: "tester_capacity" }; }
    const task = db.prepare("SELECT id, project_id, status, active_run_id FROM tasks WHERE id = ? AND (? IS NULL OR project_id = ?)").get(taskId, projectId ?? null, projectId ?? null) as Row | undefined;
    if (!task) { db.exec("COMMIT"); return { runId: undefined, reason: "task_not_found" }; }
    if (task.status !== "Review" || task.active_run_id) { db.exec("COMMIT"); return { runId: undefined, reason: "task_not_ready_for_testing" }; }
    const runId = id("run");
    const previousAttempt = db.prepare(`SELECT COALESCE(MAX(tester.attempt_no), 0) AS attemptNo
      FROM agent_runs AS tester
      WHERE tester.task_id = ? AND tester.role = 'tester'
        AND tester.created_at > COALESCE((SELECT MAX(developer.created_at) FROM agent_runs AS developer WHERE developer.task_id = ? AND developer.role = 'developer'), '')`).get(taskId, taskId) as Row;
    const attemptNo = Number(previousAttempt.attemptNo ?? 0) + 1;
    db.prepare("INSERT INTO agent_runs (id, task_id, agent_id, role, status, attempt_no, input_json, created_at, started_at) VALUES (?, ?, ?, 'tester', 'running', ?, '{}', ?, ?)").run(runId, taskId, agentId, attemptNo, now, now);
    db.prepare("INSERT INTO agent_leases (id, task_id, agent_id, run_id, acquired_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)").run(id("lease"), taskId, agentId, runId, now, new Date(Date.now() + leaseDurationMs()).toISOString());
    db.prepare("UPDATE tasks SET status = 'Testing', assignee_agent_id = ?, active_run_id = ?, updated_at = ? WHERE id = ? AND status = 'Review' AND active_run_id IS NULL").run(agentId, runId, now, taskId);
    addEventInternal(db, taskId, "tester.run_started", "manager", "agent-manager", { runId, agentId }, now);
    db.exec("COMMIT");
    return { runId, task: listTasks().find((taskItem) => taskItem.id === taskId) };
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function recoverTesterRun(runId: string, input: { summary?: string; error?: string; countRecovery?: boolean } = {}) {
  const db = getDatabase();
  const now = timestamp();
  const summary = input.summary ?? "Der Testerprozess wurde unerwartet beendet. Ein Neustart ist möglich.";
  let finishedTaskId: string | undefined;
  db.exec("BEGIN IMMEDIATE");
  try {
    const run = db.prepare("SELECT id, task_id AS taskId, attempt_no AS attemptNo FROM agent_runs WHERE id = ? AND role = 'tester' AND status IN ('queued', 'running')").get(runId) as Row | undefined;
    if (!run) { db.exec("ROLLBACK"); return undefined; }
    finishedTaskId = String(run.taskId);
    const exhausted = input.countRecovery !== false && Number(run.attemptNo) >= testerRecoveryLimit();
    const nextStatus = exhausted ? "Blocked" : "Review";
    const finalSummary = exhausted ? `${summary} Die automatische Recovery-Grenze wurde erreicht.` : summary;
    const reportId = id("report");
    db.prepare("UPDATE agent_runs SET status = 'blocked', summary = ?, error = ?, process_id = NULL, finished_at = ? WHERE id = ?").run(finalSummary, input.error ?? finalSummary, now, runId);
    db.prepare("INSERT INTO test_reports (id, task_id, agent_run_id, status, summary, checks_json, logs, created_at) VALUES (?, ?, ?, 'blocked', ?, '[]', '', ?)").run(reportId, run.taskId, runId, finalSummary, now);
    db.prepare("DELETE FROM agent_leases WHERE run_id = ?").run(runId);
    db.prepare("UPDATE tasks SET status = ?, active_run_id = NULL, assignee_agent_id = NULL, updated_at = ? WHERE id = ? AND active_run_id = ?").run(nextStatus, now, run.taskId, runId);
    addCommentInternal(db, String(run.taskId), "tester", "agent-tester-1", "QA Bot", `${finalSummary}${exhausted ? "" : " Ein Neustart ist möglich."}`, now);
    addEventInternal(db, String(run.taskId), "tester.run_recovered", "manager", "agent-manager", { runId, reportId, summary: finalSummary, nextStatus, exhausted }, now);
    db.prepare("UPDATE agent_requests SET status = 'failed', finished_at = ?, duration_ms = MAX(0, CAST((julianday(?) - julianday(started_at)) * 86400000 AS INTEGER)), error = COALESCE(error, ?) WHERE run_id = ? AND status = 'running'").run(now, now, input.error ?? summary, runId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return listTasks().find((task) => task.id === finishedTaskId);
}

export function finishTesterRun(runId: string, input: { status: "passed" | "failed" | "blocked"; summary?: string; logs?: string; checks?: unknown[]; error?: string }) {
  const db = getDatabase();
  const now = timestamp();
  let finishedTaskId: string | undefined;
  db.exec("BEGIN IMMEDIATE");
  try {
    const run = db.prepare("SELECT task_id FROM agent_runs WHERE id = ? AND role = 'tester' AND status IN ('queued', 'running')").get(runId) as { task_id: string } | undefined;
    if (!run) { db.exec("ROLLBACK"); return undefined; }
    finishedTaskId = run.task_id;
    const nextStatus = input.status === "passed" ? "Done" : input.status === "blocked" ? "Blocked" : "Changes Requested";
    const reportId = id("report");
    db.prepare("UPDATE agent_runs SET status = ?, summary = ?, output_json = ?, error = ?, process_id = NULL, finished_at = ? WHERE id = ?").run(input.status === "passed" ? "succeeded" : input.status === "blocked" ? "blocked" : "failed", input.summary ?? "", JSON.stringify({ checks: input.checks ?? [], logs: input.logs ?? "" }), input.error ?? null, now, runId);
    db.prepare("INSERT INTO test_reports (id, task_id, agent_run_id, status, summary, checks_json, logs, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(reportId, run.task_id, runId, input.status, input.summary ?? "", JSON.stringify(input.checks ?? []), input.logs ?? "", now);
    db.prepare("DELETE FROM agent_leases WHERE run_id = ?").run(runId);
    db.prepare("UPDATE tasks SET status = ?, active_run_id = NULL, updated_at = ? WHERE id = ? AND active_run_id = ?").run(nextStatus, now, run.task_id, runId);
    addCommentInternal(db, run.task_id, "tester", "agent-tester-1", "QA Bot", input.summary ?? `Testergebnis: ${input.status}`, now);
    addEventInternal(db, run.task_id, "tester.run_finished", "tester", "agent-tester-1", { runId, status: input.status, nextStatus, reportId }, now);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return listTasks().find((task) => task.id === finishedTaskId);
}

/**
 * Retire an incorrectly-created ticket without deleting its evidence. Retired
 * tickets cannot be claimed, retain every existing run/comment/event, and get
 * an explicit audit event explaining why they left the active workflow.
 */
export function archiveObsoleteTask(taskId: string, reason: string, actorId = "agent-manager") {
  const db = getDatabase();
  const now = timestamp();
  const explanation = reason.trim();
  if (!explanation) throw new Error("Ein Grund für die Archivierung ist erforderlich");
  db.exec("BEGIN IMMEDIATE");
  try {
    const task = db.prepare("SELECT id, active_run_id AS activeRunId, obsolete_at AS obsoleteAt FROM tasks WHERE id = ?").get(taskId) as Row | undefined;
    if (!task) { db.exec("ROLLBACK"); return undefined; }
    if (task.obsoleteAt) {
      db.prepare("UPDATE tasks SET status = 'Done', assignee_agent_id = NULL, updated_at = ? WHERE id = ?").run(now, taskId);
      db.exec("COMMIT");
      return listTasks().find((item) => item.id === taskId);
    }
    if (task.activeRunId) {
      db.exec("ROLLBACK");
      throw new Error(`Ticket ${taskId} hat noch einen aktiven Lauf und kann nicht archiviert werden`);
    }
    db.prepare("UPDATE tasks SET status = 'Done', obsolete_at = COALESCE(obsolete_at, ?), obsolete_reason = ?, assignee_agent_id = NULL, updated_at = ? WHERE id = ?").run(now, explanation, now, taskId);
    addCommentInternal(db, taskId, "manager", actorId, "Mira", `Als obsolet abgeschlossen: ${explanation}`, now);
    addEventInternal(db, taskId, "task.archived_obsolete", "manager", actorId, { reason: explanation, preservedHistory: true }, now);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return listTasks().find((task) => task.id === taskId);
}

/**
 * Moves the original ticket back to Review once every generated follow-up
 * ticket for the same tester run/source ticket is complete.
 *
 * This deliberately only changes a ticket that is still in Changes Requested
 * and has no active run. Starting the next tester process belongs to the
 * orchestration layer, not to the database layer.
 */
export function resumeSourceTaskAfterFollowUp(followUpTaskId: string) {
  const db = getDatabase();
  const now = timestamp();
  let sourceTaskId: string | undefined;
  let projectId: string | undefined;
  db.exec("BEGIN IMMEDIATE");
  try {
    const followUp = db.prepare("SELECT id, project_id AS projectId, status, origin_key AS originKey FROM tasks WHERE id = ?").get(followUpTaskId) as Row | undefined;
    if (!followUp || followUp.status !== "Done" || !String(followUp.originKey ?? "").startsWith("follow-up:")) {
      db.exec("ROLLBACK");
      return undefined;
    }
    sourceTaskId = String(followUp.originKey).slice("follow-up:".length).split(":", 1)[0];
    projectId = String(followUp.projectId);
    if (!sourceTaskId) {
      db.exec("ROLLBACK");
      return undefined;
    }
    const linkedFollowUps = db.prepare(`SELECT id, status
      FROM tasks
      WHERE project_id = ? AND origin_key LIKE 'follow-up:' || ? || ':%'
      ORDER BY created_at ASC, id ASC`).all(projectId, sourceTaskId) as Row[];
    if (!linkedFollowUps.length || linkedFollowUps.some((task) => task.status !== "Done")) {
      db.exec("ROLLBACK");
      return undefined;
    }
    const source = db.prepare("SELECT id, status, active_run_id AS activeRunId FROM tasks WHERE id = ? AND project_id = ?").get(sourceTaskId, projectId) as Row | undefined;
    if (!source || source.status !== "Changes Requested" || source.activeRunId) {
      db.exec("ROLLBACK");
      return undefined;
    }
    db.prepare("UPDATE tasks SET status = 'Review', updated_at = ? WHERE id = ? AND project_id = ? AND status = 'Changes Requested' AND active_run_id IS NULL").run(now, sourceTaskId, projectId);
    addCommentInternal(db, sourceTaskId, "manager", "agent-manager", "Mira", `Alle verknüpften Folgeaufgaben (${linkedFollowUps.map((task) => task.id).join(", ")}) sind erledigt. Das ursprüngliche Ticket wurde automatisch zurück in Review gesetzt.`, now);
    addEventInternal(db, sourceTaskId, "workflow.follow_up_completed", "manager", "agent-manager", {
      followUpTaskId,
      followUpTaskIds: linkedFollowUps.map((task) => task.id),
      status: "Review",
    }, now);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return listTasks(projectId).find((task) => task.id === sourceTaskId);
}

export function finishAgentRun(runId: string, input: { status: "succeeded" | "failed"; summary?: string; error?: string; nextStatus?: string; countRetry?: boolean }) {
  const db = getDatabase();
  const now = timestamp();
  let finishedTaskId: string | undefined;
  db.exec("BEGIN IMMEDIATE");
  try {
    const run = db.prepare(`SELECT runs.task_id AS taskId, runs.status, tasks.retry_count AS retryCount, tasks.max_retries AS maxRetries
      FROM agent_runs AS runs JOIN tasks ON tasks.id = runs.task_id WHERE runs.id = ?`).get(runId) as Row | undefined;
    if (!run) { db.exec("ROLLBACK"); return undefined; }
    finishedTaskId = String(run.taskId);
    if (!["queued", "running"].includes(String(run.status))) {
      db.exec("COMMIT");
      return listTasks().find((task) => task.id === finishedTaskId);
    }
    const countRetry = input.status === "failed" && input.countRetry !== false;
    const retryCount = input.status === "succeeded" ? 0 : Number(run.retryCount ?? 0) + (countRetry ? 1 : 0);
    const exhausted = input.status === "failed" && countRetry && retryCount >= Number(run.maxRetries ?? 3);
    const nextStatus = exhausted ? "Blocked" : input.nextStatus ?? (input.status === "succeeded" ? "Review" : "Ready");
    db.prepare("UPDATE agent_runs SET status = ?, summary = ?, error = ?, process_id = NULL, finished_at = ? WHERE id = ?").run(input.status, input.summary ?? "", input.error ?? null, now, runId);
    db.prepare("DELETE FROM agent_leases WHERE run_id = ?").run(runId);
    db.prepare("UPDATE agent_requests SET status = ?, finished_at = ?, duration_ms = MAX(0, CAST((julianday(?) - julianday(started_at)) * 86400000 AS INTEGER)), error = COALESCE(error, ?) WHERE run_id = ? AND status = 'running'").run(input.status === "succeeded" ? "succeeded" : "failed", now, now, input.error ?? input.summary ?? "Agentenlauf beendet", runId);
    db.prepare("UPDATE tasks SET status = ?, retry_count = ?, active_run_id = NULL, assignee_agent_id = NULL, updated_at = ? WHERE id = ? AND active_run_id = ?").run(nextStatus, retryCount, now, run.taskId, runId);
    addEventInternal(db, String(run.taskId), "agent.run_finished", "agent", runId, { status: input.status, nextStatus, retryCount, exhausted, summary: input.summary ?? "" }, now);
    if (exhausted) addCommentInternal(db, String(run.taskId), "manager", "agent-manager", "Mira", `Der Entwicklerlauf ist ${retryCount}-mal fehlgeschlagen. Das Ticket wurde nach Erreichen der Retry-Grenze blockiert.`, now);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return listTasks().find((task) => task.id === finishedTaskId);
}

export function listChatMessages(limit?: number, projectId?: string) {
  const db = getDatabase();
  const rows = (limit && limit > 0
    ? db.prepare("SELECT id, sender_type AS senderType, body, created_at AS createdAt FROM chat_messages WHERE (? IS NULL OR project_id = ?) ORDER BY created_at DESC, id DESC LIMIT ?").all(projectId ?? null, projectId ?? null, limit)
    : db.prepare("SELECT id, sender_type AS senderType, body, created_at AS createdAt FROM chat_messages WHERE (? IS NULL OR project_id = ?) ORDER BY created_at ASC, id ASC").all(projectId ?? null, projectId ?? null)) as Row[];
  const orderedRows = limit && limit > 0 ? rows.reverse() : rows;
  return orderedRows.map((row) => ({ id: row.id, sender: row.senderType === "user" ? "Du" : "Manager", text: row.body }));
}

export function addChatMessage(input: { senderType: "user" | "manager"; body: string; projectId?: string }) {
  const db = getDatabase();
  const projectId = input.projectId ?? "project-agent-harness";
  if (!getProject(projectId)) throw new Error("Projekt wurde nicht gefunden");
  db.prepare("INSERT INTO chat_messages (id, project_id, sender_type, sender_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(id("chat"), projectId, input.senderType, input.senderType === "manager" ? "agent-manager" : "owner", input.body.trim(), timestamp());
  return listChatMessages(undefined, projectId).at(-1);
}

export function databaseHealth() {
  const db = getDatabase();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Row[];
  const counts = db.prepare("SELECT (SELECT COUNT(*) FROM tasks) AS tasks, (SELECT COUNT(*) FROM comments) AS comments, (SELECT COUNT(*) FROM agent_runs) AS agentRuns, (SELECT COUNT(*) FROM task_events) AS events, (SELECT COUNT(*) FROM chat_messages) AS chatMessages").get() as Row;
  db.exec("PRAGMA optimize");
  return { path: databasePath, tables: tables.map((table) => table.name), counts };
}

type ManagerQuestionInput = { id: string; question: string; options?: string[]; required?: boolean };
type ManagerPlanTaskInput = {
  clientId: string;
  title: string;
  sequence?: number;
  description?: string;
  priority?: string;
  acceptance?: string[];
  parentClientId?: string;
  parentTaskId?: string;
  dependsOnClientIds?: string[];
  sourceTaskId?: string;
  sourceRunId?: string;
  sourceReportId?: string;
  originKey?: string;
};

function parseStoredJson<T>(value: unknown, fallback: T): T {
  try {
    const parsed = JSON.parse(String(value ?? ""));
    return parsed as T;
  } catch {
    return fallback;
  }
}

function json(value: unknown) {
  return JSON.stringify(value ?? null);
}

function planTaskRows(db: DatabaseSync, planId: string) {
  return db.prepare(`SELECT id, plan_id AS planId, client_id AS clientId, kind, title, description, priority, sequence,
    acceptance_json AS acceptanceJson, parent_client_id AS parentClientId, parent_task_id AS parentTaskId,
    depends_on_client_ids_json AS dependsOnClientIdsJson, metadata_json AS metadataJson, sort_order AS sortOrder,
    task_id AS taskId, created_at AS createdAt, updated_at AS updatedAt
    FROM manager_plan_tasks WHERE plan_id = ? ORDER BY sequence ASC, sort_order ASC, id ASC`).all(planId) as Row[];
}

function mapManagerPlan(db: DatabaseSync, row: Row) {
  const planTasks = planTaskRows(db, String(row.id)).map((task) => ({
    id: task.id,
    clientId: task.clientId,
    kind: task.kind,
    title: task.title,
    description: task.description,
    priority: task.priority,
    sequence: Number(task.sequence ?? task.sortOrder ?? 0),
    acceptance: parseStoredJson<string[]>(task.acceptanceJson, []),
    parentClientId: task.parentClientId ?? null,
    parentTaskId: task.parentTaskId ?? null,
    dependsOnClientIds: parseStoredJson<string[]>(task.dependsOnClientIdsJson, []),
    metadata: parseStoredJson<Record<string, unknown>>(task.metadataJson, {}),
    sortOrder: Number(task.sortOrder ?? 0),
    taskId: task.taskId ?? null,
  }));
  const progress = db.prepare(`SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN tasks.status = 'Done' THEN 1 ELSE 0 END) AS done,
      SUM(CASE WHEN tasks.status = 'Blocked' THEN 1 ELSE 0 END) AS blocked,
      SUM(CASE WHEN tasks.status IN ('In Progress', 'Review', 'Testing') THEN 1 ELSE 0 END) AS active
    FROM manager_plan_tasks
    LEFT JOIN tasks ON tasks.id = manager_plan_tasks.task_id
    WHERE manager_plan_tasks.plan_id = ?`).get(row.id) as Row;
  const total = Number(progress.total ?? 0);
  const done = Number(progress.done ?? 0);
  return {
    id: row.id,
    projectId: row.projectId,
    conversationId: row.conversationId ?? null,
    analysisSnapshotId: row.analysisSnapshotId ?? null,
    status: row.status,
    title: row.title,
    summary: row.summary,
    assumptions: parseStoredJson<string[]>(row.assumptionsJson, []),
    risks: parseStoredJson<string[]>(row.risksJson, []),
    actions: parseStoredJson<Record<string, unknown>[]>(row.actionsJson, []),
    tasks: planTasks,
    progress: { total, done, blocked: Number(progress.blocked ?? 0), active: Number(progress.active ?? 0), percent: total ? Math.round((done / total) * 100) : 0 },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    confirmedAt: row.confirmedAt ?? null,
    appliedAt: row.appliedAt ?? null,
  };
}

export function getManagerPlan(planId: string) {
  const db = getDatabase();
  const row = db.prepare(`SELECT id, project_id AS projectId, conversation_id AS conversationId,
    analysis_snapshot_id AS analysisSnapshotId, status, title, summary, assumptions_json AS assumptionsJson,
    risks_json AS risksJson, actions_json AS actionsJson, created_at AS createdAt, updated_at AS updatedAt,
    confirmed_at AS confirmedAt, applied_at AS appliedAt FROM manager_plans WHERE id = ?`).get(planId) as Row | undefined;
  return row ? mapManagerPlan(db, row) : undefined;
}

export function listManagerPlans(projectId: string, limit = 20) {
  const db = getDatabase();
  const rows = db.prepare(`SELECT id, project_id AS projectId, conversation_id AS conversationId,
    analysis_snapshot_id AS analysisSnapshotId, status, title, summary, assumptions_json AS assumptionsJson,
    risks_json AS risksJson, actions_json AS actionsJson, created_at AS createdAt, updated_at AS updatedAt,
    confirmed_at AS confirmedAt, applied_at AS appliedAt FROM manager_plans WHERE project_id = ?
    ORDER BY updated_at DESC, id DESC LIMIT ?`).all(projectId, Math.max(1, Math.min(limit, 100))) as Row[];
  return rows.map((row) => mapManagerPlan(db, row));
}

export function getLatestManagerPlan(projectId: string) {
  return listManagerPlans(projectId, 1)[0];
}

function mapConversation(db: DatabaseSync, row: Row) {
  const questions = (db.prepare(`SELECT id, question_key AS questionKey, question, options_json AS optionsJson,
    required, answer, answered_at AS answeredAt, created_at AS createdAt FROM manager_questions
    WHERE conversation_id = ? ORDER BY created_at ASC, id ASC`).all(row.id) as Row[]).map((question) => ({
    id: question.questionKey,
    recordId: question.id,
    question: question.question,
    options: parseStoredJson<string[]>(question.optionsJson, []),
    required: Boolean(question.required),
    answer: question.answer ?? null,
    answeredAt: question.answeredAt ?? null,
    createdAt: question.createdAt,
  }));
  const plan = db.prepare(`SELECT id, project_id AS projectId, conversation_id AS conversationId,
    analysis_snapshot_id AS analysisSnapshotId, status, title, summary, assumptions_json AS assumptionsJson,
    risks_json AS risksJson, actions_json AS actionsJson, created_at AS createdAt, updated_at AS updatedAt,
    confirmed_at AS confirmedAt, applied_at AS appliedAt FROM manager_plans WHERE conversation_id = ?
    ORDER BY updated_at DESC, id DESC LIMIT 1`).get(row.id) as Row | undefined;
  return {
    id: row.id,
    projectId: row.projectId,
    status: row.status,
    mode: row.mode,
    summary: row.summary,
    latestReply: row.latestReply,
    questions,
    plan: plan ? mapManagerPlan(db, plan) : undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt ?? null,
  };
}

export function getManagerConversation(conversationId: string) {
  const db = getDatabase();
  const row = db.prepare(`SELECT id, project_id AS projectId, status, mode, summary, latest_reply AS latestReply,
    created_at AS createdAt, updated_at AS updatedAt, completed_at AS completedAt FROM manager_conversations WHERE id = ?`).get(conversationId) as Row | undefined;
  return row ? mapConversation(db, row) : undefined;
}

export function createManagerConversation(projectId: string, input: { mode?: string; summary?: string } = {}) {
  const db = getDatabase();
  if (!getProject(projectId)) throw new Error("Projekt wurde nicht gefunden");
  const now = timestamp();
  const conversationId = id("conversation");
  db.prepare(`INSERT INTO manager_conversations (id, project_id, status, mode, summary, latest_reply, created_at, updated_at)
    VALUES (?, ?, 'open', ?, ?, '', ?, ?)`).run(conversationId, projectId, input.mode ?? "status", input.summary?.trim() ?? "", now, now);
  return getManagerConversation(conversationId)!;
}

export function findActiveManagerConversation(projectId: string) {
  const db = getDatabase();
  const row = db.prepare(`SELECT id, project_id AS projectId, status, mode, summary, latest_reply AS latestReply,
    created_at AS createdAt, updated_at AS updatedAt, completed_at AS completedAt FROM manager_conversations
    WHERE project_id = ? AND status IN ('open', 'needs_input') ORDER BY updated_at DESC, id DESC LIMIT 1`).get(projectId) as Row | undefined;
  return row ? mapConversation(db, row) : undefined;
}

export function resolveManagerConversation(projectId: string, conversationId?: string) {
  if (conversationId) {
    const conversation = getManagerConversation(conversationId);
    if (!conversation || conversation.projectId !== projectId) throw new Error("Manager-Gespräch gehört nicht zum aktiven Projekt");
    return conversation;
  }
  return findActiveManagerConversation(projectId) ?? createManagerConversation(projectId);
}

export function addManagerConversationEntry(conversationId: string, input: { senderType: "user" | "manager" | "system"; body?: string; payload?: unknown }) {
  const db = getDatabase();
  const conversation = getManagerConversation(conversationId);
  if (!conversation) throw new Error("Manager-Gespräch wurde nicht gefunden");
  const now = timestamp();
  db.prepare(`INSERT INTO manager_conversation_entries (id, conversation_id, sender_type, body, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(id("conversation-entry"), conversationId, input.senderType, input.body?.trim() ?? "", json(input.payload ?? {}), now);
  db.prepare("UPDATE manager_conversations SET updated_at = ? WHERE id = ?").run(now, conversationId);
}

export function listManagerConversationEntries(conversationId: string, limit = 100) {
  const db = getDatabase();
  return (db.prepare(`SELECT id, sender_type AS senderType, body, payload_json AS payloadJson, created_at AS createdAt
    FROM manager_conversation_entries WHERE conversation_id = ? ORDER BY created_at ASC, id ASC LIMIT ?`).all(conversationId, Math.max(1, Math.min(limit, 250))) as Row[]).map((entry) => ({
    id: entry.id,
    senderType: entry.senderType,
    body: entry.body,
    payload: parseStoredJson<Record<string, unknown>>(entry.payloadJson, {}),
    createdAt: entry.createdAt,
  }));
}

export function saveManagerQuestions(conversationId: string, questions: ManagerQuestionInput[]) {
  const db = getDatabase();
  const now = timestamp();
  db.exec("BEGIN IMMEDIATE");
  try {
    const conversation = db.prepare("SELECT id FROM manager_conversations WHERE id = ?").get(conversationId);
    if (!conversation) throw new Error("Manager-Gespräch wurde nicht gefunden");
    const insert = db.prepare(`INSERT INTO manager_questions (id, conversation_id, question_key, question, options_json, required, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(conversation_id, question_key) DO UPDATE SET
      question = excluded.question, options_json = excluded.options_json, required = excluded.required`);
    for (const question of questions) {
      insert.run(id("question"), conversationId, question.id, question.question.trim(), json(question.options ?? []), question.required === false ? 0 : 1, now);
    }
    db.prepare("UPDATE manager_conversations SET status = 'needs_input', updated_at = ? WHERE id = ?").run(now, conversationId);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return getManagerConversation(conversationId)!;
}

export function answerManagerQuestions(conversationId: string, answers: Record<string, string>) {
  const db = getDatabase();
  const now = timestamp();
  db.exec("BEGIN IMMEDIATE");
  try {
    const questions = db.prepare("SELECT question_key, required FROM manager_questions WHERE conversation_id = ?").all(conversationId) as Row[];
    if (!questions.length) throw new Error("Für dieses Gespräch sind keine Fragen offen");
    const allowed = new Set(questions.map((question) => String(question.question_key)));
    for (const [questionId, answer] of Object.entries(answers)) {
      if (!allowed.has(questionId)) throw new Error(`Unbekannte Rückfrage: ${questionId}`);
      const cleanAnswer = String(answer ?? "").trim();
      if (!cleanAnswer) throw new Error("Antworten dürfen nicht leer sein");
      db.prepare("UPDATE manager_questions SET answer = ?, answered_at = ? WHERE conversation_id = ? AND question_key = ?").run(cleanAnswer, now, conversationId, questionId);
    }
    const missing = db.prepare("SELECT COUNT(*) AS count FROM manager_questions WHERE conversation_id = ? AND required = 1 AND (answer IS NULL OR trim(answer) = '')").get(conversationId) as Row;
    db.prepare("UPDATE manager_conversations SET status = ?, updated_at = ? WHERE id = ?").run(Number(missing.count ?? 0) ? "needs_input" : "open", now, conversationId);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  const conversation = getManagerConversation(conversationId)!;
  addManagerConversationEntry(conversationId, { senderType: "user", body: "Rückfragen beantwortet.", payload: { answers } });
  return conversation;
}

export function updateManagerConversation(conversationId: string, patch: { status?: string; mode?: string; summary?: string; latestReply?: string }) {
  const db = getDatabase();
  const conversation = getManagerConversation(conversationId);
  if (!conversation) return undefined;
  const now = timestamp();
  const completedAt = patch.status === "completed" || patch.status === "failed" ? now : null;
  db.prepare(`UPDATE manager_conversations SET status = COALESCE(?, status), mode = COALESCE(?, mode),
    summary = COALESCE(?, summary), latest_reply = COALESCE(?, latest_reply), updated_at = ?,
    completed_at = COALESCE(?, completed_at) WHERE id = ?`).run(
    patch.status ?? null, patch.mode ?? null, patch.summary?.trim() ?? null, patch.latestReply?.trim() ?? null, now, completedAt, conversationId,
  );
  return getManagerConversation(conversationId);
}

export function createProjectAnalysisSnapshot(projectId: string, input: { status: string; summary: string; snapshot: unknown }) {
  const db = getDatabase();
  if (!getProject(projectId)) throw new Error("Projekt wurde nicht gefunden");
  const snapshotId = id("analysis");
  db.prepare(`INSERT INTO project_analysis_snapshots (id, project_id, status, summary, snapshot_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(snapshotId, projectId, input.status, input.summary.trim(), json(input.snapshot), timestamp());
  return getProjectAnalysisSnapshot(snapshotId)!;
}

export function getProjectAnalysisSnapshot(snapshotId: string) {
  const db = getDatabase();
  const row = db.prepare(`SELECT id, project_id AS projectId, status, summary, snapshot_json AS snapshotJson, created_at AS createdAt
    FROM project_analysis_snapshots WHERE id = ?`).get(snapshotId) as Row | undefined;
  return row ? { id: row.id, projectId: row.projectId, status: row.status, summary: row.summary, snapshot: parseStoredJson<Record<string, unknown>>(row.snapshotJson, {}), createdAt: row.createdAt } : undefined;
}

export function getLatestProjectAnalysisSnapshot(projectId: string) {
  const db = getDatabase();
  const row = db.prepare(`SELECT id, project_id AS projectId, status, summary, snapshot_json AS snapshotJson, created_at AS createdAt
    FROM project_analysis_snapshots WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`).get(projectId) as Row | undefined;
  return row ? { id: row.id, projectId: row.projectId, status: row.status, summary: row.summary, snapshot: parseStoredJson<Record<string, unknown>>(row.snapshotJson, {}), createdAt: row.createdAt } : undefined;
}

function extractPlanTasks(actions: Record<string, unknown>[]) {
  const result: Array<ManagerPlanTaskInput & { kind: string }> = [];
  for (const action of actions) {
    const kind = String(action.type ?? "");
    if (kind !== "create_tasks" && kind !== "create_follow_up_tasks") continue;
    const actionTasks = Array.isArray(action.tasks) ? action.tasks : [];
    for (const task of actionTasks) {
      if (!task || typeof task !== "object") continue;
      const item = task as Record<string, unknown>;
      result.push({
        kind,
        clientId: String(item.clientId ?? "").trim(),
        title: String(item.title ?? "").trim(),
        sequence: Number.isInteger(item.sequence) && Number(item.sequence) > 0 ? Number(item.sequence) : (result.length + 1) * 10,
        description: String(item.description ?? "").trim(),
        priority: String(item.priority ?? "Medium"),
        acceptance: Array.isArray(item.acceptance) ? item.acceptance.map((criterion) => String(criterion).trim()).filter(Boolean) : [],
        parentClientId: typeof item.parentClientId === "string" ? item.parentClientId.trim() : undefined,
        parentTaskId: typeof item.parentTaskId === "string" ? item.parentTaskId.trim() : undefined,
        dependsOnClientIds: Array.isArray(item.dependsOnClientIds) ? item.dependsOnClientIds.map((value) => String(value).trim()).filter(Boolean) : [],
        sourceTaskId: typeof item.sourceTaskId === "string" ? item.sourceTaskId.trim() : undefined,
        sourceRunId: typeof item.sourceRunId === "string" ? item.sourceRunId.trim() : undefined,
        sourceReportId: typeof item.sourceReportId === "string" ? item.sourceReportId.trim() : undefined,
        originKey: typeof item.originKey === "string" ? item.originKey.trim() : undefined,
      });
    }
  }
  return result;
}

export function createManagerPlan(input: {
  projectId: string;
  conversationId?: string;
  analysisSnapshotId?: string;
  title?: string;
  summary?: string;
  assumptions?: string[];
  risks?: string[];
  actions: Record<string, unknown>[];
}) {
  const db = getDatabase();
  if (!getProject(input.projectId)) throw new Error("Projekt wurde nicht gefunden");
  if (input.conversationId) {
    const conversation = getManagerConversation(input.conversationId);
    if (!conversation || conversation.projectId !== input.projectId) throw new Error("Manager-Gespräch gehört nicht zum Projekt");
  }
  if (input.analysisSnapshotId) {
    const snapshot = getProjectAnalysisSnapshot(input.analysisSnapshotId);
    if (!snapshot || snapshot.projectId !== input.projectId) throw new Error("Analyse-Snapshot gehört nicht zum Projekt");
  }
  const now = timestamp();
  const planId = id("plan");
  const tasks = extractPlanTasks(input.actions);
  const clientIds = new Set<string>();
  for (const task of tasks) {
    if (!task.clientId || !task.title) throw new Error("Jeder Ticketentwurf benötigt clientId und Titel");
    if (clientIds.has(task.clientId)) throw new Error(`clientId ${task.clientId} ist im Plan doppelt`);
    clientIds.add(task.clientId);
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`INSERT INTO manager_plans (id, project_id, conversation_id, analysis_snapshot_id, status, title, summary,
      assumptions_json, risks_json, actions_json, created_at, updated_at) VALUES (?, ?, ?, ?, 'awaiting_confirmation', ?, ?, ?, ?, ?, ?, ?)`).run(
      planId, input.projectId, input.conversationId ?? null, input.analysisSnapshotId ?? null, input.title?.trim() || "Manager-Plan",
      input.summary?.trim() ?? "", json(input.assumptions ?? []), json(input.risks ?? []), json(input.actions), now, now,
    );
    const insert = db.prepare(`INSERT INTO manager_plan_tasks (id, plan_id, client_id, kind, title, description, priority, sequence,
      acceptance_json, parent_client_id, parent_task_id, depends_on_client_ids_json, metadata_json, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const [sortOrder, task] of tasks.entries()) {
      insert.run(id("plan-task"), planId, task.clientId, task.kind, task.title, task.description ?? "", task.priority ?? "Medium", task.sequence ?? (sortOrder + 1) * 10,
        json(task.acceptance ?? []), task.parentClientId ?? null, task.parentTaskId ?? null, json(task.dependsOnClientIds ?? []),
        json({ sourceTaskId: task.sourceTaskId, sourceRunId: task.sourceRunId, sourceReportId: task.sourceReportId, originKey: task.originKey }), sortOrder, now, now);
    }
    if (input.conversationId) db.prepare("UPDATE manager_conversations SET status = 'awaiting_confirmation', updated_at = ? WHERE id = ?").run(now, input.conversationId);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return getManagerPlan(planId)!;
}

export function updateManagerPlanTask(planId: string, planTaskId: string, patch: { title?: string; description?: string; priority?: string; sequence?: number; acceptance?: string[]; parentClientId?: string | null; parentTaskId?: string | null; dependsOnClientIds?: string[] }) {
  const db = getDatabase();
  const plan = getManagerPlan(planId);
  if (!plan) return undefined;
  if (plan.status !== "awaiting_confirmation") throw new Error("Nur ein noch nicht bestätigter Plan darf bearbeitet werden");
  const existing = db.prepare("SELECT id FROM manager_plan_tasks WHERE id = ? AND plan_id = ?").get(planTaskId, planId);
  if (!existing) return undefined;
  const acceptance = patch.acceptance?.map((item) => String(item).trim()).filter(Boolean);
  if (patch.sequence !== undefined && (!Number.isInteger(patch.sequence) || patch.sequence < 1)) throw new Error("Die Reihenfolge muss eine positive ganze Zahl sein");
  db.prepare(`UPDATE manager_plan_tasks SET title = COALESCE(?, title), description = COALESCE(?, description), priority = COALESCE(?, priority), sequence = COALESCE(?, sequence),
    acceptance_json = COALESCE(?, acceptance_json), parent_client_id = ?, parent_task_id = ?, depends_on_client_ids_json = COALESCE(?, depends_on_client_ids_json), updated_at = ?
    WHERE id = ? AND plan_id = ?`).run(
    patch.title === undefined ? null : patch.title.trim(), patch.description === undefined ? null : patch.description.trim(), patch.priority ?? null, patch.sequence ?? null,
    acceptance === undefined ? null : json(acceptance), patch.parentClientId === undefined ? db.prepare("SELECT parent_client_id FROM manager_plan_tasks WHERE id = ?").get(planTaskId)?.parent_client_id ?? null : patch.parentClientId,
    patch.parentTaskId === undefined ? db.prepare("SELECT parent_task_id FROM manager_plan_tasks WHERE id = ?").get(planTaskId)?.parent_task_id ?? null : patch.parentTaskId,
    patch.dependsOnClientIds === undefined ? null : json(patch.dependsOnClientIds.map((item) => String(item).trim()).filter(Boolean)), timestamp(), planTaskId, planId,
  );
  db.prepare("UPDATE manager_plans SET updated_at = ? WHERE id = ?").run(timestamp(), planId);
  return getManagerPlan(planId)!;
}

export function removeManagerPlanTask(planId: string, planTaskId: string) {
  const db = getDatabase();
  const plan = getManagerPlan(planId);
  if (!plan) return undefined;
  if (plan.status !== "awaiting_confirmation") throw new Error("Nur ein noch nicht bestätigter Plan darf bearbeitet werden");
  db.prepare("DELETE FROM manager_plan_tasks WHERE id = ? AND plan_id = ?").run(planTaskId, planId);
  db.prepare("UPDATE manager_plans SET updated_at = ? WHERE id = ?").run(timestamp(), planId);
  return getManagerPlan(planId)!;
}

function nextTaskId(db: DatabaseSync, projectId: string) {
  const key = String((db.prepare("SELECT key FROM projects WHERE id = ?").get(projectId) as Row | undefined)?.key ?? "TASK");
  let taskId = "";
  do {
    taskId = `${key}-${Math.floor(200 + Math.random() * 700)}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
  } while (db.prepare("SELECT 1 FROM tasks WHERE id = ?").get(taskId));
  return taskId;
}

function ensureTaskInProject(db: DatabaseSync, projectId: string, taskId: string) {
  const task = db.prepare("SELECT id FROM tasks WHERE id = ? AND project_id = ?").get(taskId, projectId) as Row | undefined;
  if (!task) throw new Error(`Ticket ${taskId} gehört nicht zum aktiven Projekt oder existiert nicht`);
}

function assertNoDependencyCycles(db: DatabaseSync, projectId: string, additions: Array<{ taskId: string; dependsOnTaskId: string }>) {
  const edges = db.prepare(`SELECT task_dependencies.task_id AS taskId, task_dependencies.depends_on_task_id AS dependsOnTaskId
    FROM task_dependencies JOIN tasks ON tasks.id = task_dependencies.task_id WHERE tasks.project_id = ?`).all(projectId) as Array<{ taskId: string; dependsOnTaskId: string }>;
  const graph = new Map<string, string[]>();
  for (const edge of [...edges, ...additions]) {
    if (edge.taskId === edge.dependsOnTaskId) throw new Error("Ein Ticket darf nicht von sich selbst abhängen");
    const targets = graph.get(edge.taskId) ?? [];
    if (!targets.includes(edge.dependsOnTaskId)) targets.push(edge.dependsOnTaskId);
    graph.set(edge.taskId, targets);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (taskId: string): boolean => {
    if (visiting.has(taskId)) return true;
    if (visited.has(taskId)) return false;
    visiting.add(taskId);
    for (const dependency of graph.get(taskId) ?? []) if (visit(dependency)) return true;
    visiting.delete(taskId);
    visited.add(taskId);
    return false;
  };
  for (const taskId of graph.keys()) if (visit(taskId)) throw new Error("Die vorgeschlagenen Abhängigkeiten enthalten einen Zyklus");
}

function planDependencies(actions: Record<string, unknown>[]) {
  const result: Array<{ taskId: string; dependsOnTaskId: string }> = [];
  for (const action of actions) {
    if (action.type !== "set_dependencies" || !Array.isArray(action.dependencies)) continue;
    for (const dependency of action.dependencies) {
      if (!dependency || typeof dependency !== "object") continue;
      const item = dependency as Record<string, unknown>;
      const taskId = String(item.taskId ?? item.taskClientId ?? "").trim();
      const dependsOnTaskId = String(item.dependsOnTaskId ?? item.dependsOnClientId ?? "").trim();
      if (taskId && dependsOnTaskId) result.push({ taskId, dependsOnTaskId });
    }
  }
  return result;
}

function clientReferenceKey(value: unknown) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

function resolvePlanTaskReference(taskIdByClientId: Map<string, string>, reference: unknown) {
  const original = String(reference ?? "").trim();
  return taskIdByClientId.get(clientReferenceKey(original)) ?? original;
}

export function applyManagerPlan(planId: string) {
  const db = getDatabase();
  const plan = getManagerPlan(planId);
  if (!plan) return undefined;
  if (plan.status !== "awaiting_confirmation") throw new Error("Dieser Plan wurde bereits bestätigt oder verworfen");
  const now = timestamp();
  const taskIdByClientId = new Map<string, string>();
  const createdTaskIds: string[] = [];
  db.exec("BEGIN IMMEDIATE");
  try {
    const actions = plan.actions as Record<string, unknown>[];
    const rows = planTaskRows(db, planId);
    for (const row of rows) {
      const metadata = parseStoredJson<Record<string, unknown>>(row.metadataJson, {});
      const sourceTaskId = typeof metadata.sourceTaskId === "string" ? metadata.sourceTaskId : undefined;
      const sourceRunId = typeof metadata.sourceRunId === "string" ? metadata.sourceRunId : undefined;
      const sourceReportId = typeof metadata.sourceReportId === "string" ? metadata.sourceReportId : undefined;
      const originKey = typeof metadata.originKey === "string" && metadata.originKey
        ? metadata.originKey
        : row.kind === "create_follow_up_tasks" && sourceTaskId
          ? `follow-up:${sourceTaskId}:${sourceRunId ?? sourceReportId ?? "manual"}:${row.clientId}`
          : undefined;
      const existing = originKey ? db.prepare("SELECT id FROM tasks WHERE origin_key = ?").get(originKey) as Row | undefined : undefined;
      const taskId = existing ? String(existing.id) : nextTaskId(db, plan.projectId);
      taskIdByClientId.set(clientReferenceKey(row.clientId), taskId);
      if (existing) {
        db.prepare("UPDATE tasks SET plan_id = COALESCE(plan_id, ?), plan_sequence = ?, updated_at = ? WHERE id = ?").run(planId, Number(row.sequence ?? row.sortOrder ?? 0), now, taskId);
        db.prepare("UPDATE manager_plan_tasks SET task_id = ?, updated_at = ? WHERE id = ?").run(taskId, now, row.id);
        continue;
      }
      const criteria = parseStoredJson<string[]>(row.acceptanceJson, []).map((criterion) => String(criterion).trim()).filter(Boolean);
      if (!criteria.length) throw new Error(`Ticketentwurf ${row.clientId} benötigt mindestens ein Akzeptanzkriterium`);
      db.prepare(`INSERT INTO tasks (id, project_id, title, description, status, priority, retry_count, max_retries,
        parent_task_id, plan_id, plan_sequence, created_by, origin_key, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'Ready', ?, 0, 3, NULL, ?, ?, 'manager', ?, ?, ?)`).run(
        taskId, plan.projectId, row.title, row.description, row.priority, planId, Number(row.sequence ?? row.sortOrder ?? 0), originKey ?? null, now, now,
      );
      const insertCriteria = db.prepare("INSERT INTO task_acceptance_criteria (task_id, text, sort_order) VALUES (?, ?, ?)");
      for (const [order, criterion] of criteria.entries()) insertCriteria.run(taskId, criterion, order);
      addCommentInternal(db, taskId, "manager", "agent-manager", "Mira", `Aus Plan ${planId} angelegt.`, now);
      addEventInternal(db, taskId, "manager.plan_task_created", "manager", "agent-manager", { planId, clientId: row.clientId, sourceTaskId, sourceRunId, sourceReportId }, now);
      db.prepare("UPDATE manager_plan_tasks SET task_id = ?, updated_at = ? WHERE id = ?").run(taskId, now, row.id);
      createdTaskIds.push(taskId);
    }

    for (const row of rows) {
      const taskId = resolvePlanTaskReference(taskIdByClientId, row.clientId);
      if (!taskId) continue;
      const parentTaskId = row.parentClientId ? resolvePlanTaskReference(taskIdByClientId, row.parentClientId) : row.parentTaskId ? String(row.parentTaskId) : undefined;
      if (parentTaskId) {
        ensureTaskInProject(db, plan.projectId, parentTaskId);
        db.prepare("UPDATE tasks SET parent_task_id = ?, updated_at = ? WHERE id = ?").run(parentTaskId, now, taskId);
      }
    }

    const dependencies: Array<{ taskId: string; dependsOnTaskId: string }> = [];
    for (const row of rows) {
      const taskId = resolvePlanTaskReference(taskIdByClientId, row.clientId);
      if (!taskId) continue;
      for (const dependencyReference of parseStoredJson<string[]>(row.dependsOnClientIdsJson, [])) {
        const dependencyTaskId = resolvePlanTaskReference(taskIdByClientId, dependencyReference);
        ensureTaskInProject(db, plan.projectId, dependencyTaskId);
        dependencies.push({ taskId, dependsOnTaskId: dependencyTaskId });
      }
    }
    for (const dependency of planDependencies(actions)) {
      const taskId = resolvePlanTaskReference(taskIdByClientId, dependency.taskId);
      const dependsOnTaskId = resolvePlanTaskReference(taskIdByClientId, dependency.dependsOnTaskId);
      ensureTaskInProject(db, plan.projectId, taskId);
      ensureTaskInProject(db, plan.projectId, dependsOnTaskId);
      dependencies.push({ taskId, dependsOnTaskId });
    }
    assertNoDependencyCycles(db, plan.projectId, dependencies);
    const insertDependency = db.prepare("INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_task_id, created_at) VALUES (?, ?, ?)");
    for (const dependency of dependencies) insertDependency.run(dependency.taskId, dependency.dependsOnTaskId, now);

    for (const action of actions) {
      if (action.type === "update_tasks" && Array.isArray(action.updates)) {
        for (const update of action.updates) {
          if (!update || typeof update !== "object") continue;
          const item = update as Record<string, unknown>;
          const taskId = resolvePlanTaskReference(taskIdByClientId, item.taskId ?? item.taskClientId);
          if (!taskId) throw new Error("update_tasks benötigt eine Ticket-ID");
          ensureTaskInProject(db, plan.projectId, taskId);
          const acceptance = Array.isArray(item.acceptance) ? item.acceptance.map((criterion) => String(criterion).trim()).filter(Boolean) : undefined;
           db.prepare(`UPDATE tasks SET title = COALESCE(?, title), description = COALESCE(?, description), priority = COALESCE(?, priority), plan_id = COALESCE(?, plan_id), plan_sequence = COALESCE(?, plan_sequence), updated_at = ? WHERE id = ?`).run(
             typeof item.title === "string" ? item.title.trim() : null, typeof item.description === "string" ? item.description.trim() : null,
             typeof item.priority === "string" ? item.priority : null, Number.isInteger(item.sequence) ? planId : null, Number.isInteger(item.sequence) ? Number(item.sequence) : null, now, taskId,
          );
          if (acceptance) {
            if (!acceptance.length) throw new Error(`Ticket ${taskId} benötigt mindestens ein Akzeptanzkriterium`);
            db.prepare("DELETE FROM task_acceptance_criteria WHERE task_id = ?").run(taskId);
            const insertCriteria = db.prepare("INSERT INTO task_acceptance_criteria (task_id, text, sort_order) VALUES (?, ?, ?)");
            for (const [order, criterion] of acceptance.entries()) insertCriteria.run(taskId, criterion, order);
          }
          addEventInternal(db, taskId, "manager.plan_task_updated", "manager", "agent-manager", { planId }, now);
        }
      }
      if (action.type === "comment_task") {
        const taskId = resolvePlanTaskReference(taskIdByClientId, action.taskId);
        const body = String(action.body ?? "").trim();
        if (!taskId || !body) throw new Error("comment_task benötigt Ticket-ID und Text");
        ensureTaskInProject(db, plan.projectId, taskId);
        addCommentInternal(db, taskId, "manager", "agent-manager", "Mira", body, now);
        addEventInternal(db, taskId, "manager.plan_comment", "manager", "agent-manager", { planId }, now);
      }
    }
    db.prepare(`UPDATE manager_plans SET status = 'applied', confirmed_at = ?, applied_at = ?, updated_at = ? WHERE id = ?`).run(now, now, now, planId);
    if (plan.conversationId) db.prepare("UPDATE manager_conversations SET status = 'completed', updated_at = ?, completed_at = ? WHERE id = ?").run(now, now, plan.conversationId);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return { plan: getManagerPlan(planId)!, tasks: createdTaskIds.map((taskId) => listTasks(plan.projectId).find((task) => task.id === taskId)).filter(Boolean), actions: plan.actions };
}

export function discardManagerPlan(planId: string) {
  const db = getDatabase();
  const plan = getManagerPlan(planId);
  if (!plan) return undefined;
  if (plan.status !== "awaiting_confirmation") throw new Error("Nur ein noch nicht bestätigter Plan kann verworfen werden");
  const now = timestamp();
  db.prepare("UPDATE manager_plans SET status = 'discarded', updated_at = ? WHERE id = ?").run(now, planId);
  if (plan.conversationId) db.prepare("UPDATE manager_conversations SET status = 'completed', updated_at = ?, completed_at = ? WHERE id = ?").run(now, now, plan.conversationId);
  return getManagerPlan(planId)!;
}

export function createFollowUpManagerPlan(input: { projectId: string; sourceTaskId: string; sourceRunId?: string; sourceReportId?: string; summary: string; checks?: unknown[] }) {
  const sourceTask = listTasks(input.projectId).find((task) => task.id === input.sourceTaskId);
  if (!sourceTask) throw new Error("Ursprungsticket für die Folgeaufgabe wurde nicht gefunden");
  const conversation = createManagerConversation(input.projectId, { mode: "execution", summary: `Folgeaufgabe für ${sourceTask.id}` });
  const originKey = `follow-up:${sourceTask.id}:${input.sourceRunId ?? input.sourceReportId ?? "manual"}:fix`;
  const plan = createManagerPlan({
    projectId: input.projectId,
    conversationId: conversation.id,
    title: `Folgeaufgabe zu ${sourceTask.id}`,
    summary: input.summary,
    assumptions: [],
    risks: ["Die Folgeaufgabe wird erst nach Bestätigung angelegt."],
    actions: [{
      type: "create_follow_up_tasks",
      requiresConfirmation: true,
      trigger: "tester_result",
      tasks: [{
        clientId: "follow-up-fix",
        title: `Testergebnis zu ${sourceTask.id} beheben`,
        description: input.summary,
        priority: sourceTask.priority === "Urgent" ? "Urgent" : "High",
        acceptance: ["Die im Testergebnis dokumentierte Ursache ist behoben.", "Die fehlgeschlagenen Checks sind reproduzierbar bestanden.", "Der Tester bestätigt die Änderung erneut."],
        parentTaskId: sourceTask.parentTaskId ?? sourceTask.id,
        sourceTaskId: sourceTask.id,
        sourceRunId: input.sourceRunId,
        sourceReportId: input.sourceReportId,
        originKey,
      }],
    }],
  });
  addManagerConversationEntry(conversation.id, { senderType: "manager", body: `Ich habe eine bestätigungspflichtige Folgeaufgabe für ${sourceTask.id} vorbereitet.`, payload: { planId: plan.id, checks: input.checks ?? [] } });
  return plan;
}
