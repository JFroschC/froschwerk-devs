import { getAgentRunDetail } from "../../../../db/local.ts";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const run = getAgentRunDetail(decodeURIComponent(id));
  return run ? Response.json({ run }) : Response.json({ error: "agent run not found" }, { status: 404 });
}
