import { finishAgentRun } from "../../../../../db";
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
  const task = finishAgentRun(id, { ...payload, status: payload.status });
  return task ? Response.json({ task }) : Response.json({ error: "agent run not found" }, { status: 404 });
}
