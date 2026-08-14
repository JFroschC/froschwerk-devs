import { finishAgentRun, getAgentRun } from "../../../../../db";
import { cancelActiveRun } from "../../../../../scripts/workflow-orchestrator.mjs";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const payload = await request.json() as { status?: "succeeded" | "failed" | "cancelled"; summary?: string; error?: string; nextStatus?: string };
  if (payload.status === "cancelled") {
    const result = cancelActiveRun(id);
    return result.cancelled ? Response.json(result) : Response.json(result, { status: 409 });
  }
  if (payload.status !== "succeeded" && payload.status !== "failed") return Response.json({ error: "status must be succeeded or failed" }, { status: 400 });
  const run = getAgentRun(id) as { role?: string; status?: string; task?: { activeRunId?: string | null; activeRunRole?: string | null } } | undefined;
  if (!run) return Response.json({ error: "agent run not found" }, { status: 404 });
  if (run.role !== "developer" || !["queued", "starting", "running", "cancelling"].includes(String(run.status)) || run.task?.activeRunId !== id || run.task?.activeRunRole !== "developer") {
    return Response.json({ error: "agent run is not the active developer run for its ticket" }, { status: 409 });
  }
  try {
    const task = finishAgentRun(id, { ...payload, status: payload.status });
    return task ? Response.json({ task }) : Response.json({ error: "agent run is no longer active" }, { status: 409 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "agent run could not be finished" }, { status: 400 });
  }
}
