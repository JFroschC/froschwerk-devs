import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("..", import.meta.url));

function waitForListening(child) {
  return new Promise((resolvePromise, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error(`API-Start Timeout:\n${output}`)), 10_000);
    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (output.includes("SQLite API listening")) {
        clearTimeout(timeout);
        resolvePromise();
      }
    });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`API endete vor dem Start mit ${code}:\n${output}`));
    });
  });
}

test("the local API serves workflow state and auto-mode control", async (context) => {
  const port = 32_000 + Math.floor(Math.random() * 2_000);
  const databasePath = join(tmpdir(), `harness-api-smoke-${process.pid}-${Date.now()}.sqlite`);
  const child = spawn(process.execPath, ["--experimental-strip-types", "scripts/api-server.mjs"], {
    cwd: root,
    env: { ...process.env, HARNESS_DB_PATH: databasePath, HARNESS_API_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(() => child.kill());
  await waitForListening(child);

  const base = `http://127.0.0.1:${port}`;
  const health = await fetch(`${base}/api/health/db`).then((response) => response.json());
  assert.equal(health.ok, true);

  const projects = await fetch(`${base}/api/projects`).then((response) => response.json());
  assert.ok(projects.projects.some((project) => project.id === "project-agent-harness"));

  const idleResponse = await fetch(`${base}/api/workflow/advance`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId: "project-agent-harness" }),
  });
  assert.equal(idleResponse.status, 200);
  assert.deepEqual(await idleResponse.json(), { type: "none", reason: "auto_process_disabled" });

  const disabled = await fetch(`${base}/api/projects/project-agent-harness`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ autoProcessEnabled: false }),
  }).then((response) => response.json());
  assert.equal(disabled.project.autoProcessEnabled, false);

  const cancelMissing = await fetch(`${base}/api/agent-runs/missing-run/cancel`, { method: "POST" });
  assert.equal(cancelMissing.status, 409);
  assert.equal((await cancelMissing.json()).reason, "run_not_active");

  const compatibilityCancel = await fetch(`${base}/api/agent-runs/missing-run/finish`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "cancelled" }),
  });
  assert.equal(compatibilityCancel.status, 409);
  assert.equal((await compatibilityCancel.json()).reason, "run_not_active");
});
