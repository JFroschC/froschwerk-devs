import { addComment, listAgentRuns, listTaskEvents, listTasks, transitionTaskStatus } from "./local.ts";

type McpActor = {
  actorType?: "agent" | "manager" | "user";
  actorId?: string;
  authorName?: string;
  runId?: string;
};

function requireTask(taskId: string) {
  const task = listTasks().find((item) => item.id === taskId);
  if (!task) throw new Error(`Ticket nicht gefunden: ${taskId}`);
  return task;
}

function normalizeActor(actor?: McpActor) {
  return {
    actorType: actor?.actorType ?? "agent",
    actorId: actor?.actorId ?? "codex",
    authorName: actor?.authorName ?? "Codex",
    runId: actor?.runId,
  };
}

export const mcpToolContract = {
  version: 1,
  scope: "local-agent-harness",
  tools: [
    {
      name: "harness.task.read",
      description: "Liest ein Ticket inklusive Akzeptanzkriterien, Kommentaren, Agentenlaeufen und Event-Historie.",
      inputSchema: {
        type: "object",
        required: ["taskId"],
        properties: {
          taskId: { type: "string", pattern: "^[A-Z0-9][A-Z0-9_-]*$" },
        },
        additionalProperties: false,
      },
    },
    {
      name: "harness.task.comment",
      description: "Speichert einen nachvollziehbaren Kommentar an einem Ticket.",
      inputSchema: {
        type: "object",
        required: ["taskId", "body"],
        properties: {
          taskId: { type: "string", pattern: "^[A-Z0-9][A-Z0-9_-]*$" },
          body: { type: "string", minLength: 1, maxLength: 8000 },
          actor: { $ref: "#/$defs/actor" },
        },
        additionalProperties: false,
      },
    },
    {
      name: "harness.task.transition",
      description: "Aendert den Ticketstatus nur entlang der erlaubten Workflow-Uebergaenge.",
      inputSchema: {
        type: "object",
        required: ["taskId", "status"],
        properties: {
          taskId: { type: "string", pattern: "^[A-Z0-9][A-Z0-9_-]*$" },
          status: { enum: ["Ready", "In Progress", "Review", "Testing", "Done", "Changes Requested", "Blocked"] },
          reason: { type: "string", maxLength: 2000 },
          actor: { $ref: "#/$defs/actor" },
        },
        additionalProperties: false,
      },
    },
    {
      name: "harness.agent_runs.list",
      description: "Listet Agentenlaeufe fuer ein Ticket oder das gesamte Board.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string", pattern: "^[A-Z0-9][A-Z0-9_-]*$" },
        },
        additionalProperties: false,
      },
    },
  ],
  $defs: {
    actor: {
      type: "object",
      properties: {
        actorType: { enum: ["agent", "manager", "user"] },
        actorId: { type: "string", minLength: 1 },
        authorName: { type: "string", minLength: 1 },
        runId: { type: "string", minLength: 1 },
      },
      additionalProperties: false,
    },
  },
} as const;

export function listMcpTools() {
  return mcpToolContract.tools;
}

export function mcpReadTask(input: { taskId: string }) {
  const task = requireTask(input.taskId);
  return {
    task,
    agentRuns: listAgentRuns(input.taskId),
    events: listTaskEvents(input.taskId),
  };
}

export function mcpCommentOnTask(input: { taskId: string; body: string; actor?: McpActor }) {
  const body = input.body.trim();
  if (!body) throw new Error("Kommentartext ist erforderlich");
  requireTask(input.taskId);
  const actor = normalizeActor(input.actor);
  addComment(input.taskId, {
    authorType: actor.actorType,
    authorId: actor.actorId,
    authorName: actor.authorName,
    body,
    runId: actor.runId,
  });
  return mcpReadTask({ taskId: input.taskId });
}

export function mcpTransitionTask(input: { taskId: string; status: string; reason?: string; actor?: McpActor }) {
  requireTask(input.taskId);
  const actor = normalizeActor(input.actor);
  transitionTaskStatus(input.taskId, {
    status: input.status,
    actorType: actor.actorType,
    actorId: actor.actorId,
    reason: input.reason?.trim(),
    runId: actor.runId,
  });
  return mcpReadTask({ taskId: input.taskId });
}

export function mcpListAgentRuns(input: { taskId?: string } = {}) {
  return { agentRuns: listAgentRuns(input.taskId) };
}
