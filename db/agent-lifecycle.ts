/**
 * The provider-neutral lifecycle contract for agent runs.
 *
 * Database code, orchestration, and runners must use this module instead of
 * open-coding status checks. The supervisor in the next lifecycle milestone
 * can therefore make the same decisions without having to reinterpret legacy
 * runner behaviour.
 */
export const agentRunStatuses = [
  "queued",
  "starting",
  "running",
  "cancelling",
  "succeeded",
  "failed",
  "timed_out",
  "cancelled",
  "lost",
] as const;

export type AgentRunStatus = (typeof agentRunStatuses)[number];

export const activeAgentRunStatuses = new Set<AgentRunStatus>([
  "queued",
  "starting",
  "running",
  "cancelling",
]);

const allowedTransitions: Readonly<Record<AgentRunStatus, readonly AgentRunStatus[]>> = {
  queued: ["starting", "cancelling", "failed", "cancelled", "lost"],
  starting: ["running", "cancelling", "failed", "timed_out", "cancelled", "lost"],
  running: ["cancelling", "succeeded", "failed", "timed_out", "cancelled", "lost"],
  cancelling: ["cancelled", "failed", "lost"],
  succeeded: [],
  failed: [],
  timed_out: [],
  cancelled: [],
  lost: [],
};

export function isAgentRunStatus(value: unknown): value is AgentRunStatus {
  return typeof value === "string" && (agentRunStatuses as readonly string[]).includes(value);
}

export function isActiveAgentRunStatus(value: unknown): value is AgentRunStatus {
  return isAgentRunStatus(value) && activeAgentRunStatuses.has(value);
}

export function canTransitionAgentRun(from: unknown, to: unknown) {
  return isAgentRunStatus(from) && isAgentRunStatus(to) && allowedTransitions[from].includes(to);
}

export function assertAgentRunTransition(from: unknown, to: AgentRunStatus) {
  if (!canTransitionAgentRun(from, to)) {
    throw new Error(`Ungültiger Agent-Run-Übergang von ${String(from)} nach ${to}`);
  }
}

export function agentRuntimeStatus(enabled: boolean, runStatuses: Iterable<unknown>) {
  if (!enabled) return "disabled";
  const active = new Set(Array.from(runStatuses).filter(isActiveAgentRunStatus));
  if (active.has("cancelling")) return "cancelling";
  if (active.has("running")) return "busy";
  if (active.has("starting")) return "starting";
  if (active.has("queued")) return "queued";
  return "idle";
}
