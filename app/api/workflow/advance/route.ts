import { advanceAutoProcess } from "../../../../scripts/workflow-orchestrator.mjs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const payload = await request.json().catch(() => ({})) as { projectId?: string };
  if (!payload.projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
  const result = advanceAutoProcess(payload.projectId);
  return Response.json(result, { status: result.result?.error ? 409 : 200 });
}
