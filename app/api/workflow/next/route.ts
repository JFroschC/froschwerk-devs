import { claimAndLaunchDeveloper } from "../../../../scripts/workflow-orchestrator.mjs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const payload = await request.json().catch(() => ({})) as { agentId?: string; taskId?: string; projectId?: string };
  const result = claimAndLaunchDeveloper(payload.agentId, payload.taskId?.trim().toUpperCase(), payload.projectId);
  return Response.json(result, { status: result.task ? 200 : 409 });
}
