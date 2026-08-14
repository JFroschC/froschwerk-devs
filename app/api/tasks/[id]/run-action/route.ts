import { performTaskRunAction } from "../../../../../scripts/run-actions.mjs";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const payload = await request.json().catch(() => ({})) as { projectId?: string; action?: "start" | "retry"; role?: "developer" | "tester"; confirmation?: "confirmed" | "declined"; sourceRunId?: string };
  const result = performTaskRunAction({ taskId: decodeURIComponent(id), projectId: payload.projectId, action: payload.action, role: payload.role, confirmation: payload.confirmation, sourceRunId: payload.sourceRunId });
  return Response.json(result, { status: result.ok ? 200 : 409 });
}
