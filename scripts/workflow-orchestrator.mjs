import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { accessSync, constants, existsSync, statSync } from "node:fs";
import { addChatMessage, applyManagerPlan, claimNextTask, createFollowUpManagerPlan, finishAgentRun, finishTesterRun, getAgent, getAgentRun, getProject, listAgentRuns, listProjects, listTasks, recoverTesterRun, resumeSourceTaskAfterFollowUp, setAgentRunProcessId, startTesterRun, updateTask } from "../db/local.ts";
import { checkRuntime } from "./runtime-check.mjs";
import { runtimeEnvironment } from "./runtime-env.mjs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const launchedProcesses = new Map();

function terminateProcessTree(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
  }
}

function terminateProcessId(processId) {
  if (!processId) return;
  if (process.platform === "win32") spawn("taskkill", ["/pid", String(processId), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
  else process.kill(processId, "SIGTERM");
}

function processIsAlive(processId) {
  if (!processId) return false;
  try {
    process.kill(Number(processId), 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function workspaceForProject(projectId, mode = "read") {
  const project = projectId ? getProject(projectId) : undefined;
  const workspace = String(project?.workspacePath ?? "").trim();
  if (!workspace) return process.cwd();
  if (!existsSync(workspace) || !statSync(workspace).isDirectory()) throw new Error(`Workspace für Projekt ${project.name} wurde nicht gefunden: ${workspace}`);
  try {
    accessSync(workspace, mode === "write" ? constants.R_OK | constants.W_OK : constants.R_OK);
  } catch {
    throw new Error(`Zugriff auf den Workspace von Projekt ${project.name} wurde verweigert: ${workspace}`);
  }
  return workspace;
}

function launchAgentProcess(agentId, taskId, runId, projectId) {
  const workspace = workspaceForProject(projectId, "write");
  const child = spawn(process.execPath, ["--experimental-strip-types", `${projectRoot}scripts/run-agent.mjs`, "--agent", agentId, "--task", taskId, "--run-id", runId, "--workspace", workspace], {
    cwd: workspace,
    env: runtimeEnvironment(workspace),
    stdio: "inherit",
    windowsHide: false,
  });
  child.on("error", (error) => {
    launchedProcesses.delete(runId);
    finishAgentRun(runId, { status: "failed", error: error.message, nextStatus: "Ready" });
    addChatMessage({ senderType: "manager", projectId, body: `${taskId} konnte nicht gestartet werden. Der Lauf wurde für einen begrenzten Retry freigegeben: ${error.message}` });
  });
  child.on("exit", (code, signal) => {
    launchedProcesses.delete(runId);
    if (!["queued", "running"].includes(String(getAgentRun(runId)?.status))) return;
    const reason = `Entwicklerprozess wurde unerwartet beendet (Code ${code ?? "unbekannt"}${signal ? `, ${signal}` : ""}).`;
    const recovered = finishAgentRun(runId, { status: "failed", summary: reason, error: "DEVELOPER_PROCESS_EXIT", nextStatus: "Ready" });
    addChatMessage({ senderType: "manager", projectId, body: `${reason} ${recovered?.status === "Blocked" ? "Die Retry-Grenze wurde erreicht." : "Der Autoprozess versucht das Ticket erneut."}` });
    if (recovered?.status === "Ready" && getProject(projectId)?.autoProcessEnabled) setImmediate(() => advanceAutoProcess(projectId));
  });
  launchedProcesses.set(runId, child);
  setAgentRunProcessId(runId, child.pid);
  return child.pid;
}

function launchTesterProcess(runId, projectId) {
  const workspace = workspaceForProject(projectId);
  const child = spawn(process.execPath, ["--experimental-strip-types", `${projectRoot}scripts/run-tester.mjs`, "--run-id", runId], {
    cwd: workspace,
    env: runtimeEnvironment(workspace),
    stdio: "inherit",
    windowsHide: false,
  });
  child.on("error", (error) => {
    launchedProcesses.delete(runId);
    const recovered = recoverTesterRun(runId, { summary: `Tester konnte nicht gestartet werden: ${error.message}`, error: error.message });
    addChatMessage({ senderType: "manager", projectId, body: `Der Tester konnte nicht gestartet werden: ${error.message}` });
    if (recovered?.status === "Review" && getProject(projectId)?.autoProcessEnabled) setImmediate(() => advanceAutoProcess(projectId));
  });
  child.on("exit", (code, signal) => {
    launchedProcesses.delete(runId);
    // A normal tester completion has already finalized its own run. This only
    // handles abrupt process exits, so the board cannot keep a phantom active tester.
    if (getAgentRun(runId)?.status !== "running") return;
    const reason = `Testerprozess wurde unerwartet beendet (Code ${code ?? "unbekannt"}${signal ? `, ${signal}` : ""}).`;
    const recovered = recoverTesterRun(runId, { summary: `${reason} Ein neuer Testerstart ist möglich.`, error: reason });
    addChatMessage({ senderType: "manager", projectId, body: `${reason} ${recovered?.status === "Review" ? "Der Lauf wurde freigegeben und wird automatisch neu gestartet." : "Die Recovery-Grenze wurde erreicht; das Ticket ist blockiert."}` });
    if (recovered?.status === "Review" && getProject(projectId)?.autoProcessEnabled) setImmediate(() => advanceAutoProcess(projectId));
  });
  launchedProcesses.set(runId, child);
  setAgentRunProcessId(runId, child.pid);
  return child.pid;
}

export function cancelActiveRun(runId) {
  const run = getAgentRun(runId);
  if (!run || !["queued", "running"].includes(run.status)) return { reason: "run_not_active" };
  const child = launchedProcesses.get(runId);
  if (!child?.pid && !run.processId) return { reason: "process_not_available", error: "Der Prozess ist nicht mehr mit diesem Harness-Server verbunden. Bitte den gestarteten Codex-Prozess im FroschAgent-Terminal beenden." };
  const task = run.task;
  const reason = "Lauf wurde vom Benutzer abgebrochen. Das Ticket kann erneut gestartet werden.";
  if (child?.pid) terminateProcessTree(child);
  else terminateProcessId(run.processId);
  launchedProcesses.delete(runId);
  const recoveredTask = run.role === "tester"
    ? recoverTesterRun(runId, { summary: reason, error: "USER_CANCELLED", countRecovery: false })
    : finishAgentRun(runId, { status: "failed", summary: reason, error: "USER_CANCELLED", nextStatus: "Ready", countRetry: false });
  if (task?.projectId) addChatMessage({ senderType: "manager", projectId: task.projectId, body: `${task.id}: ${reason}` });
  return { cancelled: true, task: recoveredTask };
}

export function claimAndLaunchDeveloper(agentId, taskId, projectId) {
  const selectedAgentId = agentId ?? "agent-developer-1";
  const selectedAgent = getAgent(selectedAgentId);
  const selectedTask = taskId ? listTasks(projectId).find((task) => task.id === taskId) : undefined;
  const targetProjectId = projectId ?? selectedTask?.projectId;
  const runtime = checkRuntime(getProject(targetProjectId)?.workspacePath ?? "", { probeProviders: true, requiredProvider: selectedAgent?.provider });
  if (!runtime.ok) return { reason: "runtime_unavailable", error: runtime.messages.join(" ") };
  const result = claimNextTask(selectedAgentId, taskId, projectId);
  if (!result.task || !result.runId) return result;
  try {
    const processId = launchAgentProcess(selectedAgentId, result.task.id, result.runId, result.task.projectId);
    return { ...result, started: true, processId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const task = finishAgentRun(result.runId, { status: "failed", summary: "Entwickler konnte nicht gestartet werden.", error: message, nextStatus: "Ready" });
    addChatMessage({ senderType: "manager", projectId: result.task.projectId, body: `${result.task.id} konnte nicht gestartet werden: ${message}` });
    return { task, reason: "developer_launch_failed", error: message };
  }
}

export function startAndLaunchTester(taskId, agentId, projectId) {
  const selectedAgentId = agentId ?? "agent-tester-1";
  const selectedAgent = getAgent(selectedAgentId);
  const selectedTask = listTasks(projectId).find((task) => task.id === taskId);
  const targetProjectId = projectId ?? selectedTask?.projectId;
  const runtime = checkRuntime(getProject(targetProjectId)?.workspacePath ?? "", { probeProviders: true, requiredProvider: selectedAgent?.provider });
  if (!runtime.ok) return { reason: "runtime_unavailable", error: runtime.messages.join(" ") };
  const result = startTesterRun(taskId, selectedAgentId, projectId);
  if (!result.runId || !result.task) return result;
  let processId;
  try {
    processId = launchTesterProcess(result.runId, result.task.projectId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const task = recoverTesterRun(result.runId, { summary: `Tester konnte nicht gestartet werden: ${message}`, error: message });
    addChatMessage({ senderType: "manager", projectId: result.task.projectId, body: `Der Tester konnte nicht gestartet werden: ${message} Der Lauf wurde freigegeben; ein neuer Testerstart ist möglich.` });
    return { task, reason: "tester_launch_failed", error: message };
  }
  addChatMessage({
    senderType: "manager",
    projectId: result.task.projectId,
    body: `${result.task.id} wurde vom Entwickler an den Tester übergeben. Ich warte auf das Testergebnis.`,
  });
  return { ...result, started: true, processId };
}

export function selectAutoProcessAction(projectId) {
  const project = getProject(projectId);
  if (!project || project.status === "archived") return { type: "none", reason: "project_unavailable" };
  if (!project.autoProcessEnabled) return { type: "none", reason: "auto_process_disabled" };

  const activeRun = listAgentRuns(undefined, projectId).find((run) => ["queued", "running"].includes(String(run.status)));
  if (activeRun) return { type: "wait", reason: "active_run", run: activeRun };

  const tasks = listTasks(projectId);
  const review = tasks.find((task) => task.status === "Review" && !task.activeRunId);
  if (review) return { type: "tester", task: review };

  const byId = new Map(tasks.map((task) => [task.id, task]));
  const ready = tasks.find((task) => task.status === "Ready" && !task.activeRunId
    && Number(task.retryCount) < Number(task.maxRetries)
    && task.dependencies.every((dependencyId) => byId.get(dependencyId)?.status === "Done"));
  if (ready) return { type: "developer", task: ready };
  return { type: "none", reason: "no_ready_work" };
}

export function advanceAutoProcess(projectId, { announce = false } = {}) {
  recoverOrphanedRuns(projectId);
  const action = selectAutoProcessAction(projectId);
  if (action.type === "wait" || action.type === "none") return action;
  const result = action.type === "tester"
    ? startAndLaunchTester(action.task.id, "agent-tester-1", projectId)
    : claimAndLaunchDeveloper("agent-developer-1", action.task.id, projectId);
  if (result?.error) {
    addChatMessage({ senderType: "manager", projectId, body: `Der Autoprozess pausiert vor ${action.task.id}: ${result.error}` });
  }
  if (announce && result?.runId) {
    addChatMessage({
      senderType: "manager",
      projectId,
      body: action.type === "tester"
        ? `Der Autoprozess wurde fortgesetzt: ${action.task.id} wird jetzt geprüft.`
        : `Der Autoprozess wurde fortgesetzt: ${action.task.id} wird jetzt vom Entwickler bearbeitet.`,
    });
  }
  return { ...action, result };
}

export function recoverOrphanedRuns(projectId) {
  const recovered = [];
  for (const run of listAgentRuns(undefined, projectId).filter((entry) => ["queued", "running"].includes(String(entry.status)))) {
    if (processIsAlive(run.processId)) continue;
    const task = run.role === "tester"
      ? recoverTesterRun(run.runId, { summary: "Testerprozess war nach dem Harness-Neustart nicht mehr aktiv.", error: "ORPHANED_PROCESS" })
      : finishAgentRun(run.runId, { status: "failed", summary: "Entwicklerprozess war nach dem Harness-Neustart nicht mehr aktiv.", error: "ORPHANED_PROCESS", nextStatus: "Ready" });
    recovered.push({ runId: run.runId, task });
  }
  return recovered;
}

export function resumeAutoProcesses() {
  const results = [];
  for (const project of listProjects().filter((entry) => entry.status !== "archived" && entry.autoProcessEnabled)) {
    recoverOrphanedRuns(project.id);
    results.push({ projectId: project.id, action: advanceAutoProcess(project.id, { announce: true }) });
  }
  return results;
}

export function finishTesterAndContinue(runId, input, { launchNext = true } = {}) {
  const task = finishTesterRun(runId, input);
  if (!task) return undefined;
  const passed = input.status === "passed";
  const blocked = input.status === "blocked";
  const summary = String(input.summary ?? "").trim();
  if (blocked) {
    addChatMessage({
      senderType: "manager",
      projectId: task.projectId,
      body: `${task.id} wurde vom Tester blockiert${summary ? `: ${summary}` : "."} Ich erstelle daraus kein Folge-Ticket, weil noch kein belastbarer Produktfehler vorliegt. Nach Behebung der Testumgebung kann der Testlauf neu gestartet werden.`,
    });
    return { task };
  }
  if (!passed) {
    const chainLimitValue = Number(process.env.TESTER_FAILURE_CHAIN_LIMIT ?? 3);
    const chainLimit = Number.isSafeInteger(chainLimitValue) && chainLimitValue > 0 ? chainLimitValue : 3;
    const projectTasks = listTasks(task.projectId);
    const byId = new Map(projectTasks.map((entry) => [entry.id, entry]));
    let failureStages = 1;
    let cursor = task;
    const seen = new Set([task.id]);
    while (String(cursor?.originKey ?? "").startsWith("follow-up:")) {
      const sourceTaskId = String(cursor.originKey).slice("follow-up:".length).split(":", 1)[0];
      if (!sourceTaskId || seen.has(sourceTaskId)) break;
      failureStages += 1;
      seen.add(sourceTaskId);
      cursor = byId.get(sourceTaskId);
    }
    if (failureStages >= chainLimit) {
      const blockedTask = updateTask(task.id, { status: "Blocked" });
      addChatMessage({
        senderType: "manager",
        projectId: task.projectId,
        body: `${task.id} wurde nach ${chainLimit} aufeinanderfolgenden Tester-Fehlerstufen blockiert. Es wird kein weiteres automatisches Folge-Ticket erzeugt; der Fehler braucht eine manuelle Entscheidung.`,
      });
      return { task: blockedTask, reason: "tester_failure_chain_exhausted" };
    }
    const followUpPlan = createFollowUpManagerPlan({
      projectId: task.projectId,
      sourceTaskId: task.id,
      sourceRunId: runId,
      sourceReportId: task.testReport?.id,
      summary: summary || "Der Tester hat Änderungen angefordert.",
      checks: input.checks,
    });
    const project = getProject(task.projectId);
    if (project?.autoProcessEnabled) {
      try {
        const applied = applyManagerPlan(followUpPlan.id);
        const followUpTask = applied?.tasks?.[0];
        if (followUpTask) {
          const next = launchNext ? claimAndLaunchDeveloper(undefined, followUpTask.id, task.projectId) : undefined;
          addChatMessage({
            senderType: "manager",
            projectId: task.projectId,
            body: `${task.id} wurde vom Tester abgelehnt. Das Folge-Ticket ${followUpTask.id} wurde automatisch angelegt${next?.runId ? " und direkt dem Entwickler übergeben" : "; der zentrale Autoprozess übernimmt den nächsten Start"}.`,
          });
          return { task, followUpPlan: applied.plan, followUpTask, next };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        addChatMessage({
          senderType: "manager",
          projectId: task.projectId,
          body: `Das Folge-Ticket für ${task.id} konnte im Auto-Prozess nicht automatisch angelegt werden: ${message}. Der Vorschlag bleibt zur Bestätigung offen (${followUpPlan.id}).`,
        });
        return { task, followUpPlan };
      }
    }
    addChatMessage({
      senderType: "manager",
      projectId: task.projectId,
      body: `${task.id} wurde vom Tester abgelehnt und wartet auf Änderungen${summary ? `: ${summary}` : "."} Ich habe eine verknüpfte Folgeaufgabe zur Freigabe vorbereitet (${followUpPlan.id}).`,
    });
    return { task, followUpPlan };
  }

  addChatMessage({ senderType: "manager", projectId: task.projectId, body: `${task.id} wurde vom Tester bestanden${summary ? `: ${summary}` : "."}` });
  const resumedSource = resumeSourceTaskAfterFollowUp(task.id);
  if (resumedSource) {
    const project = getProject(task.projectId);
    addChatMessage({
      senderType: "manager",
      projectId: task.projectId,
      body: `Das Folge-Ticket ${task.id} ist erledigt. Das ursprüngliche Ticket ${resumedSource.id} wurde automatisch zurück in Review gesetzt.`,
    });
    if (!project?.autoProcessEnabled) {
      addChatMessage({
        senderType: "manager",
        projectId: task.projectId,
        body: "Der Autoprozess ist nicht aktiviert; das ursprüngliche Ticket wartet jetzt in Review auf den nächsten Testerstart.",
      });
      return { task, resumedSource };
    }
    if (!launchNext) return { task, resumedSource };
    const tester = startAndLaunchTester(resumedSource.id, "agent-tester-1", resumedSource.projectId);
    if (tester.runId) {
      addChatMessage({
        senderType: "manager",
        projectId: task.projectId,
        body: `${resumedSource.id} wurde automatisch wieder dem Tester zugewiesen.`,
      });
    } else {
      addChatMessage({
        senderType: "manager",
        projectId: task.projectId,
        body: `${resumedSource.id} steht wieder in Review, konnte aber noch nicht automatisch gestartet werden${tester.error ? `: ${tester.error}` : "."}`,
      });
    }
    return { task, resumedSource, tester };
  }

  const project = getProject(task.projectId);
  if (!project?.autoProcessEnabled) {
    addChatMessage({ senderType: "manager", projectId: task.projectId, body: "Der Test ist erfolgreich. Der Autoprozess ist nicht aktiviert; ich warte auf deinen nächsten Start oder eine bestätigte Planaktion." });
    return { task };
  }
  if (!launchNext) return { task };

  const next = claimAndLaunchDeveloper(undefined, undefined, task.projectId);
  if (next.task && next.runId) {
    addChatMessage({ senderType: "manager", projectId: task.projectId, body: `Der Test ist erfolgreich. Ich fahre automatisch mit ${next.task.id} fort und habe den Entwickler gestartet.` });
  } else {
    addChatMessage({ senderType: "manager", projectId: task.projectId, body: "Der Test ist erfolgreich. Aktuell gibt es kein weiteres bereites Ticket, das ich automatisch starten kann." });
  }
  return { task, next };
}

export function startTesterForTask(taskId, agentId, projectId) {
  return startAndLaunchTester(taskId, agentId, projectId);
}
