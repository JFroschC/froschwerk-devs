import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getAgent } from "../db/local.ts";
import { providerDefinition } from "./providers.mjs";
import { checkRuntime } from "./runtime-check.mjs";
import { extractUsage } from "./request-usage.mjs";
import { finishAgentRequest, startAgentRequest } from "../db/local.ts";
import { commandInvocation, runtimeEnvironment } from "./runtime-env.mjs";

const codexHome = process.env.CODEX_HOME ?? join(process.env.USERPROFILE ?? process.env.HOME ?? process.cwd(), ".codex");
const managerCodexModel = process.env.MANAGER_CODEX_MODEL ?? "gpt-5.6-luna";
const managerCodexReasoningEffort = process.env.MANAGER_CODEX_REASONING_EFFORT ?? "medium";

function codexWorkspaceArgs(workspace) {
  return existsSync(join(workspace, ".git")) ? [] : ["--skip-git-repo-check"];
}

function runCli(command, args, options, input, timeoutMs = Number(process.env.MANAGER_TIMEOUT_MS ?? 180000)) {
  return new Promise((resolvePromise, reject) => {
    const startedAt = Date.now();
    const timeoutSeconds = Math.round(timeoutMs / 1000);
    const invocation = commandInvocation(command, args, options.env);
    const child = spawn(invocation.command, invocation.args, { ...options, stdio: ["pipe", "pipe", "pipe"], shell: false });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const heartbeat = setInterval(() => {
      console.log(`[mira] läuft seit ${Math.round((Date.now() - startedAt) / 1000)}s (Timeout ${timeoutSeconds}s)`);
    }, 15_000);
    const cleanup = () => { clearTimeout(timeout); clearInterval(heartbeat); };
    console.log(`[mira] Anfrage gestartet (Timeout ${timeoutSeconds}s)`);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      console.error(`[mira] TIMEOUT nach ${timeoutSeconds}s – Prozess wird beendet.`);
      child.kill();
      reject(new Error(`REQUEST_TIMEOUT: Manager nach ${timeoutSeconds} Sekunden abgebrochen.`));
    }, timeoutMs);
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      console.error(`[mira] Prozessfehler nach ${Math.round((Date.now() - startedAt) / 1000)}s: ${error.message}`);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      if (code === 0) {
        console.log(`[mira] Anfrage erfolgreich nach ${elapsed}s beendet.`);
        resolvePromise({ stdout, stderr });
      } else {
        console.error(`[mira] Anfrage nach ${elapsed}s mit Exit-Code ${code ?? "unbekannt"} beendet.`);
        reject(new Error(stderr.trim() || `${command} endete mit Exit-Code ${code}`));
      }
    });
    child.stdin.end(input);
  });
}

function extractClaudeReply(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    return String(parsed.result ?? parsed.message ?? parsed.content ?? "").trim();
  } catch {
    return stdout.trim();
  }
}

export async function runManagerPrompt(prompt, workspace = process.cwd(), context = {}) {
  const manager = getAgent("agent-manager");
  const provider = String(manager?.provider ?? "codex");
  const definition = providerDefinition(provider);
  if (!definition) throw new Error(`Unbekannter Manager-Provider: ${provider}`);
  const runtime = checkRuntime(workspace, { probeProviders: false });
  if (!runtime.ok) throw new Error(runtime.messages.join(" "));
  if (provider === "codex" && process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY ist gesetzt. Entferne ihn, damit Mira das ChatGPT-Login verwendet.");
  if (provider === "claude" && process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY ist gesetzt. Entferne ihn, damit Mira das Claude-Abo verwendet.");

  const managerPrompt = `Du bist Mira, der Hauptmanager eines lokalen Multi-Agent-Taskboards. Antworte auf Deutsch, klar und knapp.

Wichtig:
- Du darfst in dieser Chatantwort keine Dateien verändern und keine Shell-Befehle ausführen.
- Das Board ist die verbindliche Wahrheit. Ticket- und Workflow-Aktionen werden ausschließlich von der Harness-Anwendung validiert, bestätigt und ausgeführt.
- Beziehe dich ausschließlich auf den Kontext des aktiven Projekts. Erfinde keine Ticket-IDs oder Analyseergebnisse.
- Wenn Anforderungen für einen umsetzbaren Plan fehlen, stelle konkrete Fragen in questions und schlage in derselben Antwort noch keine Ticketanlage vor.
- Bei komplexen Anforderungen: zuerst analyze_project vorschlagen, dann Rückfragen, danach einen Plan mit mehreren Tickets, Akzeptanzkriterien und Abhängigkeiten erstellen.
- Wenn der Nutzer ausdrücklich gleichzeitig Analyse und Ticketanlage verlangt (z. B. „analysieren und Tickets erstellen“), darfst du nicht bei analyze_project stehen bleiben. Nutze den bereitgestellten Analyse-Snapshot und liefere in derselben Antwort eine konkrete Freigabevorschau mit create_tasks oder update_tasks. Nur wenn der Planinhalt tatsächlich fehlt oder unlesbar ist, stelle eine Rückfrage.
- Wenn der Dateibaum einen Umsetzungsplan unter docs/DesignUpdate enthält, erwarte, dass dessen Inhalt im aktuellen Analyse-Snapshot bereitgestellt wird. Fordere den Nutzer nicht auf, HTML manuell einzufügen; verwende bei einem veralteten Snapshot die lokale Analyse.
- Behaupte nie, dass Tickets angelegt, geändert oder gestartet wurden; sie werden zuerst als Freigabevorschau gespeichert.
- Antworte ausschließlich als valides JSON ohne Markdown und ohne Text davor oder danach.
- Das JSON muss schemaVersion 2 haben und exakt diese Top-Level-Felder enthalten:
  {"schemaVersion":2,"reply":"...","mode":"analysis|planning|execution|status","questions":[{"id":"...","question":"...","options":["..."],"required":true}],"actions":[...],"assumptions":["..."],"risks":["..."],"summary":"..."}
- Zulässige Aktionen sind: analyze_project, create_tasks, update_tasks, create_follow_up_tasks, set_dependencies, start_task, start_next, start_tester, comment_task und none.
- create_tasks und create_follow_up_tasks enthalten tasks mit clientId, sequence, title, description, priority (Urgent|High|Medium|Low), acceptance, optional parentClientId oder parentTaskId und dependsOnClientIds. sequence ist die fachliche Reihenfolge und beginnt üblicherweise bei 10 in Zehnerschritten; gleiche sequence ist nur für bewusst parallele Aufgaben erlaubt.
- Wenn eine Aufgabe fachlich auf einer anderen aufbaut, setze zusätzlich dependsOnClientIds. Die JSON-Reihenfolge allein ist keine Abhängigkeit.
- update_tasks enthält zwingend ein nicht-leeres updates-Array. Jeder Eintrag enthält taskId und mindestens eines von title, description, priority, sequence oder acceptance. Setze sequence bei bestehenden Tickets mit, wenn sie in die fachliche Reihenfolge des Plans eingeordnet werden sollen. Beispiel: {"type":"update_tasks","updates":[{"taskId":"FBT-123-ABCD","sequence":20,"acceptance":["Prüfbares Kriterium"]}]}. Verwende bei update_tasks nicht das Feld tasks.
- Bei einer ausdrücklichen Reihenfolgenkorrektur (z. B. „Reihenfolge vollständig korrigieren“) reicht set_dependencies niemals aus. Erzeuge zusätzlich update_tasks für jedes bereits vorhandene Ticket der Kette und setze dort sequence. planSequence ist über update_tasks.sequence änderbar und darf nicht als unmöglich behauptet werden.
- set_dependencies enthält dependencies mit taskId oder taskClientId sowie dependsOnTaskId oder dependsOnClientId. Jede Abhängigkeit muss im aktiven Projekt liegen und darf keinen Zyklus erzeugen.
- create_follow_up_tasks nur bei einem klaren Anlass wie einem Testergebnis, einer Blockade oder einem nicht erfüllten Akzeptanzkriterium; ergänze sourceTaskId und soweit bekannt sourceRunId bzw. sourceReportId.
- start_task benötigt taskId, start_tester benötigt taskId, comment_task benötigt taskId und body. Nutze start_next nur auf ausdrücklichen Wunsch.
- Für eine reine Antwort verwende actions: [].

${prompt}`;

  const args = provider === "codex"
    ? ["--config", `model_reasoning_effort=${JSON.stringify(managerCodexReasoningEffort)}`, "exec", ...codexWorkspaceArgs(workspace), "--ephemeral", "--model", managerCodexModel, "--sandbox", "read-only", "-"]
    : ["-p", "--output-format", "json", "--permission-mode", "plan", "--no-session-persistence"];
  const cliEnv = runtimeEnvironment(workspace, provider === "codex" ? { ...process.env, CODEX_HOME: codexHome } : process.env);
  if (provider === "claude") delete cliEnv.ANTHROPIC_API_KEY;
  const request = startAgentRequest({ projectId: context.projectId, agentId: manager?.id ?? "agent-manager", role: "manager", provider, model: provider === "codex" ? managerCodexModel : "claude-subscription", command: `${definition.command} ${args.join(" ")}`, prompt: managerPrompt });
  try {
    const result = await runCli(definition.command, args, { cwd: workspace, env: cliEnv, windowsHide: true }, managerPrompt);
    const raw = `${result.stdout}\n${result.stderr}`;
    const usage = extractUsage(raw);
    finishAgentRequest(request.requestId, { status: "succeeded", response: result.stdout, ...usage, startedAt: request.startedAt });
    return provider === "codex"
      ? result.stdout.trim() || "Ich konnte gerade keine Antwort erzeugen."
      : extractClaudeReply(result.stdout) || "Ich konnte gerade keine Antwort erzeugen.";
  } catch (error) {
    finishAgentRequest(request.requestId, { status: "failed", error: error instanceof Error ? error.message : String(error), startedAt: request.startedAt });
    throw error;
  }
}
