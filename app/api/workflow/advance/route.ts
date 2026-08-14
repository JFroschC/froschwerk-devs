import { advanceAutoProcess } from "../../../../scripts/workflow-orchestrator.mjs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const payload = await request.json().catch(() => ({})) as { projectId?: string };
  if (!payload.projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
  const result = advanceAutoProcess(payload.projectId);
  const nestedResult = "result" in result ? result.result : undefined;
  const failed = typeof nestedResult === "object" && nestedResult !== null && "error" in nestedResult && Boolean(nestedResult.error);
  return Response.json(result, { status: failed ? 409 : 200 });
}
