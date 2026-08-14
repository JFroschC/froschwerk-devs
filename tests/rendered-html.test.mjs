import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the taskboard shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /Froschwerk/);
  assert.match(html, /Ticket-Board/);
  assert.match(html, /AGENTENSTATUS/);
  assert.match(html, /Codex-Abo/);
  assert.match(html, /Claude-Abo/);
  assert.match(html, /Mira/);
});

test("contains the provider assignment workflow", async () => {
  const [page, api, database, runner, testerRunner, managerRunner, managerRoute, managerActions] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../scripts/api-server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../db/local.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/run-agent.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/run-tester.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/manager-runner.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/api/chat/manager/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/manager-actions.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(page, /agent-provider-select/);
  assert.match(page, /\/api\/agents/);
  assert.match(api, /\/api\/chat\/manager/);
  assert.match(page, /requestSubmit\(\)/);
  assert.match(page, /setInterval\(sync, 2000\)/);
  assert.match(page, /Live-Sync aktiv/);
  assert.match(database, /provider TEXT NOT NULL DEFAULT 'codex'/);
  assert.match(database, /agent-developer-2.*claude|claude.*agent-developer-2/s);
  assert.match(runner, /configuredAgent/);
  assert.match(runner, /DEVELOPER_CODEX_MODEL/);
  assert.match(runner, /DEVELOPER_CODEX_REASONING_EFFORT/);
  assert.match(testerRunner, /TESTER_CODEX_MODEL/);
  assert.match(testerRunner, /TESTER_CODEX_REASONING_EFFORT/);
  assert.match(managerRunner, /MANAGER_CODEX_MODEL/);
  assert.match(managerRunner, /MANAGER_CODEX_REASONING_EFFORT/);
  assert.match(page, /await askLiveManager\(text\)/);
  assert.match(page, /chatMessagesRef/);
  assert.match(managerRoute, /registerManagerDecision/);
  assert.match(managerRoute, /Persistenter Gesprächszustand/);
  assert.match(managerActions, /schemaVersion/);
  assert.match(managerActions, /create_tasks/);
  assert.match(managerRoute, /listChatMessages\(20, projectId\)/);
  assert.match(page, /activeProjectId/);
  assert.match(page, /Projekt bearbeiten/);
  assert.match(managerRoute, /Aktives Projekt/);
  assert.match(managerActions, /start_task/);
});
