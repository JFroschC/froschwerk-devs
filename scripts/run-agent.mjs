import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { addComment, claimNextTask, finalizeAgentRunCancellation, finishAgentRun, getAgent, getAgentRun, getProject, isAgentRunCancellationRequested, listTasks, markAgentRunRunning, renewAgentRunLease, reportAgentRunActivity } from "../db/local.ts";
import { providerDefinition } from "./providers.mjs";
import { extractUsage } from "./request-usage.mjs";
import { finishAgentRequest, startAgentRequest } from "../db/local.ts";
import { codexExecArgs, codexExitDiagnostic, shouldAutoStartTester } from "./codex-cli.mjs";
import { commandInvocation, runtimeEnvironment } from "./runtime-env.mjs";
import { createCodexTurnTracker } from "./codex-turn-events.mjs";
import { resolveProjectTestCommand } from "./project-test-command.mjs";
import { classifyProjectTestResult, projectTestFailureExcerpt } from "./project-test-result.mjs";

const args = process.argv.slice(2);
const valueFor = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const requestedProvider = valueFor("--provider");
const requestedAgentId = valueFor("--agent");
const agentId = requestedAgentId ?? (requestedProvider === "claude" ? "agent-developer-2" : "agent-developer-1");
const configuredAgent = getAgent(agentId);
const provider = requestedProvider ?? String(configuredAgent?.provider ?? "codex");
const workspace = valueFor("--workspace") ?? process.cwd();
const taskId = valueFor("--task");
const requestedRunId = valueFor("--run-id");
const definition = providerDefinition(provider);
// The developer handles the highest-volume interactive work. Keep this role
// independent from the global Codex model selected for Mira or a local TUI.
const developerCodexModel = process.env.DEVELOPER_CODEX_MODEL ?? "gpt-5.6-terra";
const developerCodexReasoningEffort = process.env.DEVELOPER_CODEX_REASONING_EFFORT ?? "medium";
// A command-level override is intentional: the user's current global tier is
// "priority", which should not silently make every developer run accelerated.
const developerCodexServiceTier = process.env.DEVELOPER_CODEX_SERVICE_TIER ?? "default";

if (!definition) throw new Error(`Unbekannter Provider: ${provider}`);
if (!configuredAgent) throw new Error(`Unbekannter Agent: ${agentId}`);
if (provider === "codex" && process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY ist gesetzt. Entferne ihn, damit Codex das ChatGPT-Login verwendet.");
if (provider === "claude" && process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY ist gesetzt. Entferne ihn, damit Claude das Abo-Login verwendet.");

const task = taskId ? listTasks().find((item) => item.id === taskId) : undefined;
if (taskId && !task) throw new Error(`Ticket nicht gefunden: ${taskId}`);
if (taskId && !requestedRunId) throw new Error("--run-id ist bei einem direkten --task-Start erforderlich");
if (task && requestedRunId) {
  const activeRun = getAgentRun(requestedRunId);
  if (!activeRun || activeRun.role !== "developer" || activeRun.agentId !== agentId
    || activeRun.taskId !== task.id || !["queued", "starting", "running", "cancelling"].includes(String(activeRun.status))
    || task.activeRunId !== requestedRunId || task.activeRunRole !== "developer") {
    throw new Error(`Run ${requestedRunId} ist nicht der gültige aktive Entwickler-Lauf für ${task.id}`);
  }
}
const claim = task ? { task, runId: requestedRunId } : claimNextTask(agentId);
if (!claim.task) throw new Error(`Kein Ticket verfügbar (${claim.reason ?? "unbekannt"})`);

const recentActivity = (claim.task.comments ?? []).slice(-5).map((comment) =>
  `- ${comment.role ?? comment.author ?? "Aktivität"}: ${String(comment.text ?? "").slice(0, 2_500)}`
).join("\n");

const prompt = `Du arbeitest als Entwickler-Agent im lokalen Agent Harness. Bearbeite genau dieses Ticket: ${claim.task.id} – ${claim.task.title}

Beschreibung:
${claim.task.description}

Akzeptanzkriterien:
${claim.task.acceptance.map((item) => `- ${item}`).join("\n")}

${recentActivity ? `Letzte relevante Ticket-Aktivität:\n${recentActivity}\n` : ""}

Arbeitsregeln:
- Arbeite nur im aktuellen Repository und im Scope dieses Tickets.
- Prüfe den Ist-Zustand gezielt: Suche zuerst nach relevanten Dateien und öffne nur passende Ausschnitte (maximal etwa 250 Zeilen pro Lesevorgang).
- Lies niemals generierte Verzeichnisse oder große Artefakte vollständig (node_modules, dist, .next, coverage, Lock-Dateien, Binärdateien oder Logs) und wiederhole keine bereits gelesenen Ausgaben.
- Implementiere die kleinste sinnvolle Änderung.
- Suche vor der Implementierung repositoryweit nach bestehenden Tests, die die von dir geänderten Routen, Entitäten, Enums, Schemafelder oder Verträge verwenden. Wenn eine beabsichtigte fachliche Änderung eine alte Testannahme ungültig macht, aktualisiere diesen Test im selben Ticket, ohne seine sinnvolle Abdeckung zu entfernen.
- Jeder Test, der HTTP-Server, Datenbanken, Worker, Timer, Streams oder temporäre Dateien erzeugt, muss die Bereinigung unmittelbar nach der Erzeugung registrieren oder mit try/finally absichern. Cleanup darf niemals nur hinter Assertions stehen, weil eine fehlgeschlagene Assertion sonst den gesamten Testprozess offen hält.
- Führe relevante Tests und Checks aus. Verwende unter Node 24.15 auf Windows niemals --test-force-exit, weil diese Option beim Schließen von HTTP-Handles einen libuv-Absturz auslösen kann. Sorge in Testcode stattdessen mit finally-Hooks dafür, dass Server und Datenbanken auch nach fehlgeschlagenen Assertions geschlossen werden.
- Führe gezielte Tests für deine Änderung aus. Der Harness startet nach deiner Abschlussantwort automatisch genau einmal die vollständige Projektsuite und gibt das Ticket nur bei Erfolg an den Tester weiter. Beende keine Endlosschleife aus Analyse und Einzeltests – fasse den aktuellen Stand zusammen, wenn du ohne neue Erkenntnis nicht weiterkommst.
- Schreibe keine fragilen Tests gegen exakte sichtbare UI-Texte, Copytexte, Fehlermeldungsformulierungen, CSS-Klassen oder andere reine Implementierungsdetails. Eine redaktionelle Textänderung darf keinen Test brechen.
- Prüfe stattdessen stabiles Verhalten und fachliche Verträge: Statuscodes, Daten, Persistenz, Beziehungen, Validierung, API-Strukturen und semantische UI-Struktur. Exakte Texte sind nur zulässig, wenn sie ausdrücklich als fachlicher oder öffentlicher Vertrag gefordert sind. Stabilisiere bestehende fragile Tests, statt den Produktivtext festzuschreiben.
- Ändere keine Secrets und keine Dateien außerhalb des Workspaces.
- Gib am Ende eine kurze Zusammenfassung mit geänderten Dateien, Tests und offenen Risiken aus. Der Harness speichert diese Abschlussantwort automatisch als Kommentar im Ticket.`;

const commandArgs = provider === "codex"
  ? codexExecArgs({ workspace, model: developerCodexModel, reasoningEffort: developerCodexReasoningEffort, serviceTier: developerCodexServiceTier, sandbox: "workspace-write", json: true, skipGitRepoCheck: !existsSync(join(workspace, ".git")), ignoreRules: true })
  : ["-p", "--output-format", "json", "--permission-mode", "acceptEdits", "--allowedTools", "Read", "Edit", "Glob", "Grep", "Bash(npm.cmd test)", "Bash(npm.cmd run *)", "Bash(git status *)", "Bash(git diff *)", "Bash(git log *)", "--no-session-persistence"];

function jsonValuesFromText(value) {
  if (typeof value !== "string" || !value.trim()) return [];
  try { return [JSON.parse(value)]; } catch { /* Codex emits JSONL below. */ }
  return value.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

function developerSummary(stdout, stderr) {
  const messages = [];
  for (const value of jsonValuesFromText(stdout)) {
    if (typeof value?.result === "string") messages.push(value.result);
    if (value?.type === "item.completed" && value.item?.type === "agent_message" && typeof value.item.text === "string") messages.push(value.item.text);
    if (typeof value?.message?.content === "string") messages.push(value.message.content);
  }
  const fallback = `${stdout}\n${stderr}`.trim();
  const summary = String(messages.at(-1) ?? fallback ?? "Keine Abschlussnachricht vom Entwickler erhalten.").trim();
  return summary.length > 7_500 ? `${summary.slice(0, 7_500)}\n\n[Ausgabe gekürzt]` : summary;
}

console.log(`[agent-runner] Starte ${definition.label} für ${claim.task.id}`);
const request = startAgentRequest({ projectId: claim.task.projectId, taskId: claim.task.id, runId: claim.runId, agentId, role: "developer", provider, model: provider === "codex" ? developerCodexModel : "claude-subscription", command: `${definition.command} ${commandArgs.join(" ")}`, prompt });
const cliEnv = runtimeEnvironment(workspace);
const invocation = commandInvocation(definition.command, commandArgs, cliEnv);
const child = spawn(invocation.command, invocation.args, {
  cwd: workspace,
  env: cliEnv,
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: false,
  shell: false,
});
let stdout = "";
let stderr = "";
let timedOut = false;
let receivedAgentOutput = false;
let timeoutReason = "";
let developerCommentPublished = false;
const codexTurnTracker = createCodexTurnTracker();
let leaseOwnershipLost = false;
let cancellationRequested = false;
function publishDeveloperComment(outcome, output = stdout, errors = stderr, details = "") {
  if (developerCommentPublished) return;
  developerCommentPublished = true;
  try {
    addComment(claim.task.id, {
      authorType: "developer",
      authorId: agentId,
      authorName: configuredAgent.name,
      runId: claim.runId,
      body: `${outcome}\n\n${developerSummary(output, errors)}${details ? `\n\n${details}` : ""}`,
    });
  } catch (error) {
    console.error("[agent-runner] Entwicklerkommentar konnte nicht gespeichert werden", error);
  }
}
// A developer that is actively producing Codex events should be allowed to
// continue. Only an entirely silent start or an actual output stall is timed
// out. Environment overrides keep the policy configurable per installation.
const initialOutputTimeoutMs = Number(process.env.DEVELOPER_INITIAL_OUTPUT_TIMEOUT_MS ?? 60_000);
const idleOutputTimeoutMs = Number(process.env.DEVELOPER_IDLE_OUTPUT_TIMEOUT_MS ?? 600_000);
const maxRunMs = Number(process.env.DEVELOPER_MAX_RUN_MS ?? 25 * 60_000);
let inactivityTimeout;
let maxRunTimeout;
function terminateDeveloperProcess(force = false) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/t", ...(force ? ["/f"] : [])], { windowsHide: true, stdio: "ignore" });
  } else {
    child.kill(force ? "SIGKILL" : "SIGTERM");
  }
}

function renewLeaseOwnership() {
  if (!claim.runId || leaseOwnershipLost) return;
  const renewal = renewAgentRunLease(claim.runId);
  if (!renewal.renewed) {
    leaseOwnershipLost = true;
    console.error(`[agent-runner] Lease für ${claim.runId} konnte nicht erneuert werden; der Runner beendet seinen Prozess und schreibt keinen Abschluss mehr.`);
    terminateDeveloperProcess();
    setTimeout(() => terminateDeveloperProcess(true), 5_000).unref();
  } else if (renewal.cancellationRequested) observeCancellation();
}

function observeCancellation() {
  if (!claim.runId || cancellationRequested || !isAgentRunCancellationRequested(claim.runId)) return;
  cancellationRequested = true;
  console.log(`[agent-runner] Abbruch für ${claim.runId} bestätigt; beende den Provider kooperativ.`);
  terminateDeveloperProcess();
  setTimeout(() => terminateDeveloperProcess(true), 15_000).unref();
}

if (claim.runId) {
  markAgentRunRunning(claim.runId);
  reportAgentRunActivity(claim.runId, { phase: "agent_cli", progress: 0 });
  renewLeaseOwnership();
}
const leaseHeartbeat = claim.runId ? setInterval(renewLeaseOwnership, 30_000) : undefined;
leaseHeartbeat?.unref();
const cancellationWatch = claim.runId ? setInterval(observeCancellation, 1_000) : undefined;
cancellationWatch?.unref();

function configuredTimeout(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function runDeveloperProjectTestGate() {
  if (/^(?:0|false|off)$/i.test(String(process.env.DEVELOPER_PROJECT_TEST_GATE ?? "on"))) {
    return Promise.resolve({ status: "skipped", command: "", logs: "Entwickler-Testgate ist für diesen Lauf deaktiviert." });
  }
  const project = getProject(claim.task.projectId);
  const testCommand = resolveProjectTestCommand(project, workspace);
  if (!testCommand.command) return Promise.resolve({ status: "skipped", command: "", logs: "Kein Projekt-Testbefehl konfiguriert." });

  const command = testCommand.command;
  const startedAt = new Date().toISOString();
  const gateRequest = startAgentRequest({
    projectId: claim.task.projectId,
    taskId: claim.task.id,
    runId: claim.runId,
    agentId,
    role: "developer-test-command",
    provider: "local",
    command,
    prompt: `Entwickler-Übergabegate: ${command}`,
  });

  return new Promise((resolve) => {
    if (claim.runId) reportAgentRunActivity(claim.runId, { phase: "project_test_gate", progress: 85 });
    console.log(`[agent-runner] Starte vollständiges Entwickler-Übergabegate: ${command}`);
    const gate = spawn(command, { cwd: workspace, env: runtimeEnvironment(workspace), shell: process.platform === "win32", stdio: ["ignore", "pipe", "pipe"], windowsHide: false });
    const idleLimit = configuredTimeout("DEVELOPER_PROJECT_TEST_IDLE_TIMEOUT_MS", configuredTimeout("PROJECT_TEST_IDLE_TIMEOUT_MS", 60_000));
    const maxLimit = configuredTimeout("DEVELOPER_PROJECT_TEST_MAX_TIMEOUT_MS", configuredTimeout("PROJECT_TEST_MAX_TIMEOUT_MS", 60 * 60_000));
    const deadline = Date.now() + maxLimit;
    let stdout = "";
    let stderr = "";
    let lastActivity = Date.now();
    let timedOut = false;
    let timeoutReason = "";
    let settled = false;

    const stopGate = () => {
      if (!gate.pid) return;
      if (process.platform === "win32") spawn("taskkill", ["/pid", String(gate.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
      else gate.kill("SIGKILL");
    };
    const complete = (status, error) => {
      if (settled) return;
      settled = true;
      clearInterval(heartbeat);
      clearInterval(watchdog);
      const logs = `${stdout}\n${stderr}`.trim();
      finishAgentRequest(gateRequest.requestId, { status: status === "succeeded" ? "succeeded" : status === "blocked" ? "blocked" : "failed", response: logs, error, startedAt });
      console.log(`[agent-runner] Entwickler-Gate beendet: ${status}`);
      resolve({ status, command, logs, error });
    };
    const triggerTimeout = (reason) => {
      if (timedOut) return;
      timedOut = true;
      timeoutReason = reason;
      console.error(`[agent-runner] ${reason}`);
      stopGate();
      setTimeout(() => complete("failed", timeoutReason), 5_000).unref();
    };

    gate.stdout.on("data", (chunk) => { stdout += chunk; lastActivity = Date.now(); if (claim.runId) reportAgentRunActivity(claim.runId, { phase: "project_test_gate", progress: 90 }); process.stdout.write(chunk); });
    gate.stderr.on("data", (chunk) => { stderr += chunk; lastActivity = Date.now(); if (claim.runId) reportAgentRunActivity(claim.runId, { phase: "project_test_gate", progress: 90 }); process.stderr.write(chunk); });
    gate.on("error", (error) => complete(classifyProjectTestResult({ spawnError: true }), error.message));
    gate.on("close", (code) => complete(classifyProjectTestResult({ code, timedOut }), timedOut ? timeoutReason : code === 0 ? undefined : `Testbefehl exit code ${code}`));
    const heartbeat = setInterval(() => console.log(`[agent-runner] Entwickler-Gate läuft, letzte Testausgabe vor ${Math.round((Date.now() - lastActivity) / 1000)}s`), 15_000);
    const watchdog = setInterval(() => {
      if (Date.now() >= deadline) triggerTimeout(`DEVELOPER_PROJECT_TEST_MAX_TIMEOUT: vollständiger Test überschritt ${Math.round(maxLimit / 60000)} Minuten.`);
      else if (Date.now() - lastActivity >= idleLimit) triggerTimeout(`DEVELOPER_PROJECT_TEST_IDLE_TIMEOUT: vollständiger Test war ${Math.round(idleLimit / 1000)} Sekunden ohne Ausgabe.`);
    }, 1_000);
  });
}
function scheduleInactivityTimeout() {
  clearTimeout(inactivityTimeout);
  const timeoutMs = receivedAgentOutput ? idleOutputTimeoutMs : initialOutputTimeoutMs;
  inactivityTimeout = setTimeout(() => {
    timedOut = true;
    timeoutReason = receivedAgentOutput
      ? `Keine neue Codex-Ausgabe seit ${Math.round(timeoutMs / 1000)} Sekunden.`
      : `Keine Codex-Ausgabe innerhalb von ${Math.round(timeoutMs / 1000)} Sekunden nach dem Start.`;
    console.error(`[agent-runner] ${timeoutReason} Lauf wird beendet.`);
    terminateDeveloperProcess();
    setTimeout(() => terminateDeveloperProcess(true), 30_000).unref();
  }, timeoutMs);
}
function recordAgentOutput() {
  receivedAgentOutput = true;
  if (claim.runId) reportAgentRunActivity(claim.runId, { phase: "agent_cli", progress: 50 });
  scheduleInactivityTimeout();
}
scheduleInactivityTimeout();
maxRunTimeout = setTimeout(() => {
  timedOut = true;
  timeoutReason = `Gesamtzeitlimit von ${Math.round(maxRunMs / 60000)} Minuten erreicht.`;
  console.error(`[agent-runner] ${timeoutReason} Lauf wird beendet.`);
  terminateDeveloperProcess();
  setTimeout(() => terminateDeveloperProcess(true), 30_000).unref();
}, Number.isFinite(maxRunMs) && maxRunMs > 0 ? maxRunMs : 25 * 60_000);
child.stdout.on("data", (chunk) => {
  stdout += chunk;
  process.stdout.write(chunk);
  recordAgentOutput();
  if (provider === "codex" && codexTurnTracker.write(chunk)) {
    console.log("[agent-runner] Codex-Turn abgeschlossen; übernehme das Ergebnis ins Board.");
    scheduleDeveloperFinalization(0, undefined, true);
  }
});
child.stderr.on("data", (chunk) => { stderr += chunk; process.stderr.write(chunk); recordAgentOutput(); });
// A provider may exit immediately after emitting its final event. Ending a
// closed stdin pipe is normal in that case and must not crash the harness.
child.stdin.on("error", (error) => {
  if (error?.code !== "EPIPE") console.error("[agent-runner] Eingabe an Provider fehlgeschlagen", error);
});
child.stdin.end(prompt);
let finalized = false;

function scheduleDeveloperFinalization(code, spawnError, completedByTurnEvent = false, signal) {
  // Node may otherwise exit directly after a very fast child process closes,
  // before the asynchronous project gate has persisted the terminal state.
  const keepAlive = setInterval(() => {}, 1_000);
  void finalizeDeveloper(code, spawnError, completedByTurnEvent, signal)
    .catch((error) => {
      console.error("[agent-runner] Abschluss des Entwicklerlaufs fehlgeschlagen", error);
      process.exitCode = 1;
    })
    .finally(() => clearInterval(keepAlive));
}

async function requestAutoAdvance() {
  const project = getProject(claim.task.projectId);
  if (!project?.autoProcessEnabled) return;
  const port = process.env.HARNESS_API_PORT ?? "3001";
  const response = await fetch(`http://127.0.0.1:${port}/api/workflow/advance`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId: claim.task.projectId }),
  });
  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`Autoprozess konnte nicht fortgesetzt werden (${response.status}): ${payload}`);
  }
}

async function finalizeDeveloper(code, spawnError, completedByTurnEvent = false, signal) {
  if (finalized) return;
  finalized = true;
  clearTimeout(inactivityTimeout);
  clearTimeout(maxRunTimeout);
  const effectiveCode = spawnError ? 1 : code ?? 1;
  if (leaseOwnershipLost) {
    clearInterval(leaseHeartbeat);
    clearInterval(cancellationWatch);
    process.exitCode = 1;
    return;
  }
  const storedRun = claim.runId ? getAgentRun(claim.runId) : undefined;
  if (storedRun && !["queued", "starting", "running", "cancelling"].includes(String(storedRun.status))) {
    clearInterval(leaseHeartbeat);
    console.log(`[agent-runner] ${claim.task.id}: Lauf wurde bereits extern beendet (${storedRun.error ?? storedRun.status}); keine automatische Fortsetzung.`);
    process.exitCode = effectiveCode;
    return;
  }
  if (cancellationRequested || storedRun?.status === "cancelling") {
    finishAgentRequest(request.requestId, { status: "cancelled", response: stdout, error: "USER_CANCELLED", startedAt: request.startedAt });
    if (claim.runId) finalizeAgentRunCancellation(claim.runId, { terminationReason: "cooperative_cancelled" });
    clearInterval(leaseHeartbeat);
    clearInterval(cancellationWatch);
    process.exitCode = 0;
    return;
  }
  if (completedByTurnEvent) {
    terminateDeveloperProcess();
    setTimeout(() => { if (child.exitCode === null) terminateDeveloperProcess(true); }, 5_000).unref();
  }
  const cliSucceeded = !spawnError && !timedOut && effectiveCode === 0;
  const gateResult = cliSucceeded
    ? await runDeveloperProjectTestGate()
    : { status: "skipped", command: "", logs: "", error: undefined };
  const gatePassed = gateResult.status === "succeeded" || gateResult.status === "skipped";
  console.log(`[agent-runner] Entwickler-Gate ausgewertet: ${gateResult.status}`);
  const developerSucceeded = cliSucceeded && gatePassed;
  const gateDetails = gateResult.status === "succeeded"
    ? `Entwickler-Übergabegate bestanden: ${gateResult.command}`
    : gateResult.status === "skipped" && cliSucceeded
      ? "Entwickler-Übergabegate übersprungen: Kein Projekt-Testbefehl konfiguriert."
      : `Entwickler-Übergabegate fehlgeschlagen (${gateResult.command || "unbekannter Testbefehl"}):\n${projectTestFailureExcerpt(gateResult.logs || gateResult.error)}`;
  if (spawnError) publishDeveloperComment("Entwicklerlauf konnte nicht gestartet werden.", "", spawnError.message);
  else if (!developerSucceeded && cliSucceeded) publishDeveloperComment("Entwicklerlauf nicht an den Tester übergeben: Das vollständige Projekt-Testgate ist fehlgeschlagen.", stdout, stderr, gateDetails);
  else publishDeveloperComment(timedOut ? `Entwicklerlauf wegen Inaktivität abgebrochen: ${timeoutReason}` : effectiveCode === 0 ? "Entwicklerlauf abgeschlossen." : `Entwicklerlauf mit Exit-Code ${effectiveCode} beendet.`, stdout, stderr, cliSucceeded ? gateDetails : "");
  const usage = extractUsage(`${stdout}\n${stderr}`);
  const cliError = spawnError?.message ?? (provider === "codex" ? codexExitDiagnostic(effectiveCode, stderr) : `Exit code ${effectiveCode}`);
  finishAgentRequest(request.requestId, { status: timedOut ? "timeout" : effectiveCode === 0 ? "succeeded" : "failed", response: stdout, error: timedOut ? `REQUEST_TIMEOUT: ${timeoutReason}` : effectiveCode === 0 ? undefined : cliError, ...usage, startedAt: request.startedAt });
  clearInterval(leaseHeartbeat);
  clearInterval(cancellationWatch);
  let finishedTask;
  if (claim.runId) {
    const gateError = gatePassed ? undefined : `DEVELOPER_PROJECT_TEST_GATE_FAILED: ${gateResult.error ?? projectTestFailureExcerpt(gateResult.logs)}`;
    finishedTask = finishAgentRun(claim.runId, {
      status: developerSucceeded ? "succeeded" : timedOut ? "timed_out" : "failed",
      summary: developerSucceeded ? `${definition.label} beendet; vollständiges Projekt-Testgate bestanden.` : cliSucceeded ? "Entwickler-Übergabegate fehlgeschlagen; Ticket bleibt beim Entwickler." : timedOut ? `${definition.label} wurde wegen Inaktivität abgebrochen.` : `${definition.label} endete mit Exit-Code ${effectiveCode}.`,
      error: developerSucceeded ? undefined : gateError ?? (timedOut ? `REQUEST_TIMEOUT: ${timeoutReason}` : cliError),
      nextStatus: developerSucceeded ? "Review" : "Ready",
      exitCode: code ?? null,
      signal: signal ?? null,
      terminationReason: developerSucceeded ? "completed" : timedOut ? "timeout" : spawnError ? "spawn_error" : "process_exit",
    });
    console.log(`[agent-runner] Entwickler-Run finalisiert: ${finishedTask?.status ?? "unbekannt"}`);
  }
  if (shouldAutoStartTester({ developerSucceeded, taskInReview: finishedTask?.status === "Review", autoProcessEnabled: finishedTask ? getProject(finishedTask.projectId)?.autoProcessEnabled : false }) || (finishedTask?.status === "Ready" && getProject(finishedTask.projectId)?.autoProcessEnabled)) {
    try { await requestAutoAdvance(); } catch (error) { console.error("[agent-runner] Autoprozess konnte nicht fortgesetzt werden", error); }
  }
  process.exitCode = developerSucceeded ? 0 : effectiveCode || 1;
}

child.on("error", (error) => { scheduleDeveloperFinalization(undefined, error); });
child.on("close", (code, signal) => { scheduleDeveloperFinalization(code, undefined, false, signal); });
