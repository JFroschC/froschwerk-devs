import { performRunStopAction } from "../../../../../scripts/run-actions.mjs";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const payload = await request.json().catch(() => ({})) as { action?: "stop"; confirmation?: "confirmed" | "declined" };
  if (payload.action !== "stop") return Response.json({ ok: false, reason: "unknown_action" }, { status: 400 });
  const result = performRunStopAction({ runId: decodeURIComponent(id), confirmation: payload.confirmation });
  return Response.json(result, { status: result.ok ? 200 : 409 });
}
