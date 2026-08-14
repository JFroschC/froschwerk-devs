import { createManagerAction, finishManagerAction, getManagerAction, getManagerConversation, getManagerPlan, getProject, listTasks, startManagerAction, updateManagerAction } from "../../../../../../db/local.ts";
import { runManagerPrompt } from "../../../../../../scripts/manager-runner.mjs";
import { executeManagedManagerPlan, parseManagerDecision, registerManagerDecision, runManagedProjectAnalysis } from "../../../../../../scripts/manager-actions.mjs";

export const runtime = "nodejs";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const previous = getManagerAction(decodeURIComponent(id));
  if (!previous) return Response.json({ error: "Manager-Versuch nicht gefunden" }, { status: 404 });
  if (!["failed", "cancelled"].includes(previous.status)) return Response.json({ error: "Nur ein fehlgeschlagener oder abgebrochener Versuch kann wiederholt werden" }, { status: 409 });
  try {
    if (previous.type === "analysis") {
      const result = await runManagedProjectAnalysis(previous.projectId, { source: "retry", retryOfActionId: previous.id });
      return Response.json({ action: result.action, analysisSnapshot: result.snapshot }, { status: 201 });
    }
    if (previous.type === "execute_plan" && previous.planId) {
      const plan = getManagerPlan(previous.planId);
      if (!plan || plan.status !== "awaiting_confirmation") return Response.json({ error: "Der zugrunde liegende Plan ist nicht mehr erneut ausführbar" }, { status: 409 });
      const result = executeManagedManagerPlan(plan.id, { plan, retryOfActionId: previous.id });
      return Response.json({ action: result.action, plan: result.plan }, { status: 201 });
    }
    if (previous.type === "planning" && previous.conversationId) {
      const project = getProject(previous.projectId);
      const conversation = getManagerConversation(previous.conversationId);
      if (!project || !conversation) return Response.json({ error: "Projekt oder Gespräch des vorherigen Versuchs ist nicht mehr verfügbar" }, { status: 409 });
      const action = createManagerAction({ projectId: previous.projectId, conversationId: conversation.id, type: "planning", input: previous.input, retryOfActionId: previous.id });
      startManagerAction(action.id, "provider_retry");
      try {
        const body = typeof previous.input.body === "string" ? previous.input.body : "Bitte wiederhole den vorherigen Manager-Versuch.";
        const parsed = parseManagerDecision(await runManagerPrompt(`Wiederhole den vorherigen Manager-Versuch als neuen, eigenständigen Versuch. Aktives Projekt:\n${JSON.stringify(project)}\n\nBoard:\n${JSON.stringify(listTasks(project.id))}\n\nUrsprüngliche Eingabe:\n${body}`, project.workspacePath || process.cwd(), { projectId: project.id, actionId: action.id, onRequestStarted: (agentRequestId: string) => updateManagerAction(action.id, { phase: "provider_retry", agentRequestId }) }));
        const result = await registerManagerDecision({ projectId: project.id, conversationId: conversation.id, decision: parsed.decision, validationErrors: parsed.errors });
        const completed = finishManagerAction(action.id, { status: "succeeded", phase: "decision_saved", result: { planId: result.plan?.id ?? null, validationErrors: parsed.errors }, planId: result.plan?.id });
        return Response.json({ action: completed, plan: result.plan, analysisSnapshot: result.analysisSnapshot }, { status: 201 });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const completed = finishManagerAction(action.id, { status: message === "MANAGER_ACTION_CANCELLED" ? "cancelled" : "failed", phase: "provider_failed", error: message });
        return Response.json({ action: completed, error: message }, { status: 422 });
      }
    }
    return Response.json({ error: "Dieser Manager-Versuch kann nicht automatisch wiederholt werden." }, { status: 409 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Manager-Versuch konnte nicht wiederholt werden" }, { status: 422 });
  }
}
