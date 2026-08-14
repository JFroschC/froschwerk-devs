"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type Status = "Ready" | "In Progress" | "Review" | "Testing" | "Changes Requested" | "Blocked" | "Done";
type Priority = "Urgent" | "High" | "Medium" | "Low";

type Comment = {
  id: string;
  author: string;
  role: "Du" | "Manager" | "Entwickler" | "Tester";
  text: string;
  createdAt: string;
};

type Task = {
  id: string;
  title: string;
  description: string;
  status: Status;
  priority: Priority;
  project: string;
  assignee: string;
  acceptance: string[];
  comments: Comment[];
  updatedAt: string;
  activeRunId?: string | null;
  activeRunStatus?: string | null;
  activeRunRole?: string | null;
  parentTaskId?: string | null;
  planId?: string | null;
  planSequence?: number | null;
  obsoleteAt?: string | null;
  obsoleteReason?: string | null;
  dependencies?: string[];
  testReport?: {
    status: "passed" | "failed" | "blocked";
    summary: string;
    checks: Array<{ name?: string; status?: string; details?: string }>;
    logs?: string;
  };
};

type ChatMessage = {
  id: string;
  sender: "Du" | "Manager";
  text: string;
};

type ProviderStatus = {
  id: string;
  label: string;
  installed: boolean;
  loggedIn: boolean;
  authMethod?: string;
  subscriptionType?: string;
  apiKeyDetected: boolean;
  error?: string;
};

type RuntimeCheck = {
  ok: boolean;
  user: { username: string; userProfile: string; sandbox: boolean };
  codexHome: { path: string; directory: { writable: boolean }; state: { writable: boolean }; tmp: { writable: boolean } };
  providers: Record<string, { installed: boolean; version: string; path: string; error: string }>;
  workspace: { path: string; writable: boolean; exists: boolean } | null;
  messages: string[];
};

type AgentRequest = {
  id: string;
  role: string;
  provider: string;
  model: string;
  status: string;
  startedAt: string;
  lastActivityAt?: string;
  currentPhase?: string;
  finishedAt?: string;
  durationMs?: number;
  inputChars: number;
  outputChars: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  promptPreview: string;
  responsePreview: string;
  error?: string;
};

type AgentRun = {
  runId: string;
  taskId: string;
  agentId: string;
  agentName: string;
  role: string;
  provider: string;
  status: string;
  attemptNo: number;
  summary?: string;
  error?: string | null;
  processId?: number | null;
  processIdentity?: string | null;
  leaseExpiresAt?: string | null;
  lastHeartbeatAt?: string | null;
  lastActivityAt?: string | null;
  currentPhase?: string | null;
  progress?: number | null;
  exitCode?: number | null;
  signal?: string | null;
  terminationReason?: string | null;
  cancellationRequestedAt?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt: string;
};

type TaskEvent = {
  id: string;
  taskId: string;
  taskTitle?: string;
  eventType: string;
  actorType: string;
  actorId: string;
  payload: unknown;
  createdAt: string;
};

type AgentRunDetail = AgentRun & {
  lease: { acquiredAt: string; expiresAt: string } | null;
  requests: AgentRequest[];
  testReport: { id: string; status: string; summary: string; checks: Array<{ name?: string; status?: string; details?: string }>; logs: string; createdAt: string } | null;
  events: TaskEvent[];
};

type RequestSummary = { count: number; running: number; tokens: number; durationMs: number };

type HarnessAgent = {
  id: string;
  name: string;
  role: "manager" | "developer" | "tester";
  provider: "codex" | "claude";
  status: string;
  maxConcurrency: number;
};

type WorkspaceView = "board" | "agents" | "activity" | "runs";
type RightPane = "detail" | "chat";
type AgentTab = "output" | "requests" | "events" | "tests";

type PendingRunAction = {
  target: "task" | "run";
  taskId: string;
  action: "start" | "retry" | "stop";
  role: "developer" | "tester";
  runId?: string;
  message: string;
};

type Project = {
  id: string;
  key: string;
  name: string;
  description: string;
  type: string;
  workspacePath: string;
  startCommand: string;
  testCommand: string;
  autoProcessEnabled: boolean;
  status: "active" | "archived";
  ticketCount: number;
  doneCount: number;
  progress: number;
  runCount: number;
};

type ManagerQuestion = {
  id: string;
  question: string;
  options: string[];
  required: boolean;
  answer?: string | null;
};

type ManagerPlanTask = {
  id: string;
  clientId: string;
  kind: string;
  title: string;
  description: string;
  priority: Priority;
  sequence: number;
  acceptance: string[];
  parentClientId?: string | null;
  parentTaskId?: string | null;
  dependsOnClientIds: string[];
  taskId?: string | null;
};

type ManagerTaskUpdate = {
  taskId: string;
  title?: string;
  description?: string;
  priority?: Priority;
  acceptance?: string[];
};

type ManagerPlanAction = {
  type: string;
  updates?: ManagerTaskUpdate[];
};

type ManagerPlan = {
  id: string;
  status: "awaiting_confirmation" | "applied" | "discarded" | string;
  title: string;
  summary: string;
  assumptions: string[];
  risks: string[];
  actions?: ManagerPlanAction[];
  tasks: ManagerPlanTask[];
  progress: { total: number; done: number; active: number; blocked: number; percent: number };
};

type ManagerConversation = {
  id: string;
  status: "open" | "needs_input" | "awaiting_confirmation" | "completed" | "failed" | string;
  mode: string;
  questions: ManagerQuestion[];
  plan?: ManagerPlan;
};

type AnalysisSnapshot = { id: string; summary: string; status: string; createdAt: string; snapshot?: { git?: { branch?: string; changedFiles?: number }; workspace?: { path?: string } } };
type ManagerState = { conversation?: ManagerConversation; plan?: ManagerPlan; analysisSnapshot?: AnalysisSnapshot };
type ManagerAction = {
  id: string;
  type: "analysis" | "planning" | "execute_plan" | string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled" | string;
  phase: string;
  attemptNo: number;
  retryOfActionId?: string | null;
  confirmation: string;
  agentRequestId?: string | null;
  planId?: string | null;
  analysisSnapshotId?: string | null;
  error?: string | null;
  result?: Record<string, unknown>;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  events: Array<{ id: number; eventType: string; createdAt: string }>;
};
type ManagerStateWithActions = ManagerState & { actions?: ManagerAction[] };

const statuses: Status[] = ["Ready", "In Progress", "Review", "Testing", "Changes Requested", "Blocked", "Done"];
const activeStatuses = ["queued", "starting", "running", "cancelling"];
const activeProjectStorageKey = "froschwerk-active-project";
const defaultProjectId = "project-agent-harness";

function browserPreference(key: string) {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

const seedTasks: Task[] = [
  {
    id: "FW-104",
    title: "Taskboard-Grundlayout und Navigation",
    description: "Ein übersichtliches Board für Projekte und Agentenläufe aufbauen.",
    status: "Done",
    priority: "High",
    project: "Agent Harness",
    assignee: "Entwickler",
    acceptance: ["Statusspalten sind sichtbar", "Tickets können geöffnet werden"],
    comments: [
      { id: "c1", author: "Mira", role: "Manager", text: "Vom Tester bestätigt und abgeschlossen.", createdAt: "Heute, 09:42" },
      { id: "c2", author: "QA Bot", role: "Tester", text: "Board-Navigation und responsive Ansicht geprüft.", createdAt: "Heute, 09:38" },
    ],
    updatedAt: "vor 18 Min.",
  },
  {
    id: "FW-108",
    title: "Manager-Chat mit Ticketaktionen",
    description: "Der Hauptmanager soll Tickets aus dem Chat anlegen und den nächsten Lauf starten können.",
    status: "In Progress",
    priority: "Urgent",
    project: "Agent Harness",
    assignee: "Entwickler",
    acceptance: ["Chat ist sichtbar", "Neues Ticket kann aus einer Nachricht entstehen", "Nächste Aufgabe kann gestartet werden"],
    comments: [{ id: "c3", author: "Mira", role: "Manager", text: "Phase 2 gestartet. UI zuerst, API-Adapter folgt.", createdAt: "Heute, 10:04" }],
    updatedAt: "vor 6 Min.",
  },
  {
    id: "FW-111",
    title: "Testergebnisse direkt am Ticket speichern",
    description: "Testberichte, Logs und eine klare Pass/Fail-Rückmeldung am Ticket ablegen.",
    status: "Testing",
    priority: "High",
    project: "Agent Harness",
    assignee: "Tester",
    acceptance: ["Testergebnis hat einen Status", "Fehler enthalten Reproduktionsschritte", "Manager erhält eine Rückmeldung"],
    comments: [{ id: "c4", author: "QA Bot", role: "Tester", text: "Prüfe zunächst den aktuellen Kommentarfluss.", createdAt: "Heute, 09:56" }],
    updatedAt: "vor 23 Min.",
  },
  {
    id: "FW-115",
    title: "Run-Aktionssteuerung vorbereiten",
    description: "Sichere Start-, Stop- und Retry-Aktionen für Agentenläufe vorbereiten.",
    status: "Ready",
    priority: "Medium",
    project: "Agent Harness",
    assignee: "Entwickler",
    acceptance: ["Tool-Vertrag ist dokumentiert", "Statusänderungen sind eingeschränkt", "Agentenläufe sind nachvollziehbar"],
    comments: [],
    updatedAt: "gestern",
  },
  {
    id: "FW-118",
    title: "Retry- und Blockade-Regeln definieren",
    description: "Verhindern, dass ein fehlerhaftes Ticket endlos zwischen Entwickler und Tester pendelt.",
    status: "Review",
    priority: "Low",
    project: "Agent Harness",
    assignee: "Manager",
    acceptance: ["Maximale Versuche sind sichtbar", "Blocked eskaliert an den Benutzer"],
    comments: [],
    updatedAt: "Montag",
  },
];

const initialMessages: ChatMessage[] = [
  { id: "m1", sender: "Manager", text: "Guten Morgen. Ich habe 5 Tickets im Projekt Agent Harness. FW-108 ist aktuell der nächste aktive Schritt." },
  { id: "m2", sender: "Manager", text: "Du kannst mir Aufgaben in normaler Sprache geben. Ich erstelle daraus ein Ticket und halte den Verlauf direkt am Board fest." },
];

const roleLabel = (role: string) => role === "manager" ? "Hauptmanager" : role === "tester" ? "Tester" : "Entwickler";
const roleDe = (role: string) => role === "manager" ? "Manager" : role === "tester" ? "Tester" : "Entwickler";
const providerLabel = (provider: string) => provider === "claude" ? "Claude-Abo" : "Codex-Abo";

function agentDuty(role: string) {
  if (role === "manager") return { file: "agents/manager.md", text: "Analysiere das Projekt lesend, stelle Rückfragen und schlage bestätigungspflichtige Pläne vor. Lege Tickets ausschließlich als atomaren Batch an und triff keine unbestätigten Änderungen am Board." };
  if (role === "tester") return { file: "agents/tester.md", text: "Prüfe genau ein an dich übergebenes Ticket gegen seine Akzeptanzkriterien, führe das Projekt-Testgate aus und halte ein klares Pass/Fail mit Reproduktionsschritten fest. Verändere keinen Produktivcode." };
  return { file: "agents/developer.md", text: "Setze genau ein Ticket um. Halte dich an die Akzeptanzkriterien, ändere nur Dateien im Arbeitsverzeichnis und starte am Ende das Projekt-Testgate. Melde Blockaden zurück, statt Annahmen zu treffen." };
}

function agentRights(role: string): Array<{ text: string; granted: boolean }> {
  if (role === "manager") return [
    { text: "Projekt lesend analysieren", granted: true },
    { text: "Pläne vorschlagen und Tickets als Batch anlegen", granted: true },
    { text: "Provider über das lokale Abo ansprechen", granted: true },
    { text: "Produktivcode direkt ändern", granted: false },
    { text: "Läufe erzwingen ohne Bestätigung", granted: false },
  ];
  if (role === "tester") return [
    { text: "Dateien lesen", granted: true },
    { text: "Testgate ausführen", granted: true },
    { text: "Testergebnis am Ticket speichern", granted: true },
    { text: "Produktivcode ändern", granted: false },
    { text: "Ticket anlegen oder löschen", granted: false },
  ];
  return [
    { text: "Dateien lesen und ändern", granted: true },
    { text: "Testgate ausführen", granted: true },
    { text: "Ticketstatus auf Review setzen", granted: true },
    { text: "Tickets anlegen oder löschen", granted: false },
    { text: "Netzwerkzugriff außerhalb des Providers", granted: false },
  ];
}

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>(seedTasks);
  const [selectedId, setSelectedId] = useState("FW-108");
  const [chat, setChat] = useState<ChatMessage[]>(initialMessages);
  const [chatInput, setChatInput] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showTaskEditor, setShowTaskEditor] = useState(false);
  const [taskForm, setTaskForm] = useState({ id: "", title: "", description: "", priority: "Medium", assignee: "Entwickler", acceptance: "" });
  const [dbError, setDbError] = useState("");
  const [runtimeCheck, setRuntimeCheck] = useState<RuntimeCheck | null>(null);
  const [agentRequests, setAgentRequests] = useState<AgentRequest[]>([]);
  const [requestSummary, setRequestSummary] = useState<RequestSummary>({ count: 0, running: 0, tokens: 0, durationMs: 0 });
  const [providers, setProviders] = useState<Record<string, ProviderStatus>>({});
  const [agents, setAgents] = useState<HarnessAgent[]>([]);
  const [agentRuns, setAgentRuns] = useState<AgentRun[]>([]);
  const [taskEvents, setTaskEvents] = useState<TaskEvent[]>([]);
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>("board");
  const [rightPane, setRightPane] = useState<RightPane>("detail");
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [agentTab, setAgentTab] = useState<AgentTab>("output");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<AgentRunDetail | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pendingRunAction, setPendingRunAction] = useState<PendingRunAction | null>(null);
  const [runActionSubmitting, setRunActionSubmitting] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState(() => browserPreference(activeProjectStorageKey) || defaultProjectId);
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [projectForm, setProjectForm] = useState({ key: "", name: "", description: "", type: "Tool", workspacePath: "", startCommand: "", testCommand: "" });
  const [managerState, setManagerState] = useState<ManagerStateWithActions>({});
  const [questionAnswers, setQuestionAnswers] = useState<Record<string, string>>({});
  const [lastSyncedAt, setLastSyncedAt] = useState("");
  const chatMessagesRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const lastChatMessageIdRef = useRef("");
  const activeProjectIdRef = useRef(activeProjectId);
  const refreshSequenceRef = useRef(0);

  const refreshWorkspace = useCallback(async (showError = false) => {
    const refreshSequence = ++refreshSequenceRef.current;
    try {
      const projectResponse = await fetch("/api/projects", { cache: "no-store" });
      if (!projectResponse.ok) throw new Error("Projects API unavailable");
      const projectPayload = await projectResponse.json() as { projects: Project[] };
      setProjects(projectPayload.projects);
      const projectId = projectPayload.projects.some((project) => project.id === activeProjectId) ? activeProjectId : projectPayload.projects[0]?.id;
      if (!projectId) throw new Error("Kein aktives Projekt vorhanden");
      if (projectId !== activeProjectId) setActiveProjectId(projectId);
      const query = `?projectId=${encodeURIComponent(projectId)}`;
      const [tasksResponse, chatResponse, agentsResponse, requestsResponse, runsResponse, eventsResponse, managerResponse] = await Promise.all([
        fetch(`/api/tasks${query}`, { cache: "no-store" }),
        fetch(`/api/chat${query}`, { cache: "no-store" }),
        fetch("/api/agents", { cache: "no-store" }),
        fetch(`/api/agent-requests${query}&limit=5`, { cache: "no-store" }),
        fetch(`/api/agent-runs${query}`, { cache: "no-store" }),
        fetch(`/api/task-events${query}&limit=100`, { cache: "no-store" }),
        fetch(`/api/manager/state${query}`, { cache: "no-store" }),
      ]);
      if (!tasksResponse.ok || !chatResponse.ok || !agentsResponse.ok || !requestsResponse.ok || !runsResponse.ok || !eventsResponse.ok || !managerResponse.ok) throw new Error("SQLite API unavailable");
      const tasksPayload = await tasksResponse.json() as { tasks: Task[] };
      const chatPayload = await chatResponse.json() as { messages: ChatMessage[] };
      const agentsPayload = await agentsResponse.json() as { agents: HarnessAgent[] };
      const requestsPayload = await requestsResponse.json() as { requests: AgentRequest[]; summary: RequestSummary };
      const runsPayload = await runsResponse.json() as { runs: AgentRun[] };
      const eventsPayload = await eventsResponse.json() as { events: TaskEvent[] };
      const managerPayload = await managerResponse.json() as ManagerStateWithActions;
      if (refreshSequence !== refreshSequenceRef.current || projectId !== activeProjectIdRef.current) return;
      setTasks(tasksPayload.tasks);
      setChat(chatPayload.messages);
      setAgents(agentsPayload.agents);
      setAgentRequests(requestsPayload.requests);
      setRequestSummary(requestsPayload.summary);
      setAgentRuns(runsPayload.runs);
      setTaskEvents(eventsPayload.events);
      setManagerState(managerPayload);
      setLastSyncedAt(new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
      setDbError((current) => current.startsWith("SQLite ") ? "" : current);
    } catch {
      if (showError) setDbError("SQLite ist noch nicht erreichbar. Die Anzeige nutzt vorübergehend die Startdaten.");
    }
  }, [activeProjectId]);

  useEffect(() => {
    activeProjectIdRef.current = activeProjectId;
  }, [activeProjectId]);

  useEffect(() => {
    if (!selectedRunId) {
      queueMicrotask(() => setSelectedRun(null));
      return;
    }
    let cancelled = false;
    fetch(`/api/agent-runs/${encodeURIComponent(selectedRunId)}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<{ run: AgentRunDetail }> : Promise.reject(new Error("Run-Detail nicht erreichbar")))
      .then((payload) => { if (!cancelled) setSelectedRun(payload.run); })
      .catch((error) => { if (!cancelled) setDbError(error instanceof Error ? error.message : "Run-Detail nicht erreichbar"); });
    return () => { cancelled = true; };
  }, [selectedRunId, agentRuns]);

  useEffect(() => {
    try {
      window.localStorage.setItem(activeProjectStorageKey, activeProjectId);
    } catch {
      // Project selection remains available for the current browser session.
    }
  }, [activeProjectId]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/health/runtime?projectId=${encodeURIComponent(activeProjectId)}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<RuntimeCheck> : Promise.reject(new Error("Runtimecheck nicht erreichbar")))
      .then((payload) => { if (!cancelled && activeProjectIdRef.current === activeProjectId) setRuntimeCheck(payload); })
      .catch(() => { if (!cancelled) setRuntimeCheck(null); });
    return () => { cancelled = true; };
  }, [activeProjectId]);

  useEffect(() => {
    let cancelled = false;
    const sync = () => { if (!cancelled && document.visibilityState === "visible") void refreshWorkspace(); };
    // Initial hydration replaces the fallback seed data with SQLite data.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshWorkspace(true);
    const intervalId = window.setInterval(sync, 2000);
    document.addEventListener("visibilitychange", sync);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [refreshWorkspace]);

  useEffect(() => {
    const container = chatMessagesRef.current;
    const lastMessageId = chat.at(-1)?.id ?? "";
    if (!container || lastMessageId === lastChatMessageIdRef.current) return;
    lastChatMessageIdRef.current = lastMessageId;
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, [chat]);

  useEffect(() => {
    if (workspaceView === "agents" && agentTab === "output" && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [taskEvents, workspaceView, agentTab]);

  async function refreshProviders() {
    try {
      const response = await fetch("/api/providers", { cache: "no-store" });
      if (!response.ok) throw new Error("Provider-Status nicht erreichbar");
      const payload = await response.json() as { providers: Record<string, ProviderStatus> };
      setProviders(payload.providers);
    } catch {
      setProviders({});
    }
  }

  async function updateAgentProvider(agentId: string, provider: HarnessAgent["provider"]) {
    try {
      const response = await fetch(`/api/agents/${agentId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider }) });
      if (!response.ok) throw new Error("Agent-Provider konnte nicht gespeichert werden");
      const payload = await response.json() as { agent: HarnessAgent };
      setAgents((current) => current.map((agent) => agent.id === agentId ? payload.agent : agent));
    } catch (error) {
      setDbError(error instanceof Error ? error.message : "Agent-Provider konnte nicht gespeichert werden");
    }
  }

  function openProjectForm(project?: Project) {
    setEditingProjectId(project?.id ?? null);
    setProjectForm(project ? { key: project.key, name: project.name, description: project.description, type: project.type, workspacePath: project.workspacePath, startCommand: project.startCommand, testCommand: project.testCommand } : { key: "", name: "", description: "", type: "Tool", workspacePath: "", startCommand: "", testCommand: "" });
    setShowProjectModal(true);
  }

  function openTaskEditor(task: Task) {
    setTaskForm({ id: task.id, title: task.title, description: task.description, priority: task.priority, assignee: task.assignee, acceptance: task.acceptance.join("\n") });
    setShowTaskEditor(true);
  }

  async function saveTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const acceptance = taskForm.acceptance.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    try {
      const response = await fetch(`/api/tasks/${taskForm.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: taskForm.title, description: taskForm.description, priority: taskForm.priority, assignee: taskForm.assignee, acceptance }) });
      const payload = await response.json() as { task?: Task; error?: string };
      if (!response.ok || !payload.task) throw new Error(payload.error || "Ticket konnte nicht gespeichert werden");
      setTasks((current) => current.map((task) => task.id === payload.task!.id ? payload.task! : task));
      setShowTaskEditor(false);
    } catch (error) {
      setDbError(error instanceof Error ? error.message : "Ticket konnte nicht gespeichert werden");
    }
  }

  async function saveProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const response = await fetch(editingProjectId ? `/api/projects/${editingProjectId}` : "/api/projects", { method: editingProjectId ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(projectForm) });
      const payload = await response.json() as { project?: Project; error?: string };
      if (!response.ok || !payload.project) throw new Error(payload.error || "Projekt konnte nicht gespeichert werden");
      setProjects((current) => editingProjectId ? current.map((project) => project.id === payload.project!.id ? payload.project! : project) : [payload.project!, ...current]);
      setActiveProjectId(payload.project.id);
      setShowProjectModal(false);
    } catch (error) {
      setDbError(error instanceof Error ? error.message : "Projekt konnte nicht gespeichert werden");
    }
  }

  async function archiveActiveProject() {
    const project = projects.find((item) => item.id === activeProjectId);
    if (!project || !window.confirm(`Projekt „${project.name}“ wirklich archivieren?`)) return;
    if (projects.length <= 1) {
      setDbError("Das letzte aktive Projekt kann nicht archiviert werden.");
      return;
    }
    try {
      const response = await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
      const payload = await response.json() as { project?: Project; error?: string };
      if (!response.ok) throw new Error(payload.error || "Projekt konnte nicht archiviert werden");
      const remaining = projects.filter((item) => item.id !== project.id);
      setProjects(remaining);
      setActiveProjectId(remaining[0]?.id ?? "");
    } catch (error) {
      setDbError(error instanceof Error ? error.message : "Projekt konnte nicht archiviert werden");
    }
  }

  async function toggleAutoProcess() {
    const project = projects.find((item) => item.id === activeProjectId);
    if (!project) return;
    try {
      const response = await fetch(`/api/projects/${project.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ autoProcessEnabled: !project.autoProcessEnabled }) });
      const payload = await response.json() as { project?: Project; autoProcess?: { reason?: string; result?: { error?: string } }; error?: string };
      if (!response.ok || !payload.project) throw new Error(payload.error || "Autoprozess konnte nicht gespeichert werden");
      setProjects((current) => current.map((item) => item.id === payload.project!.id ? payload.project! : item));
      if (!project.autoProcessEnabled && payload.autoProcess?.result?.error) setDbError(`Autoprozess ist aktiviert, konnte aber noch nicht starten: ${payload.autoProcess.result.error}`);
    } catch (error) {
      setDbError(error instanceof Error ? error.message : "Autoprozess konnte nicht gespeichert werden");
    }
  }

  useEffect(() => {
    // Provider status synchronizes the UI with the local CLI auth stores.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshProviders();
  }, []);

  const selectedTask = tasks.find((task) => task.id === selectedId) ?? tasks[0];
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? projects[0];
  const selectedTaskRuns = selectedTask ? agentRuns.filter((run) => run.taskId === selectedTask.id) : [];
  const retryableRun = selectedTaskRuns.find((run) => ["failed", "timed_out", "cancelled", "lost"].includes(run.status));
  const activeManagerPlan = managerState.plan ?? managerState.conversation?.plan;
  const hasManagerWorkbench = Boolean(managerState.analysisSnapshot || managerState.conversation?.status === "needs_input" || activeManagerPlan || (managerState.actions?.length ?? 0) > 0);

  const displayedAgents = agents.length > 0 ? agents : [
    { id: "agent-manager", name: "Mira", role: "manager" as const, provider: "codex" as const, status: "online", maxConcurrency: 1 },
    { id: "agent-developer-1", name: "Dev Agent", role: "developer" as const, provider: "codex" as const, status: "online", maxConcurrency: 2 },
    { id: "agent-developer-2", name: "Dev Agent 2", role: "developer" as const, provider: "claude" as const, status: "offline", maxConcurrency: 1 },
    { id: "agent-tester-1", name: "QA Bot", role: "tester" as const, provider: "codex" as const, status: "online", maxConcurrency: 2 },
  ];
  const agentForPage = displayedAgents.find((agent) => agent.id === selectedAgentId) ?? displayedAgents[0] ?? null;

  const runningCount = agentRuns.filter((run) => activeStatuses.includes(run.status)).length;
  const attention = useMemo(() => {
    const notes: string[] = [];
    const active = agentRuns.find((run) => activeStatuses.includes(run.status));
    if (active) notes.push(`${active.agentName} arbeitet an ${active.taskId}`);
    const waiting = tasks.filter((task) => task.status === "Review").length;
    if (waiting > 0) notes.push(`${waiting} ${waiting === 1 ? "Ticket wartet" : "Tickets warten"} auf deine Freigabe`);
    const blocked = tasks.filter((task) => task.status === "Blocked").length;
    if (blocked > 0) notes.push(`${blocked} blockiert`);
    if (providers.claude && providers.claude.installed && !providers.claude.loggedIn) notes.push("Claude-Login fehlt");
    const heading = `${tasks.length} ${tasks.length === 1 ? "Ticket" : "Tickets"}, ${runningCount === 0 ? "keiner läuft" : runningCount === 1 ? "einer läuft" : `${runningCount} laufen`}.`;
    return { heading, sub: notes.length ? notes.join(" · ") : "Alles ruhig im Projekt." };
  }, [tasks, agentRuns, providers, runningCount]);

  async function updateTask(id: string, patch: Partial<Task>) {
    try {
      const response = await fetch(`/api/tasks/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
      if (!response.ok) throw new Error("Ticket konnte nicht gespeichert werden");
      const payload = await response.json() as { task: Task };
      setTasks((current) => current.map((task) => task.id === id ? payload.task : task));
    } catch (error) {
      setDbError(error instanceof Error ? error.message : "Ticket konnte nicht gespeichert werden");
    }
  }

  function moveTask(id: string, status: Status) {
    void updateTask(id, { status });
  }

  async function addComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTask) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const text = String(form.get("comment") ?? "").trim();
    if (!text) return;
    // React may release the synthetic event after the awaited request. Reset the
    // native form before awaiting so comment submission stays reliable.
    formElement.reset();
    try {
      const response = await fetch(`/api/tasks/${selectedTask.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body: text, authorType: "user", authorId: "owner", authorName: "Du" }) });
      if (!response.ok) throw new Error("Kommentar konnte nicht gespeichert werden");
      const payload = await response.json() as { task: Task };
      setTasks((current) => current.map((task) => task.id === selectedTask.id ? payload.task : task));
    } catch (error) {
      setDbError(error instanceof Error ? error.message : "Kommentar konnte nicht gespeichert werden");
    }
  }

  async function createTask(title = newTitle, description = newDescription) {
    const cleanTitle = title.trim();
    if (!cleanTitle) return;
    try {
      const response = await fetch("/api/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: cleanTitle, description: description.trim(), projectId: activeProjectId }) });
      if (!response.ok) throw new Error("Ticket konnte nicht angelegt werden");
      const payload = await response.json() as { task: Task };
      setTasks((current) => [payload.task, ...current]);
      setSelectedId(payload.task.id);
      setRightPane("detail");
      setNewTitle("");
      setNewDescription("");
      setShowCreate(false);
      return payload.task;
    } catch (error) {
      setDbError(error instanceof Error ? error.message : "Ticket konnte nicht angelegt werden");
    }
  }

  async function appendChat(senderType: "user" | "manager", text: string) {
    const projectId = activeProjectId;
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ senderType, body: text, projectId: activeProjectId }) });
      if (!response.ok) throw new Error("Chatnachricht konnte nicht gespeichert werden");
      const payload = await response.json() as { message: ChatMessage; task?: Task; tasks?: Task[] };
      if (activeProjectIdRef.current !== projectId) return false;
      setChat((current) => [...current, payload.message]);
      if (payload.tasks) setTasks(payload.tasks);
      if (payload.task) setSelectedId(payload.task.id);
      return true;
    } catch (error) {
      setDbError(error instanceof Error ? error.message : "Chatnachricht konnte nicht gespeichert werden");
      return false;
    }
  }

  async function askLiveManager(text: string, conversationId?: string, answers?: Record<string, string>) {
    const projectId = activeProjectId;
    try {
      const response = await fetch("/api/chat/manager", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body: text, projectId, conversationId, answers }) });
      if (!response.ok) {
        const errorPayload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(errorPayload?.error || "Mira konnte nicht über den lokalen Provider antworten");
      }
      const payload = await response.json() as { message: ChatMessage; task?: Task; tasks?: Task[]; conversation?: ManagerConversation; plan?: ManagerPlan; analysisSnapshot?: AnalysisSnapshot; action?: ManagerAction };
      if (activeProjectIdRef.current !== projectId) return;
      setChat((current) => [...current, payload.message]);
      if (payload.tasks) setTasks(payload.tasks);
      if (payload.task) setSelectedId(payload.task.id);
      setManagerState((current) => ({ conversation: payload.conversation, plan: payload.plan, analysisSnapshot: payload.analysisSnapshot ?? current.analysisSnapshot, actions: payload.action ? [payload.action, ...(current.actions ?? []).filter((action) => action.id !== payload.action?.id)] : current.actions }));
    } catch (error) {
      setDbError(error instanceof Error ? error.message : "Mira konnte nicht antworten");
    }
  }

  function queueTaskRunAction(task: Task, action: "start" | "retry", role: "developer" | "tester", runId?: string) {
    const actor = role === "developer" ? "Entwickler" : "Tester";
    const message = action === "retry"
      ? `Neuen ${actor}-Versuch für ${task.id} starten? Der vorherige Run ${runId} bleibt unverändert in der Auditspur.`
      : `${actor} für ${task.id} starten? Der Start wird serverseitig erneut gegen Ticket, Abhängigkeiten und aktive Prozesse geprüft.`;
    setPendingRunAction({ target: "task", taskId: task.id, action, role, runId, message });
  }

  function queueStopRunAction(run: AgentRun) {
    setPendingRunAction({ target: "run", taskId: run.taskId, action: "stop", role: run.role === "tester" ? "tester" : "developer", runId: run.runId, message: `Run ${run.runId} wirklich stoppen? Er bleibt zunächst in „cancelling“ gesperrt, bis der Prozess sicher beendet ist.` });
  }

  function readableRunActionError(reason?: string) {
    return ({ task_not_found: "Das Ticket existiert nicht mehr.", task_not_startable: "Das Ticket ist nicht mehr startbar oder ein Run ist noch aktiv.", retry_source_not_terminal: "Retry ist nur für einen beendeten, fehlgeschlagenen oder abgebrochenen Run möglich.", developer_capacity: "Der Entwickler ist aktuell ausgelastet.", tester_capacity: "Der Tester ist aktuell ausgelastet.", runtime_unavailable: "Die erforderliche Provider- oder Laufzeitumgebung ist nicht verfügbar.", run_not_found: "Der Run existiert nicht mehr.", run_not_active: "Der Run ist bereits beendet oder nicht mehr der kanonisch aktive Run." } as Record<string, string>)[reason ?? ""] ?? "Die Aktion wurde serverseitig abgelehnt. Die Anzeige wurde aktualisiert.";
  }

  async function resolvePendingRunAction(confirmation: "confirmed" | "declined") {
    const pending = pendingRunAction;
    if (!pending || runActionSubmitting) return;
    setRunActionSubmitting(true);
    try {
      const endpoint = pending.target === "run"
        ? `/api/agent-runs/${encodeURIComponent(pending.runId!)}/action`
        : `/api/tasks/${encodeURIComponent(pending.taskId)}/run-action`;
      const body = pending.target === "run"
        ? { action: "stop", confirmation }
        : { action: pending.action, role: pending.role, confirmation, projectId: activeProjectId, sourceRunId: pending.runId };
      const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json() as { ok?: boolean; reason?: string };
      if (!response.ok || !payload.ok) throw new Error(readableRunActionError(payload.reason));
      setPendingRunAction(null);
      await refreshWorkspace();
    } catch (error) {
      setDbError(error instanceof Error ? error.message : "Run-Aktion konnte nicht ausgeführt werden");
      setPendingRunAction(null);
      await refreshWorkspace();
    } finally {
      setRunActionSubmitting(false);
    }
  }

  async function cancelManagerAction(action: ManagerAction) {
    try {
      const response = await fetch(`/api/manager/actions/${encodeURIComponent(action.id)}/cancel`, { method: "POST" });
      const payload = await response.json() as { action?: ManagerAction; error?: string };
      if (!response.ok || !payload.action) throw new Error(payload.error || "Manager-Aktion konnte nicht abgebrochen werden");
      setManagerState((current) => ({ ...current, actions: [payload.action!, ...(current.actions ?? []).filter((item) => item.id !== payload.action?.id)] }));
      await refreshWorkspace();
    } catch (error) {
      setDbError(error instanceof Error ? error.message : "Manager-Aktion konnte nicht abgebrochen werden");
    }
  }

  async function retryManagerAction(action: ManagerAction) {
    try {
      const response = await fetch(`/api/manager/actions/${encodeURIComponent(action.id)}/retry`, { method: "POST" });
      const payload = await response.json() as { action?: ManagerAction; analysisSnapshot?: AnalysisSnapshot; plan?: ManagerPlan; error?: string };
      if (!response.ok || !payload.action) throw new Error(payload.error || "Manager-Aktion konnte nicht wiederholt werden");
      setManagerState((current) => ({ ...current, analysisSnapshot: payload.analysisSnapshot ?? current.analysisSnapshot, plan: payload.plan ?? current.plan, actions: [payload.action!, ...(current.actions ?? []).filter((item) => item.id !== payload.action?.id)] }));
      await refreshWorkspace();
    } catch (error) {
      setDbError(error instanceof Error ? error.message : "Manager-Aktion konnte nicht wiederholt werden");
    }
  }

  async function analyzeActiveProject() {
    try {
      const response = await fetch("/api/manager/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: activeProjectId }) });
      const payload = await response.json() as { analysisSnapshot?: AnalysisSnapshot; message?: ChatMessage; action?: ManagerAction; error?: string };
      if (!response.ok || !payload.analysisSnapshot) throw new Error(payload.error || "Projektanalyse konnte nicht gestartet werden");
      setManagerState((current) => ({ ...current, analysisSnapshot: payload.analysisSnapshot, actions: payload.action ? [payload.action, ...(current.actions ?? []).filter((action) => action.id !== payload.action?.id)] : current.actions }));
      if (payload.message) setChat((current) => [...current, payload.message!]);
      setRightPane("chat");
    } catch (error) {
      setDbError(error instanceof Error ? error.message : "Projektanalyse konnte nicht gestartet werden");
    }
  }

  async function confirmManagerPlan() {
    const plan = managerState.plan;
    if (!plan) return;
    try {
      const response = await fetch(`/api/manager/plans/${plan.id}/confirm`, { method: "POST" });
      const payload = await response.json() as { plan?: ManagerPlan; tasks?: Task[]; message?: ChatMessage; action?: ManagerAction; error?: string };
      if (!response.ok || !payload.plan) throw new Error(payload.error || "Plan konnte nicht bestätigt werden");
      setManagerState((current) => ({ ...current, plan: payload.plan, conversation: current.conversation ? { ...current.conversation, plan: payload.plan, status: "completed" } : current.conversation, actions: payload.action ? [payload.action, ...(current.actions ?? []).filter((action) => action.id !== payload.action?.id)] : current.actions }));
      if (payload.tasks) setTasks(payload.tasks);
      if (payload.message) setChat((current) => [...current, payload.message!]);
    } catch (error) {
      setDbError(error instanceof Error ? error.message : "Plan konnte nicht bestätigt werden");
    }
  }

  async function discardManagerPlan() {
    const plan = managerState.plan;
    if (!plan) return;
    try {
      const response = await fetch(`/api/manager/plans/${plan.id}/discard`, { method: "POST" });
      const payload = await response.json() as { plan?: ManagerPlan; error?: string };
      if (!response.ok || !payload.plan) throw new Error(payload.error || "Plan konnte nicht verworfen werden");
      setManagerState((current) => ({ ...current, plan: payload.plan, conversation: current.conversation ? { ...current.conversation, plan: payload.plan, status: "completed" } : current.conversation }));
    } catch (error) {
      setDbError(error instanceof Error ? error.message : "Plan konnte nicht verworfen werden");
    }
  }

  async function removePlanTask(taskId: string) {
    const plan = managerState.plan;
    if (!plan) return;
    try {
      const response = await fetch(`/api/manager/plans/${plan.id}/tasks/${taskId}`, { method: "DELETE" });
      const payload = await response.json() as { plan?: ManagerPlan; error?: string };
      if (!response.ok || !payload.plan) throw new Error(payload.error || "Ticketentwurf konnte nicht entfernt werden");
      setManagerState((current) => ({ ...current, plan: payload.plan, conversation: current.conversation ? { ...current.conversation, plan: payload.plan } : current.conversation }));
    } catch (error) {
      setDbError(error instanceof Error ? error.message : "Ticketentwurf konnte nicht entfernt werden");
    }
  }

  async function editPlanTask(task: ManagerPlanTask) {
    const plan = managerState.plan;
    if (!plan) return;
    const sequenceText = window.prompt("Reihenfolge (z. B. 10, 20, 30)", String(task.sequence));
    if (sequenceText === null) return;
    const sequence = Number(sequenceText);
    if (!Number.isInteger(sequence) || sequence < 1) {
      setDbError("Die Reihenfolge muss eine positive ganze Zahl sein.");
      return;
    }
    const title = window.prompt("Titel des Ticketentwurfs", task.title);
    if (title === null || !title.trim()) return;
    const description = window.prompt("Beschreibung", task.description);
    if (description === null) return;
    const acceptance = window.prompt("Akzeptanzkriterien (eine Zeile pro Kriterium)", task.acceptance.join("\n"));
    if (acceptance === null) return;
    const criteria = acceptance.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    if (!criteria.length) {
      setDbError("Ein Ticketentwurf benötigt mindestens ein Akzeptanzkriterium.");
      return;
    }
    try {
      const response = await fetch(`/api/manager/plans/${plan.id}/tasks/${task.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ sequence, title: title.trim(), description, acceptance: criteria }) });
      const payload = await response.json() as { plan?: ManagerPlan; error?: string };
      if (!response.ok || !payload.plan) throw new Error(payload.error || "Ticketentwurf konnte nicht geändert werden");
      setManagerState((current) => ({ ...current, plan: payload.plan, conversation: current.conversation ? { ...current.conversation, plan: payload.plan } : current.conversation }));
    } catch (error) {
      setDbError(error instanceof Error ? error.message : "Ticketentwurf konnte nicht geändert werden");
    }
  }

  function continuePlanning(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const conversation = managerState.conversation;
    if (!conversation) return;
    const unanswered = conversation.questions.filter((question) => !question.answer && question.required);
    const answers = Object.fromEntries(unanswered.map((question) => [question.id, questionAnswers[question.id]?.trim() ?? ""]));
    if (Object.values(answers).some((answer) => !answer)) {
      setDbError("Bitte beantworte alle Pflichtfragen.");
      return;
    }
    const responseText = unanswered.map((question) => `${question.question}: ${answers[question.id]}`).join("\n");
    void (async () => {
      const saved = await appendChat("user", responseText);
      if (saved) await askLiveManager("Bitte setze die Planung mit meinen Antworten fort.", conversation.id, answers);
      setQuestionAnswers({});
    })();
  }

  async function processChatText(rawText: string) {
    const text = rawText.trim();
    if (!text) return;
    setChatInput("");
    setRightPane("chat");
    const saved = await appendChat("user", text);
    if (saved) {
      if (managerState.conversation?.status === "needs_input") await askLiveManager(text, managerState.conversation.id);
      else await askLiveManager(text);
    }
  }

  function handleChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void processChatText(chatInput);
  }

  function openRunDrawer(runId: string) {
    setSelectedRunId(runId);
    setDrawerOpen(true);
  }

  function closeRunDrawer() {
    setDrawerOpen(false);
    setSelectedRunId(null);
  }

  function openAgent(agentId: string) {
    setSelectedAgentId(agentId);
    setAgentTab("output");
    setWorkspaceView("agents");
  }

  function selectCard(id: string) {
    setSelectedId(id);
    setRightPane("detail");
  }

  function statusLabel(status: Status) {
    if (status === "Ready") return "Bereit";
    if (status === "In Progress") return "In Arbeit";
    if (status === "Review") return "Review";
    if (status === "Testing") return "Testing";
    if (status === "Changes Requested") return "Änderungen nötig";
    if (status === "Blocked") return "Blockiert";
    if (status === "Done") return "Erledigt";
    return status;
  }

  function formatTimestamp(value?: string | null) {
    if (!value) return "nicht vorhanden";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "historisch unvollständig" : date.toLocaleString("de-DE", { dateStyle: "short", timeStyle: "medium" });
  }

  function formatClock(value?: string | null) {
    if (!value) return "–";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "–" : date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function relativeAge(value?: string | null) {
    if (!value) return "nicht gemeldet";
    const ms = Date.parse(new Date().toISOString()) - Date.parse(value);
    if (!Number.isFinite(ms)) return "unbekannt";
    if (ms < 60_000) return `vor ${Math.max(0, Math.round(ms / 1000))} s`;
    if (ms < 3_600_000) return `vor ${Math.round(ms / 60_000)} Min.`;
    return `vor ${Math.round(ms / 3_600_000)} h`;
  }

  function formatRunDuration(run: AgentRun) {
    const started = run.startedAt ?? run.createdAt;
    const end = run.finishedAt ?? new Date().toISOString();
    const milliseconds = Date.parse(end) - Date.parse(started);
    if (!Number.isFinite(milliseconds) || milliseconds < 0) return "nicht verfügbar";
    const seconds = Math.floor(milliseconds / 1000);
    return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  }

  function readableRunStatus(status: string) {
    return ({ queued: "wartet", starting: "startet", running: "arbeitet", cancelling: "beendet kooperativ", succeeded: "erfolgreich", failed: "fehlgeschlagen", timed_out: "Zeitüberschreitung", cancelled: "abgebrochen", lost: "verloren" } as Record<string, string>)[status] ?? status;
  }

  function runResultClass(status: string) {
    if (status === "succeeded") return "txt-ok";
    if (["failed", "timed_out", "lost"].includes(status)) return "txt-accent";
    return "";
  }

  function prioClass(priority: string) {
    return `prio prio--${priority.toLowerCase()}`;
  }

  const layout: "detail" | "chat" | "single" = workspaceView !== "board" ? "single" : rightPane === "chat" ? "chat" : "detail";

  const confirmBlock = pendingRunAction ? (
    <section className="confirm" role="alertdialog" aria-live="assertive" aria-label="Run-Aktion bestätigen">
      <strong>{pendingRunAction.action === "stop" ? "Abbruch bestätigen" : pendingRunAction.action === "retry" ? "Wiederholung bestätigen" : "Start bestätigen"}</strong>
      <p>{pendingRunAction.message}</p>
      <div className="row">
        <button className="btn btn--outline btn--sm" disabled={runActionSubmitting} onClick={() => void resolvePendingRunAction("declined")}>Abbrechen</button>
        <button className="btn btn--primary btn--sm" disabled={runActionSubmitting} onClick={() => void resolvePendingRunAction("confirmed")}>{runActionSubmitting ? "Wird geprüft …" : "Bestätigen"}</button>
      </div>
    </section>
  ) : null;

  // -- Board ------------------------------------------------------------------
  const boardView = (
    <section className="main" aria-label="Board">
      <header className="page-head">
        <div className="grow">
          <h1 className="serif page-title">{attention.heading}</h1>
          <p className="page-sub">{attention.sub}</p>
        </div>
        <div className="page-actions">
          <button className="btn btn--outline" onClick={() => void analyzeActiveProject()}>Projekt analysieren</button>
          <button className="btn btn--outline" onClick={() => openProjectForm(activeProject)}>Projekt bearbeiten</button>
          <button className="btn btn--primary" onClick={() => setShowCreate(true)}>Neues Ticket</button>
        </div>
      </header>
      {dbError && <div className="banner banner--error" role="status">{dbError}</div>}
      {runtimeCheck && !runtimeCheck.ok && <div className="banner" role="alert"><strong>Agent-Laufzeitcheck fehlgeschlagen.</strong> {runtimeCheck.messages.join(" ")} <small>Benutzer: {runtimeCheck.user.username} · CODEX_HOME: {runtimeCheck.codexHome.path} · Schreibrecht: {runtimeCheck.codexHome.directory.writable ? "ja" : "nein"}</small></div>}
      <div className="stat-line">
        <span><b>{activeProject?.progress ?? 0} %</b> erledigt</span>
        <span className="bar"><i style={{ width: `${activeProject?.progress ?? 0}%` }} /></span>
        <span>{activeProject?.runCount ?? 0} Läufe</span>
        <span>{requestSummary.tokens.toLocaleString("de-DE")} Tokens</span>
        <span className="stat-sync">{lastSyncedAt ? `Live-Sync ${lastSyncedAt}` : "Live-Sync aktiv"}</span>
      </div>
      <div className="board-scroll" role="region" aria-label="Ticketspalten">
        <div className="board">
          {statuses.map((status) => {
            const columnTasks = tasks.filter((task) => task.status === status);
            return (
              <section className="col" key={status}>
                <div className="col-head"><span className="col-title">{statusLabel(status)}</span><span className="n">{columnTasks.length}</span></div>
                {columnTasks.map((task) => {
                  const run = task.activeRunId ? agentRuns.find((entry) => entry.runId === task.activeRunId) : undefined;
                  const isActive = task.status === "In Progress";
                  const isDone = task.status === "Done";
                  return (
                    <button
                      type="button"
                      key={task.id}
                      className={`card${isActive ? " card--active" : ""}${isDone ? " card--done" : ""}${selectedId === task.id ? " is-selected" : ""}`}
                      onClick={() => selectCard(task.id)}
                    >
                      <div className="card-top"><span className="card-id">{task.id}</span><span className={prioClass(task.priority)}>{task.priority}</span></div>
                      <h4 className="card-title">{task.title}</h4>
                      {task.description && !isActive && <p className="card-desc">{task.description}</p>}
                      {isActive && <div className="card-run"><span className="dot" /> {task.assignee}{run ? ` · ${formatRunDuration(run)}` : ""}</div>}
                      {isActive && <div className="bar"><i style={{ width: `${run?.progress ?? 40}%` }} /></div>}
                      <div className="card-foot"><span>{isActive ? `${run?.progress ?? 40} % · ${run?.currentPhase ?? "in Arbeit"}` : task.assignee}</span><span className="date">{task.updatedAt}</span></div>
                    </button>
                  );
                })}
                {columnTasks.length === 0 && <div className="col-empty">Keine Tickets</div>}
                <button className="add-card" onClick={() => setShowCreate(true)}>＋ Ticket</button>
              </section>
            );
          })}
        </div>
      </div>
      <button className="mira-bar" onClick={() => setRightPane("chat")} aria-label="Mit Mira chatten">
        <span className="nm">Mira</span>
        <span className="ph">Aufgabe beschreiben — daraus werden Tickets …</span>
        <span className="kbd">⏎</span>
      </button>
    </section>
  );

  // -- Ticketdetail -----------------------------------------------------------
  const detailRail = (
    <aside className="rail rail--detail" aria-label="Ticketdetail">
      {selectedTask ? (
        <>
          <div className="detail-top">
            <span className="card-id mono">{selectedTask.id}</span>
            <span className={prioClass(selectedTask.priority)}>{selectedTask.priority}</span>
            <button className="x" aria-label="Details schließen" onClick={() => setSelectedId("")}>×</button>
          </div>
          <h2 className="detail-title">{selectedTask.title}</h2>
          <p className="detail-desc">{selectedTask.description}</p>
          {selectedTask.obsoleteAt && <div className="banner" role="status"><strong>Obsolet archiviert.</strong> {selectedTask.obsoleteReason ?? "Dieses Ticket ist revisionssicher aus dem aktiven Workflow entfernt."}</div>}
          <div className="detail-actions">
            {selectedTask.activeRunId && <button className="btn btn--primary" disabled={Boolean(pendingRunAction)} onClick={() => { const run = agentRuns.find((entry) => entry.runId === selectedTask.activeRunId); if (run) queueStopRunAction(run); }}>Lauf abbrechen</button>}
            {!selectedTask.activeRunId && selectedTask.status === "Ready" && <button className="btn btn--dark" disabled={Boolean(pendingRunAction)} onClick={() => queueTaskRunAction(selectedTask, "start", "developer")}>Entwickler starten</button>}
            {!selectedTask.activeRunId && selectedTask.status === "Review" && <button className="btn btn--dark" disabled={Boolean(pendingRunAction)} onClick={() => queueTaskRunAction(selectedTask, "start", "tester")}>Tester starten</button>}
            {!selectedTask.activeRunId && retryableRun && <button className="btn btn--outline" disabled={Boolean(pendingRunAction)} onClick={() => queueTaskRunAction(selectedTask, "retry", retryableRun.role === "tester" ? "tester" : "developer", retryableRun.runId)}>{retryableRun.role === "tester" ? "Tester" : "Entwickler"} wiederholen</button>}
            <button className="btn btn--outline" onClick={() => openTaskEditor(selectedTask)}>Bearbeiten</button>
          </div>
          {confirmBlock}
          <div className="section">
            <div className="meta-list">
              <div className="meta-row"><span>Status</span><select value={selectedTask.status} disabled={Boolean(selectedTask.obsoleteAt)} onChange={(event) => moveTask(selectedTask.id, event.target.value as Status)}>{statuses.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select></div>
              <div className="meta-row"><span>Zuständig</span><span>{selectedTask.assignee}</span></div>
              {selectedTask.activeRunId && <div className="meta-row"><span>Lauf</span><span>{selectedTask.activeRunRole === "tester" ? "Tester" : "Entwickler"} · {readableRunStatus(selectedTask.activeRunStatus ?? "running")}</span></div>}
              {selectedTask.planSequence != null && <div className="meta-row"><span>Reihenfolge</span><span className="mono">#{selectedTask.planSequence}</span></div>}
            </div>
          </div>
          <div className="section">
            <h3 className="section-title">Akzeptanzkriterien <span className="n">{selectedTask.acceptance.length}</span></h3>
            <div className="check-list">
              {selectedTask.acceptance.map((criteria, index) => {
                const done = selectedTask.status === "Done";
                return <div className={`check-item${done ? "" : " is-open"}`} key={`${criteria}-${index}`}><span className="mk">{done ? "✓" : "○"}</span><span>{criteria}</span></div>;
              })}
              {selectedTask.acceptance.length === 0 && <p className="empty">Noch keine Kriterien hinterlegt.</p>}
            </div>
          </div>
          <div className="section">
            <h3 className="section-title">Läufe <span className="n">{selectedTaskRuns.length}</span></h3>
            {selectedTaskRuns.map((run) => (
              <button type="button" className={`run-line${["failed", "timed_out", "cancelled", "lost"].includes(run.status) ? " is-muted" : ""}`} key={run.runId} onClick={() => openRunDrawer(run.runId)}>
                <div className="top"><span>{run.agentName} · Versuch {run.attemptNo}</span><span className={`res ${runResultClass(run.status)}`}>{readableRunStatus(run.status)} · {formatRunDuration(run)}</span></div>
                <small>Phase {run.currentPhase ?? "nicht gemeldet"} · Aktivität {relativeAge(run.lastActivityAt)}</small>
              </button>
            ))}
            {selectedTaskRuns.length === 0 && <p className="empty">Für dieses Ticket existiert noch kein Run. Das bedeutet nicht, dass ein Lauf aktiv ist.</p>}
          </div>
          <div className="section">
            <h3 className="section-title">Aktivität <span className="n">{selectedTask.comments.length}</span></h3>
            <div className="comments">
              {selectedTask.comments.map((comment) => (
                <div className="comment" key={comment.id}>
                  <div className="comment-head"><strong className={comment.role === "Manager" ? "txt-accent" : undefined}>{comment.author}</strong><span>{comment.createdAt}</span></div>
                  <p>{comment.text}</p>
                </div>
              ))}
              {selectedTask.comments.length === 0 && <p className="empty">Noch keine Aktivität an diesem Ticket.</p>}
            </div>
            <form className="comment-bar" onSubmit={addComment}>
              <span className="side-avatar">F</span>
              <input name="comment" placeholder="Kommentar …" aria-label="Kommentar hinzufügen" />
              <button className="send" aria-label="Kommentar senden">↑</button>
            </form>
          </div>
        </>
      ) : <p className="empty" style={{ padding: "8px 0" }}>Kein Ticket ausgewählt. Wähle links eine Karte.</p>}
    </aside>
  );

  // -- Mira-Chat --------------------------------------------------------------
  const chatManagerAgent = displayedAgents.find((agent) => agent.role === "manager");
  const chatRail = (
    <aside className="rail rail--chat" aria-label="Chat mit Mira">
      <div className="chat-head">
        <span className="chat-title serif">Mira</span>
        <span className="chat-sub">Hauptmanager · {chatManagerAgent ? providerLabel(chatManagerAgent.provider).replace("-Abo", "") : "Codex"}</span>
        <span className="chat-status">online</span>
        <button className="x" onClick={() => setRightPane("detail")} aria-label="Chat schließen">×</button>
      </div>
      <div className="chat-scroll" ref={chatMessagesRef}>
        {chat.map((message) => (
          <div className={`msg${message.sender === "Du" ? " msg--user" : ""}`} key={message.id}>
            <div className="msg-head"><strong>{message.sender === "Du" ? "Du" : "Mira"}</strong><span>{message.sender === "Du" ? "gerade eben" : "Mira"}</span></div>
            <p>{message.text}</p>
          </div>
        ))}
        {hasManagerWorkbench && (
          <>
            {managerState.analysisSnapshot && (
              <div className="mira-note">
                <span className="label">Projektanalyse</span>
                <p>{managerState.analysisSnapshot.summary}</p>
                {managerState.analysisSnapshot.snapshot?.git?.branch && <small>Git: {managerState.analysisSnapshot.snapshot.git.branch} · {managerState.analysisSnapshot.snapshot.git.changedFiles ?? 0} Änderungen</small>}
              </div>
            )}
            {managerState.conversation?.status === "needs_input" && (
              <form className="mira-note" onSubmit={continuePlanning}>
                <span className="label">Rückfragen</span>
                {managerState.conversation.questions.filter((question) => !question.answer).map((question) => (
                  <label className="field" key={question.id}>{question.question}
                    {question.options.length > 0
                      ? <select value={questionAnswers[question.id] ?? ""} onChange={(event) => setQuestionAnswers((current) => ({ ...current, [question.id]: event.target.value }))}><option value="">Bitte auswählen</option>{question.options.map((option) => <option value={option} key={option}>{option}</option>)}</select>
                      : <input value={questionAnswers[question.id] ?? ""} onChange={(event) => setQuestionAnswers((current) => ({ ...current, [question.id]: event.target.value }))} placeholder="Deine Antwort" />}
                  </label>
                ))}
                <button className="btn btn--primary btn--sm" style={{ justifySelf: "start" }}>Planung fortsetzen</button>
              </form>
            )}
            {activeManagerPlan && (
              <div className="mira-note plan-block">
                <div className="plan-head"><span className="label">{activeManagerPlan.status === "awaiting_confirmation" ? "Planvorschlag" : "Planfortschritt"}</span><strong>{activeManagerPlan.title}</strong><span className="pct">{activeManagerPlan.progress.percent} %</span></div>
                <p>{activeManagerPlan.summary}</p>
                {activeManagerPlan.assumptions.length > 0 && <small>Annahmen: {activeManagerPlan.assumptions.join(" · ")}</small>}
                {activeManagerPlan.risks.length > 0 && <small className="risk">Risiken: {activeManagerPlan.risks.join(" · ")}</small>}
                <div className="plan-rows">
                  {activeManagerPlan.tasks.map((task) => (
                    <div className="plan-row" key={task.id}>
                      <span className="seq">#{task.sequence}</span>
                      <div className="body">
                        <div className="ti">{task.title}</div>
                        <div className="mt">{roleDe(task.kind)} · {task.priority}{task.taskId ? ` · ${task.taskId}` : ""}</div>
                        {activeManagerPlan.status === "awaiting_confirmation" && <div className="edit"><button type="button" onClick={() => void editPlanTask(task)}>Bearbeiten</button><button type="button" onClick={() => void removePlanTask(task.id)}>Entfernen</button></div>}
                      </div>
                    </div>
                  ))}
                </div>
                {activeManagerPlan.status === "awaiting_confirmation" && (
                  <div className="plan-actions">
                    <button className="btn btn--primary btn--sm" onClick={() => void confirmManagerPlan()}>{activeManagerPlan.tasks.length} {activeManagerPlan.tasks.length === 1 ? "Ticket" : "Tickets"} anlegen</button>
                    <button className="btn btn--ghost btn--sm" onClick={() => void discardManagerPlan()}>Verwerfen</button>
                  </div>
                )}
              </div>
            )}
            {(managerState.actions?.length ?? 0) > 0 && (
              <div className="mira-note">
                <span className="label">Manager-Aktionen</span>
                {managerState.actions!.slice(0, 4).map((action) => (
                  <div key={action.id} style={{ display: "grid", gap: "4px" }}>
                    <small><b>{(action.type ?? "Aktion").replaceAll("_", " ")}</b> · Versuch {action.attemptNo ?? 1} · {action.status ?? "unbekannt"} · Phase {action.phase ?? "—"}</small>
                    {action.error && <small className="risk">{action.error}</small>}
                    <div className="plan-actions">
                      {["queued", "running"].includes(action.status) && <button className="btn btn--ghost btn--sm" onClick={() => void cancelManagerAction(action)}>Abbrechen</button>}
                      {["failed", "cancelled"].includes(action.status) && <button className="btn btn--outline btn--sm" onClick={() => void retryManagerAction(action)}>Wiederholen</button>}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="mira-note">
              <span className="label">Autoprozess</span>
              <p>{activeProject?.autoProcessEnabled ? "Wartende Review- oder Ready-Tickets werden nacheinander übernommen." : "Entwickler- und Testerläufe werden nur manuell gestartet."}</p>
              <button className="btn btn--outline btn--sm" style={{ justifySelf: "start" }} onClick={() => void toggleAutoProcess()}>{activeProject?.autoProcessEnabled ? "Autoprozess deaktivieren" : "Autoprozess aktivieren"}</button>
            </div>
          </>
        )}
      </div>
      <div className="chat-chips">
        <button className="chip" onClick={() => void processChatText("Starte die nächste Aufgabe")}>Nächstes Ticket starten</button>
        <button className="chip" onClick={() => void processChatText("Analysiere dieses Projekt und erstelle anschließend einen umsetzbaren Plan.")}>Projekt planen</button>
        <button className="chip" onClick={() => void processChatText("Wie ist der Status?")}>Status</button>
      </div>
      <form className="chat-input" onSubmit={handleChat}>
        <textarea value={chatInput} onChange={(event) => setChatInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder={`Aufgabe an Mira über ${activeProject?.name ?? "dieses Projekt"} …`} aria-label="Nachricht an Mira" rows={2} />
        <button className="send" aria-label="Nachricht senden">↑</button>
      </form>
    </aside>
  );

  // -- Agentenseite -----------------------------------------------------------
  const agentPage = (() => {
    if (!agentForPage) return <section className="agent"><p className="empty" style={{ padding: "40px" }}>Kein Agent verfügbar.</p></section>;
    const agent = agentForPage;
    const agentRunsForAgent = agentRuns.filter((run) => run.agentId === agent.id).sort((a, b) => Date.parse(b.startedAt ?? b.createdAt) - Date.parse(a.startedAt ?? a.createdAt));
    const currentRun = agentRunsForAgent.find((run) => activeStatuses.includes(run.status));
    const pastRuns = agentRunsForAgent.filter((run) => !activeStatuses.includes(run.status));
    const terminal = agentRunsForAgent.filter((run) => ["succeeded", "failed", "timed_out", "cancelled", "lost"].includes(run.status));
    const succeeded = terminal.filter((run) => run.status === "succeeded").length;
    const successRate = terminal.length ? Math.round((succeeded / terminal.length) * 100) : null;
    const currentTask = currentRun ? tasks.find((task) => task.id === currentRun.taskId) : undefined;
    const logEvents = currentRun ? taskEvents.filter((event) => event.taskId === currentRun.taskId).slice(-14) : taskEvents.slice(-14);
    const changedFiles = currentRun ? taskEvents.filter((event) => event.taskId === currentRun.taskId && event.eventType.includes("file")).length : 0;
    const duty = agentDuty(agent.role);
    const rights = agentRights(agent.role);
    const model = selectedRun && selectedRun.agentId === agent.id ? selectedRun.requests[0]?.model : undefined;
    const queue = (agent.role === "tester" ? tasks.filter((task) => task.status === "Review") : tasks.filter((task) => task.status === "Ready")).slice(0, 3);
    const description = `${roleLabel(agent.role)} im Projekt ${activeProject?.name ?? "Agent Harness"}. Arbeitet über das ${agent.provider === "claude" ? "Claude-Code" : "OpenAI-Codex"}-Abo${model ? ` mit dem Modell ${model}` : ""}, führt Läufe im Arbeitsverzeichnis aus und ${agent.role === "manager" ? "schlägt bestätigungspflichtige Pläne vor" : "darf Dateien ändern sowie das Testgate starten"}.`;

    const tabItems: Array<{ id: AgentTab; label: string; count?: number }> = [
      { id: "output", label: "Ausgabe" },
      { id: "requests", label: "Anfragen", count: agentRequests.length },
      { id: "events", label: "Ereignisse", count: logEvents.length },
      { id: "tests", label: "Testchecks", count: currentTask?.testReport?.checks.length ?? 0 },
    ];

    return (
      <section className="agent" aria-label={`Agent ${agent.name}`}>
        <div className="crumbs"><button onClick={() => setWorkspaceView("board")}>Agenten</button><span>/</span><span className="cur">{agent.name}</span></div>
        <div className="agent-head">
          <div className="grow">
            <h1 className="agent-title">{agent.name}</h1>
            <p className="agent-desc">{description}</p>
          </div>
          <div className="agent-actions">
            {currentRun && <button className="btn btn--primary" disabled={Boolean(pendingRunAction)} onClick={() => queueStopRunAction(currentRun)}>Lauf abbrechen</button>}
            <button className="btn btn--outline" onClick={() => setWorkspaceView("board")}>Zum Board</button>
          </div>
        </div>
        <div className="agent-status">
          {currentRun ? <span><span className="live">●</span> arbeitet seit <b>{formatRunDuration(currentRun)}</b></span> : <span>bereit — kein aktiver Lauf</span>}
          <span>Lease bis <b className="mono">{formatClock(currentRun?.leaseExpiresAt)}</b></span>
          <span>Heartbeat <b>{currentRun ? relativeAge(currentRun.lastHeartbeatAt) : "—"}</b></span>
          <span>heute <b>{agentRunsForAgent.length} Läufe</b></span>
          <span>Erfolgsquote <b>{successRate === null ? "—" : `${successRate} %`}</b></span>
        </div>
        {(dbError || (runtimeCheck && !runtimeCheck.ok)) && <div style={{ paddingTop: "12px" }}>{dbError && <div className="banner banner--error">{dbError}</div>}</div>}
        <div className="agent-body">
          <div className="agent-main">
            {confirmBlock}
            <div className="run-head"><span className="t serif">Aktueller Lauf</span>{currentRun ? <><span className="id">{currentRun.runId} · Versuch {currentRun.attemptNo}</span><span className="pct">{currentRun.progress ?? 0} %</span></> : <span className="pct">kein Lauf aktiv</span>}</div>
            {currentRun ? (
              <>
                <div className="run-ticket"><span className="id">{currentRun.taskId}</span><span className="ti">{currentTask?.title ?? "Ticket"}</span>{currentTask && <span className={prioClass(currentTask.priority)}>{currentTask.priority}</span>}</div>
                <div className="bar run-bar"><i style={{ width: `${currentRun.progress ?? 0}%` }} /></div>
                <div className="tabs">
                  {tabItems.map((tab) => <button key={tab.id} className={`tab${agentTab === tab.id ? " is-active" : ""}`} onClick={() => setAgentTab(tab.id)}>{tab.label}{tab.count != null ? ` · ${tab.count}` : ""}</button>)}
                  <span className="spacer">Geänderte Dateien · {changedFiles}</span>
                </div>
                {agentTab === "output" && (
                  <div className="log" ref={logRef}>
                    {logEvents.length === 0 && <div className="log-row empty">Noch keine Ausgabe für diesen Lauf.</div>}
                    {logEvents.map((event) => <div className="log-row" key={event.id}><span className="ts">{formatClock(event.createdAt)}</span>  {event.eventType}  <span className="hi">{event.taskTitle ?? event.actorType}</span></div>)}
                    {logEvents.length > 0 && <div className="log-row"><span className="ts">{formatClock(currentRun.lastActivityAt)}</span>  phase  <span className="hi">{currentRun.currentPhase ?? "arbeitet"}</span><span className="cur" /></div>}
                  </div>
                )}
                {agentTab === "requests" && (
                  <div className="log" style={{ fontFamily: "var(--font-sans)", lineHeight: 1.6 }}>
                    {agentRequests.length === 0 && <p className="empty">Keine Anfragen im aktuellen Projekt gespeichert.</p>}
                    {agentRequests.map((request) => <div className="log-row" key={request.id} style={{ paddingBottom: "6px" }}><b>{request.role} · {request.provider} · {request.status}</b> — {request.durationMs ? `${Math.round(request.durationMs / 1000)}s` : "läuft"} · ≈{request.estimatedInputTokens + request.estimatedOutputTokens} Tokens</div>)}
                  </div>
                )}
                {agentTab === "events" && (
                  <div className="log" style={{ fontFamily: "var(--font-sans)", lineHeight: 1.6 }}>
                    {logEvents.length === 0 && <p className="empty">Keine Ereignisse gespeichert.</p>}
                    {logEvents.map((event) => <div className="log-row" key={event.id}>{formatClock(event.createdAt)} · {(event.eventType ?? "").replaceAll(".", " ")}</div>)}
                  </div>
                )}
                {agentTab === "tests" && (
                  <div className="log" style={{ fontFamily: "var(--font-sans)", lineHeight: 1.6 }}>
                    {!currentTask?.testReport && <p className="empty">Für dieses Ticket liegt noch kein Testergebnis vor.</p>}
                    {currentTask?.testReport?.checks.map((check, index) => <div className="log-row" key={`${check.name}-${index}`}>{check.name ?? "Check"}: <span className={check.status === "passed" ? "ok" : ""}>{check.status ?? "unbekannt"}</span>{check.details ? ` · ${check.details}` : ""}</div>)}
                  </div>
                )}
              </>
            ) : <p className="empty">Dieser Agent führt gerade keinen Lauf aus. Sein Live-Log erscheint hier, sobald ein Ticket übernommen wird.</p>}

            <div className="past">
              <h3 className="past-title">Frühere Läufe</h3>
              <div className="past-grid past-head"><span>ZEIT</span><span>TICKET</span><span>ERGEBNIS</span><span>DAUER</span><span>TOKENS</span></div>
              {pastRuns.map((run) => (
                <button type="button" className="past-grid past-row" key={run.runId} onClick={() => openRunDrawer(run.runId)}>
                  <span className="time">{formatClock(run.finishedAt ?? run.startedAt ?? run.createdAt)}</span>
                  <span className="tk">{run.taskId}</span>
                  <span className={runResultClass(run.status)}>{readableRunStatus(run.status)}</span>
                  <span className="val">{formatRunDuration(run)}</span>
                  <span className="tk">—</span>
                </button>
              ))}
              {pastRuns.length === 0 && <p className="empty">Noch keine früheren Läufe für diesen Agenten.</p>}
            </div>
          </div>

          <aside className="agent-side">
            <div className="section section--first">
              <div className="meta-list">
                <div className="meta-row"><span>Rolle</span><span>{roleLabel(agent.role)}</span></div>
                <div className="meta-row"><span>Provider</span><select value={agent.provider} onChange={(event) => void updateAgentProvider(agent.id, event.target.value as HarnessAgent["provider"])}><option value="codex">Codex-Abo</option><option value="claude">Claude-Abo</option></select></div>
                <div className="meta-row"><span>Modell</span><span className="mono">{model ?? "laut Lauf"}</span></div>
                <div className="meta-row"><span>Max. Versuche</span><span>3</span></div>
                <div className="meta-row"><span>Kapazität</span><span>{agent.maxConcurrency}</span></div>
                <div className="meta-row"><span>Autoprozess</span><span className={activeProject?.autoProcessEnabled ? "txt-ok" : undefined}>{activeProject?.autoProcessEnabled ? "aktiv" : "pausiert"}</span></div>
              </div>
            </div>
            <div className="section">
              <h3 className="section-title">Auftrag <span className="file">{duty.file}</span></h3>
              <p className="agent-brief">{duty.text}</p>
            </div>
            <div className="section">
              <h3 className="section-title">Rechte</h3>
              <div className="check-list">
                {rights.map((right, index) => <div className={`check-item${right.granted ? "" : " is-open"}`} key={index}><span className="mk">{right.granted ? "✓" : "○"}</span><span>{right.text}</span></div>)}
              </div>
            </div>
            <div className="section">
              <h3 className="section-title">Arbeitsverzeichnis</h3>
              <div className="wd-path">{activeProject?.workspacePath || "Noch kein lokaler Ordner hinterlegt"}</div>
              <div className="wd-test">Testbefehl <span className="mono">{activeProject?.testCommand || "nicht gesetzt"}</span></div>
            </div>
            <div className="section">
              <h3 className="section-title">Warteschlange</h3>
              {queue.map((task, index) => <div className="queue-row" key={task.id}><span className="id">{task.id}</span><span className="ti">{task.title}</span><span className="tag">{index === 0 ? "als nächstes" : "danach"}</span></div>)}
              {queue.length === 0 && <p className="empty">Keine wartenden Tickets für diese Rolle.</p>}
            </div>
          </aside>
        </div>
      </section>
    );
  })();

  // -- Aktivität / Läufe ------------------------------------------------------
  const activityView = (
    <section className="main list-view" aria-label="Aktivität">
      <header className="page-head"><div className="grow"><h1 className="serif page-title">Aktivität</h1><p className="page-sub">Task-Events und Run-Übergänge · per Polling synchronisiert</p></div></header>
      {dbError && <div className="banner banner--error">{dbError}</div>}
      <div className="list-scroll">
        {taskEvents.map((event) => (
          <div className="feed-row" key={event.id}>
            <div><strong>{event.taskId} · {(event.eventType ?? "").replaceAll(".", " ")}</strong><div className="sub">{event.taskTitle ?? "Ticket"} · {event.actorType}</div></div>
            <span className="time">{formatTimestamp(event.createdAt)}</span>
          </div>
        ))}
        {taskEvents.length === 0 && <p className="empty">Noch keine Events im aktiven Projekt. Fehlende historische Daten werden nicht als laufend dargestellt.</p>}
      </div>
    </section>
  );

  const runsView = (
    <section className="main list-view" aria-label="Läufe">
      <header className="page-head"><div className="grow"><h1 className="serif page-title">Läufe</h1><p className="page-sub">{agentRuns.length} {agentRuns.length === 1 ? "Run" : "Runs"} im Projekt · klicke eine Zeile für das Detail</p></div></header>
      {dbError && <div className="banner banner--error">{dbError}</div>}
      <div className="list-scroll">
        <div className="past-grid past-head" style={{ gridTemplateColumns: "92px 120px minmax(0,1fr) 130px 92px" }}><span>TICKET</span><span>AGENT</span><span>ERGEBNIS</span><span>AKTIVITÄT</span><span>DAUER</span></div>
        {agentRuns.map((run) => (
          <button type="button" className="past-grid past-row" style={{ gridTemplateColumns: "92px 120px minmax(0,1fr) 130px 92px" }} key={run.runId} onClick={() => openRunDrawer(run.runId)}>
            <span className="tk">{run.taskId}</span>
            <span className="val">{run.agentName}</span>
            <span className={runResultClass(run.status)}>{readableRunStatus(run.status)} · Versuch {run.attemptNo}</span>
            <span className="val">{relativeAge(run.lastActivityAt ?? run.finishedAt ?? run.startedAt)}</span>
            <span className="val">{formatRunDuration(run)}</span>
          </button>
        ))}
        {agentRuns.length === 0 && <p className="empty">Noch keine Läufe im aktiven Projekt.</p>}
      </div>
    </section>
  );

  return (
    <main className="shell" data-layout={layout}>
      <aside className="sidebar">
        <div className="brand"><span className="name">Froschwerk</span><small>HARNESS</small></div>
        <nav className="nav" aria-label="Hauptnavigation">
          <button className={`nav-item${workspaceView === "board" ? " is-active" : ""}`} onClick={() => setWorkspaceView("board")}>Board <span className="n">{tasks.length}</span></button>
          <button className={`nav-item${workspaceView === "agents" ? " is-active" : ""}`} onClick={() => setWorkspaceView("agents")}>Agenten <span className="n">{displayedAgents.length}</span></button>
          <button className={`nav-item${workspaceView === "activity" ? " is-active" : ""}`} onClick={() => setWorkspaceView("activity")}>Aktivität</button>
          <button className={`nav-item${workspaceView === "runs" ? " is-active" : ""}`} onClick={() => setWorkspaceView("runs")}>Läufe <span className="n">{agentRuns.length}</span></button>
        </nav>

        <div className="side-label">PROJEKTE <button onClick={() => openProjectForm()} aria-label="Neues Projekt anlegen">＋</button></div>
        {projects.length === 0 && <div className="side-proj is-active">{activeProject?.name ?? "Agent Harness"}</div>}
        {projects.map((project) => (
          <button key={project.id} className={`side-proj${project.id === activeProjectId ? " is-active" : ""}`} onClick={() => { if (project.id !== activeProjectId) { setTasks([]); setChat([]); setRuntimeCheck(null); setSelectedId(""); setLastSyncedAt(""); setActiveProjectId(project.id); setWorkspaceView("board"); } }}>{project.name}</button>
        ))}

        <div className="side-label">AGENTEN</div>
        <div className="side-agents">
          {displayedAgents.map((agent) => {
            const activeRun = agentRuns.find((run) => run.agentId === agent.id && activeStatuses.includes(run.status));
            const off = agent.status === "offline";
            const st = activeRun ? { text: activeRun.status === "cancelling" ? "beendet" : activeRun.taskId, cls: "st--run" } : off ? { text: "offline", cls: "st--off" } : { text: "bereit", cls: "st--ok" };
            return (
              <button key={agent.id} className={`side-agent${off ? " is-off" : ""}${workspaceView === "agents" && agentForPage?.id === agent.id ? " is-active" : ""}`} onClick={() => openAgent(agent.id)}>
                <span className="nm">{agent.name}</span><span className={`st ${st.cls}`}>{st.text}</span>
              </button>
            );
          })}
        </div>

        <div className="side-label">VERBINDUNGEN <button onClick={() => void refreshProviders()} aria-label="Providerstatus aktualisieren">↻</button></div>
        <div className="side-conns">
          {(["codex", "claude"] as const).map((id) => {
            const provider = providers[id];
            const connected = Boolean(provider?.loggedIn && !provider.apiKeyDetected);
            const text = connected ? (provider?.subscriptionType || provider?.authMethod || "Verbunden") : provider?.installed ? "Login fehlt" : "prüft …";
            return <div className="side-conn" key={id}><span className="nm">{provider?.label ?? (id === "codex" ? "OpenAI Codex" : "Claude Code")}</span><span className={`st ${connected ? "st--ok" : provider?.installed ? "st--run" : "st--off"}`}>{text}</span></div>;
          })}
        </div>

        <div className="side-user"><span className="side-avatar">F</span><div className="u"><strong>FroschiO</strong><small>Workspace Owner</small></div></div>
      </aside>

      {workspaceView === "agents" ? agentPage : workspaceView === "activity" ? activityView : workspaceView === "runs" ? runsView : boardView}
      {workspaceView === "board" && (rightPane === "chat" ? chatRail : detailRail)}

      {drawerOpen && selectedRun && selectedRun.runId === selectedRunId && (
        <div className="drawer-back" role="presentation">
          <section className="drawer" role="dialog" aria-modal="true" aria-label={`Run-Detail ${selectedRun.runId}`}>
            <header className="drawer-head">
              <div><span className="label">Agent Run · {selectedRun.taskId}</span><h2>{selectedRun.agentName} · {roleDe(selectedRun.role)} · Versuch {selectedRun.attemptNo}</h2><p>{readableRunStatus(selectedRun.status)} · gestartet {formatTimestamp(selectedRun.startedAt ?? selectedRun.createdAt)}</p></div>
              <button className="x" onClick={closeRunDrawer} aria-label="Run-Detail schließen">×</button>
            </header>
            <div className="drawer-metrics">
              <div><span>Zustand</span><strong>{readableRunStatus(selectedRun.status)}</strong></div>
              <div><span>Phase / Fortschritt</span><strong>{selectedRun.currentPhase ?? "nicht gemeldet"}{selectedRun.progress == null ? "" : ` · ${selectedRun.progress} %`}</strong></div>
              <div><span>Letzte Aktivität</span><strong>{relativeAge(selectedRun.lastActivityAt)}</strong></div>
              <div><span>Dauer</span><strong>{formatRunDuration(selectedRun)}</strong></div>
            </div>
            <div className="drawer-body">
              <div className="drawer-main">
                <div>
                  <h3>Ergebnis</h3>
                  <p>{selectedRun.summary || "Für diesen Run wurde keine Zusammenfassung gespeichert."}</p>
                  {selectedRun.error && <p className="run-error">Fehler: {selectedRun.error}</p>}
                  <dl className="drawer-data">
                    <div><dt>Provider / Modell</dt><dd>{selectedRun.provider} / {selectedRun.requests[0]?.model || "nicht gespeichert"}</dd></div>
                    <div><dt>Beendigung</dt><dd>{selectedRun.terminationReason ?? "noch nicht beendet"}</dd></div>
                    <div><dt>Exit / Signal</dt><dd>{selectedRun.exitCode ?? "–"} / {selectedRun.signal ?? "–"}</dd></div>
                    <div><dt>Lease-Ablauf</dt><dd>{formatTimestamp(selectedRun.lease?.expiresAt)}</dd></div>
                    <div><dt>Heartbeat</dt><dd>{formatTimestamp(selectedRun.lastHeartbeatAt)}</dd></div>
                    <div><dt>PID / Prozessidentität</dt><dd>{selectedRun.processId ?? "nicht vorhanden"} / {selectedRun.processIdentity ?? "nicht vorhanden"}</dd></div>
                  </dl>
                </div>
                <div className="section">
                  <h3>Requests und Ausgaben <span className="n">{selectedRun.requests.length}</span></h3>
                  {selectedRun.requests.map((request) => (
                    <div className="drawer-req" key={request.id}>
                      <div className="top"><strong>{request.status}</strong><span>{request.provider} · {request.model || "Modell nicht gespeichert"} · {formatTimestamp(request.finishedAt ?? request.lastActivityAt ?? request.startedAt)}</span></div>
                      {request.error && <p className="run-error">{request.error}</p>}
                      <details><summary>Technische Rohdaten anzeigen</summary><pre>{request.responsePreview || "Keine Ausgabe gespeichert."}</pre></details>
                    </div>
                  ))}
                  {selectedRun.requests.length === 0 && <p className="empty">Keine Request-Daten gespeichert.</p>}
                </div>
                {selectedRun.testReport && (
                  <div className="section">
                    <h3>Testergebnis: {selectedRun.testReport.status}</h3>
                    <p>{selectedRun.testReport.summary || "Keine Zusammenfassung gespeichert."}</p>
                    <ul className="run-checks">{selectedRun.testReport.checks.map((check, index) => <li key={`${check.name}-${index}`}><strong>{check.name ?? "Check"}</strong><span>{check.status ?? "unbekannt"}{check.details ? ` · ${check.details}` : ""}</span></li>)}</ul>
                    <details><summary>Testlogs anzeigen</summary><pre>{selectedRun.testReport.logs || "Keine Testlogs gespeichert."}</pre></details>
                  </div>
                )}
              </div>
              <aside className="drawer-events">
                <h3>Ereignisse</h3>
                {selectedRun.events.map((event) => <article key={event.id}><strong>{(event.eventType ?? "").replaceAll(".", " ")}</strong><span>{formatTimestamp(event.createdAt)}</span></article>)}
                {selectedRun.events.length === 0 && <p className="empty">Keine Events gespeichert.</p>}
              </aside>
            </div>
          </section>
        </div>
      )}

      {showCreate && (
        <div className="modal-back">
          <div className="modal">
            <div className="modal-head"><div><span className="label">Neues Ticket</span><h2>Was soll erledigt werden?</h2></div><button className="x" onClick={() => setShowCreate(false)}>×</button></div>
            <label className="field">Titel<input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="z. B. Run-Aktion dokumentieren" /></label>
            <label className="field">Beschreibung<textarea value={newDescription} onChange={(event) => setNewDescription(event.target.value)} placeholder="Ziel, Kontext und gewünschtes Ergebnis …" rows={4} /></label>
            <div className="modal-actions"><button className="btn btn--outline" onClick={() => setShowCreate(false)}>Abbrechen</button><button className="btn btn--primary" onClick={() => createTask()}>Ticket anlegen</button></div>
          </div>
        </div>
      )}
      {showProjectModal && (
        <div className="modal-back">
          <form className="modal modal--wide" onSubmit={saveProject}>
            <div className="modal-head"><div><span className="label">{editingProjectId ? "Projekt bearbeiten" : "Neues Projekt"}</span><h2>{editingProjectId ? "Projekt konfigurieren" : "Was möchtest du entwickeln?"}</h2></div><button type="button" className="x" onClick={() => setShowProjectModal(false)}>×</button></div>
            <div className="field-grid"><label className="field">Name<input required value={projectForm.name} onChange={(event) => setProjectForm((current) => ({ ...current, name: event.target.value }))} placeholder="Meine WebApp" /></label><label className="field">Schlüssel<input required value={projectForm.key} onChange={(event) => setProjectForm((current) => ({ ...current, key: event.target.value }))} placeholder="APP" /></label></div>
            <label className="field">Beschreibung<textarea value={projectForm.description} onChange={(event) => setProjectForm((current) => ({ ...current, description: event.target.value }))} rows={2} placeholder="Worum geht es in diesem Projekt?" /></label>
            <label className="field">Projektart<select value={projectForm.type} onChange={(event) => setProjectForm((current) => ({ ...current, type: event.target.value }))}><option>WebApp</option><option>Desktop-App</option><option>Mobile-App</option><option>Tool</option><option>API</option><option>Bibliothek</option><option>Sonstiges</option></select></label>
            <label className="field">Lokaler Workspace / Repository<input value={projectForm.workspacePath} onChange={(event) => setProjectForm((current) => ({ ...current, workspacePath: event.target.value }))} placeholder="C:\Projekte\MeineWebApp" /></label>
            <div className="field-grid"><label className="field">Startbefehl<input value={projectForm.startCommand} onChange={(event) => setProjectForm((current) => ({ ...current, startCommand: event.target.value }))} placeholder="npm run dev" /></label><label className="field">Testbefehl<input value={projectForm.testCommand} onChange={(event) => setProjectForm((current) => ({ ...current, testCommand: event.target.value }))} placeholder="npm test" /></label></div>
            <div className="modal-actions">{editingProjectId && <button type="button" className="btn btn--ghost" onClick={() => void archiveActiveProject()}>Archivieren</button>}<button type="button" className="btn btn--outline" onClick={() => setShowProjectModal(false)}>Abbrechen</button><button className="btn btn--primary">{editingProjectId ? "Speichern" : "Projekt anlegen"}</button></div>
          </form>
        </div>
      )}
      {showTaskEditor && (
        <div className="modal-back">
          <form className="modal" onSubmit={saveTask}>
            <div className="modal-head"><div><span className="label">Ticket bearbeiten</span><h2>{taskForm.id}</h2></div><button type="button" className="x" onClick={() => setShowTaskEditor(false)}>×</button></div>
            <label className="field">Titel<input required value={taskForm.title} onChange={(event) => setTaskForm((current) => ({ ...current, title: event.target.value }))} /></label>
            <label className="field">Beschreibung<textarea value={taskForm.description} onChange={(event) => setTaskForm((current) => ({ ...current, description: event.target.value }))} rows={4} /></label>
            <div className="field-grid"><label className="field">Priorität<select value={taskForm.priority} onChange={(event) => setTaskForm((current) => ({ ...current, priority: event.target.value }))}>{["Urgent", "High", "Medium", "Low"].map((priority) => <option key={priority}>{priority}</option>)}</select></label><label className="field">Zuständig<select value={taskForm.assignee} onChange={(event) => setTaskForm((current) => ({ ...current, assignee: event.target.value }))}><option>Manager</option><option>Entwickler</option><option>Tester</option></select></label></div>
            <label className="field">Akzeptanzkriterien <small>Eine Zeile pro Kriterium</small><textarea value={taskForm.acceptance} onChange={(event) => setTaskForm((current) => ({ ...current, acceptance: event.target.value }))} rows={6} /></label>
            <div className="modal-actions"><button type="button" className="btn btn--outline" onClick={() => setShowTaskEditor(false)}>Abbrechen</button><button className="btn btn--primary">Änderungen speichern</button></div>
          </form>
        </div>
      )}
    </main>
  );
}
