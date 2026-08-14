import { addChatMessage, getProject } from "../../../../db/local.ts";
import { runManagedProjectAnalysis } from "../../../../scripts/manager-actions.mjs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const payload = await request.json().catch(() => ({})) as { projectId?: string };
  const projectId = typeof payload.projectId === "string" ? payload.projectId : "project-agent-harness";
  const project = getProject(projectId);
  if (!project || project.status === "archived") return Response.json({ error: "Aktives Projekt nicht gefunden" }, { status: 404 });
  try {
    const { snapshot: analysisSnapshot, action } = await runManagedProjectAnalysis(projectId, { source: "manual" });
    const message = addChatMessage({ senderType: "manager", projectId, body: `Projektanalyse gespeichert: ${analysisSnapshot.summary}` });
    return Response.json({ analysisSnapshot, message, action }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Projektanalyse fehlgeschlagen" }, { status: 422 });
  }
}
