import { listProjectTaskEvents } from "../../../db/local.ts";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const projectId = query.get("projectId");
  if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
  return Response.json({ events: listProjectTaskEvents(projectId, Number(query.get("limit") ?? 100)) });
}
