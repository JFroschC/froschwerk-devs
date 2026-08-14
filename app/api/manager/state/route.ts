import { findActiveManagerConversation, getLatestManagerPlan, getLatestProjectAnalysisSnapshot, getProject, listManagerActions } from "../../../../db/local.ts";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const projectId = new URL(request.url).searchParams.get("projectId") ?? "project-agent-harness";
  const project = getProject(projectId);
  if (!project) return Response.json({ error: "Projekt nicht gefunden" }, { status: 404 });
  return Response.json({
    conversation: findActiveManagerConversation(projectId),
    plan: getLatestManagerPlan(projectId),
    analysisSnapshot: getLatestProjectAnalysisSnapshot(projectId),
    actions: listManagerActions(projectId),
  });
}
