import { getAgentRun } from "../../../../../db";
import { finishTesterAndContinue } from "../../../../../scripts/workflow-orchestrator.mjs";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const runId = decodeURIComponent(id);
  const run = getAgentRun(runId) as { role?: string; status?: string; task?: { activeRunId?: string | null; activeRunRole?: string | null } } | undefined;
  if (!run) return Response.json({ error: "tester run not found" }, { status: 404 });
  if (run.role !== "tester" || !["queued", "running"].includes(String(run.status)) || run.task?.activeRunId !== runId || run.task?.activeRunRole !== "tester") {
    return Response.json({ error: "tester run is not the active run for its ticket" }, { status: 409 });
  }
  const payload = await request.json() as { status?: string };
  if (!["passed", "failed", "blocked"].includes(String(payload.status))) return Response.json({ error: "status must be passed, failed or blocked" }, { status: 400 });
  const result = finishTesterAndContinue(runId, payload);
  return result ? Response.json(result) : Response.json({ error: "tester run is no longer active" }, { status: 409 });
}
