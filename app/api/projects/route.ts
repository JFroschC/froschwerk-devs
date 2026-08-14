import { createProject, listProjects } from "../../../db/local.ts";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ projects: listProjects() });
}

export async function POST(request: Request) {
  try {
    const project = createProject(await request.json());
    return Response.json({ project }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Projekt konnte nicht angelegt werden" }, { status: 400 });
  }
}
