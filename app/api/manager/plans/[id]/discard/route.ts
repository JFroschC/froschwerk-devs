import { discardManagerPlan } from "../../../../../../db/local.ts";

export const runtime = "nodejs";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const plan = discardManagerPlan(id);
    return plan ? Response.json({ plan }) : Response.json({ error: "Plan nicht gefunden" }, { status: 404 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Plan konnte nicht verworfen werden" }, { status: 422 });
  }
}
