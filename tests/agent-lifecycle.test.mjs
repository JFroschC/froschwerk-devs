import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("..", import.meta.url));
const databaseModule = pathToFileURL(resolve(root, "db/local.ts")).href;
const lifecycleModule = pathToFileURL(resolve(root, "db/agent-lifecycle.ts")).href;

function run(script) {
  const databasePath = join(tmpdir(), `harness-lifecycle-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`);
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", `process.env.HARNESS_DB_PATH = ${JSON.stringify(databasePath)};\n${script}`], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

test("the central lifecycle contract permits only defined transitions", () => {
  assert.equal(run(`
    import assert from "node:assert/strict";
    const lifecycle = await import(${JSON.stringify(lifecycleModule)});
    assert.equal(lifecycle.canTransitionAgentRun("queued", "starting"), true);
    assert.equal(lifecycle.canTransitionAgentRun("starting", "running"), true);
    assert.equal(lifecycle.canTransitionAgentRun("running", "succeeded"), true);
    assert.equal(lifecycle.canTransitionAgentRun("queued", "succeeded"), false);
    assert.equal(lifecycle.canTransitionAgentRun("succeeded", "running"), false);
    assert.throws(() => lifecycle.assertAgentRunTransition("failed", "running"));
    console.log("ok");
  `), "ok");
});

test("existing agent_runs tables receive process identity during lifecycle migration", () => {
  assert.equal(run(`
    import assert from "node:assert/strict";
    import { DatabaseSync } from "node:sqlite";
    const legacy = new DatabaseSync(process.env.HARNESS_DB_PATH);
    legacy.exec(\`
      CREATE TABLE agent_runs (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL, agent_id TEXT NOT NULL, role TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued', attempt_no INTEGER NOT NULL DEFAULT 1,
        input_json TEXT NOT NULL DEFAULT '{}', output_json TEXT NOT NULL DEFAULT '{}',
        summary TEXT NOT NULL DEFAULT '', error TEXT, process_id INTEGER,
        started_at TEXT, finished_at TEXT, created_at TEXT NOT NULL
      );
    \`);
    legacy.close();
    const db = await import(${JSON.stringify(databaseModule)});
    db.listAgentRuns();
    const migrated = new DatabaseSync(process.env.HARNESS_DB_PATH);
    const columns = migrated.prepare("PRAGMA table_info(agent_runs)").all().map((column) => column.name);
    migrated.close();
    assert.ok(columns.includes("process_identity"));
    console.log("ok");
  `), "ok");
});

test("runs persist heartbeat, activity, technical completion and derived agent status", () => {
  assert.equal(run(`
    import assert from "node:assert/strict";
    const db = await import(${JSON.stringify(databaseModule)});
    const claimed = db.claimNextTask("agent-developer-1", "FW-115", "project-agent-harness");
    assert.ok(claimed.runId);
    assert.equal(db.getAgentRun(claimed.runId).status, "queued");
    assert.equal(db.getAgent("agent-developer-1").runtimeStatus, "queued");
    db.markAgentRunStarting(claimed.runId);
    db.markAgentRunRunning(claimed.runId);
    assert.equal(db.reportAgentRunActivity(claimed.runId, { phase: "implementation", progress: 42 }).reported, true);
    assert.equal(db.renewAgentRunLease(claimed.runId).renewed, true);
    const active = db.getAgentRun(claimed.runId);
    assert.equal(active.status, "running");
    assert.equal(active.currentPhase, "implementation");
    assert.equal(active.progress, 42);
    assert.ok(active.lastHeartbeatAt);
    assert.ok(active.lastActivityAt);
    assert.equal(db.getAgent("agent-developer-1").runtimeStatus, "busy");
    const finished = db.finishAgentRun(claimed.runId, { status: "succeeded", exitCode: 0, terminationReason: "completed" });
    assert.equal(finished.status, "Review");
    const terminal = db.getAgentRun(claimed.runId);
    assert.equal(terminal.status, "succeeded");
    assert.equal(terminal.exitCode, 0);
    assert.equal(terminal.terminationReason, "completed");
    assert.equal(db.getAgent("agent-developer-1").runtimeStatus, "idle");
    db.updateAgent("agent-developer-1", { enabled: false });
    const disabled = db.getAgent("agent-developer-1");
    assert.equal(disabled.configuredStatus, "disabled");
    assert.equal(disabled.runtimeStatus, "disabled");
    console.log("ok");
  `), "ok");
});

test("a cancellation stays exclusive until process completion and does not consume retries", () => {
  assert.equal(run(`
    import assert from "node:assert/strict";
    const db = await import(${JSON.stringify(databaseModule)});
    const claimed = db.claimNextTask("agent-developer-1", "FW-115", "project-agent-harness");
    db.markAgentRunRunning(claimed.runId);
    const cancelling = db.requestAgentRunCancellation(claimed.runId, { reason: "USER_CANCELLED" });
    assert.equal(cancelling.status, "cancelling");
    const taskWhileStopping = db.listTasks("project-agent-harness").find((task) => task.id === "FW-115");
    assert.equal(taskWhileStopping.activeRunId, claimed.runId);
    assert.equal(db.claimNextTask("agent-developer-1", "FW-115", "project-agent-harness").reason, "task_not_ready");
    const released = db.finalizeAgentRunCancellation(claimed.runId, { terminationReason: "cooperative_cancelled" });
    assert.equal(released.status, "Ready");
    assert.equal(released.retryCount, 0);
    assert.equal(db.getAgentRun(claimed.runId).status, "cancelled");
    assert.ok(db.claimNextTask("agent-developer-1", "FW-115", "project-agent-harness").runId);
    console.log("ok");
  `), "ok");
});

test("manager requests expose persistent activity and phase", () => {
  assert.equal(run(`
    import assert from "node:assert/strict";
    const db = await import(${JSON.stringify(databaseModule)});
    const request = db.startAgentRequest({ projectId: "project-agent-harness", agentId: "agent-manager", role: "manager", provider: "codex", prompt: "Status" });
    db.reportAgentRequestActivity(request.requestId, "provider_output");
    const active = db.listAgentRequests("project-agent-harness").find((entry) => entry.id === request.requestId);
    assert.equal(active.currentPhase, "provider_output");
    assert.ok(active.lastActivityAt);
    db.finishAgentRequest(request.requestId, { status: "succeeded", response: "ok", startedAt: request.startedAt });
    console.log("ok");
  `), "ok");
});

test("run details expose the persisted audit trail without deriving lifecycle state in the UI", () => {
  assert.equal(run(`
    import assert from "node:assert/strict";
    const db = await import(${JSON.stringify(databaseModule)});
    const claimed = db.claimNextTask("agent-developer-1", "FW-115", "project-agent-harness");
    db.markAgentRunRunning(claimed.runId);
    const request = db.startAgentRequest({ projectId: "project-agent-harness", taskId: "FW-115", runId: claimed.runId, agentId: "agent-developer-1", role: "developer", provider: "codex", model: "gpt-5", prompt: "Implementiere die Änderung" });
    db.reportAgentRequestActivity(request.requestId, "implementation");
    db.finishAgentRequest(request.requestId, { status: "succeeded", response: "Änderung fertig", startedAt: request.startedAt });
    const detail = db.getAgentRunDetail(claimed.runId);
    assert.equal(detail.status, "running");
    assert.ok(detail.lease?.expiresAt);
    assert.equal(detail.requests.length, 1);
    assert.equal(detail.requests[0].responsePreview, "Änderung fertig");
    assert.ok(detail.events.some((event) => event.eventType === "task.claimed"));
    assert.ok(db.listProjectTaskEvents("project-agent-harness").some((event) => event.taskId === "FW-115"));
    console.log("ok");
  `), "ok");
});
