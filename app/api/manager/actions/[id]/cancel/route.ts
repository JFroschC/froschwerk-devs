import { requestManagerActionCancellation } from "../../../../../../db/local.ts";
import { cancelManagerPrompt } from "../../../../../../scripts/manager-runner.mjs";

export const runtime = "nodejs";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const result = requestManagerActionCancellation(decodeURIComponent(id));
  if (!result.action) return Response.json({ error: "Manager-Versuch nicht gefunden", reason: result.reason }, { status: 404 });
  if (result.reason) return Response.json({ action: result.action, error: "Manager-Versuch ist nicht mehr aktiv", reason: result.reason }, { status: 409 });
  const providerStopped = cancelManagerPrompt(result.action.id);
  return Response.json({ action: result.action, providerStopped }, { status: 200 });
}
