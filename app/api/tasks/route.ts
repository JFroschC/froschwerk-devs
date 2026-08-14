import { createTask, listTasks } from "../../../db";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const projectId = new URL(request.url).searchParams.get("projectId") ?? undefined;
  return Response.json({ tasks: listTasks(projectId) });
}

export async function POST(request: Request) {
  const payload = await request.json() as { title?: string; description?: string; priority?: string; acceptance?: string[]; projectId?: string };
  const title = payload.title?.trim() ?? "";
  if (!title) return Response.json({ error: "title is required" }, { status: 400 });
  return Response.json({ task: createTask({ ...payload, title }) }, { status: 201 });
}
