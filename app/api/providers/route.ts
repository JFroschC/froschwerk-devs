import { getProviderStatus } from "../../../scripts/providers.mjs";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ providers: await getProviderStatus() });
}
