import { cancelActiveRun } from "../../../../../scripts/workflow-orchestrator.mjs";

export const runtime = "nodejs";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const result = cancelActiveRun(decodeURIComponent(id));
  return result.cancelled ? Response.json(result) : Response.json(result, { status: 409 });
}
