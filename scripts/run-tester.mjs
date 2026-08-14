import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getAgentRun, getProject, recoverTesterRun, renewAgentRunLease } from "../db/local.ts";
import { providerDefinition } from "./providers.mjs";
import { finishTesterAndContinue } from "./workflow-orchestrator.mjs";
import { codexExecArgs, codexExitDiagnostic } from "./codex-cli.mjs";
import { extractUsage } from "./request-usage.mjs";
import { finishAgentRequest, startAgentRequest } from "../db/local.ts";
import { resolveProjectTestCommand } from "./project-test-command.mjs";
import { classifyProjectTestResult, projectTestFailureExcerpt, reconcileTesterResult } from "./project-test-result.mjs";
import { commandInvocation, runtimeEnvironment } from "./runtime-env.mjs";

const args = process.argv.slice(2);
const valueFor = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const runId = valueFor("--run-id");
if (!runId) throw new Error("--run-id ist erforderlich");
const run = getAgentRun(runId);
if (!run || run.role !== "tester") throw new Error(`Tester-Lauf nicht gefunden: ${runId}`);
if (!['queued', 'running'].includes(String(run.status)) || run.task?.activeRunId !== runId || run.task?.activeRunRole !== 'tester') {
  throw new Error(`Tester-Lauf ${runId} ist nicht der gültige aktive Tester-Lauf seines Tickets.`);
}
const definition = providerDefinition(String(run.provider));
if (!definition) throw new Error(`Unbekannter Provider: ${run.provider}`);
if (run.provider === "codex" && process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY ist gesetzt. Entferne ihn für das ChatGPT-Abo.");
if (run.provider === "claude" && process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY ist gesetzt. Entferne ihn für das Claude-Abo.");

const task = run.task;
const project = task?.projectId ? getProject(task.projectId) : undefined;
const testerWorkspace = project?.workspacePath || process.cwd();
// QA work needs dependable reasoning and tool use, but should never spend the
// subscription's Opus allowance. Haiku remains suitable for a future, separate
// lightweight check role; this full tester is intentionally pinned to Sonnet.
const claudeTesterModel = process.env.CLAUDE_TESTER_MODEL ?? "sonnet";
const codexTesterModel = process.env.TESTER_CODEX_MODEL ?? "gpt-5.6-luna";
const codexTesterReasoningEffort = process.env.TESTER_CODEX_REASONING_EFFORT ?? "medium";
const codexTesterServiceTier = process.env.TESTER_CODEX_SERVICE_TIER ?? "default";
const currentWorkflowStatus = String(task?.status ?? "unbekannt");
if (currentWorkflowStatus !== "Testing") {
  const summary = `${task?.id ?? "Dieses Ticket"} wurde nicht im erwarteten Testerstatus übergeben (aktuell: ${currentWorkflowStatus}, erwartet: Testing). Das ist ein Workflow-/Übergabefehler, kein Produktfehler.`;
  finishTesterAndContinue(runId, { status: "blocked", summary, checks: [{ name: "Tester-Übergabe", status: "blocked", details: summary }] }, { launchNext: false });
  process.exit(0);
}
const prompt = `Du arbeitest als QA-Tester-Agent im lokalen Agent Harness. Prüfe genau dieses Ticket: ${task.id} – ${task.title}

Beschreibung:
${task.description}

Akzeptanzkriterien:
${task.acceptance.map((item) => `- ${item}`).join("\n")}

Arbeitsregeln:
- Phase 1: Prüfe zuerst alle Akzeptanzkriterien und die vorhandenen Tests ausschließlich statisch. Starte in dieser Phase keine Test-, Build-, npm-, node- oder Dev-Server-Befehle; auch keine einzelnen Testdateien und keine Hintergrundprozesse.
- Phase 2: Gib danach unmittelbar deine JSON-Antwort ab. Erst danach führt der Harness genau einmal den zentralen vollständigen Projekt-Testbefehl npm.cmd run test unter Windows aus, wartet auf dessen Ende und bestimmt daraus das endgültige Ergebnis. Starte diesen Befehl niemals selbst und starte niemals einen zweiten Testlauf.
- Keine UI-, Browser-, Screenshot- oder Klicktests durchführen. Prüfe ausschließlich Logik, API, Datenbank, Workflow und automatisierte Tests.
- Schreibe oder ergänze bei Bedarf nur Testdateien. Verändere keinen Produktivcode.
- Schreibe keine fragilen Tests gegen exakte sichtbare UI-Texte, Copytexte, Fehlermeldungsformulierungen, CSS-Klassen oder andere reine Implementierungsdetails. Eine redaktionelle Textänderung darf keinen Test brechen.
- Prüfe stattdessen stabiles Verhalten und fachliche Verträge: Statuscodes, Daten, Persistenz, Beziehungen, Validierung, API-Strukturen und nur bei ausdrücklicher Anforderung semantische UI-Struktur. Wenn ein bestehender Test nur an einem frei änderbaren Text hängt, stabilisiere ihn statt den Produktivtext festzuschreiben.
- Der Harness führt den Projekt-Testbefehl nach deiner Antwort selbst aus. Behaupte keinen bestandenen Test, den du nicht durch einen echten Testlauf belegen kannst.
- Der Status Testing ist bei deinem Start korrekt. Ein Ticket muss nach dem Entwicklerlauf nicht mehr Ready sein. Ready → In Progress → Review → Testing ist der normale Ablauf.
- Wenn ein Kriterium einen bereits ausgeführten Statuswechsel beschreibt, prüfe historische Events, Runs oder Logs. Verlange nicht, dass der aktuelle Status wieder Ready ist.
- Wenn Browserzugriff, Node-REPL, npm, Git oder eine andere Testumgebung durch Policy/Sandbox fehlt, melde blocked statt failed.
- Unter Windows verwende für npm immer npm.cmd (zum Beispiel npm.cmd test), nicht npm test, damit nicht versehentlich die gesperrte PowerShell-Datei npm.ps1 gestartet wird.
- Der noch ausstehende zentrale Harness-Testlauf ist niemals allein ein Grund fuer blocked. Wenn alle statisch pruefbaren Kriterien erfuellt sind, melde passed; der Harness fuehrt den Test danach selbst aus und verbindet beide Ergebnisse.
- failed ist nur für einen reproduzierbaren Produktfehler erlaubt.
- Verändere keinen Produktivcode.
- Lies die relevanten Änderungen und bewerte die vorhandenen Tests statisch.
- Suche gezielt nach älteren Tests, die von geänderten Routen, Entitäten, Enums, Schemafeldern oder Verträgen betroffen sind. Eine fachlich beabsichtigte Erweiterung darf nicht an einer veralteten Testannahme scheitern; aktualisiere in diesem Fall ausschließlich den betroffenen Test und erhalte seine sinnvolle Abdeckung.
- Prüfe bei jedem Test mit HTTP-Servern, Datenbanken, Workern, Timern, Streams oder temporären Dateien, dass Cleanup unmittelbar nach der Erzeugung registriert oder mit try/finally garantiert wird. Assertions dürfen niemals vor dem einzigen Cleanup-Pfad liegen.
- Prüfe jedes Akzeptanzkriterium.
- Antworte ausschließlich als JSON mit diesem Schema:
{"status":"passed|failed|blocked","summary":"...","checks":[{"name":"...","status":"passed|failed|blocked","details":"..."}],"logs":"..."}`;

const commandArgs = String(run.provider) === "codex"
  ? codexExecArgs({ workspace: testerWorkspace, model: codexTesterModel, reasoningEffort: codexTesterReasoningEffort, serviceTier: codexTesterServiceTier, sandbox: "workspace-write", json: true, skipGitRepoCheck: !existsSync(join(testerWorkspace, ".git")), ignoreRules: true })
  : ["-p", "--model", claudeTesterModel, "--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits", "--allowedTools", "Read", "Edit", "Glob", "Grep", "Bash(npm.cmd test)", "Bash(npm.cmd run *)", "Bash(git status *)", "Bash(git diff *)", "Bash(git log *)", "--no-session-persistence"];

const request = startAgentRequest({ projectId: task?.projectId, taskId: task?.id, runId, agentId: run.agentId, role: "tester", provider: String(run.provider), model: String(run.provider) === "codex" ? codexTesterModel : `claude-${claudeTesterModel}`, command: `${definition.command} ${commandArgs.join(" ")}`, prompt });
const leaseHeartbeat = setInterval(() => renewAgentRunLease(runId), 30_000);
leaseHeartbeat.unref();
renewAgentRunLease(runId);

const reportStatuses = new Set(["passed", "failed", "blocked"]);

function jsonValuesFromText(value) {
  if (typeof value !== "string") return [];
  const text = value.trim();
  if (!text) return [];
  const values = [text];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) values.push(fenced[1].trim());
  const firstObject = text.indexOf("{");
  const lastObject = text.lastIndexOf("}");
  if (firstObject >= 0 && lastObject > firstObject) values.push(text.slice(firstObject, lastObject + 1));
  return values.flatMap((candidate) => {
    try { return [JSON.parse(candidate)]; } catch { return []; }
  });
}

function reportFromCandidate(value) {
  const pending = [value];
  const seenObjects = new Set();
  while (pending.length) {
    const candidate = pending.shift();
    if (typeof candidate === "string") {
      pending.push(...jsonValuesFromText(candidate));
      continue;
    }
    if (!candidate || typeof candidate !== "object" || seenObjects.has(candidate)) continue;
    seenObjects.add(candidate);
    if (reportStatuses.has(candidate.status)) return candidate;
    for (const field of ["result", "text", "content", "item"]) {
      if (candidate[field] !== undefined) pending.push(candidate[field]);
    }
    if (candidate.item?.text !== undefined) pending.push(candidate.item.text);
    if (candidate.item?.content !== undefined) pending.push(candidate.item.content);
  }
  return undefined;
}

function parseOutput(stdout) {
  const output = stdout.trim();
  const candidates = [
    ...jsonValuesFromText(output),
    ...output.split(/\r?\n/).filter(Boolean).reverse().flatMap(jsonValuesFromText),
  ];
  for (const candidate of candidates) {
    const report = reportFromCandidate(candidate);
    if (report) return report;
  }
  throw cliFailure("Testerantwort enthält kein auswertbares JSON", stdout, "");
}

function diagnosticTail(stdout, stderr, limit = 6_000) {
  const output = `${stdout}\n${stderr}`.trim();
  if (!output) return "Keine Ausgabe vom Tester erhalten.";
  return output.length > limit ? `[... gekürzt ...]\n${output.slice(-limit)}` : output;
}

function cliFailure(message, stdout, stderr) {
  const error = new Error(`${message}\n\nTester-Diagnose:\n${diagnosticTail(stdout, stderr)}`);
  error.diagnostic = diagnosticTail(stdout, stderr);
  return error;
}

function terminateProcessTree(child, force = false) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    const args = ["/pid", String(child.pid), "/t"];
    if (force) args.push("/f");
    spawn("taskkill", args, { windowsHide: true, stdio: "ignore" });
  } else {
    child.kill(force ? "SIGKILL" : "SIGTERM");
  }
}

function idleTimeoutMs(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function runCli() {
  return new Promise((resolve, reject) => {
    const cliEnv = runtimeEnvironment(testerWorkspace);
    const invocation = commandInvocation(definition.command, commandArgs, cliEnv);
    const child = spawn(invocation.command, invocation.args, { cwd: testerWorkspace, env: cliEnv, stdio: ["pipe", "pipe", "pipe"], windowsHide: false, shell: false });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      // Keep the full result for parsing, but do not hide the tester's output
      // from the Harness terminal while the run is active.
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });
    child.on("error", (error) => fail(cliFailure(error.message, stdout, stderr)));
    const timeoutMs = idleTimeoutMs("TESTER_IDLE_TIMEOUT_MS", Number(process.env.TESTER_TIMEOUT_MS ?? 600000));
    const maxRunMs = idleTimeoutMs("TESTER_MAX_RUN_MS", 30 * 60_000);
    let lastActivity = Date.now();
    let timeoutTriggered = false;
    let timeoutReason = "";
    const heartbeat = setInterval(() => console.log(`[tester-runner] Codex läuft, letzte Ausgabe vor ${Math.round((Date.now() - lastActivity) / 1000)}s (Inaktivitätsgrenze ${Math.round(timeoutMs / 1000)}s)`), 15_000);
    const idleCheck = setInterval(() => {
      if (!timeoutTriggered && Date.now() - lastActivity >= timeoutMs) {
        timeoutTriggered = true;
        timeoutReason = `REQUEST_TIMEOUT: Tester war mindestens ${Math.round(timeoutMs / 1000)} Sekunden inaktiv.`;
        console.error(`[tester-runner] ${timeoutReason} Beende den Prozess sauber.`);
        terminateProcessTree(child);
        setTimeout(() => terminateProcessTree(child, true), 30_000).unref();
      }
    }, 5_000);
    const maxRunTimeout = setTimeout(() => {
      if (timeoutTriggered) return;
      timeoutTriggered = true;
      timeoutReason = `REQUEST_TIMEOUT: Tester überschritt die Gesamtgrenze von ${Math.round(maxRunMs / 60000)} Minuten.`;
      console.error(`[tester-runner] ${timeoutReason} Beende den Prozess sauber.`);
      terminateProcessTree(child);
      setTimeout(() => terminateProcessTree(child, true), 30_000).unref();
    }, maxRunMs);
    child.stdout.on("data", () => { lastActivity = Date.now(); });
    child.stderr.on("data", () => { lastActivity = Date.now(); });
    child.on("close", (code) => {
      clearInterval(heartbeat);
      clearInterval(idleCheck);
      clearTimeout(maxRunTimeout);
      if (settled) return;
      settled = true;
      if (timeoutTriggered) reject(cliFailure(timeoutReason, stdout, stderr));
      else if (code === 0) resolve({ stdout, stderr });
      else reject(cliFailure(String(run.provider) === "codex" ? codexExitDiagnostic(code, stderr) : `Tester exit code ${code}`, stdout, stderr));
    });
    child.stdin.end(prompt);
  });
}

function runProjectTests(command, cwd) {
  return new Promise((resolve) => {
    const startedAt = new Date().toISOString();
    const testRequest = startAgentRequest({ projectId: task.projectId, taskId: task.id, runId, agentId: run.agentId, role: "test-command", provider: "local", command, prompt: `Projekt-Testbefehl: ${command}` });
    const child = spawn(command, { cwd, env: runtimeEnvironment(cwd), shell: process.platform === "win32", stdio: ["ignore", "pipe", "pipe"], windowsHide: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; process.stdout.write(chunk); });
    child.stderr.on("data", (chunk) => { stderr += chunk; process.stderr.write(chunk); });
    // A finished Node test with leaked servers/workers can remain silent forever.
    // Projects with legitimately long quiet integration tests can override this.
    const timeoutMs = idleTimeoutMs("PROJECT_TEST_IDLE_TIMEOUT_MS", 60_000);
    const maxTimeoutMs = idleTimeoutMs("PROJECT_TEST_MAX_TIMEOUT_MS", 60 * 60_000);
    const startedAtMs = Date.now();
    const deadline = startedAtMs + maxTimeoutMs;
    let lastActivity = Date.now();
    let timeoutTriggered = false;
    const heartbeat = setInterval(() => console.log(`[tester-runner] Projekt-Test läuft, letzte Ausgabe vor ${Math.round((Date.now() - lastActivity) / 1000)}s (Inaktivitätsgrenze ${Math.round(timeoutMs / 1000)}s)`), 15_000);
    let settled = false;
    let timeoutReason = "";
    const finish = (status, error) => {
      if (settled) return;
      settled = true;
      clearInterval(heartbeat);
      const logs = `${stdout}\n${stderr}`.trim();
      finishAgentRequest(testRequest.requestId, { status, response: logs, error, startedAt });
      resolve({ status, logs });
    };
    const idleCheck = setInterval(() => {
      if (!timeoutTriggered && Date.now() >= deadline) {
        timeoutTriggered = true;
        timeoutReason = `PROJECT_TEST_MAX_TIMEOUT: Testbefehl überschritt die Gesamtgrenze von ${Math.round(maxTimeoutMs / 60000)} Minuten.`;
        console.error(`[tester-runner] ${timeoutReason} Beende ihn sauber.`);
        terminateProcessTree(child);
        setTimeout(() => terminateProcessTree(child, true), 30_000).unref();
      } else if (!timeoutTriggered && Date.now() - lastActivity >= timeoutMs) {
        timeoutTriggered = true;
        timeoutReason = `PROJECT_TEST_IDLE_TIMEOUT: Testbefehl war mindestens ${Math.round(timeoutMs / 60000)} Minuten ohne Ausgabe.`;
        console.error(`[tester-runner] Projekt-Test ist seit ${Math.round(timeoutMs / 1000)}s inaktiv; beende ihn sauber.`);
        terminateProcessTree(child);
        setTimeout(() => terminateProcessTree(child, true), 30_000).unref();
      }
    }, 5_000);
    child.stdout.on("data", () => { lastActivity = Date.now(); });
    child.stderr.on("data", () => { lastActivity = Date.now(); });
    child.on("error", (error) => { clearInterval(idleCheck); finish(classifyProjectTestResult({ spawnError: true }), error.message); });
    child.on("close", (code) => {
      clearInterval(idleCheck);
      const status = classifyProjectTestResult({ code, timedOut: timeoutTriggered });
      finish(status, timeoutTriggered ? timeoutReason : code === 0 ? undefined : `Testbefehl exit code ${code}`);
    });
  });
}

async function requestAutoAdvance() {
  if (!getProject(task.projectId)?.autoProcessEnabled) return;
  const port = process.env.HARNESS_API_PORT ?? "3001";
  const response = await fetch(`http://127.0.0.1:${port}/api/workflow/advance`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId: task.projectId }),
  });
  if (!response.ok) throw new Error(`Autoprozess konnte nicht fortgesetzt werden (${response.status}): ${await response.text()}`);
}

try {
  console.log(`[tester-runner] Starte ${definition.label} für ${task.id}`);
  const result = await runCli();
  const report = parseOutput(result.stdout);
  const usage = extractUsage(`${result.stdout}\n${result.stderr}`);
  finishAgentRequest(request.requestId, { status: "succeeded", response: result.stdout, ...usage, startedAt: request.startedAt });
  const testCommand = resolveProjectTestCommand(project, testerWorkspace);
  const testResult = testCommand.command
    ? await runProjectTests(testCommand.command, testerWorkspace)
    : { status: "blocked", logs: "Kein Testbefehl im aktiven Projekt konfiguriert." };
  const reconciled = reconcileTesterResult(report, testResult.status);
  const finalStatus = reconciled.status;
  const testCommandLabel = testCommand.source === "package-script" ? "automatisch aus package.json erkannt" : testCommand.command;
  const failureExcerpt = testResult.status === "failed" ? projectTestFailureExcerpt(testResult.logs) : "";
  const summary = `${String(report.summary ?? "")}${testCommand.command ? `\n\nAutomatischer Testlauf (${testCommandLabel}): ${testResult.status}.` : "\n\nKein Testbefehl konfiguriert oder automatisch erkannt; Testergebnis blockiert."}${failureExcerpt ? `\n\nFehlerauszug des zentralen Testlaufs:\n${failureExcerpt}` : ""}`;
  const checks = [
    ...reconciled.checks,
    ...(testCommand.command ? [{ name: "Zentraler Projekt-Testlauf", status: testResult.status === "succeeded" ? "passed" : testResult.status === "failed" ? "failed" : "blocked", details: failureExcerpt || `Status: ${testResult.status}` }] : []),
  ];
  finishTesterAndContinue(runId, { status: finalStatus, summary, checks, logs: `${String(report.logs ?? result.stderr ?? "")}\n\n--- Automatischer Projekt-Testlauf ---\n${testResult.logs}` }, { launchNext: false });
  try { await requestAutoAdvance(); } catch (advanceError) { console.error("[tester-runner] Autoprozess konnte nicht fortgesetzt werden", advanceError); }
  console.log(`[tester-runner] ${task.id}: ${report.status}`);
} catch (error) {
  const storedRun = getAgentRun(runId);
  if (storedRun && !["queued", "running"].includes(String(storedRun.status))) {
    console.log(`[tester-runner] ${task.id}: Lauf wurde bereits extern beendet (${storedRun.error ?? storedRun.status}); keine automatische Fortsetzung.`);
    process.exitCode = storedRun.error === "USER_CANCELLED" ? 0 : 1;
  } else {
    let errorText = error instanceof Error ? error.message : String(error);
    const diagnostic = error instanceof Error && typeof error.diagnostic === "string" ? error.diagnostic : "";
    if (diagnostic && !errorText.includes("Tester-Diagnose:")) errorText += `\n\nTester-Diagnose:\n${diagnostic}`;
    const blocked = /REQUEST_TIMEOUT|CODEX_CLI_ARGUMENT_ERROR|sandbox|policy|browser|node.?repl|npm|git|zugriff verweigert|permission denied/i.test(errorText);
    finishAgentRequest(request.requestId, { status: blocked ? "blocked" : "failed", response: diagnostic, error: errorText, startedAt: request.startedAt });
    if (/REQUEST_TIMEOUT/i.test(errorText)) recoverTesterRun(runId, { summary: "Tester-Lauf wegen Timeout abgebrochen. Ein Neustart ist möglich.", error: errorText });
    finishTesterAndContinue(runId, { status: blocked ? "blocked" : "failed", summary: blocked ? "Tester-Lauf wegen einer nicht verfügbaren Testumgebung blockiert." : "Tester-Lauf fehlgeschlagen.", error: errorText }, { launchNext: false });
    try { await requestAutoAdvance(); } catch (advanceError) { console.error("[tester-runner] Autoprozess konnte nicht fortgesetzt werden", advanceError); }
    console.error("[tester-runner] failed", error);
    process.exitCode = 1;
  }
} finally {
  clearInterval(leaseHeartbeat);
}
