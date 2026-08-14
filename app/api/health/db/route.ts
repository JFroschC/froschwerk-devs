import { databaseHealth } from "../../../../db";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ ok: true, database: databaseHealth() });
}
