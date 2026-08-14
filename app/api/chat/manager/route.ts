import {
  addChatMessage,
  addManagerConversationEntry,
  answerManagerQuestions,
  getLatestProjectAnalysisSnapshot,
  getManagerConversation,
  getProject,
  listChatMessages,
  listManagerConversationEntries,
  listTasks,
  resolveManagerConversation,
} from "../../../../db/local.ts";
import { runManagerPrompt } from "../../../../scripts/manager-runner.mjs";
import {
  analysisSnapshotHasPlanningDocument,
  ensureOrderedExistingTasks,
  managerDecisionHasMutation,
  managerRequestWantsOrdering,
  managerRequestWantsPlan,
  parseManagerDecision,
  registerManagerDecision,
  runReadOnlyProjectAnalysis,
} from "../../../../scripts/manager-actions.mjs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const payload = await request.json() as { body?: string; projectId?: string; conversationId?: string; answers?: Record<string, string> };
  const body = typeof payload.body === "string" ? payload.body.trim() : "";
  const answers = payload.answers && typeof payload.answers === "object" && !Array.isArray(payload.answers) ? payload.answers : undefined;
  if (!body && !answers) return Response.json({ error: "body or answers is required" }, { status: 400 });
  const projectId = typeof payload.projectId === "string" ? payload.projectId : "project-agent-harness";
  const project = getProject(projectId);
  if (!project || project.status === "archived") return Response.json({ error: "Aktives Projekt nicht gefunden" }, { status: 404 });

  let conversation;
  try {
    conversation = resolveManagerConversation(projectId, typeof payload.conversationId === "string" ? payload.conversationId : undefined);
    if (answers) answerManagerQuestions(conversation.id, answers);
    if (body) addManagerConversationEntry(conversation.id, { senderType: "user", body, payload: answers ? { answers } : {} });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Manager-Gespräch konnte nicht fortgesetzt werden" }, { status: 400 });
  }

  const tasks = listTasks(projectId);
  const history = listChatMessages(20, projectId).map((message) => `${message.sender}: ${message.text}`).join("\n");
  const currentConversation = getManagerConversation(conversation.id);
  const wantsPlan = managerRequestWantsPlan(body);
  let analysis = getLatestProjectAnalysisSnapshot(projectId);
  if (wantsPlan || !analysisSnapshotHasPlanningDocument(analysis)) analysis = await runReadOnlyProjectAnalysis(projectId);
  const entries = listManagerConversationEntries(conversation.id, 30);
  let parsed;
  try {
    parsed = parseManagerDecision(await runManagerPrompt(
      `Aktives Projekt:\n${JSON.stringify(project, null, 2)}\n\nAktueller Board-Kontext dieses Projekts:\n${JSON.stringify(tasks, null, 2)}\n\nLetzter Chatverlauf dieses Projekts (maximal 20 Nachrichten):\n${history || "Noch kein Verlauf."}\n\nPersistenter Gesprächszustand:\n${JSON.stringify({ conversation: currentConversation, entries, latestAnalysis: analysis }, null, 2)}\n\nNutzerfrage oder Antwort:\n${body || "Die offenen Rückfragen wurden beantwortet. Setze die Planung fort."}`,
      project.workspacePath || process.cwd(),
      { projectId },
    ));
    parsed.decision = ensureOrderedExistingTasks(parsed.decision, tasks, managerRequestWantsOrdering(body));
    if (wantsPlan && !managerDecisionHasMutation(parsed.decision)) {
      parsed = parseManagerDecision(await runManagerPrompt(
        `Die lokale Analyse wurde soeben ausgeführt. Der Nutzer verlangt ausdrücklich Analyse UND Ticketanlage. Erzeuge jetzt die konkrete Freigabevorschau mit create_tasks oder update_tasks. Gib keine weitere analyze_project-Aktion zurück, solange der bereitgestellte Planinhalt lesbar ist.\n\nProjektanalyse:\n${JSON.stringify(analysis, null, 2)}\n\nBoard:\n${JSON.stringify(tasks, null, 2)}\n\nNutzeranforderung:\n${body}`,
        project.workspacePath || process.cwd(),
        { projectId },
      ));
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Mira konnte nicht über den lokalen Provider antworten" }, { status: 503 });
  }

  let result;
  try {
    result = await registerManagerDecision({ projectId, conversationId: conversation.id, decision: parsed.decision, validationErrors: parsed.errors });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Miras Vorschlag konnte nicht gespeichert werden" }, { status: 422 });
  }
  const notices = [
    ...(!parsed.valid ? ["Die vorgeschlagenen Aktionen wurden aus Sicherheitsgründen nicht übernommen: " + parsed.errors.join(" ")] : []),
    result.analysisSnapshot ? `Projektanalyse gespeichert: ${result.analysisSnapshot.summary}` : "",
    result.plan ? `Ich habe einen bestätigungspflichtigen Entwurf mit ${result.plan.tasks.length} Ticket${result.plan.tasks.length === 1 ? "" : "s"} vorbereitet.` : "",
  ].filter(Boolean);
  const reply = [parsed.decision.reply || "Ich habe deine Nachricht aufgenommen.", ...notices].join("\n\n");
  return Response.json({
    message: addChatMessage({ senderType: "manager", body: reply, projectId }),
    tasks: listTasks(projectId),
    decision: parsed.decision,
    validationErrors: parsed.errors,
    conversation: getManagerConversation(conversation.id),
    plan: result.plan,
    analysisSnapshot: result.analysisSnapshot,
  }, { status: 201 });
}
