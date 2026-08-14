import { addChatMessage, getManagerPlan, listTasks } from "../../../../../../db/local.ts";
import { executeManagedManagerPlan } from "../../../../../../scripts/manager-actions.mjs";

export const runtime = "nodejs";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const before = getManagerPlan(id);
  if (!before) return Response.json({ error: "Plan nicht gefunden" }, { status: 404 });
  try {
    const result = executeManagedManagerPlan(id, { plan: before });
    if (!result) return Response.json({ error: "Plan nicht gefunden" }, { status: 404 });
    const message = addChatMessage({ senderType: "manager", projectId: before.projectId, body: result.confirmation });
    return Response.json({ plan: result.plan, tasks: listTasks(before.projectId), message, action: result.action }, { status: 200 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Plan konnte nicht bestätigt werden" }, { status: 422 });
  }
}
