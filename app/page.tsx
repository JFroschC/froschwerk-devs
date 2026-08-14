"use client";

import { FormEvent, type CSSProperties, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

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

type RequestSummary = { count: number; running: number; tokens: number; durationMs: number };

type HarnessAgent = {
  id: string;
  name: string;
  role: "manager" | "developer" | "tester";
  provider: "codex" | "claude";
  status: string;
  maxConcurrency: number;
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
type ChatSize = { width: number; height: number };
type BoardDensity = "compact" | "standard" | "wide";

const statuses: Status[] = ["Ready", "In Progress", "Review", "Testing", "Changes Requested", "Blocked", "Done"];
const chatSizeStorageKey = "froschwerk-chat-size";
const activeProjectStorageKey = "froschwerk-active-project";
const boardDensityStorageKey = "froschwerk-board-density";
const managerPanelStorageKey = "froschwerk-manager-panel-height";
const overviewPanelStorageKey = "froschwerk-overview-panel-height";
const defaultProjectId = "project-agent-harness";
const defaultChatSize: ChatSize = { width: 460, height: 680 };
const minimumChatSize: ChatSize = { width: 360, height: 420 };
const defaultManagerPanelHeight = 360;
const minimumManagerPanelHeight = 170;
const defaultOverviewPanelHeight = 420;
const minimumOverviewPanelHeight = 230;

function initialChatSize(): ChatSize {
  if (typeof window === "undefined") return defaultChatSize;
  try {
    const saved = JSON.parse(window.localStorage.getItem(chatSizeStorageKey) ?? "null") as Partial<ChatSize> | null;
    if (typeof saved?.width === "number" && typeof saved.height === "number") {
      return { width: Math.max(minimumChatSize.width, Math.round(saved.width)), height: Math.max(minimumChatSize.height, Math.round(saved.height)) };
    }
  } catch {
    // A malformed local preference should never prevent the board from loading.
  }
  return defaultChatSize;
}

function browserPreference(key: string) {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function initialBoardDensity(): BoardDensity {
  const saved = browserPreference(boardDensityStorageKey);
  return saved === "compact" || saved === "wide" || saved === "standard" ? saved : "standard";
}

function initialManagerPanelHeight() {
  const saved = Number(browserPreference(managerPanelStorageKey));
  return Number.isFinite(saved) && saved >= minimumManagerPanelHeight ? Math.round(saved) : defaultManagerPanelHeight;
}

function initialOverviewPanelHeight() {
  const saved = Number(browserPreference(overviewPanelStorageKey));
  return Number.isFinite(saved) && saved >= minimumOverviewPanelHeight ? Math.round(saved) : defaultOverviewPanelHeight;
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
    title: "MCP-Schnittstelle für Codex vorbereiten",
    description: "Werkzeuge definieren, mit denen Codex Tickets lesen, kommentieren und Status ändern kann.",
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
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState(() => browserPreference(activeProjectStorageKey) || defaultProjectId);
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [projectForm, setProjectForm] = useState({ key: "", name: "", description: "", type: "Tool", workspacePath: "", startCommand: "", testCommand: "" });
  const [managerState, setManagerState] = useState<ManagerState>({});
  const [questionAnswers, setQuestionAnswers] = useState<Record<string, string>>({});
  const [lastSyncedAt, setLastSyncedAt] = useState("");
  const [chatSize, setChatSize] = useState<ChatSize>(initialChatSize);
  const [boardDensity, setBoardDensity] = useState<BoardDensity>(initialBoardDensity);
  const [managerPanelHeight, setManagerPanelHeight] = useState(initialManagerPanelHeight);
  const [overviewPanelHeight, setOverviewPanelHeight] = useState(initialOverviewPanelHeight);
  const [isChatResizing, setIsChatResizing] = useState(false);
  const [isManagerPanelResizing, setIsManagerPanelResizing] = useState(false);
  const [isOverviewPanelResizing, setIsOverviewPanelResizing] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(true);
  const chatMessagesRef = useRef<HTMLDivElement>(null);
  const lastChatMessageIdRef = useRef("");
  const activeProjectIdRef = useRef(activeProjectId);
  const refreshSequenceRef = useRef(0);
  const chatResizeRef = useRef<{ startX: number; startY: number; width: number; height: number } | null>(null);
  const managerPanelResizeRef = useRef<{ startY: number; height: number } | null>(null);
  const overviewPanelResizeRef = useRef<{ startY: number; height: number } | null>(null);

  const clampChatSize = useCallback((size: ChatSize): ChatSize => {
    const maxWidth = Math.max(minimumChatSize.width, window.innerWidth - 250);
    const maxHeight = Math.max(minimumChatSize.height, window.innerHeight - 24);
    return {
      width: Math.min(Math.max(Math.round(size.width), minimumChatSize.width), maxWidth),
      height: Math.min(Math.max(Math.round(size.height), minimumChatSize.height), maxHeight),
    };
  }, []);

  const clampManagerPanelHeight = useCallback((height: number) => {
    const maximum = Math.max(minimumManagerPanelHeight, chatSize.height - 230);
    return Math.min(Math.max(Math.round(height), minimumManagerPanelHeight), maximum);
  }, [chatSize.height]);

  const clampOverviewPanelHeight = useCallback((height: number) => {
    const maximum = Math.max(minimumOverviewPanelHeight, window.innerHeight - 230);
    return Math.min(Math.max(Math.round(height), minimumOverviewPanelHeight), maximum);
  }, []);

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
      const [tasksResponse, chatResponse, agentsResponse, requestsResponse, managerResponse] = await Promise.all([
        fetch(`/api/tasks${query}`, { cache: "no-store" }),
        fetch(`/api/chat${query}`, { cache: "no-store" }),
        fetch("/api/agents", { cache: "no-store" }),
        fetch(`/api/agent-requests${query}&limit=5`, { cache: "no-store" }),
        fetch(`/api/manager/state${query}`, { cache: "no-store" }),
      ]);
      if (!tasksResponse.ok || !chatResponse.ok || !agentsResponse.ok || !requestsResponse.ok || !managerResponse.ok) throw new Error("SQLite API unavailable");
      const tasksPayload = await tasksResponse.json() as { tasks: Task[] };
      const chatPayload = await chatResponse.json() as { messages: ChatMessage[] };
      const agentsPayload = await agentsResponse.json() as { agents: HarnessAgent[] };
      const requestsPayload = await requestsResponse.json() as { requests: AgentRequest[]; summary: RequestSummary };
      const managerPayload = await managerResponse.json() as ManagerState;
      if (refreshSequence !== refreshSequenceRef.current || projectId !== activeProjectIdRef.current) return;
      setTasks(tasksPayload.tasks);
      setChat(chatPayload.messages);
      setAgents(agentsPayload.agents);
      setAgentRequests(requestsPayload.requests);
      setRequestSummary(requestsPayload.summary);
      setManagerState(managerPayload);
      setLastSyncedAt(new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
      setDbError((current) => current.startsWith("SQLite ") ? "" : current);
    } catch {
      if (showError) setDbError("SQLite ist noch nicht erreichbar. Die Anzeige nutzt vorÃ¼bergehend die Startdaten.");
    }
  }, [activeProjectId]);

  useEffect(() => {
    activeProjectIdRef.current = activeProjectId;
  }, [activeProjectId]);

  useEffect(() => {
    try {
      window.localStorage.setItem(chatSizeStorageKey, JSON.stringify(chatSize));
    } catch {
      // The chat remains resizable even when browser storage is unavailable.
    }
  }, [chatSize]);

  useEffect(() => {
    try {
      window.localStorage.setItem(activeProjectStorageKey, activeProjectId);
    } catch {
      // Project selection remains available for the current browser session.
    }
  }, [activeProjectId]);

  useEffect(() => {
    try {
      window.localStorage.setItem(boardDensityStorageKey, boardDensity);
    } catch {
      // The board remains usable even when browser storage is unavailable.
    }
  }, [boardDensity]);

  useEffect(() => {
    try {
      window.localStorage.setItem(managerPanelStorageKey, String(managerPanelHeight));
    } catch {
      // The split remains adjustable for the current browser session.
    }
  }, [managerPanelHeight]);

  useEffect(() => {
    try {
      window.localStorage.setItem(overviewPanelStorageKey, String(overviewPanelHeight));
    } catch {
      // The workspace split remains adjustable for the current browser session.
    }
  }, [overviewPanelHeight]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const resizing = chatResizeRef.current;
      if (!resizing) return;
      setChatSize(clampChatSize({
        width: resizing.width + resizing.startX - event.clientX,
        height: resizing.height + resizing.startY - event.clientY,
      }));
    };
    const stopResizing = () => {
      if (!chatResizeRef.current) return;
      chatResizeRef.current = null;
      setIsChatResizing(false);
    };
    const constrainToViewport = () => setChatSize((current) => clampChatSize(current));
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResizing);
    window.addEventListener("pointercancel", stopResizing);
    window.addEventListener("resize", constrainToViewport);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResizing);
      window.removeEventListener("pointercancel", stopResizing);
      window.removeEventListener("resize", constrainToViewport);
    };
  }, [clampChatSize]);

  const startChatResize = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    chatResizeRef.current = { startX: event.clientX, startY: event.clientY, width: chatSize.width, height: chatSize.height };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsChatResizing(true);
  }, [chatSize]);

  const resetChatSize = useCallback(() => setChatSize(clampChatSize(defaultChatSize)), [clampChatSize]);

  useEffect(() => {
    const resizePlanPanel = (event: PointerEvent) => {
      const resizing = managerPanelResizeRef.current;
      if (!resizing) return;
      setManagerPanelHeight(clampManagerPanelHeight(resizing.height + resizing.startY - event.clientY));
    };
    const stopResizing = () => {
      if (!managerPanelResizeRef.current) return;
      managerPanelResizeRef.current = null;
      setIsManagerPanelResizing(false);
    };
    window.addEventListener("pointermove", resizePlanPanel);
    window.addEventListener("pointerup", stopResizing);
    window.addEventListener("pointercancel", stopResizing);
    return () => {
      window.removeEventListener("pointermove", resizePlanPanel);
      window.removeEventListener("pointerup", stopResizing);
      window.removeEventListener("pointercancel", stopResizing);
    };
  }, [clampManagerPanelHeight]);

  const startManagerPanelResize = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    managerPanelResizeRef.current = { startY: event.clientY, height: managerPanelHeight };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsManagerPanelResizing(true);
  }, [managerPanelHeight]);

  useEffect(() => {
    const resizeOverviewPanel = (event: PointerEvent) => {
      const resizing = overviewPanelResizeRef.current;
      if (!resizing) return;
      setOverviewPanelHeight(clampOverviewPanelHeight(resizing.height + event.clientY - resizing.startY));
    };
    const stopResizing = () => {
      if (!overviewPanelResizeRef.current) return;
      overviewPanelResizeRef.current = null;
      setIsOverviewPanelResizing(false);
    };
    const constrainToViewport = () => setOverviewPanelHeight((current) => clampOverviewPanelHeight(current));
    window.addEventListener("pointermove", resizeOverviewPanel);
    window.addEventListener("pointerup", stopResizing);
    window.addEventListener("pointercancel", stopResizing);
    window.addEventListener("resize", constrainToViewport);
    return () => {
      window.removeEventListener("pointermove", resizeOverviewPanel);
      window.removeEventListener("pointerup", stopResizing);
      window.removeEventListener("pointercancel", stopResizing);
      window.removeEventListener("resize", constrainToViewport);
    };
  }, [clampOverviewPanelHeight]);

  const startOverviewPanelResize = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    overviewPanelResizeRef.current = { startY: event.clientY, height: overviewPanelHeight };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsOverviewPanelResizing(true);
  }, [overviewPanelHeight]);

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

  /*
    Promise.all([fetch("/api/tasks"), fetch("/api/chat"), fetch("/api/agents")])
      .then(async ([tasksResponse, chatResponse, agentsResponse]) => {
        if (!tasksResponse.ok || !chatResponse.ok || !agentsResponse.ok) throw new Error("SQLite API unavailable");
        const tasksPayload = await tasksResponse.json() as { tasks: Task[] };
        const chatPayload = await chatResponse.json() as { messages: ChatMessage[] };
        const agentsPayload = await agentsResponse.json() as { agents: HarnessAgent[] };
        if (!cancelled) {
          setTasks(tasksPayload.tasks);
          setChat(chatPayload.messages);
          setAgents(agentsPayload.agents);
        }
      })
      .catch(() => {
        if (!cancelled) setDbError("SQLite ist noch nicht erreichbar. Die Anzeige nutzt vorübergehend die Startdaten.");
      });
    return () => { cancelled = true; };
  }, []);
  */

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
  const activeManagerPlan = managerState.plan ?? managerState.conversation?.plan;
  const hasManagerWorkbench = Boolean(managerState.analysisSnapshot || managerState.conversation?.status === "needs_input" || activeManagerPlan);
  const stats = useMemo(() => ({
    active: tasks.filter((task) => task.status === "In Progress").length,
    review: tasks.filter((task) => task.status === "Review" || task.status === "Testing").length,
    done: tasks.filter((task) => task.status === "Done").length,
  }), [tasks]);

  const displayedAgents = agents.length > 0 ? agents : [
    { id: "agent-manager", name: "Mira", role: "manager" as const, provider: "codex" as const, status: "online", maxConcurrency: 1 },
    { id: "agent-developer-1", name: "Dev Agent", role: "developer" as const, provider: "codex" as const, status: "online", maxConcurrency: 2 },
    { id: "agent-developer-2", name: "Dev Agent 2", role: "developer" as const, provider: "claude" as const, status: "offline", maxConcurrency: 1 },
    { id: "agent-tester-1", name: "QA Bot", role: "tester" as const, provider: "codex" as const, status: "online", maxConcurrency: 2 },
  ];

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
      const payload = await response.json() as { message: ChatMessage; task?: Task; tasks?: Task[]; conversation?: ManagerConversation; plan?: ManagerPlan; analysisSnapshot?: AnalysisSnapshot };
      if (activeProjectIdRef.current !== projectId) return;
      setChat((current) => [...current, payload.message]);
      if (payload.tasks) setTasks(payload.tasks);
      if (payload.task) setSelectedId(payload.task.id);
      setManagerState({ conversation: payload.conversation, plan: payload.plan, analysisSnapshot: payload.analysisSnapshot ?? managerState.analysisSnapshot });
    } catch (error) {
      setDbError(error instanceof Error ? error.message : "Mira konnte nicht antworten");
    }
  }

  async function runNext(taskId?: string) {
    try {
      const response = await fetch("/api/workflow/next", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(taskId ? { taskId, projectId: activeProjectId } : { projectId: activeProjectId }) });
      const payload = await response.json() as { task?: Task; runId?: string; reason?: string; started?: boolean; error?: string };
      if (!response.ok && payload.error) throw new Error(payload.error);
      if (!payload.task) {
        const message = payload.reason === "developer_capacity"
          ? "Der Entwickler ist aktuell ausgelastet. Ich starte kein weiteres Ticket parallel."
          : payload.reason === "task_not_ready"
            ? `${taskId ?? "Das Ticket"} ist nicht bereit, bereits aktiv oder hat noch eine offene Abhängigkeit.`
            : taskId
              ? `${taskId} wurde nicht gefunden oder kann aktuell nicht gestartet werden.`
              : "Aktuell wartet kein weiteres Ready-Ticket auf Bearbeitung.";
        void appendChat("manager", message);
        return;
      }
      setTasks((current) => [payload.task!, ...current.filter((task) => task.id !== payload.task!.id)]);
      setSelectedId(payload.task.id);
      void appendChat("manager", `${payload.task.id} wurde dem Entwickler zugewiesen und ${payload.started ? "der lokale Agentenprozess" : "der Lauf"} wurde gestartet.`);
    } catch (error) {
      setDbError(error instanceof Error ? error.message : "Nächstes Ticket konnte nicht gestartet werden");
    }
  }

  async function runTester(taskId: string) {
    try {
      const response = await fetch("/api/workflow/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskId, projectId: activeProjectId }) });
      const payload = await response.json() as { task?: Task; reason?: string; error?: string };
      if (!response.ok || !payload.task) throw new Error(payload.error || (payload.reason === "tester_capacity" ? "Der Tester ist aktuell ausgelastet." : "Tester konnte nicht gestartet werden"));
      setTasks((current) => current.map((task) => task.id === taskId ? payload.task! : task));
    } catch (error) {
      setDbError(error instanceof Error ? error.message : "Tester konnte nicht gestartet werden");
    }
  }

  async function cancelRun(runId: string) {
    try {
      let response = await fetch(`/api/agent-runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" });
      if (response.status === 404) {
        response = await fetch(`/api/agent-runs/${encodeURIComponent(runId)}/finish`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "cancelled" }) });
      }
      const payload = await response.json() as { task?: Task; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Lauf konnte nicht abgebrochen werden");
      if (payload.task) setTasks((current) => current.map((task) => task.id === payload.task?.id ? payload.task : task));
      await refreshWorkspace();
    } catch (error) {
      setDbError(error instanceof Error ? error.message : "Lauf konnte nicht abgebrochen werden");
    }
  }

  async function analyzeActiveProject() {
    try {
      const response = await fetch("/api/manager/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: activeProjectId }) });
      const payload = await response.json() as { analysisSnapshot?: AnalysisSnapshot; message?: ChatMessage; error?: string };
      if (!response.ok || !payload.analysisSnapshot) throw new Error(payload.error || "Projektanalyse konnte nicht gestartet werden");
      setManagerState((current) => ({ ...current, analysisSnapshot: payload.analysisSnapshot }));
      if (payload.message) setChat((current) => [...current, payload.message!]);
    } catch (error) {
      setDbError(error instanceof Error ? error.message : "Projektanalyse konnte nicht gestartet werden");
    }
  }

  async function confirmManagerPlan() {
    const plan = managerState.plan;
    if (!plan) return;
    try {
      const response = await fetch(`/api/manager/plans/${plan.id}/confirm`, { method: "POST" });
      const payload = await response.json() as { plan?: ManagerPlan; tasks?: Task[]; message?: ChatMessage; error?: string };
      if (!response.ok || !payload.plan) throw new Error(payload.error || "Plan konnte nicht bestätigt werden");
      setManagerState((current) => ({ ...current, plan: payload.plan, conversation: current.conversation ? { ...current.conversation, plan: payload.plan, status: "completed" } : current.conversation }));
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

  function statusLabel(status: Status) {
    if (status === "Ready") return "Bereit";
    if (status === "In Progress") return "In Arbeit";
    if (status === "Changes Requested") return "Änderungen nötig";
    if (status === "Blocked") return "Blockiert";
    if (status === "Done") return "Erledigt";
    return status;
  }

  return (
    <main className="app-shell" style={{ "--chat-panel-width": `${chatSize.width}px`, "--chat-panel-height": `${chatSize.height}px`, "--chat-panel-space": isChatOpen ? `${chatSize.width}px` : "0px", "--manager-workbench-height": `${managerPanelHeight}px`, "--workspace-overview-height": `${overviewPanelHeight}px` } as CSSProperties}>
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">◈</span><span>Froschwerk</span><small>AGENT HARNESS</small></div>
        <label className="workspace-switcher"><span className="status-dot" /><select value={activeProjectId} onChange={(event) => { setTasks([]); setChat([]); setRuntimeCheck(null); setSelectedId(""); setLastSyncedAt(""); setActiveProjectId(event.target.value); }} aria-label="Aktives Projekt auswählen">{projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select><span className="chevron">⌄</span></label>
        <nav className="side-nav" aria-label="Hauptnavigation">
          <button className="nav-item active"><span>▦</span> Board <b>{tasks.length}</b></button>
          <button className="nav-item"><span>◎</span> Agenten</button>
          <button className="nav-item"><span>◷</span> Aktivität</button>
        </nav>
        <div className="side-section-label project-label">PROJEKT <button className="sidebar-action" onClick={() => openProjectForm()} aria-label="Neues Projekt anlegen">＋</button></div>
        <button className="project-row active-project" onClick={() => openProjectForm(activeProject)}><span className="project-icon">{activeProject?.key.slice(0, 1) ?? "P"}</span><span><strong>{activeProject?.name ?? "Projekt auswählen"}</strong><small>{activeProject?.type ?? ""}</small></span><span className="more">•••</span></button>
        <div className="side-section-label">AGENTENSTATUS</div>
        {displayedAgents.map((agent) => { const avatar = agent.role === "manager" ? "M" : agent.role === "tester" ? "Q" : "D"; const statusClass = agent.status === "online" ? "online" : agent.status === "busy" ? "busy" : "offline-dot"; return <div className="agent-row" key={agent.id}><span className={`avatar ${agent.role}`}>{avatar}</span><span><strong>{agent.name}</strong><small>{agent.role === "manager" ? "Hauptmanager" : agent.role === "tester" ? "Tester" : "Entwickler"}</small><select className="agent-provider-select" value={agent.provider} onChange={(event) => void updateAgentProvider(agent.id, event.target.value as HarnessAgent["provider"])} aria-label={`${agent.name} Provider`}><option value="codex">Codex-Abo</option><option value="claude">Claude-Abo</option></select></span><i className={statusClass} /></div>; })}
        <div className="side-section-label provider-label">VERBINDUNGEN <button className="provider-refresh" onClick={() => void refreshProviders()} aria-label="Providerstatus aktualisieren">↻</button></div>
        {(["codex", "claude"] as const).map((id) => { const provider = providers[id]; return <div className="provider-row" key={id}><span className={`provider-icon ${id}`}>{id === "codex" ? "C" : "A"}</span><span><strong>{provider?.label ?? (id === "codex" ? "OpenAI Codex" : "Claude Code")}</strong><small>{provider?.loggedIn ? `${provider.authMethod ?? "Abo"}${provider.subscriptionType ? ` · ${provider.subscriptionType}` : ""}` : provider?.installed ? "Nicht angemeldet" : "Status wird geprüft …"}</small></span><i className={provider?.loggedIn && !provider.apiKeyDetected ? "online" : provider?.installed ? "busy" : "offline-dot"} /></div>; })}
        <div className="sidebar-bottom"><div className="user-card"><span className="avatar user">F</span><span><strong>FroschiO</strong><small>Workspace Owner</small></span><span>•••</span></div><div className="sidebar-foot">⌘ K <span>Command palette</span></div></div>
      </aside>

      <section className="content-area">
        <section className="workspace-overview-pane" aria-label="Projekt- und Laufzeitinformationen">
        <header className="topbar"><div className="breadcrumbs"><span>{activeProject?.name ?? "Projekt"}</span><b>/</b><strong>Board</strong></div><div className="top-actions"><button className="icon-button" aria-label="Suche">⌕</button><button className="icon-button" aria-label="Benachrichtigungen">♧</button><button className="manager-pill" onClick={() => setIsChatOpen(true)} aria-expanded={isChatOpen}><span className="avatar manager">M</span> Mit Mira chatten <span>↗</span></button></div></header>
        {dbError && <div className="db-banner" role="status">{dbError}</div>}
        {runtimeCheck && !runtimeCheck.ok && <div className="db-banner" role="alert"><strong>Agent-Laufzeitcheck fehlgeschlagen.</strong> {runtimeCheck.messages.join(" ")} <small>Benutzer: {runtimeCheck.user.username} · CODEX_HOME: {runtimeCheck.codexHome.path} · Schreibrecht: {runtimeCheck.codexHome.directory.writable ? "ja" : "nein"}</small></div>}
        <div className="page-heading"><div><div className="eyebrow">{activeProject?.type?.toUpperCase() ?? "PROJEKT"} · AKTIVES PROJEKT</div><h1>{activeProject?.name ?? "Projekt"}<span className="accent">.</span></h1><p>{activeProject?.description || "Dein gekapseltes Projektboard mit Mira und deinen Agents."}</p></div><div className="heading-actions"><button className="secondary-button" onClick={() => void analyzeActiveProject()}>Projekt analysieren</button><button className="secondary-button" onClick={() => openProjectForm(activeProject)}>Projekt bearbeiten</button><button className="primary-button" onClick={() => setShowCreate(true)}><span>＋</span> Neues Ticket</button></div></div>
        <div className="project-overview"><div><span className="eyebrow">WORKSPACE</span><strong>{activeProject?.workspacePath || "Noch kein lokaler Ordner hinterlegt"}</strong></div><div><span className="eyebrow">FORTSCHRITT</span><strong>{activeProject?.progress ?? 0}%</strong><div className="progress-track"><i style={{ width: `${activeProject?.progress ?? 0}%` }} /></div></div><div><span className="eyebrow">LÄUFE</span><strong>{activeProject?.runCount ?? 0}</strong></div><button className="secondary-button danger-button" onClick={() => void archiveActiveProject()}>Archivieren</button></div>
        <div className="metric-grid"><div className="metric-card"><span className="metric-icon blue">◌</span><div><small>Aktive Tickets</small><strong>{stats.active}</strong><em className="positive">↑ 1 seit gestern</em></div></div><div className="metric-card"><span className="metric-icon amber">◷</span><div><small>In Prüfung</small><strong>{stats.review}</strong><em>Entwickler + QA</em></div></div><div className="metric-card"><span className="metric-icon green">✓</span><div><small>Abgeschlossen</small><strong>{stats.done}</strong><em className="positive">↑ 2 diese Woche</em></div></div><div className="metric-card manager-card"><span className="avatar manager large">M</span><div><small>Manager-Status</small><strong>Alles im Blick</strong><em><i className="online" /> Mira ist bereit</em></div></div></div>

        <div className="sync-indicator" role="status"><i className="online" /> Live-Sync aktiv{lastSyncedAt ? ` · zuletzt ${lastSyncedAt}` : ""}</div>
        <div className="request-monitor" aria-label="Agenten-Anfragen"><div><span className="eyebrow">AGENT REQUEST TRACKING</span><strong>{requestSummary.running ? `${requestSummary.running} läuft gerade` : "Keine Anfrage läuft"}</strong></div><div><span>Anfragen</span><b>{requestSummary.count}</b></div><div><span>Tokens</span><b>{requestSummary.tokens.toLocaleString("de-DE")}{requestSummary.tokens ? " ≈" : ""}</b></div><div><span>Gesamtdauer</span><b>{Math.round(requestSummary.durationMs / 1000)}s</b></div>{agentRequests[0] && <small title={agentRequests[0].responsePreview}>{agentRequests[0].role} · {agentRequests[0].provider} · {agentRequests[0].status} · {agentRequests[0].durationMs ? `${Math.round(agentRequests[0].durationMs / 1000)}s` : "läuft"}{agentRequests[0].totalTokens ? ` · ${agentRequests[0].totalTokens} Tokens` : ` · ≈${agentRequests[0].estimatedInputTokens + agentRequests[0].estimatedOutputTokens} Tokens`}</small>}<details className="request-details"><summary>Letzte Anfragen und Antworten</summary>{agentRequests.map((request) => <article key={request.id}><strong>{request.role} · {request.provider} · {request.status}</strong><span>{request.durationMs ? `${Math.round(request.durationMs / 1000)}s` : "noch offen"} · Input ≈{request.estimatedInputTokens} Tokens · Output ≈{request.estimatedOutputTokens} Tokens{request.totalTokens ? ` · Exakt gesamt ${request.totalTokens}` : ""}</span><label>Gesendet<pre>{request.promptPreview}</pre></label><label>Antwort<pre>{request.responsePreview || request.error || "Noch keine Antwort"}</pre></label></article>)}</details></div>
        </section>
        <button className={`workspace-pane-resize-handle${isOverviewPanelResizing ? " is-resizing" : ""}`} type="button" onPointerDown={startOverviewPanelResize} aria-label="Höhe des Projekt- und Debugbereichs durch Ziehen ändern" title="Projekt- und Debugbereich größer oder kleiner ziehen"><span aria-hidden="true">⋮</span><small>Infobereich ziehen</small><span aria-hidden="true">⋮</span></button>
        <section className="board-pane" aria-label="Ticket-Board">
        <div className="board-toolbar"><div><h2>Ticket-Board</h2><span className="muted">{tasks.length} Tickets · zuletzt aktualisiert {tasks[0]?.updatedAt}</span></div><div className="toolbar-actions"><div className="board-density" role="group" aria-label="Spaltenbreite"><span>Ansicht</span>{(["compact", "standard", "wide"] as const).map((density) => <button type="button" className={boardDensity === density ? "active" : ""} aria-pressed={boardDensity === density} onClick={() => setBoardDensity(density)} key={density}>{density === "compact" ? "Kompakt" : density === "wide" ? "Breit" : "Standard"}</button>)}</div><button className="secondary-button" onClick={() => void runNext()}>▶ Nächstes Ticket starten</button><button className="filter-button">☷ Filtern <span>⌄</span></button></div></div>
        <div className="board-scroll" role="region" aria-label="Ticketspalten scrollen">
        <div className={`board ${boardDensity}`}>
          {statuses.map((status) => {
            const columnTasks = tasks.filter((task) => task.status === status);
            return <section className={`board-column ${status.toLowerCase().replaceAll(" ", "-")}`} key={status}><div className="column-head"><span className="column-title"><i /> {statusLabel(status)}</span><span className="column-count">{columnTasks.length}</span><button aria-label={`${status} Optionen`}>•••</button></div><div className="column-body">{columnTasks.map((task) => <button type="button" className={`task-card ${selectedId === task.id ? "selected" : ""}`} key={task.id} onClick={() => setSelectedId(task.id)}><div className="task-top"><span className="task-id">{task.id}</span><span className="task-sequence" title="Fachliche Reihenfolge">{task.planSequence ? `#${task.planSequence}` : "nicht gesetzt"}</span><span className={`priority ${task.priority.toLowerCase()}`}>{task.priority}</span></div><h3>{task.title}</h3><p>{task.description}</p><div className="task-bottom"><span className={`avatar small ${task.assignee === "Tester" ? "tester" : task.assignee === "Manager" ? "manager" : "developer"}`}>{task.assignee === "Tester" ? "Q" : task.assignee === "Manager" ? "M" : "D"}</span><span className="comment-count">▱ {task.comments.length}</span><span className="task-date">{task.updatedAt}</span></div></button>)}{columnTasks.length === 0 && <div className="empty-column">Keine Tickets</div>}</div><button className="add-card" onClick={() => { setShowCreate(true); }}>＋ Ticket hinzufügen</button></section>;
          })}
        </div>
        </div>
        </section>
      </section>

      <div className="workflow-strip" role="status"><span>{selectedTask?.activeRunId ? `Lauf aktiv: ${selectedTask.activeRunRole === "tester" ? "Tester" : "Entwickler"}` : selectedTask?.testReport ? `Testergebnis: ${selectedTask.testReport.status === "passed" ? "Bestanden" : "Änderungen erforderlich"}` : "Workflow bereit"}</span>{selectedTask?.activeRunId && <><small>{selectedTask.activeRunId}</small><button className="secondary-button" onClick={() => void cancelRun(selectedTask.activeRunId!)}>■ Lauf abbrechen</button></>}{selectedTask?.status === "Ready" && <button className="secondary-button" onClick={() => void runNext(selectedTask.id)}>▶ Entwickler starten</button>}{selectedTask?.status === "Review" && <button className="secondary-button" onClick={() => void runTester(selectedTask.id)}>Tester starten</button>}</div>
      <aside className="detail-panel">
        {selectedTask && <button className="secondary-button" onClick={() => openTaskEditor(selectedTask)}>Ticket bearbeiten</button>}
        <div className="detail-header"><div><span className="eyebrow">TICKETDETAILS</span><strong>{selectedTask?.id}</strong></div><button className="close-button" aria-label="Details schließen">×</button></div>
        {selectedTask && <><div className="detail-title"><span className={`priority ${selectedTask.priority.toLowerCase()}`}>{selectedTask.priority}</span><h2>{selectedTask.title}</h2><p>{selectedTask.description}</p></div>{selectedTask.obsoleteAt && <div className="db-banner" role="status"><strong>Obsolet archiviert.</strong> {selectedTask.obsoleteReason ?? "Dieses Ticket ist revisionssicher aus dem aktiven Workflow entfernt."}</div>}<div className="detail-meta"><div><span>Status</span><select value={selectedTask.status} disabled={Boolean(selectedTask.obsoleteAt)} onChange={(event) => moveTask(selectedTask.id, event.target.value as Status)}>{statuses.map((status) => <option key={status} value={status}>{status}</option>)}</select></div><div><span>Zuständig</span><strong><span className={`avatar small ${selectedTask.assignee === "Tester" ? "tester" : selectedTask.assignee === "Manager" ? "manager" : "developer"}`}>{selectedTask.assignee === "Tester" ? "Q" : selectedTask.assignee === "Manager" ? "M" : "D"}</span>{selectedTask.assignee}</strong></div></div><div className="detail-section"><div className="section-title">Akzeptanzkriterien <span>{selectedTask.acceptance.length}</span></div><ul className="criteria-list">{selectedTask.acceptance.map((criteria, index) => <li key={`${criteria}-${index}`}><span className="check-box">{selectedTask.status === "Done" ? "✓" : ""}</span>{criteria}</li>)}</ul></div><div className="detail-section comments-section"><div className="section-title">Aktivität <span>{selectedTask.comments.length}</span></div><div className="comments-list">{selectedTask.comments.map((comment) => <div className="comment" key={comment.id}><span className={`avatar small ${comment.role === "Tester" ? "tester" : comment.role === "Manager" ? "manager" : comment.role === "Entwickler" ? "developer" : "user"}`}>{comment.role === "Tester" ? "Q" : comment.role === "Manager" ? "M" : comment.role === "Entwickler" ? "D" : "F"}</span><div><div className="comment-author"><strong>{comment.author}</strong><span>{comment.createdAt}</span></div><p>{comment.text}</p></div></div>)}</div><form className="comment-form" onSubmit={addComment}><span className="avatar small user">F</span><input name="comment" placeholder="Kommentar hinzufügen …" aria-label="Kommentar hinzufügen" /><button aria-label="Kommentar senden">↑</button></form></div></>}
      </aside>

      {isChatOpen ? <aside className={`chat-panel${isChatResizing ? " is-resizing" : ""}`} aria-label="Chat mit Mira">
        <button className="chat-resize-handle" type="button" onPointerDown={startChatResize} aria-label="Chatfenster durch Ziehen vergrößern oder verkleinern" title="Zum Ändern der Größe ziehen"><span aria-hidden="true">↖</span></button>
        <div className="chat-header"><div><div className="chat-title"><span className="avatar manager">M</span><strong>Mira</strong><span className="online-label"><i className="online" /> online</span></div><span className="chat-subtitle">Hauptmanager · {activeProject?.name ?? "Projekt"}</span></div><div className="chat-header-actions"><button className="chat-size-reset" type="button" onClick={resetChatSize} title="Standardgröße wiederherstellen" aria-label="Standardgröße wiederherstellen">↺</button><button className="close-button chat-collapse" type="button" onClick={() => setIsChatOpen(false)} title="Chat einklappen" aria-label="Chat einklappen">×</button></div></div>
        <div className="chat-messages" ref={chatMessagesRef}>{chat.map((message) => <div className={`chat-message ${message.sender === "Du" ? "from-user" : "from-manager"}`} key={message.id}>{message.sender === "Manager" && <span className="avatar small manager">M</span>}<div><span className="message-label">{message.sender === "Du" ? "Du" : "Mira · gerade eben"}</span><p>{message.text}</p></div></div>)}</div>
        {hasManagerWorkbench && <><button className={`manager-panel-resize-handle${isManagerPanelResizing ? " is-resizing" : ""}`} type="button" onPointerDown={startManagerPanelResize} aria-label="Höhe des Planbereichs durch Ziehen ändern" title="Planbereich größer oder kleiner ziehen"><span aria-hidden="true">⋮</span><small>Planbereich ziehen</small><span aria-hidden="true">⋮</span></button><div className="manager-workbench">
          <section className="manager-card auto-process-card"><div><span className="eyebrow">AUTOPROZESS</span><strong>{activeProject?.autoProcessEnabled ? "Automatisch weiterarbeiten" : "Nach jedem Lauf pausieren"}</strong></div><p>{activeProject?.autoProcessEnabled ? "Wartende Review- oder Ready-Tickets werden nacheinander übernommen. Nach erfolgreicher Entwicklung startet der Tester; nach bestandenem Test folgt das nächste Ticket." : "Entwickler- und Testerläufe werden nur manuell gestartet; auch nach einem bestandenen Test bleibt der Workflow stehen."}</p><button className="secondary-button" onClick={() => void toggleAutoProcess()}>Autoprozess {activeProject?.autoProcessEnabled ? "deaktivieren" : "aktivieren und starten"}</button></section>
          {managerState.analysisSnapshot && <section className="manager-card analysis-card"><div><span className="eyebrow">PROJEKTANALYSE</span><strong>{managerState.analysisSnapshot.status === "succeeded" ? "Snapshot bereit" : "Analyse mit Hinweis"}</strong></div><p>{managerState.analysisSnapshot.summary}</p>{managerState.analysisSnapshot.snapshot?.git?.branch && <small>Git: {managerState.analysisSnapshot.snapshot.git.branch} · {managerState.analysisSnapshot.snapshot.git.changedFiles ?? 0} Änderungen</small>}</section>}
          {managerState.conversation?.status === "needs_input" && <form className="manager-card question-card" onSubmit={continuePlanning}><div><span className="eyebrow">RÜCKFRAGEN</span><strong>Planung benötigt deine Antworten</strong></div>{managerState.conversation.questions.filter((question) => !question.answer).map((question) => <label key={question.id}>{question.question}{question.options.length > 0 ? <select value={questionAnswers[question.id] ?? ""} onChange={(event) => setQuestionAnswers((current) => ({ ...current, [question.id]: event.target.value }))}><option value="">Bitte auswählen</option>{question.options.map((option) => <option value={option} key={option}>{option}</option>)}</select> : <input value={questionAnswers[question.id] ?? ""} onChange={(event) => setQuestionAnswers((current) => ({ ...current, [question.id]: event.target.value }))} placeholder="Deine Antwort" />}</label>)}<button className="primary-button">Planung fortsetzen</button></form>}
          {activeManagerPlan && <section className="manager-card plan-card"><div className="plan-heading"><div><span className="eyebrow">{activeManagerPlan.status === "awaiting_confirmation" ? "PLANVORSCHAU" : "PLANFORTSCHRITT"}</span><strong>{activeManagerPlan.title}</strong></div><b>{activeManagerPlan.progress.percent}%</b></div><p>{activeManagerPlan.summary}</p>{activeManagerPlan.assumptions.length > 0 && <small>Annahmen: {activeManagerPlan.assumptions.join(" · ")}</small>}{activeManagerPlan.risks.length > 0 && <small className="risk-note">Risiken: {activeManagerPlan.risks.join(" · ")}</small>}<div className="plan-task-list">{activeManagerPlan.tasks.map((task) => <article key={task.id}><div><span className="priority">#{task.sequence} · {task.priority}</span><strong>{task.title}</strong><p>{task.description}</p><small>{task.acceptance.length} Kriterien{task.dependsOnClientIds.length ? ` · abhängig von ${task.dependsOnClientIds.join(", ")}` : ""}{task.taskId ? ` · ${task.taskId}` : ""}</small></div>{activeManagerPlan.status === "awaiting_confirmation" && <span className="plan-task-actions"><button type="button" onClick={() => void editPlanTask(task)}>Bearbeiten</button><button type="button" onClick={() => void removePlanTask(task.id)}>Entfernen</button></span>}</article>)}</div>{activeManagerPlan.status === "awaiting_confirmation" && <div className="plan-actions"><button className="secondary-button" onClick={() => void discardManagerPlan()}>Verwerfen</button><button className="primary-button" onClick={() => void confirmManagerPlan()}>Plan bestätigen</button></div>}</section>}
        </div></>}
        <div className="chat-suggestions"><button onClick={() => { void processChatText("Analysiere dieses Projekt und erstelle anschließend einen umsetzbaren Plan."); }}>Projekt planen</button><button onClick={() => { void processChatText("Wie ist der Status?"); }}>Status zusammenfassen</button><button onClick={() => { void processChatText("Starte die nächste Aufgabe"); }}>Nächstes Ticket</button></div>
        <form className="chat-form" onSubmit={handleChat}><textarea value={chatInput} onChange={(event) => setChatInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder={`Nachricht an Mira über ${activeProject?.name ?? "dieses Projekt"} …`} aria-label="Nachricht an Mira" rows={2} /><div className="chat-form-bottom"><span>↗ Enter senden · Shift+Enter Zeilenumbruch</span><button className="send-button" aria-label="Nachricht senden">↑</button></div></form>
      </aside> : <button className="chat-launcher" type="button" onClick={() => setIsChatOpen(true)} aria-label="Chat mit Mira öffnen"><span className="avatar manager">M</span><span>Mit Mira chatten</span><b>↑</b></button>}

      {showCreate && <div className="modal-backdrop"><div className="create-modal"><div className="modal-heading"><div><span className="eyebrow">NEUES TICKET</span><h2>Was soll erledigt werden?</h2></div><button className="close-button" onClick={() => setShowCreate(false)}>×</button></div><label>Titel<input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="z. B. MCP-Tools dokumentieren" /></label><label>Beschreibung<textarea value={newDescription} onChange={(event) => setNewDescription(event.target.value)} placeholder="Ziel, Kontext und gewünschtes Ergebnis …" rows={4} /></label><div className="modal-actions"><button className="secondary-button" onClick={() => setShowCreate(false)}>Abbrechen</button><button className="primary-button" onClick={() => createTask()}>Ticket anlegen</button></div></div></div>}
      {showProjectModal && <div className="modal-backdrop"><form className="create-modal project-modal" onSubmit={saveProject}><div className="modal-heading"><div><span className="eyebrow">{editingProjectId ? "PROJEKT BEARBEITEN" : "NEUES PROJEKT"}</span><h2>{editingProjectId ? "Projekt konfigurieren" : "Was möchtest du entwickeln?"}</h2></div><button type="button" className="close-button" onClick={() => setShowProjectModal(false)}>×</button></div><div className="form-grid"><label>Name<input required value={projectForm.name} onChange={(event) => setProjectForm((current) => ({ ...current, name: event.target.value }))} placeholder="Meine WebApp" /></label><label>Schlüssel<input required value={projectForm.key} onChange={(event) => setProjectForm((current) => ({ ...current, key: event.target.value }))} placeholder="APP" /></label></div><label>Beschreibung<textarea value={projectForm.description} onChange={(event) => setProjectForm((current) => ({ ...current, description: event.target.value }))} rows={2} placeholder="Worum geht es in diesem Projekt?" /></label><label>Projektart<select value={projectForm.type} onChange={(event) => setProjectForm((current) => ({ ...current, type: event.target.value }))}><option>WebApp</option><option>Desktop-App</option><option>Mobile-App</option><option>Tool</option><option>API</option><option>Bibliothek</option><option>Sonstiges</option></select></label><label>Lokaler Workspace / Repository<input value={projectForm.workspacePath} onChange={(event) => setProjectForm((current) => ({ ...current, workspacePath: event.target.value }))} placeholder="C:\Projekte\MeineWebApp" /></label><div className="form-grid"><label>Startbefehl<input value={projectForm.startCommand} onChange={(event) => setProjectForm((current) => ({ ...current, startCommand: event.target.value }))} placeholder="npm run dev" /></label><label>Testbefehl<input value={projectForm.testCommand} onChange={(event) => setProjectForm((current) => ({ ...current, testCommand: event.target.value }))} placeholder="npm test" /></label></div><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setShowProjectModal(false)}>Abbrechen</button><button className="primary-button">{editingProjectId ? "Änderungen speichern" : "Projekt anlegen"}</button></div></form></div>}
      {showTaskEditor && <div className="modal-backdrop"><form className="create-modal" onSubmit={saveTask}><div className="modal-heading"><div><span className="eyebrow">TICKET BEARBEITEN</span><h2>{taskForm.id}</h2></div><button type="button" className="close-button" onClick={() => setShowTaskEditor(false)}>×</button></div><label>Titel<input required value={taskForm.title} onChange={(event) => setTaskForm((current) => ({ ...current, title: event.target.value }))} /></label><label>Beschreibung<textarea value={taskForm.description} onChange={(event) => setTaskForm((current) => ({ ...current, description: event.target.value }))} rows={4} /></label><div className="form-grid"><label>Priorität<select value={taskForm.priority} onChange={(event) => setTaskForm((current) => ({ ...current, priority: event.target.value }))}>{["Urgent", "High", "Medium", "Low"].map((priority) => <option key={priority}>{priority}</option>)}</select></label><label>Zuständig<select value={taskForm.assignee} onChange={(event) => setTaskForm((current) => ({ ...current, assignee: event.target.value }))}><option>Manager</option><option>Entwickler</option><option>Tester</option></select></label></div><label>Akzeptanzkriterien <small>Eine Zeile pro Kriterium</small><textarea value={taskForm.acceptance} onChange={(event) => setTaskForm((current) => ({ ...current, acceptance: event.target.value }))} rows={6} /></label><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setShowTaskEditor(false)}>Abbrechen</button><button className="primary-button">Änderungen speichern</button></div></form></div>}
    </main>
  );
}
