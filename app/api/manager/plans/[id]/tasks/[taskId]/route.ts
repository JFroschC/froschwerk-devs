import { removeManagerPlanTask, updateManagerPlanTask } from "../../../../../../../db/local.ts";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ id: string; taskId: string }> }) {
  const { id, taskId } = await context.params;
  try {
    const plan = updateManagerPlanTask(id, taskId, await request.json());
    return plan ? Response.json({ plan }) : Response.json({ error: "Planentwurf nicht gefunden" }, { status: 404 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Planentwurf konnte nicht geändert werden" }, { status: 422 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string; taskId: string }> }) {
  const { id, taskId } = await context.params;
  try {
    const plan = removeManagerPlanTask(id, taskId);
    return plan ? Response.json({ plan }) : Response.json({ error: "Planentwurf nicht gefunden" }, { status: 404 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Planentwurf konnte nicht entfernt werden" }, { status: 422 });
  }
}
