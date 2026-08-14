import { updateAgent } from "../../../../db/local.ts";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const patch = await request.json();
  const agent = updateAgent(decodeURIComponent(id), patch);
  return agent ? Response.json({ agent }) : Response.json({ error: "agent not found" }, { status: 404 });
}
