import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("..", import.meta.url));

test("workflow can claim the explicitly requested ticket", () => {
  const databasePath = join(tmpdir(), `harness-workflow-${process.pid}-${Date.now()}.sqlite`);
  const databaseModule = pathToFileURL(resolve(root, "db/local.ts")).href;
  const script = `
    process.env.HARNESS_DB_PATH = ${JSON.stringify(databasePath)};
    const { claimNextTask } = await import(${JSON.stringify(databaseModule)});
    const result = claimNextTask("agent-developer-1", "FW-115");
    if (result.task?.id !== "FW-115") throw new Error(JSON.stringify(result));
  `;
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
