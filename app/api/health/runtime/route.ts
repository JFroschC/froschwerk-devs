import { getProject } from "../../../../db";
import { checkRuntime } from "../../../../scripts/runtime-check.mjs";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const projectId = new URL(request.url).searchParams.get("projectId") ?? "";
  const project = projectId ? getProject(projectId) : undefined;
  return Response.json(checkRuntime(project?.workspacePath ?? "", { probeProviders: false }));
}
