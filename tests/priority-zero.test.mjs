import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("..", import.meta.url));
const databaseModule = pathToFileURL(resolve(root, "db/local.ts")).href;
const mcpModule = pathToFileURL(resolve(root, "db/mcp-tools.ts")).href;

function databasePath() {
  return join(tmpdir(), `harness-priority-zero-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`);
}

function runWithDatabase(path, script) {
  const source = `process.env.HARNESS_DB_PATH = ${JSON.stringify(path)};\n${script}`;
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", source], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

test("stored provider assignments survive reopening the database", () => {
  const path = databasePath();
  runWithDatabase(path, `
    const db = await import(${JSON.stringify(databaseModule)});
    db.updateAgent("agent-developer-2", { provider: "codex" });
    console.log("updated");
  `);
  assert.equal(runWithDatabase(path, `
    const db = await import(${JSON.stringify(databaseModule)});
    if (db.getAgent("agent-developer-2").provider !== "codex") throw new Error("provider was overwritten");
    console.log("ok");
  `), "ok");
});

test("only a valid active run can be completed", () => {
  const path = databasePath();
  assert.equal(runWithDatabase(path, `
    import assert from "node:assert/strict";
    const db = await import(${JSON.stringify(databaseModule)});
    const developer = db.claimNextTask("agent-developer-1", "FW-115", "project-agent-harness");
    assert.ok(developer.runId);
    db.markAgentRunRunning(developer.runId);
    assert.throws(() => db.finishAgentRun(developer.runId, { status: "succeeded", nextStatus: "Done" }), /Ungültiger Folgestatus/);
    assert.equal(db.getAgentRun(developer.runId).status, "running");
    assert.ok(db.finishAgentRun(developer.runId, { status: "succeeded" }));
    const tester = db.startTesterRun("FW-115", "agent-tester-1", "project-agent-harness");
    assert.ok(tester.runId);
    assert.equal(db.finishAgentRun(tester.runId, { status: "failed" }), undefined);
    console.log("ok");
  `), "ok");
});

test("direct developer runner rejects a task without its active run id", () => {
  const path = databasePath();
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/run-agent.mjs", "--agent", "agent-developer-1", "--task", "FW-115"], {
    cwd: root,
    env: { ...process.env, HARNESS_DB_PATH: path },
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}\n${result.stdout}`, /--run-id ist bei einem direkten --task-Start erforderlich/);
});

test("MCP ticket schemas accept project-independent ticket prefixes", async () => {
  const { mcpToolContract } = await import(mcpModule);
  for (const tool of mcpToolContract.tools) {
    const taskId = tool.inputSchema.properties.taskId;
    if (!taskId) continue;
    const pattern = new RegExp(taskId.pattern);
    assert.match("FBT-477-A56D", pattern);
    assert.doesNotMatch("invalid id", pattern);
  }
});
