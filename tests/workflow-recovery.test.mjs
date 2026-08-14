import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("..", import.meta.url));
const databaseModule = pathToFileURL(resolve(root, "db/local.ts")).href;
const workflowModule = pathToFileURL(resolve(root, "scripts/workflow-orchestrator.mjs")).href;

function run(script) {
  const databasePath = join(tmpdir(), `harness-recovery-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`);
  const source = `process.env.HARNESS_DB_PATH = ${JSON.stringify(databasePath)};\n${script}`;
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", source], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

test("Changes Requested tickets are claimed atomically", () => {
  assert.equal(run(`
    import assert from "node:assert/strict";
    const db = await import(${JSON.stringify(databaseModule)});
    db.updateTask("FW-118", { status: "Changes Requested" });
    const claimed = db.claimNextTask("agent-developer-1", "FW-118", "project-agent-harness");
    assert.ok(claimed.runId);
    assert.equal(claimed.task.status, "In Progress");
    assert.equal(claimed.task.activeRunId, claimed.runId);
    assert.equal(db.getAgentRun(claimed.runId).status, "running");
    console.log("ok");
  `), "ok");
});

test("developer failures retry only to the configured boundary", () => {
  assert.equal(run(`
    import assert from "node:assert/strict";
    const db = await import(${JSON.stringify(databaseModule)});
    const task = db.createTask({ title: "Retry-Grenze" });
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const claimed = db.claimNextTask("agent-developer-1", task.id, "project-agent-harness");
      assert.ok(claimed.runId);
      const finished = db.finishAgentRun(claimed.runId, { status: "failed", error: "CLI_FAILURE", nextStatus: "Ready" });
      assert.equal(finished.retryCount, attempt);
      assert.equal(finished.status, attempt === 3 ? "Blocked" : "Ready");
      const repeated = db.finishAgentRun(claimed.runId, { status: "failed", error: "DUPLICATE" });
      assert.equal(repeated.retryCount, attempt);
    }
    assert.equal(db.claimNextTask("agent-developer-1", task.id, "project-agent-harness").reason, "task_not_ready");
    const reset = db.updateTask(task.id, { status: "Ready" });
    assert.equal(reset.retryCount, 0);
    assert.ok(db.claimNextTask("agent-developer-1", task.id, "project-agent-harness").runId);
    console.log("ok");
  `), "ok");
});

test("lease heartbeats preserve live work and expired developer runs recover", () => {
  assert.equal(run(`
    import assert from "node:assert/strict";
    import { DatabaseSync } from "node:sqlite";
    const db = await import(${JSON.stringify(databaseModule)});
    const task = db.createTask({ title: "Heartbeat" });
    const live = db.claimNextTask("agent-developer-1", task.id, "project-agent-harness");
    const raw = new DatabaseSync(process.env.HARNESS_DB_PATH);
    raw.prepare("UPDATE agent_leases SET expires_at = ? WHERE run_id = ?").run(new Date(Date.now() - 5000).toISOString(), live.runId);
    raw.close();
    assert.equal(db.renewAgentRunLease(live.runId).renewed, true);
    assert.equal(db.listTasks().find((entry) => entry.id === task.id).status, "In Progress");
    const rawAgain = new DatabaseSync(process.env.HARNESS_DB_PATH);
    rawAgain.prepare("UPDATE agent_leases SET expires_at = ? WHERE run_id = ?").run(new Date(Date.now() - 5000).toISOString(), live.runId);
    rawAgain.close();
    const recovered = db.listTasks().find((entry) => entry.id === task.id);
    assert.equal(recovered.status, "Ready");
    assert.equal(recovered.activeRunId, null);
    assert.equal(recovered.retryCount, 1);
    assert.equal(db.getAgentRun(live.runId).status, "failed");
    console.log("ok");
  `), "ok");
});

test("tester process recovery is bounded and eventually blocks the loop", () => {
  assert.equal(run(`
    import assert from "node:assert/strict";
    const db = await import(${JSON.stringify(databaseModule)});
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const started = db.startTesterRun("FW-118", "agent-tester-1", "project-agent-harness");
      assert.ok(started.runId);
      const recovered = db.recoverTesterRun(started.runId, { summary: "Prozessabbruch" });
      assert.equal(recovered.status, attempt === 3 ? "Blocked" : "Review");
    }
    assert.equal(db.startTesterRun("FW-118", "agent-tester-1", "project-agent-harness").reason, "task_not_ready_for_testing");
    console.log("ok");
  `), "ok");
});

test("a user-cancelled tester run does not consume the recovery boundary", () => {
  assert.equal(run(`
    import assert from "node:assert/strict";
    const db = await import(${JSON.stringify(databaseModule)});
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const started = db.startTesterRun("FW-118", "agent-tester-1", "project-agent-harness");
      db.recoverTesterRun(started.runId, { summary: "Technischer Abbruch" });
    }
    const cancelled = db.startTesterRun("FW-118", "agent-tester-1", "project-agent-harness");
    const recovered = db.recoverTesterRun(cancelled.runId, { summary: "Benutzerabbruch", error: "USER_CANCELLED", countRecovery: false });
    assert.equal(recovered.status, "Review");
    assert.equal(recovered.activeRunId, null);
    console.log("ok");
  `), "ok");
});

test("repeated tester failures stop creating nested follow-up tickets", () => {
  assert.equal(run(`
    import assert from "node:assert/strict";
    const db = await import(${JSON.stringify(databaseModule)});
    const workflow = await import(${JSON.stringify(workflowModule)});
    let taskId = "FW-118";
    for (let failure = 1; failure <= 3; failure += 1) {
      if (failure > 1) {
        const developer = db.claimNextTask("agent-developer-1", taskId, "project-agent-harness");
        assert.ok(developer.runId);
        db.finishAgentRun(developer.runId, { status: "succeeded" });
      }
      const tester = db.startTesterRun(taskId, "agent-tester-1", "project-agent-harness");
      assert.ok(tester.runId);
      const result = workflow.finishTesterAndContinue(tester.runId, { status: "failed", summary: "Fehlerstufe " + failure }, { launchNext: false });
      if (failure < 3) {
        assert.ok(result.followUpPlan);
        const applied = db.applyManagerPlan(result.followUpPlan.id);
        taskId = applied.tasks[0].id;
      } else {
        assert.equal(result.reason, "tester_failure_chain_exhausted");
        assert.equal(result.task.status, "Blocked");
        assert.equal(result.followUpPlan, undefined);
      }
    }
    console.log("ok");
  `), "ok");
});

test("auto mode prioritizes Review before Ready and observes active runs", () => {
  assert.equal(run(`
    import assert from "node:assert/strict";
    const db = await import(${JSON.stringify(databaseModule)});
    const workflow = await import(${JSON.stringify(workflowModule)});
    db.updateProject("project-agent-harness", { autoProcessEnabled: true });
    const first = workflow.selectAutoProcessAction("project-agent-harness");
    assert.equal(first.type, "tester");
    assert.equal(first.task.id, "FW-118");
    const started = db.startTesterRun(first.task.id, "agent-tester-1", "project-agent-harness");
    assert.ok(started.runId);
    assert.equal(workflow.selectAutoProcessAction("project-agent-harness").type, "wait");
    console.log("ok");
  `), "ok");
});

test("the tester runner completes an isolated CLI-to-database smoke flow", { skip: process.platform !== "win32" }, () => {
  const databasePath = join(tmpdir(), `harness-tester-smoke-${process.pid}-${Date.now()}.sqlite`);
  const prepare = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", `
    process.env.HARNESS_DB_PATH = ${JSON.stringify(databasePath)};
    const db = await import(${JSON.stringify(databaseModule)});
    db.updateProject("project-agent-harness", { testCommand: "node --version" });
    console.log(db.startTesterRun("FW-118", "agent-tester-1", "project-agent-harness").runId);
  `], { cwd: root, encoding: "utf8" });
  assert.equal(prepare.status, 0, prepare.stderr || prepare.stdout);
  const runId = prepare.stdout.trim();
  assert.match(runId, /^run-/);

  const env = { ...process.env, HARNESS_DB_PATH: databasePath, APPDATA: resolve(tmpdir(), "harness-missing-appdata"), CODEX_HOME: tmpdir(), PATH: `${resolve(root, "tests/fixtures")};${process.env.PATH ?? ""}` };
  delete env.OPENAI_API_KEY;
  const runner = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/run-tester.mjs", "--run-id", runId], { cwd: root, env, encoding: "utf8", timeout: 30_000 });
  assert.equal(runner.status, 0, runner.stderr || runner.stdout);

  const verify = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", `
    process.env.HARNESS_DB_PATH = ${JSON.stringify(databasePath)};
    const db = await import(${JSON.stringify(databaseModule)});
    const run = db.getAgentRun(${JSON.stringify(runId)});
    const task = db.listTasks("project-agent-harness").find((entry) => entry.id === "FW-118");
    if (run.status !== "succeeded" || task.status !== "Done" || task.activeRunId !== null) throw new Error(JSON.stringify({ run, task }));
    console.log("ok");
  `], { cwd: root, encoding: "utf8" });
  assert.equal(verify.status, 0, verify.stderr || verify.stdout);
  assert.equal(verify.stdout.trim(), "ok");
});

test("the developer runner completes an isolated CLI-to-database smoke flow", { skip: process.platform !== "win32" }, () => {
  const databasePath = join(tmpdir(), `harness-developer-smoke-${process.pid}-${Date.now()}.sqlite`);
  const prepare = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", `
    process.env.HARNESS_DB_PATH = ${JSON.stringify(databasePath)};
    const db = await import(${JSON.stringify(databaseModule)});
    db.updateProject("project-agent-harness", { testCommand: "node --version" });
    const claimed = db.claimNextTask("agent-developer-1", "FW-115", "project-agent-harness");
    console.log(claimed.runId);
  `], { cwd: root, encoding: "utf8" });
  assert.equal(prepare.status, 0, prepare.stderr || prepare.stdout);
  const runId = prepare.stdout.trim();
  assert.match(runId, /^run-/);

  const env = { ...process.env, HARNESS_DB_PATH: databasePath, APPDATA: resolve(tmpdir(), "harness-missing-appdata"), CODEX_HOME: tmpdir(), PATH: `${resolve(root, "tests/fixtures")};${process.env.PATH ?? ""}` };
  delete env.OPENAI_API_KEY;
  const runner = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/run-agent.mjs", "--agent", "agent-developer-1", "--task", "FW-115", "--run-id", runId, "--workspace", root], { cwd: root, env, encoding: "utf8", timeout: 30_000 });
  assert.equal(runner.status, 0, runner.stderr || runner.stdout);

  const verify = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", `
    process.env.HARNESS_DB_PATH = ${JSON.stringify(databasePath)};
    const db = await import(${JSON.stringify(databaseModule)});
    const run = db.getAgentRun(${JSON.stringify(runId)});
    const task = db.listTasks("project-agent-harness").find((entry) => entry.id === "FW-115");
    const gate = db.listAgentRequests("project-agent-harness").find((request) => request.runId === ${JSON.stringify(runId)} && request.role === "developer-test-command");
    if (run.status !== "succeeded" || task.status !== "Review" || task.activeRunId !== null || !task.comments.some((comment) => comment.role === "Entwickler") || gate?.status !== "succeeded") throw new Error(JSON.stringify({ run, task, gate }));
    console.log("ok");
  `], { cwd: root, encoding: "utf8" });
  assert.equal(verify.status, 0, verify.stderr || verify.stdout);
  assert.equal(verify.stdout.trim(), "ok");
});

test("the developer gate keeps a failing full suite away from review", { skip: process.platform !== "win32" }, () => {
  const databasePath = join(tmpdir(), `harness-developer-gate-${process.pid}-${Date.now()}.sqlite`);
  const prepare = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", `
    process.env.HARNESS_DB_PATH = ${JSON.stringify(databasePath)};
    const db = await import(${JSON.stringify(databaseModule)});
    db.updateProject("project-agent-harness", { testCommand: "node -e \\"process.exit(7)\\"" });
    console.log(db.claimNextTask("agent-developer-1", "FW-115", "project-agent-harness").runId);
  `], { cwd: root, encoding: "utf8" });
  assert.equal(prepare.status, 0, prepare.stderr || prepare.stdout);
  const runId = prepare.stdout.trim();
  assert.match(runId, /^run-/);

  const env = { ...process.env, HARNESS_DB_PATH: databasePath, APPDATA: resolve(tmpdir(), "harness-missing-appdata"), CODEX_HOME: tmpdir(), PATH: `${resolve(root, "tests/fixtures")};${process.env.PATH ?? ""}` };
  delete env.OPENAI_API_KEY;
  const runner = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/run-agent.mjs", "--agent", "agent-developer-1", "--task", "FW-115", "--run-id", runId, "--workspace", root], { cwd: root, env, encoding: "utf8", timeout: 30_000 });
  assert.equal(runner.status, 1, runner.stderr || runner.stdout);

  const verify = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", `
    process.env.HARNESS_DB_PATH = ${JSON.stringify(databasePath)};
    const db = await import(${JSON.stringify(databaseModule)});
    const run = db.getAgentRun(${JSON.stringify(runId)});
    const task = db.listTasks("project-agent-harness").find((entry) => entry.id === "FW-115");
    const gate = db.listAgentRequests("project-agent-harness").find((request) => request.runId === ${JSON.stringify(runId)} && request.role === "developer-test-command");
    if (run.status !== "failed" || task.status !== "Ready" || task.activeRunId !== null || gate?.status !== "failed" || !task.comments.some((comment) => /Testgate ist fehlgeschlagen/i.test(comment.text))) throw new Error(JSON.stringify({ run, task, gate }));
    console.log("ok");
  `], { cwd: root, encoding: "utf8" });
  assert.equal(verify.status, 0, verify.stderr || verify.stdout);
  assert.equal(verify.stdout.trim(), "ok");
});
