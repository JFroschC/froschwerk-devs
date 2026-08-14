import { addComment, updateTask } from "../../../../db";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const payload = await request.json() as { title?: string; description?: string; status?: string; priority?: string; assignee?: string; acceptance?: string[] };
  const task = updateTask(id, payload);
  if (!task) return Response.json({ error: "task not found" }, { status: 404 });
  return Response.json({ task });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const payload = await request.json() as { body?: string; authorType?: string; authorId?: string; authorName?: string };
  const body = payload.body?.trim() ?? "";
  if (!body) return Response.json({ error: "body is required" }, { status: 400 });
  const task = addComment(id, { ...payload, body });
  if (!task) return Response.json({ error: "task not found" }, { status: 404 });
  return Response.json({ task }, { status: 201 });
}
