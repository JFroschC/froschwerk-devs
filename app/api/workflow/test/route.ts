import { startTesterForTask } from "../../../../scripts/workflow-orchestrator.mjs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const payload = await request.json();
  const taskId = typeof payload.taskId === "string" ? payload.taskId : "";
  if (!taskId) return Response.json({ error: "taskId is required" }, { status: 400 });
  const result = startTesterForTask(taskId, typeof payload.agentId === "string" ? payload.agentId : undefined, typeof payload.projectId === "string" ? payload.projectId : undefined);
  const started = "runId" in result && typeof result.runId === "string";
  return started ? Response.json(result) : Response.json(result, { status: 409 });
}
