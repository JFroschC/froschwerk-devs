import { agentRequestSummary, listAgentRequests } from "../../../db/local.ts";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const projectId = query.get("projectId") ?? undefined;
  return Response.json({ requests: listAgentRequests(projectId, Number(query.get("limit") ?? 25)), summary: agentRequestSummary(projectId) });
}
