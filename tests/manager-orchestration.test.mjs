import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("..", import.meta.url));
const databaseModule = pathToFileURL(resolve(root, "db/local.ts")).href;
const managerActionsModule = pathToFileURL(resolve(root, "scripts/manager-actions.mjs")).href;
const analysisModule = pathToFileURL(resolve(root, "scripts/project-analysis.mjs")).href;
const workflowModule = pathToFileURL(resolve(root, "scripts/workflow-orchestrator.mjs")).href;
const codexCliModule = pathToFileURL(resolve(root, "scripts/codex-cli.mjs")).href;

function run(script) {
  const databasePath = join(tmpdir(), `harness-manager-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`);
  const source = `process.env.HARNESS_DB_PATH = ${JSON.stringify(databasePath)};\n${script}`;
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", source], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

test("manager schema v2 rejects unsafe actions and accepts a dependency plan", () => {
  const output = run(`
    const { validateManagerDecision } = await import(${JSON.stringify(managerActionsModule)});
    const valid = validateManagerDecision({
      schemaVersion: 2, reply: "Plan bereit", mode: "planning", questions: [], assumptions: [], risks: [], summary: "",
      actions: [{ type: "create_tasks", tasks: [
        { clientId: "model", title: "Datenmodell", priority: "High", acceptance: ["Schema dokumentiert"] },
        { clientId: "api", title: "API", priority: "Medium", acceptance: ["Endpunkt geprüft"], dependsOnClientIds: ["model"] },
      ] }],
    });
    const invalid = validateManagerDecision({ schemaVersion: 2, reply: "", mode: "planning", questions: [], assumptions: [], risks: [], summary: "", actions: [{ type: "drop_database" }] });
    if (!valid.valid || invalid.valid || invalid.decision.actions.length) throw new Error(JSON.stringify({ valid, invalid }));
    console.log("ok");
  `);
  assert.equal(output, "ok");
});

test("manager actions persist lifecycle, cancellation and a separately linked retry", () => {
  const output = run(`
    import assert from "node:assert/strict";
    const db = await import(${JSON.stringify(databaseModule)});
    const first = db.createManagerAction({ projectId: "project-agent-harness", type: "analysis", input: { source: "test" } });
    assert.equal(first.status, "queued");
    db.startManagerAction(first.id, "collecting_workspace");
    db.updateManagerAction(first.id, { phase: "workspace_ready", result: { files: 3 } });
    const cancellation = db.requestManagerActionCancellation(first.id);
    assert.equal(cancellation.action.phase, "cancelling");
    db.finishManagerAction(first.id, { status: "succeeded", result: { ignored: true } });
    const cancelled = db.getManagerAction(first.id);
    assert.equal(cancelled.status, "cancelled");
    assert.equal(cancelled.result.ignored, true);
    assert.ok(cancelled.events.some((event) => event.eventType === "manager.action_cancellation_requested"));
    const retry = db.createManagerAction({ projectId: "project-agent-harness", type: "analysis", retryOfActionId: first.id, input: { source: "retry" } });
    assert.equal(retry.attemptNo, 2);
    assert.equal(retry.retryOfActionId, first.id);
    assert.equal(db.listManagerActions("project-agent-harness")[0].id, retry.id);
    console.log("ok");
  `);
  assert.equal(output, "ok");
});

test("legacy SQLite databases receive manager columns before their indexes", () => {
  const output = run(`
    import assert from "node:assert/strict";
    import { DatabaseSync } from "node:sqlite";
    const legacy = new DatabaseSync(process.env.HARNESS_DB_PATH);
    legacy.exec(\`
      CREATE TABLE projects (id TEXT PRIMARY KEY, project_key TEXT UNIQUE NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE tasks (id TEXT PRIMARY KEY, ticket_id TEXT UNIQUE NOT NULL, project_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, priority TEXT NOT NULL, assignee TEXT, claimed_by TEXT, claimed_at TEXT, worktree_path TEXT, branch_name TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      INSERT INTO projects (id, project_key, name, description, created_at, updated_at) VALUES ('legacy-project', 'LEG', 'Legacy', '', datetime('now'), datetime('now'));
    \`);
    legacy.close();
    const db = await import(${JSON.stringify(databaseModule)});
    const project = db.listProjects().find((entry) => entry.id === "legacy-project");
    assert.equal(project.autoProcessEnabled, false);
    const migrated = new DatabaseSync(process.env.HARNESS_DB_PATH);
    const columns = migrated.prepare("PRAGMA table_info(tasks)").all().map((column) => column.name);
    migrated.close();
    assert.ok(columns.includes("parent_task_id"));
    assert.ok(columns.includes("plan_id"));
    console.log("ok");
  `);
  assert.equal(output, "ok");
});

test("questions, plan batch, and dependencies persist atomically", () => {
  const output = run(`
    import assert from "node:assert/strict";
    const db = await import(${JSON.stringify(databaseModule)});
    const conversation = db.createManagerConversation("project-agent-harness", { mode: "planning" });
    db.saveManagerQuestions(conversation.id, [{ id: "roles", question: "Mehrere Rollen?", options: ["Ja", "Nein"], required: true }]);
    assert.equal(db.getManagerConversation(conversation.id).status, "needs_input");
    db.answerManagerQuestions(conversation.id, { roles: "Ja" });
    assert.equal(db.getManagerConversation(conversation.id).questions[0].answer, "Ja");
    const plan = db.createManagerPlan({ projectId: "project-agent-harness", conversationId: conversation.id, summary: "Plan", actions: [{ type: "create_tasks", tasks: [
      { clientId: "foundation", sequence: 10, title: "Fundament", priority: "High", acceptance: ["Fundament vorhanden"] },
      { clientId: "feature", sequence: 20, title: "Feature", priority: "Medium", acceptance: ["Feature vorhanden"], dependsOnClientIds: ["foundation"] },
    ] }] });
    const applied = db.applyManagerPlan(plan.id);
    assert.equal(applied.plan.status, "applied");
    const tasks = db.listTasks("project-agent-harness").filter((task) => task.planId === plan.id);
    assert.equal(tasks.length, 2);
    const foundation = tasks.find((task) => task.title === "Fundament");
    const feature = tasks.find((task) => task.title === "Feature");
    assert.equal(foundation.planSequence, 10);
    assert.equal(feature.planSequence, 20);
    assert.equal(applied.plan.tasks.find((task) => task.clientId === "foundation").sequence, 10);
    assert.deepEqual(feature.dependencies, [foundation.id]);
    const blockedClaim = db.claimNextTask("agent-developer-1", feature.id, "project-agent-harness");
    assert.equal(blockedClaim.reason, "task_not_ready");
    assert.equal(db.getManagerConversation(conversation.id).status, "completed");
    console.log("ok");
  `);
  assert.equal(output, "ok");
});

test("planned task sequence wins before priority when claiming ready work", () => {
  const output = run(`
    import assert from "node:assert/strict";
    const db = await import(${JSON.stringify(databaseModule)});
    const plan = db.createManagerPlan({ projectId: "project-agent-harness", summary: "Reihenfolge", actions: [{ type: "create_tasks", tasks: [
      { clientId: "later", sequence: 20, title: "Später", priority: "Urgent", acceptance: ["Später fertig"] },
      { clientId: "first", sequence: 10, title: "Zuerst", priority: "Low", acceptance: ["Zuerst fertig"] },
    ] }] });
    db.applyManagerPlan(plan.id);
    const first = db.claimNextTask("agent-developer-1", undefined, "project-agent-harness");
    assert.equal(first.task.title, "Zuerst");
    db.markAgentRunRunning(first.runId);
    db.finishAgentRun(first.runId, { status: "succeeded" });
    const second = db.claimNextTask("agent-developer-1", undefined, "project-agent-harness");
    assert.equal(second.task.title, "Später");
    console.log("ok");
  `);
  assert.equal(output, "ok");
});

test("plan action dependencies resolve draft IDs case-insensitively", () => {
  const output = run(`
    import assert from "node:assert/strict";
    const db = await import(${JSON.stringify(databaseModule)});
    const plan = db.createManagerPlan({ projectId: "project-agent-harness", summary: "Case-insensitive Referenz", actions: [
      { type: "create_tasks", tasks: [{ clientId: "architecture", title: "Architektur", priority: "High", acceptance: ["Basis vorhanden"] }] },
      { type: "set_dependencies", dependencies: [{ taskId: "ARCHITECTURE", dependsOnTaskId: "FW-104" }] },
    ] });
    const applied = db.applyManagerPlan(plan.id);
    assert.equal(applied.plan.status, "applied");
    const task = db.listTasks("project-agent-harness").find((entry) => entry.planId === plan.id);
    assert.deepEqual(task.dependencies, ["FW-104"]);
    console.log("ok");
  `);
  assert.equal(output, "ok");
});

test("a confirmed manager plan can revise an existing ticket", () => {
  const output = run(`
    import assert from "node:assert/strict";
    const db = await import(${JSON.stringify(databaseModule)});
    const plan = db.createManagerPlan({ projectId: "project-agent-harness", summary: "Bestehendes Ticket präzisieren", actions: [{
      type: "update_tasks",
      updates: [{ taskId: "FW-115", title: "Run-Aktionssteuerung anbinden", priority: "High", acceptance: ["Run-Aktionen sind lokal erreichbar"] }],
    }] });
    const applied = db.applyManagerPlan(plan.id);
    const task = db.listTasks("project-agent-harness").find((entry) => entry.id === "FW-115");
    assert.equal(applied.tasks.length, 0);
    assert.equal(task.title, "Run-Aktionssteuerung anbinden");
    assert.equal(task.priority, "High");
    assert.deepEqual(task.acceptance, ["Run-Aktionen sind lokal erreichbar"]);
    console.log("ok");
  `);
  assert.equal(output, "ok");
});

test("a single manager plan can create and update tickets together", () => {
  const output = run(`
    import assert from "node:assert/strict";
    const db = await import(${JSON.stringify(databaseModule)});
    const plan = db.createManagerPlan({ projectId: "project-agent-harness", summary: "Neue und bestehende Tickets", actions: [
      { type: "create_tasks", tasks: [{ clientId: "new-feature", sequence: 10, title: "Neue Funktion", priority: "Medium", acceptance: ["Funktion ist testbar"] }] },
      { type: "update_tasks", updates: [{ taskId: "FW-115", sequence: 5, title: "Run-Aktionssteuerung verbindlich anbinden", acceptance: ["Run-Aktionen sind lokal erreichbar"] }] },
    ] });
    const applied = db.applyManagerPlan(plan.id);
    const tasks = db.listTasks("project-agent-harness");
    assert.equal(applied.plan.status, "applied");
    assert.ok(tasks.some((task) => task.title === "Neue Funktion"));
    assert.equal(tasks.find((task) => task.id === "FW-115").title, "Run-Aktionssteuerung verbindlich anbinden");
    assert.equal(tasks.find((task) => task.id === "FW-115").planSequence, 5);
    assert.equal(tasks.find((task) => task.id === "FW-115").planId, plan.id);
    console.log("ok");
  `);
  assert.equal(output, "ok");
});

test("update task plans accept the manager's compatible tasks alias", () => {
  const output = run(`
    import assert from "node:assert/strict";
    const { validateManagerDecision } = await import(${JSON.stringify(managerActionsModule)});
    const result = validateManagerDecision({
      schemaVersion: 2, reply: "Plan", mode: "planning", questions: [], assumptions: [], risks: [], summary: "",
      actions: [{ type: "update_tasks", tasks: [{ taskId: "FW-115", acceptance: ["Kriterium ist prüfbar"] }] }],
    });
    assert.equal(result.valid, true, result.errors.join(" "));
    assert.deepEqual(result.decision.actions[0].updates[0], { taskId: "FW-115", title: undefined, description: undefined, priority: undefined, sequence: undefined, acceptance: ["Kriterium ist prüfbar"] });
    console.log("ok");
  `);
  assert.equal(output, "ok");
});

test("full order corrections add sequence updates for existing dependency-chain tickets", () => {
  const output = run(`
    const { ensureOrderedExistingTasks } = await import(${JSON.stringify(managerActionsModule)});
    const fixed = ensureOrderedExistingTasks({ actions: [{ type: "set_dependencies", dependencies: [
      { taskId: "FW-2", dependsOnTaskId: "FW-1" },
    ] }] }, [{ id: "FW-1" }, { id: "FW-2" }], true);
    const update = fixed.actions.find((action) => action.type === "update_tasks");
    if (!update || update.updates.length !== 2 || update.updates[0].sequence !== 10 || update.updates[1].sequence !== 20) throw new Error(JSON.stringify(fixed));
    console.log("ok");
  `);
  assert.equal(output, "ok");
});

test("cycles roll back the entire ticket batch", () => {
  const output = run(`
    import assert from "node:assert/strict";
    const db = await import(${JSON.stringify(databaseModule)});
    const before = db.listTasks("project-agent-harness").length;
    const plan = db.createManagerPlan({ projectId: "project-agent-harness", summary: "Zyklus", actions: [{ type: "create_tasks", tasks: [
      { clientId: "one", title: "Eins", priority: "Medium", acceptance: ["Eins"], dependsOnClientIds: ["two"] },
      { clientId: "two", title: "Zwei", priority: "Medium", acceptance: ["Zwei"], dependsOnClientIds: ["one"] },
    ] }] });
    assert.throws(() => db.applyManagerPlan(plan.id), /Zyklus/);
    assert.equal(db.listTasks("project-agent-harness").length, before);
    assert.equal(db.getManagerPlan(plan.id).status, "awaiting_confirmation");
    console.log("ok");
  `);
  assert.equal(output, "ok");
});

test("failed tester results create a linked follow-up proposal instead of auto-starting work", () => {
  const output = run(`
    import assert from "node:assert/strict";
    const db = await import(${JSON.stringify(databaseModule)});
    const { finishTesterAndContinue } = await import(${JSON.stringify(workflowModule)});
    const started = db.startTesterRun("FW-118", "agent-tester-1", "project-agent-harness");
    assert.ok(started.runId);
    const result = finishTesterAndContinue(started.runId, { status: "failed", summary: "Reproduzierbarer Fehler", checks: [{ name: "Check", status: "failed" }] }, { launchNext: false });
    assert.equal(result.task.status, "Changes Requested");
    assert.equal(result.followUpPlan.status, "awaiting_confirmation");
    assert.equal(result.followUpPlan.tasks[0].parentTaskId, "FW-118");
    const applied = db.applyManagerPlan(result.followUpPlan.id);
    const followUp = applied.tasks[0];
    assert.equal(followUp.parentTaskId, "FW-118");
    assert.equal(followUp.status, "Ready");
    console.log("ok");
  `);
  assert.equal(output, "ok");
});

test("blocked tester results do not create a follow-up loop", () => {
  const output = run(`
    import assert from "node:assert/strict";
    const db = await import(${JSON.stringify(databaseModule)});
    const { finishTesterAndContinue } = await import(${JSON.stringify(workflowModule)});
    const started = db.startTesterRun("FW-118", "agent-tester-1", "project-agent-harness");
    assert.ok(started.runId);
    const result = finishTesterAndContinue(started.runId, { status: "blocked", summary: "Sandbox blockiert npm" }, { launchNext: true });
    assert.equal(result.task.status, "Blocked");
    assert.equal(result.followUpPlan, undefined);
    assert.equal(db.listTasks("project-agent-harness").filter((task) => task.parentTaskId === "FW-118").length, 0);
    console.log("ok");
  `);
  assert.equal(output, "ok");
});

test("the auto-process switch gates the developer-to-tester handoff", () => {
  const output = run(`
    import assert from "node:assert/strict";
    const { shouldAutoStartTester } = await import(${JSON.stringify(codexCliModule)});
    assert.equal(shouldAutoStartTester({ developerSucceeded: true, taskInReview: true, autoProcessEnabled: false }), false);
    assert.equal(shouldAutoStartTester({ developerSucceeded: true, taskInReview: true, autoProcessEnabled: true }), true);
    assert.equal(shouldAutoStartTester({ developerSucceeded: false, taskInReview: true, autoProcessEnabled: true }), false);
    assert.equal(shouldAutoStartTester({ developerSucceeded: true, taskInReview: false, autoProcessEnabled: true }), false);
    console.log("ok");
  `);
  assert.equal(output, "ok");
});

test("Codex runner arguments preserve a Windows workspace path and use workspace-write", () => {
  const output = run(`
    import assert from "node:assert/strict";
    const { codexExecArgs, codexExitDiagnostic } = await import(${JSON.stringify(codexCliModule)});
    const args = codexExecArgs({ workspace: "C:\\\\Users\\\\FroschiO\\\\Froschwerk NEU\\\\FroschwerkCRM-BusinessTool", model: "gpt-test", json: true, ignoreRules: true });
    assert.equal(args.includes("--ask-for-approval"), false);
    assert.equal(args.includes("--ignore-user-config"), false);
    assert.equal(args.includes("--ignore-rules"), true);
    assert.equal(args.includes("--approve-for-me"), true);
    assert.equal(args[args.indexOf("--cd") + 1], "C:\\\\Users\\\\FroschiO\\\\Froschwerk NEU\\\\FroschwerkCRM-BusinessTool");
    assert.equal(args[args.indexOf("--add-dir") + 1], args[args.indexOf("--cd") + 1]);
    assert.equal(args.includes("--sandbox"), false);
    assert.match(codexExitDiagnostic(2, "unexpected argument"), /CODEX_CLI_ARGUMENT_ERROR/);
    console.log("ok");
  `);
  assert.equal(output, "ok");
});

test("obsolete tickets retain history but cannot be claimed again", () => {
  const output = run(`
    import assert from "node:assert/strict";
    const db = await import(${JSON.stringify(databaseModule)});
    const task = db.createTask({ title: "Falsch erzeugtes Folge-Ticket" });
    const archived = db.archiveObsoleteTask(task.id, "Testergebnis war durch die Sandbox blockiert, kein Produktfehler.");
    assert.equal(archived.status, "Done");
    assert.ok(archived.obsoleteAt);
    assert.match(archived.obsoleteReason, /Sandbox/);
    assert.equal(db.claimNextTask("agent-developer-1", task.id, "project-agent-harness").reason, "task_not_ready");
    assert.ok(db.listTaskEvents(task.id).some((event) => event.eventType === "task.archived_obsolete"));
    assert.ok(db.listTasks().find((entry) => entry.id === task.id).comments.some((comment) => /obsolet abgeschlossen/i.test(comment.text)));
    console.log("ok");
  `);
  assert.equal(output, "ok");
});

test("completed follow-up tickets automatically resume the original ticket in review", () => {
  const output = run(`
    import assert from "node:assert/strict";
    const db = await import(${JSON.stringify(databaseModule)});
    const { finishTesterAndContinue } = await import(${JSON.stringify(workflowModule)});
    const failedTester = db.startTesterRun("FW-118", "agent-tester-1", "project-agent-harness");
    assert.ok(failedTester.runId);
    const failed = finishTesterAndContinue(failedTester.runId, { status: "failed", summary: "Reproduzierbarer Fehler" }, { launchNext: false });
    const applied = db.applyManagerPlan(failed.followUpPlan.id);
    const followUp = applied.tasks[0];
    const developer = db.claimNextTask("agent-developer-1", followUp.id, "project-agent-harness");
    assert.ok(developer.runId);
    db.markAgentRunRunning(developer.runId);
    db.finishAgentRun(developer.runId, { status: "succeeded", summary: "Folgefehler behoben" });
    const followUpTester = db.startTesterRun(followUp.id, "agent-tester-1", "project-agent-harness");
    assert.ok(followUpTester.runId);
    db.markAgentRunRunning(followUpTester.runId);
    const completed = finishTesterAndContinue(followUpTester.runId, { status: "passed", summary: "Folgefehler behoben und geprüft" }, { launchNext: false });
    assert.equal(completed.resumedSource.id, "FW-118");
    assert.equal(completed.resumedSource.status, "Review");
    assert.equal(db.listTasks("project-agent-harness").find((task) => task.id === "FW-118").status, "Review");
    assert.equal(db.getAgentRun(followUpTester.runId).status, "succeeded");
    console.log("ok");
  `);
  assert.equal(output, "ok");
});

test("an interrupted tester run releases the ticket for a retry", () => {
  const output = run(`
    import assert from "node:assert/strict";
    const db = await import(${JSON.stringify(databaseModule)});
    const { recoverTesterRun } = db;
    const started = db.startTesterRun("FW-118", "agent-tester-1", "project-agent-harness");
    assert.ok(started.runId);
    const recovered = recoverTesterRun(started.runId, { summary: "Testerprozess beendet" });
    assert.equal(recovered.status, "Review");
    assert.equal(recovered.activeRunId, null);
    assert.equal(db.listAgentRuns("FW-118", "project-agent-harness").find((run) => run.runId === started.runId).status, "lost");
    const restarted = db.startTesterRun("FW-118", "agent-tester-1", "project-agent-harness");
    assert.ok(restarted.runId);
    console.log("ok");
  `);
  assert.equal(output, "ok");
});

test("expired tester leases are released only by the lifecycle supervisor", () => {
  const output = run(`
    import assert from "node:assert/strict";
    import { DatabaseSync } from "node:sqlite";
    process.env.TESTER_TIMEOUT_MS = "1000";
    const db = await import(${JSON.stringify(databaseModule)});
    const workflow = await import(${JSON.stringify(workflowModule)});
    const started = db.startTesterRun("FW-118", "agent-tester-1", "project-agent-harness");
    assert.ok(started.runId);
    const raw = new DatabaseSync(process.env.HARNESS_DB_PATH);
    const old = new Date(Date.now() - 5000).toISOString();
    raw.prepare("UPDATE agent_runs SET started_at = ? WHERE id = ?").run(old, started.runId);
    raw.prepare("UPDATE agent_leases SET expires_at = ? WHERE run_id = ?").run(old, started.runId);
    raw.close();
    workflow.sweepAgentLifecycle();
    const cancelling = db.listTasks("project-agent-harness").find((task) => task.id === "FW-118");
    assert.equal(cancelling.status, "Testing");
    assert.equal(cancelling.activeRunId, started.runId);
    workflow.sweepAgentLifecycle();
    const recovered = db.listTasks("project-agent-harness").find((task) => task.id === "FW-118");
    assert.equal(recovered.status, "Review");
    assert.equal(recovered.activeRunId, null);
    assert.equal(db.startTesterRun("FW-118", "agent-tester-1", "project-agent-harness").runId !== undefined, true);
    console.log("ok");
  `);
  assert.equal(output, "ok");
});

test("project analysis stays bounded and excludes secret file contents", () => {
  const workspace = join(tmpdir(), `harness-analysis-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(workspace, { recursive: true });
  writeFileSync(join(workspace, "README.md"), "# Analyse\nProjektbeschreibung");
  writeFileSync(join(workspace, "package.json"), JSON.stringify({ name: "analysis-fixture", scripts: { test: "node --test" } }));
  mkdirSync(join(workspace, "docs", "DesignUpdate"), { recursive: true });
  writeFileSync(join(workspace, "docs", "DesignUpdate", "Umsetzungsplan Test.html"), "<h1>Konkreter Planinhalt</h1>");
  writeFileSync(join(workspace, ".env"), "TOP_SECRET=do-not-leak");
  const output = run(`
    import assert from "node:assert/strict";
    const { analyzeProjectWorkspace } = await import(${JSON.stringify(analysisModule)});
    const result = await analyzeProjectWorkspace({ id: "p", name: "Analyse", workspacePath: ${JSON.stringify(workspace)}, testCommand: "node --test" }, {});
    assert.equal(result.status, "succeeded");
    assert.ok(result.snapshot.fileTree.some((entry) => entry.path === ".env" && entry.excluded === "secret"));
    assert.equal(JSON.stringify(result.snapshot).includes("TOP_SECRET"), false);
    assert.equal(result.snapshot.package.name, "analysis-fixture");
    const planFile = result.snapshot.files.find((file) => file.path === "docs/DesignUpdate/Umsetzungsplan Test.html");
    assert.match(planFile?.content ?? "", /Konkreter Planinhalt/);
    console.log("ok");
  `);
  assert.equal(output, "ok");
});
