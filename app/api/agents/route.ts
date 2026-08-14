import { listAgents } from "../../../db/local.ts";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ agents: listAgents() });
}
