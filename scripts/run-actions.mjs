import { getAgentRun, listTasks, recordRunActionAudit } from "../db/local.ts";
import { cancelActiveRun, claimAndLaunchDeveloper, startAndLaunchTester } from "./workflow-orchestrator.mjs";

const terminalRetryStatuses = new Set(["failed", "timed_out", "cancelled", "lost"]);

function taskFor(taskId, projectId) {
  return listTasks(projectId).find((task) => task.id === taskId);
}

function actionError(taskId, input, reason) {
  recordRunActionAudit(taskId, { ...input, outcome: "rejected", reason });
  return { ok: false, reason };
}

/** Central server-side contract for user-triggered starts and retries. */
export function performTaskRunAction({ taskId, projectId, action, role, confirmation, sourceRunId }) {
  const input = { action, role, runId: sourceRunId };
  const task = taskFor(taskId, projectId);
  if (!task) return { ok: false, reason: "task_not_found" };
  if (confirmation !== "confirmed") {
    recordRunActionAudit(taskId, { ...input, outcome: "declined" });
    return { ok: true, declined: true };
  }
  recordRunActionAudit(taskId, { ...input, outcome: "confirmed" });
  if (action !== "start" && action !== "retry") return actionError(taskId, input, "unknown_action");
  if (role !== "developer" && role !== "tester") return actionError(taskId, input, "unknown_role");
  if (action === "retry") {
    const source = sourceRunId ? getAgentRun(sourceRunId) : undefined;
    if (!source || source.taskId !== taskId || source.role !== role || !terminalRetryStatuses.has(String(source.status))) {
      return actionError(taskId, input, "retry_source_not_terminal");
    }
  }
  const expectedStatus = role === "developer" ? ["Ready", "Changes Requested"] : ["Review"];
  if (task.activeRunId || !expectedStatus.includes(task.status)) return actionError(taskId, input, "task_not_startable");
  const result = role === "developer"
    ? claimAndLaunchDeveloper(undefined, taskId, projectId)
    : startAndLaunchTester(taskId, undefined, projectId);
  if (!result?.runId) return actionError(taskId, input, String(result?.reason ?? "start_rejected"));
  recordRunActionAudit(taskId, { ...input, outcome: "accepted", resultRunId: result.runId });
  return { ok: true, task: result.task, runId: result.runId, started: result.started === true };
}

/** Central server-side contract for a stop request. */
export function performRunStopAction({ runId, confirmation }) {
  const run = getAgentRun(runId);
  if (!run) return { ok: false, reason: "run_not_found" };
  const input = { action: "stop", runId, role: run.role };
  if (confirmation !== "confirmed") {
    recordRunActionAudit(run.taskId, { ...input, outcome: "declined" });
    return { ok: true, declined: true };
  }
  recordRunActionAudit(run.taskId, { ...input, outcome: "confirmed" });
  const result = cancelActiveRun(runId);
  if (!result.cancelled) return actionError(run.taskId, input, String(result.reason ?? "run_not_active"));
  recordRunActionAudit(run.taskId, { ...input, outcome: "accepted", resultRunId: runId });
  return { ok: true, ...result };
}
