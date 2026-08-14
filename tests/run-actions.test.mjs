import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("..", import.meta.url));
const databaseModule = pathToFileURL(resolve(root, "db/local.ts")).href;
const actionModule = pathToFileURL(resolve(root, "scripts/run-actions.mjs")).href;

function run(script) {
  const databasePath = join(tmpdir(), `harness-run-actions-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`);
  const source = `process.env.HARNESS_DB_PATH = ${JSON.stringify(databasePath)};\n${script}`;
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", source], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

test("run actions persist declined confirmations and stale retry rejections without changing the active run", () => {
  assert.equal(run(`
    import assert from "node:assert/strict";
    const db = await import(${JSON.stringify(databaseModule)});
    const actions = await import(${JSON.stringify(actionModule)});
    const claimed = db.claimNextTask("agent-developer-1", "FW-115", "project-agent-harness");
    assert.ok(claimed.runId);
    const declined = actions.performRunStopAction({ runId: claimed.runId, confirmation: "declined" });
    assert.equal(declined.ok, true);
    assert.equal(db.getAgentRun(claimed.runId).status, "queued");
    const rejected = actions.performTaskRunAction({ taskId: "FW-115", projectId: "project-agent-harness", action: "retry", role: "developer", confirmation: "confirmed", sourceRunId: claimed.runId });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.reason, "retry_source_not_terminal");
    assert.equal(db.getAgentRun(claimed.runId).status, "queued");
    const events = db.listTaskEvents("FW-115");
    assert.ok(events.some((event) => event.eventType === "agent.action_declined" && event.payload.action === "stop"));
    assert.ok(events.some((event) => event.eventType === "agent.action_confirmed" && event.payload.action === "retry"));
    assert.ok(events.some((event) => event.eventType === "agent.action_rejected" && event.payload.reason === "retry_source_not_terminal"));
    console.log("ok");
  `), "ok");
});
