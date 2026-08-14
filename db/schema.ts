import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  key: text("key").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  type: text("type").notNull().default("Tool"),
  workspacePath: text("workspace_path").notNull().default(""),
  startCommand: text("start_command").notNull().default(""),
  testCommand: text("test_command").notNull().default(""),
  autoProcessEnabled: integer("auto_process_enabled", { mode: "boolean" }).notNull().default(false),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("idx_projects_key").on(table.key)]);

export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  provider: text("provider").notNull().default("codex"),
  status: text("status").notNull().default("offline"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  maxConcurrency: integer("max_concurrency").notNull().default(1),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  status: text("status").notNull().default("Ready"),
  priority: text("priority").notNull().default("Medium"),
  assigneeAgentId: text("assignee_agent_id").references(() => agents.id),
  activeRunId: text("active_run_id"),
  retryCount: integer("retry_count").notNull().default(0),
  maxRetries: integer("max_retries").notNull().default(3),
  parentTaskId: text("parent_task_id"),
  planId: text("plan_id"),
  planSequence: integer("plan_sequence"),
  createdBy: text("created_by").notNull().default("user"),
  originKey: text("origin_key"),
  obsoleteAt: text("obsolete_at"),
  obsoleteReason: text("obsolete_reason"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_tasks_project_status_priority").on(table.projectId, table.status, table.priority),
  index("idx_tasks_assignee_status").on(table.assigneeAgentId, table.status),
  index("idx_tasks_parent").on(table.parentTaskId),
  index("idx_tasks_plan").on(table.planId),
  uniqueIndex("idx_tasks_origin_key_unique").on(table.originKey),
]);

export const taskAcceptanceCriteria = sqliteTable("task_acceptance_criteria", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  taskId: text("task_id").notNull().references(() => tasks.id),
  text: text("text").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
}, (table) => [index("idx_acceptance_task_order").on(table.taskId, table.sortOrder)]);

export const taskDependencies = sqliteTable("task_dependencies", {
  taskId: text("task_id").notNull().references(() => tasks.id),
  dependsOnTaskId: text("depends_on_task_id").notNull().references(() => tasks.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("idx_task_dependency_pair").on(table.taskId, table.dependsOnTaskId)]);

export const comments = sqliteTable("comments", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => tasks.id),
  authorType: text("author_type").notNull(),
  authorId: text("author_id"),
  authorName: text("author_name").notNull(),
  body: text("body").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_comments_task_created").on(table.taskId, table.createdAt)]);

export const agentRuns = sqliteTable("agent_runs", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => tasks.id),
  agentId: text("agent_id").notNull().references(() => agents.id),
  role: text("role").notNull(),
  status: text("status").notNull().default("queued"),
  attemptNo: integer("attempt_no").notNull().default(1),
  inputJson: text("input_json").notNull().default("{}"),
  outputJson: text("output_json").notNull().default("{}"),
  summary: text("summary").notNull().default(""),
  error: text("error"),
  processId: integer("process_id"),
  processIdentity: text("process_identity"),
  lastHeartbeatAt: text("last_heartbeat_at"),
  lastActivityAt: text("last_activity_at"),
  currentPhase: text("current_phase"),
  progress: integer("progress"),
  exitCode: integer("exit_code"),
  signal: text("signal"),
  terminationReason: text("termination_reason"),
  cancellationRequestedAt: text("cancellation_requested_at"),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_agent_runs_task_created").on(table.taskId, table.createdAt),
  index("idx_agent_runs_agent_status").on(table.agentId, table.status),
  index("idx_agent_runs_status_heartbeat").on(table.status, table.lastHeartbeatAt),
]);

export const agentLeases = sqliteTable("agent_leases", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => tasks.id),
  agentId: text("agent_id").notNull().references(() => agents.id),
  runId: text("run_id").notNull().references(() => agentRuns.id),
  acquiredAt: text("acquired_at").notNull(),
  expiresAt: text("expires_at").notNull(),
}, (table) => [
  uniqueIndex("idx_agent_leases_task").on(table.taskId),
  uniqueIndex("idx_agent_leases_run").on(table.runId),
  index("idx_agent_leases_agent_expiry").on(table.agentId, table.expiresAt),
]);

export const agentRequests = sqliteTable("agent_requests", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projects.id),
  taskId: text("task_id").references(() => tasks.id),
  runId: text("run_id").references(() => agentRuns.id),
  agentId: text("agent_id").references(() => agents.id),
  role: text("role").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull().default(""),
  command: text("command").notNull().default(""),
  status: text("status").notNull().default("running"),
  startedAt: text("started_at").notNull(),
  lastActivityAt: text("last_activity_at"),
  currentPhase: text("current_phase"),
  finishedAt: text("finished_at"),
  durationMs: integer("duration_ms"),
  inputChars: integer("input_chars").notNull().default(0),
  outputChars: integer("output_chars").notNull().default(0),
  estimatedInputTokens: integer("estimated_input_tokens").notNull().default(0),
  estimatedOutputTokens: integer("estimated_output_tokens").notNull().default(0),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  totalTokens: integer("total_tokens"),
  promptHash: text("prompt_hash").notNull().default(""),
  promptPreview: text("prompt_preview").notNull().default(""),
  responsePreview: text("response_preview").notNull().default(""),
  error: text("error"),
}, (table) => [
  index("idx_agent_requests_project_started").on(table.projectId, table.startedAt),
  index("idx_agent_requests_run_started").on(table.runId, table.startedAt),
]);

export const taskEvents = sqliteTable("task_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  taskId: text("task_id").notNull().references(() => tasks.id),
  eventType: text("event_type").notNull(),
  actorType: text("actor_type").notNull(),
  actorId: text("actor_id"),
  payloadJson: text("payload_json").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_task_events_task_created").on(table.taskId, table.createdAt)]);

export const testReports = sqliteTable("test_reports", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => tasks.id),
  agentRunId: text("agent_run_id").references(() => agentRuns.id),
  status: text("status").notNull(),
  summary: text("summary").notNull().default(""),
  checksJson: text("checks_json").notNull().default("[]"),
  logs: text("logs").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_test_reports_task_created").on(table.taskId, table.createdAt)]);

export const artifacts = sqliteTable("artifacts", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => tasks.id),
  agentRunId: text("agent_run_id").references(() => agentRuns.id),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  path: text("path").notNull(),
  metadataJson: text("metadata_json").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_artifacts_task_created").on(table.taskId, table.createdAt)]);

export const chatMessages = sqliteTable("chat_messages", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projects.id),
  senderType: text("sender_type").notNull(),
  senderId: text("sender_id"),
  body: text("body").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_chat_messages_created").on(table.createdAt),
  index("idx_chat_messages_project_created").on(table.projectId, table.createdAt),
]);

export const managerConversations = sqliteTable("manager_conversations", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  status: text("status").notNull().default("open"),
  mode: text("mode").notNull().default("status"),
  summary: text("summary").notNull().default(""),
  latestReply: text("latest_reply").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  completedAt: text("completed_at"),
}, (table) => [index("idx_manager_conversations_project_updated").on(table.projectId, table.updatedAt)]);

export const managerConversationEntries = sqliteTable("manager_conversation_entries", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => managerConversations.id),
  senderType: text("sender_type").notNull(),
  body: text("body").notNull().default(""),
  payloadJson: text("payload_json").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_manager_conversation_entries_created").on(table.conversationId, table.createdAt)]);

export const managerQuestions = sqliteTable("manager_questions", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => managerConversations.id),
  questionKey: text("question_key").notNull(),
  question: text("question").notNull(),
  optionsJson: text("options_json").notNull().default("[]"),
  required: integer("required", { mode: "boolean" }).notNull().default(true),
  answer: text("answer"),
  answeredAt: text("answered_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_manager_question_conversation_key").on(table.conversationId, table.questionKey),
  index("idx_manager_questions_conversation").on(table.conversationId, table.answeredAt),
]);

export const projectAnalysisSnapshots = sqliteTable("project_analysis_snapshots", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  status: text("status").notNull(),
  summary: text("summary").notNull().default(""),
  snapshotJson: text("snapshot_json").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_analysis_snapshots_project_created").on(table.projectId, table.createdAt)]);

export const managerPlans = sqliteTable("manager_plans", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  conversationId: text("conversation_id").references(() => managerConversations.id),
  analysisSnapshotId: text("analysis_snapshot_id").references(() => projectAnalysisSnapshots.id),
  status: text("status").notNull().default("awaiting_confirmation"),
  title: text("title").notNull().default("Manager-Plan"),
  summary: text("summary").notNull().default(""),
  assumptionsJson: text("assumptions_json").notNull().default("[]"),
  risksJson: text("risks_json").notNull().default("[]"),
  actionsJson: text("actions_json").notNull().default("[]"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  confirmedAt: text("confirmed_at"),
  appliedAt: text("applied_at"),
}, (table) => [index("idx_manager_plans_project_updated").on(table.projectId, table.updatedAt)]);

export const managerActions = sqliteTable("manager_actions", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  conversationId: text("conversation_id").references(() => managerConversations.id),
  planId: text("plan_id").references(() => managerPlans.id),
  analysisSnapshotId: text("analysis_snapshot_id").references(() => projectAnalysisSnapshots.id),
  agentRequestId: text("agent_request_id").references(() => agentRequests.id),
  type: text("type").notNull(),
  status: text("status").notNull().default("queued"),
  phase: text("phase").notNull().default("queued"),
  attemptNo: integer("attempt_no").notNull().default(1),
  retryOfActionId: text("retry_of_action_id"),
  confirmation: text("confirmation").notNull().default("not_required"),
  inputJson: text("input_json").notNull().default("{}"),
  resultJson: text("result_json").notNull().default("{}"),
  error: text("error"),
  cancellationRequestedAt: text("cancellation_requested_at"),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_manager_actions_project_created").on(table.projectId, table.createdAt),
  index("idx_manager_actions_status").on(table.status, table.createdAt),
]);

export const managerActionEvents = sqliteTable("manager_action_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  actionId: text("action_id").notNull().references(() => managerActions.id),
  eventType: text("event_type").notNull(),
  payloadJson: text("payload_json").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_manager_action_events_action_created").on(table.actionId, table.createdAt)]);

export const managerPlanTasks = sqliteTable("manager_plan_tasks", {
  id: text("id").primaryKey(),
  planId: text("plan_id").notNull().references(() => managerPlans.id),
  clientId: text("client_id").notNull(),
  kind: text("kind").notNull().default("create_tasks"),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  priority: text("priority").notNull().default("Medium"),
  sequence: integer("sequence").notNull().default(0),
  acceptanceJson: text("acceptance_json").notNull().default("[]"),
  parentClientId: text("parent_client_id"),
  parentTaskId: text("parent_task_id"),
  dependsOnClientIdsJson: text("depends_on_client_ids_json").notNull().default("[]"),
  metadataJson: text("metadata_json").notNull().default("{}"),
  sortOrder: integer("sort_order").notNull().default(0),
  taskId: text("task_id").references(() => tasks.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_manager_plan_task_client").on(table.planId, table.clientId),
  index("idx_manager_plan_tasks_plan_order").on(table.planId, table.sortOrder),
  index("idx_manager_plan_tasks_plan_sequence").on(table.planId, table.sequence, table.sortOrder),
]);
