import { archiveProject, getProject, updateProject } from "../../../../db/local.ts";
import { advanceAutoProcess } from "../../../../scripts/workflow-orchestrator.mjs";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const project = getProject(decodeURIComponent(id));
  return project ? Response.json({ project }) : Response.json({ error: "Projekt nicht gefunden" }, { status: 404 });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const payload = await request.json();
    const project = updateProject(decodeURIComponent(id), payload);
    const autoProcess = project?.autoProcessEnabled && payload.autoProcessEnabled === true ? advanceAutoProcess(project.id, { announce: true }) : undefined;
    return project ? Response.json({ project, autoProcess }) : Response.json({ error: "Projekt nicht gefunden" }, { status: 404 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Projekt konnte nicht gespeichert werden" }, { status: 400 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const project = archiveProject(decodeURIComponent(id));
    return project ? Response.json({ project }) : Response.json({ error: "Projekt nicht gefunden" }, { status: 404 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Projekt konnte nicht archiviert werden" }, { status: 409 });
  }
}
