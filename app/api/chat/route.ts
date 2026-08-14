import { addChatMessage, listChatMessages } from "../../../db";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const projectId = new URL(request.url).searchParams.get("projectId") ?? undefined;
  return Response.json({ messages: listChatMessages(undefined, projectId) });
}

export async function POST(request: Request) {
  const payload = await request.json() as { senderType?: "user" | "manager"; body?: string; projectId?: string };
  const body = payload.body?.trim() ?? "";
  if (!body) return Response.json({ error: "body is required" }, { status: 400 });
  return Response.json({ message: addChatMessage({ senderType: payload.senderType ?? "user", body, projectId: payload.projectId }) }, { status: 201 });
}
