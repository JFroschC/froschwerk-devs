import { listAgentRuns } from "../../../db/local.ts";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const taskId = new URL(request.url).searchParams.get("taskId") ?? undefined;
  const projectId = new URL(request.url).searchParams.get("projectId") ?? undefined;
  return Response.json({ runs: listAgentRuns(taskId, projectId) });
}
