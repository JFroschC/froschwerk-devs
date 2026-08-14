import {
  addManagerConversationEntry,
  agentRequestSummary,
  applyManagerPlan,
  createManagerPlan,
  createManagerAction,
  createProjectAnalysisSnapshot,
  finishManagerAction,
  getManagerAction,
  getLatestProjectAnalysisSnapshot,
  getManagerPlan,
  getProject,
  listAgentRequests,
  listTasks,
  isManagerActionCancellationRequested,
  saveManagerQuestions,
  updateManagerConversation,
  updateManagerAction,
  startManagerAction,
} from "../db/local.ts";
import { analyzeProjectWorkspace } from "./project-analysis.mjs";
import { claimAndLaunchDeveloper, startTesterForTask } from "./workflow-orchestrator.mjs";

const modes = new Set(["analysis", "planning", "execution", "status"]);
const actionTypes = new Set([
  "analyze_project", "create_tasks", "update_tasks", "create_follow_up_tasks", "set_dependencies",
  "start_task", "start_next", "start_tester", "comment_task", "none",
]);
const priorities = new Set(["Urgent", "High", "Medium", "Low"]);

export function managerRequestWantsPlan(body) {
  const text = cleanText(body, 2_000);
  return /analys/i.test(text)
    && /(ticket|aufgabe|plan|vorschlag)/i.test(text)
    && /(erstell|anleg|bearbeit|überarbeit|ueberarbeit|änder|aender|vorschlag|plan)/i.test(text);
}

export function managerRequestWantsOrdering(body) {
  const text = cleanText(body, 2_000);
  return /(reihenfolge|sequenz|sequence|sortier|priorisier|ablauf|vollständig korrigieren|vollstaendig korrigieren)/i.test(text);
}

export function managerDecisionHasMutation(decision) {
  return (decision?.actions ?? []).some((action) => !["analyze_project", "none"].includes(action.type));
}

export function analysisSnapshotHasPlanningDocument(analysis) {
  return (analysis?.snapshot?.files ?? []).some((file) => {
    const path = typeof file?.path === "string" ? file.path.replaceAll("\\", "/").toLowerCase() : "";
    return path.includes("docs/designupdate/")
      && path.includes("umsetzungsplan")
      && path.endsWith(".html")
      && typeof file?.content === "string"
      && file.content.trim().length > 0;
  });
}

export function ensureOrderedExistingTasks(decision, tasks, wantsOrdering) {
  if (!wantsOrdering) return decision;
  const dependencyAction = (decision?.actions ?? []).find((action) => action.type === "set_dependencies");
  if (!dependencyAction?.dependencies?.length) return decision;
  const existingIds = new Set((tasks ?? []).map((task) => String(task.id).toUpperCase()));
  const nodes = new Set();
  const edges = new Map();
  const indegree = new Map();
  for (const dependency of dependencyAction.dependencies) {
    const taskId = cleanText(dependency.taskId || dependency.taskClientId, 120).toUpperCase();
    const dependsOnTaskId = cleanText(dependency.dependsOnTaskId || dependency.dependsOnClientId, 120).toUpperCase();
    if (!existingIds.has(taskId) || !existingIds.has(dependsOnTaskId)) continue;
    nodes.add(taskId); nodes.add(dependsOnTaskId);
    if (!edges.has(dependsOnTaskId)) edges.set(dependsOnTaskId, new Set());
    if (!edges.get(dependsOnTaskId).has(taskId)) {
      edges.get(dependsOnTaskId).add(taskId);
      indegree.set(taskId, (indegree.get(taskId) ?? 0) + 1);
    }
    if (!indegree.has(dependsOnTaskId)) indegree.set(dependsOnTaskId, 0);
  }
  const queue = [...nodes].filter((id) => (indegree.get(id) ?? 0) === 0);
  const ordered = [];
  while (queue.length) {
    const id = queue.shift();
    ordered.push(id);
    for (const next of edges.get(id) ?? []) {
      const nextDegree = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, nextDegree);
      if (nextDegree === 0) queue.push(next);
    }
  }
  if (ordered.length !== nodes.size) return decision;
  const existingUpdates = (decision.actions ?? []).find((action) => action.type === "update_tasks");
  const updatesByTaskId = new Map((existingUpdates?.updates ?? []).map((update) => [String(update.taskId).toUpperCase(), update]));
  ordered.forEach((taskId, index) => {
    const update = updatesByTaskId.get(taskId) ?? { taskId };
    update.sequence = (index + 1) * 10;
    updatesByTaskId.set(taskId, update);
  });
  const sequenceUpdates = [...updatesByTaskId.values()];
  const actions = (decision.actions ?? []).filter((action) => action.type !== "update_tasks");
  actions.push({ type: "update_tasks", requiresConfirmation: true, updates: sequenceUpdates });
  return { ...decision, actions };
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

function cleanText(value, limit = 10_000) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function cleanStringList(value, limit = 100) {
  return Array.isArray(value) ? value.map((item) => cleanText(String(item), 1_000)).filter(Boolean).slice(0, limit) : [];
}

function normalizeTask(task, index, kind, errors) {
  const value = asRecord(task);
  if (!value) {
    errors.push(`${kind}.tasks[${index}] ist ungültig`);
    return undefined;
  }
  const clientId = cleanText(value.clientId, 80);
  const title = cleanText(value.title, 180);
  const sequence = value.sequence === undefined ? (index + 1) * 10 : Number(value.sequence);
  const acceptance = cleanStringList(value.acceptance, 30);
  if (!clientId || !title || !acceptance.length) {
    errors.push(`${kind}.tasks[${index}] benötigt clientId, Titel und mindestens ein Akzeptanzkriterium`);
    return undefined;
  }
  if (!Number.isInteger(sequence) || sequence < 1) {
    errors.push(`${kind}.tasks[${index}] benötigt eine positive ganze sequence`);
    return undefined;
  }
  const priority = cleanText(value.priority || "Medium", 20);
  if (!priorities.has(priority)) {
    errors.push(`${kind}.tasks[${index}] hat eine ungültige Priorität`);
    return undefined;
  }
  return {
    clientId,
    title,
    sequence,
    description: cleanText(value.description, 8_000),
    priority,
    acceptance,
    parentClientId: cleanText(value.parentClientId, 80) || undefined,
    parentTaskId: cleanText(value.parentTaskId, 120) || undefined,
    dependsOnClientIds: cleanStringList(value.dependsOnClientIds, 50),
    sourceTaskId: cleanText(value.sourceTaskId, 120) || undefined,
    sourceRunId: cleanText(value.sourceRunId, 160) || undefined,
    sourceReportId: cleanText(value.sourceReportId, 160) || undefined,
    originKey: cleanText(value.originKey, 240) || undefined,
  };
}

function normalizeAction(rawAction, index, errors) {
  const action = asRecord(rawAction);
  if (!action) {
    errors.push(`actions[${index}] ist kein Objekt`);
    return undefined;
  }
  const type = cleanText(action.type, 80);
  if (!actionTypes.has(type)) {
    errors.push(`actions[${index}] verwendet einen nicht unterstützten Typ`);
    return undefined;
  }
  if (type === "none" || type === "analyze_project" || type === "start_next") return { type, requiresConfirmation: type === "start_next" };
  if (type === "start_task" || type === "start_tester" || type === "comment_task") {
    const taskId = cleanText(action.taskId, 120).toUpperCase();
    if (!taskId) {
      errors.push(`${type} benötigt taskId`);
      return undefined;
    }
    if (type === "comment_task") {
      const body = cleanText(action.body, 8_000);
      if (!body) {
        errors.push("comment_task benötigt body");
        return undefined;
      }
      return { type, taskId, body, requiresConfirmation: true };
    }
    return { type, taskId, agentId: cleanText(action.agentId, 120) || undefined, requiresConfirmation: true };
  }
  if (type === "create_tasks" || type === "create_follow_up_tasks") {
    if (!Array.isArray(action.tasks) || !action.tasks.length) {
      errors.push(`${type} benötigt mindestens einen Ticketentwurf`);
      return undefined;
    }
    const tasks = action.tasks.map((task, taskIndex) => normalizeTask(task, taskIndex, type, errors)).filter(Boolean);
    return { type, requiresConfirmation: true, trigger: cleanText(action.trigger, 120) || undefined, tasks };
  }
  if (type === "update_tasks") {
    // Older manager prompts described ticket changes with `tasks`, while the
    // action contract uses `updates`. Accept the compatible alias so a
    // complete plan is not discarded solely because of that field name.
    const rawUpdates = Array.isArray(action.updates) ? action.updates : action.tasks;
    if (!Array.isArray(rawUpdates) || !rawUpdates.length) {
      errors.push("update_tasks benötigt mindestens eine Änderung");
      return undefined;
    }
    const updates = [];
    for (const [updateIndex, rawUpdate] of rawUpdates.entries()) {
      const update = asRecord(rawUpdate);
      const taskId = cleanText(update?.taskId || update?.taskClientId, 120).toUpperCase();
      if (!update || !taskId) {
        errors.push(`update_tasks.updates[${updateIndex}] benötigt taskId`);
        continue;
      }
      const priority = update.priority === undefined ? undefined : cleanText(update.priority, 20);
      const sequence = update.sequence === undefined ? undefined : Number(update.sequence);
      if (priority && !priorities.has(priority)) errors.push(`update_tasks.updates[${updateIndex}] hat eine ungültige Priorität`);
      const acceptance = update.acceptance === undefined ? undefined : cleanStringList(update.acceptance, 30);
      if (update.acceptance !== undefined && !acceptance.length) errors.push(`update_tasks.updates[${updateIndex}] darf keine leeren Akzeptanzkriterien setzen`);
      if (update.title === undefined && update.description === undefined && update.priority === undefined && update.sequence === undefined && update.acceptance === undefined) {
        errors.push(`update_tasks.updates[${updateIndex}] benötigt mindestens ein zu änderndes Feld`);
        continue;
      }
      updates.push({ taskId, title: update.title === undefined ? undefined : cleanText(update.title, 180), description: update.description === undefined ? undefined : cleanText(update.description, 8_000), priority, sequence, acceptance });
    }
    return { type, requiresConfirmation: true, updates };
  }
  if (type === "set_dependencies") {
    if (!Array.isArray(action.dependencies) || !action.dependencies.length) {
      errors.push("set_dependencies benötigt Abhängigkeiten");
      return undefined;
    }
    const dependencies = [];
    for (const [dependencyIndex, rawDependency] of action.dependencies.entries()) {
      const dependency = asRecord(rawDependency);
      const taskId = cleanText(dependency?.taskId || dependency?.taskClientId, 120).toUpperCase();
      const dependsOnTaskId = cleanText(dependency?.dependsOnTaskId || dependency?.dependsOnClientId, 120).toUpperCase();
      if (!taskId || !dependsOnTaskId) {
        errors.push(`set_dependencies.dependencies[${dependencyIndex}] benötigt taskId und dependsOnTaskId`);
        continue;
      }
      dependencies.push({ taskId, dependsOnTaskId });
    }
    return { type, requiresConfirmation: true, dependencies };
  }
  return undefined;
}

function legacyDecision(input) {
  const legacyAction = asRecord(input?.action);
  return {
    schemaVersion: 2,
    reply: cleanText(input?.reply),
    mode: "status",
    questions: [],
    actions: legacyAction?.type && legacyAction.type !== "none" ? [legacyAction] : [],
    assumptions: [],
    risks: [],
    summary: "",
  };
}

export function validateManagerDecision(input) {
  const errors = [];
  const source = asRecord(input);
  if (!source) return { valid: false, errors: ["Managerantwort ist kein JSON-Objekt"], decision: legacyDecision({ reply: "Ich konnte die Antwort nicht sicher verarbeiten." }) };
  const candidate = source.schemaVersion === undefined ? legacyDecision(source) : source;
  if (candidate.schemaVersion !== 2) errors.push("Nur Manager-Antwortschema Version 2 ist erlaubt");
  const mode = cleanText(candidate.mode, 30) || "status";
  if (!modes.has(mode)) errors.push("Ungültiger Manager-Modus");
  const questions = [];
  if (candidate.questions !== undefined && !Array.isArray(candidate.questions)) errors.push("questions muss eine Liste sein");
  for (const [index, rawQuestion] of (Array.isArray(candidate.questions) ? candidate.questions : []).entries()) {
    const question = asRecord(rawQuestion);
    const id = cleanText(question?.id, 100);
    const text = cleanText(question?.question, 1_000);
    if (!id || !text) {
      errors.push(`questions[${index}] benötigt id und question`);
      continue;
    }
    questions.push({ id, question: text, options: cleanStringList(question.options, 20), required: question.required !== false });
  }
  if (candidate.actions !== undefined && !Array.isArray(candidate.actions)) errors.push("actions muss eine Liste sein");
  const actions = (Array.isArray(candidate.actions) ? candidate.actions : []).map((action, index) => normalizeAction(action, index, errors)).filter(Boolean);
  const clientIds = new Set();
  for (const action of actions) {
    for (const task of action.tasks ?? []) {
      if (clientIds.has(task.clientId)) errors.push(`clientId ${task.clientId} ist in mehreren Tickets doppelt`);
      clientIds.add(task.clientId);
    }
  }
  const decision = {
    schemaVersion: 2,
    reply: cleanText(candidate.reply, 12_000),
    mode: modes.has(mode) ? mode : "status",
    questions,
    actions: errors.length ? [] : actions.filter((action) => action.type !== "none"),
    assumptions: cleanStringList(candidate.assumptions, 50),
    risks: cleanStringList(candidate.risks, 50),
    summary: cleanText(candidate.summary, 4_000),
  };
  return { valid: !errors.length, errors, decision };
}

export function parseManagerDecision(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const start = String(raw).indexOf("{");
    const end = String(raw).lastIndexOf("}");
    if (start >= 0 && end > start) {
      try { parsed = JSON.parse(String(raw).slice(start, end + 1)); } catch { /* safe fallback below */ }
    }
  }
  if (!parsed) {
    return {
      valid: false,
      errors: ["Miras Antwort war kein valides JSON. Es wurde keine Aktion ausgeführt."],
      decision: { schemaVersion: 2, reply: cleanText(raw) || "Ich konnte meine Antwort nicht sicher strukturieren.", mode: "status", questions: [], actions: [], assumptions: [], risks: [], summary: "" },
    };
  }
  return validateManagerDecision(parsed);
}

export async function runReadOnlyProjectAnalysis(projectId) {
  const project = getProject(projectId);
  if (!project || project.status === "archived") throw new Error("Aktives Projekt wurde nicht gefunden");
  const tasks = listTasks(projectId);
  const board = {
    taskCount: tasks.length,
    statuses: tasks.reduce((counts, task) => ({ ...counts, [task.status]: (counts[task.status] ?? 0) + 1 }), {}),
    blocked: tasks.filter((task) => task.status === "Blocked").map((task) => ({ id: task.id, title: task.title })),
    changesRequested: tasks.filter((task) => task.status === "Changes Requested").map((task) => ({ id: task.id, title: task.title })),
  };
  const result = await analyzeProjectWorkspace(project, { board, requests: { summary: agentRequestSummary(projectId), recent: listAgentRequests(projectId, 5) } });
  return createProjectAnalysisSnapshot(projectId, result);
}

export async function runManagedProjectAnalysis(projectId, options = {}) {
  const action = createManagerAction({ projectId, type: "analysis", input: { source: options.source ?? "manual" }, retryOfActionId: options.retryOfActionId });
  startManagerAction(action.id, "collecting_workspace");
  try {
    const snapshot = await runReadOnlyProjectAnalysis(projectId);
    if (isManagerActionCancellationRequested(action.id)) {
      finishManagerAction(action.id, { status: "cancelled", phase: "cancelled", result: { analysisSnapshotId: snapshot.id, note: "Snapshot wurde nicht als abgeschlossene Manager-Aktion übernommen." }, analysisSnapshotId: snapshot.id });
      throw new Error("MANAGER_ACTION_CANCELLED");
    }
    finishManagerAction(action.id, { status: "succeeded", phase: "snapshot_saved", result: { analysisSnapshotId: snapshot.id, summary: snapshot.summary }, analysisSnapshotId: snapshot.id });
    return { action: action.id, snapshot };
  } catch (error) {
    if (String(error?.message ?? error) !== "MANAGER_ACTION_CANCELLED") finishManagerAction(action.id, { status: "failed", phase: "failed", error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

export async function registerManagerDecision(input) {
  const { projectId, conversationId, decision, validationErrors = [] } = input;
  const project = getProject(projectId);
  if (!project || project.status === "archived") throw new Error("Aktives Projekt wurde nicht gefunden");
  addManagerConversationEntry(conversationId, { senderType: "manager", body: decision.reply, payload: { decision, validationErrors } });
  let analysisSnapshot;
  const analysisAction = decision.actions.find((action) => action.type === "analyze_project");
  if (analysisAction) analysisSnapshot = await runReadOnlyProjectAnalysis(projectId);
  let plan;
  if (decision.questions.length) {
    saveManagerQuestions(conversationId, decision.questions);
  } else {
    const mutations = decision.actions.filter((action) => action.type !== "analyze_project" && action.type !== "none");
    if (mutations.length) {
      plan = createManagerPlan({
        projectId,
        conversationId,
        analysisSnapshotId: analysisSnapshot?.id ?? getLatestProjectAnalysisSnapshot(projectId)?.id,
        title: decision.mode === "planning" ? "Plan von Mira" : "Vorgeschlagene Manager-Aktion",
        summary: decision.summary || decision.reply,
        assumptions: decision.assumptions,
        risks: decision.risks,
        actions: mutations,
      });
    } else {
      updateManagerConversation(conversationId, { status: validationErrors.length ? "failed" : "completed", mode: decision.mode, summary: decision.summary, latestReply: decision.reply });
    }
  }
  if (decision.questions.length) updateManagerConversation(conversationId, { mode: decision.mode, summary: decision.summary, latestReply: decision.reply });
  if (plan) updateManagerConversation(conversationId, { mode: decision.mode, summary: decision.summary, latestReply: decision.reply });
  return { analysisSnapshot, plan };
}

export function executeConfirmedManagerPlan(planId) {
  const applied = applyManagerPlan(planId);
  if (!applied) return undefined;
  const confirmations = [];
  const updatedTaskCount = applied.actions.reduce((count, action) => count + (action.type === "update_tasks" && Array.isArray(action.updates) ? action.updates.length : 0), 0);
  for (const action of applied.actions) {
    const type = action.type;
    if (type !== "start_next" && type !== "start_task" && type !== "start_tester") continue;
    if (type === "start_tester") {
      const result = startTesterForTask(action.taskId, action.agentId, applied.plan.projectId);
      confirmations.push(result.task && result.runId ? `${action.taskId} wurde an den Tester übergeben.` : `${action.taskId} konnte noch nicht getestet werden.`);
      continue;
    }
    const result = claimAndLaunchDeveloper(action.agentId, type === "start_task" ? action.taskId : undefined, applied.plan.projectId);
    confirmations.push(result.task && result.runId ? `${result.task.id} wurde dem Entwickler übergeben.` : type === "start_task" ? `${action.taskId} ist nicht startbereit.` : "Aktuell ist kein startbereites Ticket vorhanden.");
  }
  const summary = [
    applied.tasks.length ? `${applied.tasks.length} Ticket${applied.tasks.length === 1 ? "" : "s"} wurde${applied.tasks.length === 1 ? "" : "n"} aus dem bestätigten Plan angelegt.` : updatedTaskCount ? `${updatedTaskCount} bestehende${updatedTaskCount === 1 ? "s" : ""} Ticket${updatedTaskCount === 1 ? "" : "s"} wurde${updatedTaskCount === 1 ? "" : "n"} angepasst.` : "Der bestätigte Plan wurde angewendet.",
    ...confirmations,
  ].join(" ");
  return { ...applied, confirmation: summary };
}

export function executeManagedManagerPlan(planId, options = {}) {
  // applyManagerPlan is a single SQLite transaction. Cancellation is inspected
  // before it starts and before every subsequent process-launch subaction.
  const plan = options.plan ?? getManagerPlan(planId);
  const projectId = plan?.projectId;
  if (!projectId) throw new Error("Der Manager-Plan muss vor der Ausführung geladen werden");
  const action = createManagerAction({ projectId, planId, type: "execute_plan", confirmation: "confirmed", input: { planId }, retryOfActionId: options.retryOfActionId });
  startManagerAction(action.id, "applying_ticket_batch");
  try {
    if (isManagerActionCancellationRequested(action.id)) throw new Error("MANAGER_ACTION_CANCELLED");
    const applied = applyManagerPlan(planId);
    if (!applied) throw new Error("Plan nicht gefunden");
    updateManagerAction(action.id, { phase: "ticket_batch_applied", result: { createdTaskIds: applied.tasks.map((task) => task.id), planId } });
    const confirmations = [];
    const completedSubactions = [];
    for (const item of applied.actions) {
      if (!["start_next", "start_task", "start_tester"].includes(item.type)) continue;
      if (isManagerActionCancellationRequested(action.id)) {
        finishManagerAction(action.id, { status: "cancelled", phase: "cancelled_after_atomic_batch", result: { planId, createdTaskIds: applied.tasks.map((task) => task.id), completedSubactions, pendingSubactions: applied.actions.filter((candidate) => ["start_next", "start_task", "start_tester"].includes(candidate.type)).slice(completedSubactions.length) } });
        return { ...applied, confirmation: "Der Ticketbatch wurde atomar angelegt. Noch ausstehende Startaktionen wurden nach dem Abbruch nicht ausgeführt.", action: getManagerAction(action.id) };
      }
      const result = item.type === "start_tester"
        ? startTesterForTask(item.taskId, item.agentId, applied.plan.projectId)
        : claimAndLaunchDeveloper(item.agentId, item.type === "start_task" ? item.taskId : undefined, applied.plan.projectId);
      completedSubactions.push({ type: item.type, taskId: item.taskId ?? result.task?.id ?? null, runId: result.runId ?? null, started: Boolean(result.runId) });
      confirmations.push(result.runId ? `${item.taskId ?? result.task?.id} wurde gestartet.` : `${item.taskId ?? "Nächstes Ticket"} konnte nicht gestartet werden.`);
    }
    const updatedTaskCount = applied.actions.reduce((count, item) => count + (item.type === "update_tasks" && Array.isArray(item.updates) ? item.updates.length : 0), 0);
    const confirmation = [applied.tasks.length ? `${applied.tasks.length} Ticket${applied.tasks.length === 1 ? "" : "s"} wurde${applied.tasks.length === 1 ? "" : "n"} aus dem bestätigten Plan angelegt.` : updatedTaskCount ? `${updatedTaskCount} bestehende Ticket${updatedTaskCount === 1 ? "" : "s"} wurde${updatedTaskCount === 1 ? "" : "n"} angepasst.` : "Der bestätigte Plan wurde angewendet.", ...confirmations].join(" ");
    finishManagerAction(action.id, { status: "succeeded", phase: "finished", result: { planId, createdTaskIds: applied.tasks.map((task) => task.id), completedSubactions }, planId });
    return { ...applied, confirmation, action: getManagerAction(action.id) };
  } catch (error) {
    const cancelled = String(error?.message ?? error) === "MANAGER_ACTION_CANCELLED";
    finishManagerAction(action.id, { status: cancelled ? "cancelled" : "failed", phase: cancelled ? "cancelled_before_batch" : "failed", error: cancelled ? undefined : error instanceof Error ? error.message : String(error), result: { planId } });
    if (cancelled) return { plan: options.plan, tasks: [], actions: [], confirmation: "Manager-Aktion wurde vor dem Ticketbatch abgebrochen.", action: getManagerAction(action.id) };
    throw error;
  }
}

// Kept as a compatibility export for callers from the MVP. New callers must
// persist a v2 decision and confirm it through executeConfirmedManagerPlan.
export function executeManagerAction(action) {
  const validation = validateManagerDecision({ schemaVersion: 2, reply: "", mode: "execution", actions: [action], questions: [], assumptions: [], risks: [], summary: "" });
  return { confirmation: validation.valid ? "Aktion wurde als bestätigungspflichtiger Vorschlag vorbereitet." : validation.errors.join(" "), task: undefined, action: validation.decision.actions[0] };
}
