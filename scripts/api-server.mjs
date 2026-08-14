import { createServer } from "node:http";
import {
  addChatMessage,
  addComment,
  addManagerConversationEntry,
  agentRequestSummary,
  answerManagerQuestions,
  archiveProject,
  createProject,
  createTask,
  discardManagerPlan,
  findActiveManagerConversation,
  finishAgentRun,
  getAgentRun,
  getLatestManagerPlan,
  getLatestProjectAnalysisSnapshot,
  getManagerConversation,
  getManagerPlan,
  getProject,
  listAgentRequests,
  listAgentRuns,
  listAgents,
  listChatMessages,
  listManagerConversationEntries,
  listProjects,
  listTasks,
  removeManagerPlanTask,
  resolveManagerConversation,
  updateAgent,
  updateManagerPlanTask,
  updateProject,
  updateTask,
} from "../db/local.ts";
import { runManagerPrompt } from "./manager-runner.mjs";
import {
  analysisSnapshotHasPlanningDocument,
  executeConfirmedManagerPlan,
  ensureOrderedExistingTasks,
  managerDecisionHasMutation,
  managerRequestWantsOrdering,
  managerRequestWantsPlan,
  parseManagerDecision,
  registerManagerDecision,
  runReadOnlyProjectAnalysis,
} from "./manager-actions.mjs";
import { advanceAutoProcess, cancelActiveRun, claimAndLaunchDeveloper, finishTesterAndContinue, resumeAutoProcesses, startTesterForTask } from "./workflow-orchestrator.mjs";
import { getProviderStatus } from "./providers.mjs";
import { checkRuntime } from "./runtime-check.mjs";

const port = Number(process.env.HARNESS_API_PORT ?? 3001);

function json(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  });
  response.end(JSON.stringify(body));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => { try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error("Invalid JSON")); } });
    request.on("error", reject);
  });
}

function taskIdFromPath(pathname) {
  const match = pathname.match(/^\/api\/tasks\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : undefined;
}

async function managerReply(payload) {
  const body = typeof payload.body === "string" ? payload.body.trim() : "";
  const answers = payload.answers && typeof payload.answers === "object" && !Array.isArray(payload.answers) ? payload.answers : undefined;
  if (!body && !answers) return { error: "body or answers is required", status: 400 };
  const projectId = typeof payload.projectId === "string" ? payload.projectId : "project-agent-harness";
  const project = getProject(projectId);
  if (!project || project.status === "archived") return { error: "Aktives Projekt nicht gefunden", status: 404 };
  let conversation;
  try {
    conversation = resolveManagerConversation(projectId, typeof payload.conversationId === "string" ? payload.conversationId : undefined);
    if (answers) answerManagerQuestions(conversation.id, answers);
    if (body) addManagerConversationEntry(conversation.id, { senderType: "user", body, payload: answers ? { answers } : {} });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Manager-Gespräch konnte nicht fortgesetzt werden", status: 400 };
  }
  const tasks = listTasks(projectId);
  const history = listChatMessages(20, projectId).map((message) => `${message.sender}: ${message.text}`).join("\n");
  const wantsPlan = managerRequestWantsPlan(body);
  let analysis = getLatestProjectAnalysisSnapshot(projectId);
  if (wantsPlan || !analysisSnapshotHasPlanningDocument(analysis)) analysis = await runReadOnlyProjectAnalysis(projectId);
  let parsed;
  try {
    parsed = parseManagerDecision(await runManagerPrompt(
      `Aktives Projekt:\n${JSON.stringify(project, null, 2)}\n\nAktueller Board-Kontext:\n${JSON.stringify(tasks, null, 2)}\n\nLetzter Chatverlauf dieses Projekts:\n${history || "Noch kein Verlauf."}\n\nPersistenter Gesprächszustand:\n${JSON.stringify({ conversation: getManagerConversation(conversation.id), entries: listManagerConversationEntries(conversation.id, 30), latestAnalysis: getLatestProjectAnalysisSnapshot(projectId) }, null, 2)}\n\nNutzerfrage oder Antwort:\n${body || "Die offenen Rückfragen wurden beantwortet. Setze die Planung fort."}`,
      project.workspacePath || process.cwd(),
      { projectId },
    ));
    parsed.decision = ensureOrderedExistingTasks(parsed.decision, tasks, managerRequestWantsOrdering(body));
    if (wantsPlan && !managerDecisionHasMutation(parsed.decision)) {
      parsed = parseManagerDecision(await runManagerPrompt(
        `Die lokale Analyse wurde soeben ausgeführt. Der Nutzer verlangt ausdrücklich Analyse UND Ticketanlage. Erzeuge jetzt die konkrete Freigabevorschau mit create_tasks oder update_tasks. Gib keine weitere analyze_project-Aktion zurück, solange der bereitgestellte Planinhalt lesbar ist.\n\nProjektanalyse:\n${JSON.stringify(analysis, null, 2)}\n\nBoard:\n${JSON.stringify(tasks, null, 2)}\n\nNutzeranforderung:\n${body}`,
        project.workspacePath || process.cwd(),
        { projectId },
      ));
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Mira konnte nicht über den lokalen Provider antworten", status: 503 };
  }
  let result;
  try {
    result = await registerManagerDecision({ projectId, conversationId: conversation.id, decision: parsed.decision, validationErrors: parsed.errors });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Miras Vorschlag konnte nicht gespeichert werden", status: 422 };
  }
  const notices = [
    ...(!parsed.valid ? [`Die vorgeschlagenen Aktionen wurden aus Sicherheitsgründen nicht übernommen: ${parsed.errors.join(" ")}`] : []),
    result.analysisSnapshot ? `Projektanalyse gespeichert: ${result.analysisSnapshot.summary}` : "",
    result.plan ? `Ich habe einen bestätigungspflichtigen Entwurf mit ${result.plan.tasks.length} Ticket${result.plan.tasks.length === 1 ? "" : "s"} vorbereitet.` : "",
  ].filter(Boolean);
  const reply = [parsed.decision.reply || "Ich habe deine Nachricht aufgenommen.", ...notices].join("\n\n");
  return {
    status: 201,
    body: {
      message: addChatMessage({ senderType: "manager", body: reply, projectId }),
      tasks: listTasks(projectId),
      decision: parsed.decision,
      validationErrors: parsed.errors,
      conversation: getManagerConversation(conversation.id),
      plan: result.plan,
      analysisSnapshot: result.analysisSnapshot,
    },
  };
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const { pathname } = url;
  if (request.method === "OPTIONS") {
    response.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS", "access-control-allow-headers": "content-type" });
    response.end();
    return;
  }
  try {
    if (request.method === "GET" && pathname === "/api/projects") return json(response, 200, { projects: listProjects() });
    if (request.method === "POST" && pathname === "/api/projects") return json(response, 201, { project: createProject(await readJson(request)) });
    const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
    if (projectMatch && request.method === "PATCH") {
      const payload = await readJson(request);
      const project = updateProject(decodeURIComponent(projectMatch[1]), payload);
      const autoProcess = project?.autoProcessEnabled && payload.autoProcessEnabled === true
        ? advanceAutoProcess(project.id, { announce: true })
        : undefined;
      return json(response, 200, { project, autoProcess });
    }
    if (projectMatch && request.method === "DELETE") return json(response, 200, { project: archiveProject(decodeURIComponent(projectMatch[1])) });

    if (request.method === "GET" && pathname === "/api/agent-runs") return json(response, 200, { runs: listAgentRuns(url.searchParams.get("taskId") ?? undefined, url.searchParams.get("projectId") ?? undefined) });
    if (request.method === "GET" && pathname === "/api/agents") return json(response, 200, { agents: listAgents() });
    if (request.method === "GET" && pathname === "/api/agent-requests") {
      const projectId = url.searchParams.get("projectId") ?? undefined;
      return json(response, 200, { requests: listAgentRequests(projectId, Number(url.searchParams.get("limit") ?? 25)), summary: agentRequestSummary(projectId) });
    }
    const agentMatch = pathname.match(/^\/api\/agents\/([^/]+)$/);
    if (request.method === "PATCH" && agentMatch) {
      const agent = updateAgent(decodeURIComponent(agentMatch[1]), await readJson(request));
      return agent ? json(response, 200, { agent }) : json(response, 404, { error: "agent not found" });
    }

    if (request.method === "GET" && pathname === "/api/tasks") return json(response, 200, { tasks: listTasks(url.searchParams.get("projectId") ?? undefined) });
    if (request.method === "POST" && pathname === "/api/tasks") {
      const payload = await readJson(request);
      const title = typeof payload.title === "string" ? payload.title.trim() : "";
      if (!title) return json(response, 400, { error: "title is required" });
      return json(response, 201, { task: createTask({ ...payload, title }) });
    }

    if (request.method === "POST" && pathname === "/api/workflow/next") {
      const payload = await readJson(request);
      const result = claimAndLaunchDeveloper(typeof payload.agentId === "string" ? payload.agentId : undefined, typeof payload.taskId === "string" ? payload.taskId.trim().toUpperCase() : undefined, typeof payload.projectId === "string" ? payload.projectId : undefined);
      return json(response, result.task && result.runId ? 200 : 409, result);
    }
    if (request.method === "POST" && pathname === "/api/workflow/test") {
      const payload = await readJson(request);
      const taskId = typeof payload.taskId === "string" ? payload.taskId : "";
      if (!taskId) return json(response, 400, { error: "taskId is required" });
      const result = startTesterForTask(taskId, typeof payload.agentId === "string" ? payload.agentId : undefined, typeof payload.projectId === "string" ? payload.projectId : undefined);
      return json(response, result.runId ? 200 : 409, result);
    }
    if (request.method === "POST" && pathname === "/api/workflow/advance") {
      const payload = await readJson(request);
      const projectId = typeof payload.projectId === "string" ? payload.projectId : "";
      if (!projectId) return json(response, 400, { error: "projectId is required" });
      const result = advanceAutoProcess(projectId);
      return json(response, result.result?.error ? 409 : 200, result);
    }
    const cancelMatch = pathname.match(/^\/api\/agent-runs\/([^/]+)\/cancel$/);
    if (request.method === "POST" && cancelMatch) {
      const result = cancelActiveRun(decodeURIComponent(cancelMatch[1]));
      return result.cancelled ? json(response, 200, result) : json(response, 409, result);
    }
    const finishMatch = pathname.match(/^\/api\/agent-runs\/([^/]+)\/finish$/);
    if (request.method === "POST" && finishMatch) {
      const runId = decodeURIComponent(finishMatch[1]);
      const payload = await readJson(request);
      if (payload.status === "cancelled") {
        const result = cancelActiveRun(runId);
        return result.cancelled ? json(response, 200, result) : json(response, 409, result);
      }
      if (payload.status !== "succeeded" && payload.status !== "failed") return json(response, 400, { error: "status must be succeeded or failed" });
      const run = getAgentRun(runId);
      if (!run) return json(response, 404, { error: "agent run not found" });
      if (run.role !== "developer" || !["queued", "running"].includes(String(run.status)) || run.task?.activeRunId !== runId || run.task?.activeRunRole !== "developer") {
        return json(response, 409, { error: "agent run is not the active developer run for its ticket" });
      }
      try {
        const task = finishAgentRun(runId, payload);
        return task ? json(response, 200, { task }) : json(response, 409, { error: "agent run is no longer active" });
      } catch (error) {
        return json(response, 400, { error: error instanceof Error ? error.message : "agent run could not be finished" });
      }
    }
    const testerFinishMatch = pathname.match(/^\/api\/test-runs\/([^/]+)\/finish$/);
    if (request.method === "POST" && testerFinishMatch) {
      const runId = decodeURIComponent(testerFinishMatch[1]);
      const run = getAgentRun(runId);
      if (!run) return json(response, 404, { error: "tester run not found" });
      if (run.role !== "tester" || !["queued", "running"].includes(String(run.status)) || run.task?.activeRunId !== runId || run.task?.activeRunRole !== "tester") {
        return json(response, 409, { error: "tester run is not the active run for its ticket" });
      }
      const payload = await readJson(request);
      if (!["passed", "failed", "blocked"].includes(String(payload.status))) return json(response, 400, { error: "status must be passed, failed or blocked" });
      const result = finishTesterAndContinue(runId, payload);
      return result ? json(response, 200, result) : json(response, 409, { error: "tester run is no longer active" });
    }

    if (request.method === "GET" && pathname === "/api/chat") return json(response, 200, { messages: listChatMessages(undefined, url.searchParams.get("projectId") ?? undefined) });
    if (request.method === "POST" && pathname === "/api/chat") {
      const payload = await readJson(request);
      const body = typeof payload.body === "string" ? payload.body.trim() : "";
      if (!body) return json(response, 400, { error: "body is required" });
      return json(response, 201, { message: addChatMessage({ senderType: payload.senderType === "manager" ? "manager" : "user", body, projectId: payload.projectId }) });
    }
    if (request.method === "POST" && pathname === "/api/chat/manager") {
      const result = await managerReply(await readJson(request));
      return json(response, result.status, result.error ? { error: result.error } : result.body);
    }

    if (request.method === "GET" && pathname === "/api/manager/state") {
      const projectId = url.searchParams.get("projectId") ?? "project-agent-harness";
      if (!getProject(projectId)) return json(response, 404, { error: "Projekt nicht gefunden" });
      return json(response, 200, { conversation: findActiveManagerConversation(projectId), plan: getLatestManagerPlan(projectId), analysisSnapshot: getLatestProjectAnalysisSnapshot(projectId) });
    }
    if (request.method === "POST" && pathname === "/api/manager/analyze") {
      const payload = await readJson(request);
      const projectId = typeof payload.projectId === "string" ? payload.projectId : "project-agent-harness";
      const snapshot = await runReadOnlyProjectAnalysis(projectId);
      return json(response, 201, { analysisSnapshot: snapshot, message: addChatMessage({ senderType: "manager", projectId, body: `Projektanalyse gespeichert: ${snapshot.summary}` }) });
    }
    const confirmMatch = pathname.match(/^\/api\/manager\/plans\/([^/]+)\/confirm$/);
    if (request.method === "POST" && confirmMatch) {
      const plan = getManagerPlan(decodeURIComponent(confirmMatch[1]));
      if (!plan) return json(response, 404, { error: "Plan nicht gefunden" });
      const result = executeConfirmedManagerPlan(plan.id);
      if (!result) return json(response, 404, { error: "Plan nicht gefunden" });
      return json(response, 200, { plan: result.plan, tasks: listTasks(plan.projectId), message: addChatMessage({ senderType: "manager", projectId: plan.projectId, body: result.confirmation }) });
    }
    const discardMatch = pathname.match(/^\/api\/manager\/plans\/([^/]+)\/discard$/);
    if (request.method === "POST" && discardMatch) {
      const plan = discardManagerPlan(decodeURIComponent(discardMatch[1]));
      return plan ? json(response, 200, { plan }) : json(response, 404, { error: "Plan nicht gefunden" });
    }
    const planTaskMatch = pathname.match(/^\/api\/manager\/plans\/([^/]+)\/tasks\/([^/]+)$/);
    if (planTaskMatch && request.method === "PATCH") {
      const plan = updateManagerPlanTask(decodeURIComponent(planTaskMatch[1]), decodeURIComponent(planTaskMatch[2]), await readJson(request));
      return plan ? json(response, 200, { plan }) : json(response, 404, { error: "Planentwurf nicht gefunden" });
    }
    if (planTaskMatch && request.method === "DELETE") {
      const plan = removeManagerPlanTask(decodeURIComponent(planTaskMatch[1]), decodeURIComponent(planTaskMatch[2]));
      return plan ? json(response, 200, { plan }) : json(response, 404, { error: "Planentwurf nicht gefunden" });
    }

    if (request.method === "GET" && pathname === "/api/health/db") return json(response, 200, { ok: true });
    if (request.method === "GET" && pathname === "/api/health/runtime") {
      const project = getProject(url.searchParams.get("projectId") ?? "");
      return json(response, 200, checkRuntime(project?.workspacePath ?? "", { probeProviders: false }));
    }
    if (request.method === "GET" && pathname === "/api/providers") return json(response, 200, { providers: await getProviderStatus() });

    const taskId = taskIdFromPath(pathname);
    if (taskId && request.method === "PATCH") {
      const task = updateTask(taskId, await readJson(request));
      return task ? json(response, 200, { task }) : json(response, 404, { error: "task not found" });
    }
    if (taskId && request.method === "POST") {
      const payload = await readJson(request);
      const body = typeof payload.body === "string" ? payload.body.trim() : "";
      if (!body) return json(response, 400, { error: "body is required" });
      const task = addComment(taskId, { ...payload, body });
      return task ? json(response, 201, { task }) : json(response, 404, { error: "task not found" });
    }
    return json(response, 404, { error: "not found" });
  } catch (error) {
    console.error("[harness-api] request failed", error);
    return json(response, 500, { error: error instanceof Error ? error.message : "Internal server error" });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[harness-api] SQLite API listening on http://127.0.0.1:${port}`);
  setImmediate(() => {
    try {
      const resumed = resumeAutoProcesses();
      if (resumed.length) console.log(`[harness-api] ${resumed.length} Autoprozess(e) geprüft und fortgesetzt.`);
    } catch (error) {
      console.error("[harness-api] Autoprozesse konnten beim Start nicht fortgesetzt werden", error);
    }
  });
});
function shutdown() { server.close(() => process.exit(0)); }
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
