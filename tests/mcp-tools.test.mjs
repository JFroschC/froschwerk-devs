import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("..", import.meta.url));

function runStripTypes(script) {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

test("documents the MCP tool contract", async () => {
  const document = await readFile(new URL("../docs/MCP-TOOLS.md", import.meta.url), "utf8");
  assert.match(document, /harness\.task\.read/);
  assert.match(document, /harness\.task\.comment/);
  assert.match(document, /harness\.task\.transition/);
  assert.match(document, /harness\.agent_runs\.list/);
  assert.match(document, /Ready.*In Progress/s);
});

test("MCP tools restrict status changes and expose an audit trail", () => {
  const databasePath = join(tmpdir(), `harness-mcp-${process.pid}-${Date.now()}.sqlite`);
  const toolsPath = pathToFileURL(resolve(root, "db/mcp-tools.ts")).href;
  runStripTypes(`
    import assert from "node:assert/strict";

    process.env.HARNESS_DB_PATH = ${JSON.stringify(databasePath)};
    const {
      listMcpTools,
      mcpCommentOnTask,
      mcpReadTask,
      mcpTransitionTask,
    } = await import(${JSON.stringify(toolsPath)});

    assert.deepEqual(listMcpTools().map((tool) => tool.name), [
      "harness.task.read",
      "harness.task.comment",
      "harness.task.transition",
      "harness.agent_runs.list",
    ]);

    const initial = mcpReadTask({ taskId: "FW-115" });
    assert.equal(initial.task.status, "Ready");
    assert.ok(Array.isArray(initial.agentRuns));
    assert.ok(Array.isArray(initial.events));

    assert.throws(
      () => mcpTransitionTask({ taskId: "FW-115", status: "Done" }),
      /Statuswechsel von Ready nach Done ist nicht erlaubt/,
    );

    const afterComment = mcpCommentOnTask({
      taskId: "FW-115",
      body: "MCP-Vertrag vorbereitet.",
      actor: { actorId: "agent-developer-1", authorName: "Codex", runId: "run-test" },
    });
    assert.ok(afterComment.events.some((event) => event.eventType === "comment.created" && event.payload.runId === "run-test"));

    const afterTransition = mcpTransitionTask({
      taskId: "FW-115",
      status: "In Progress",
      reason: "Agent startet Umsetzung.",
      actor: { actorId: "agent-developer-1", authorName: "Codex", runId: "run-test" },
    });
    assert.equal(afterTransition.task.status, "In Progress");
    assert.ok(afterTransition.events.some((event) =>
      event.eventType === "mcp.status_changed" &&
      event.payload.fromStatus === "Ready" &&
      event.payload.toStatus === "In Progress" &&
      event.payload.runId === "run-test"
    ));
  `);
});
