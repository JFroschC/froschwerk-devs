import { finishTesterAndContinue } from "../../../../../scripts/workflow-orchestrator.mjs";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const result = finishTesterAndContinue(decodeURIComponent(id), await request.json());
  return result ? Response.json(result) : Response.json({ error: "tester run not found" }, { status: 404 });
}
