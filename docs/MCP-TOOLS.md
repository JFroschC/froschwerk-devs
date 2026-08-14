# MCP-Tool-Vertrag fuer Codex

Dieses Dokument beschreibt den vorbereiteten Tool-Vertrag fuer einen spaeteren lokalen MCP-Server. Der MCP-Server soll diese Funktionen nur als Adapter exponieren; die fachlichen Regeln liegen in `db/mcp-tools.ts` und `db/local.ts`.

## Ziel und Grenzen

Codex darf ueber die MCP-Schnittstelle:

- Tickets lesen
- Tickets kommentieren
- eingeschraenkte Statusuebergaenge ausfuehren
- Agentenlaeufe und Event-Historie lesen

Codex darf ueber diese Tools nicht:

- Tickets frei editieren oder loeschen
- Secrets oder Provider-Logins lesen
- beliebige Statusstrings setzen
- abgeschlossene Tickets ohne Manageraktion wieder oeffnen
- eine aktive Lease umgehen

## Actor-Kontext

Schreibende Tools akzeptieren optional einen `actor`:

```json
{
  "actorType": "agent",
  "actorId": "codex",
  "authorName": "Codex",
  "runId": "run-..."
}
```

`runId` verbindet Kommentare und Statuswechsel mit einem konkreten Agentenlauf. Fehlt der Actor, wird `agent/codex` verwendet.

## Tools

### `harness.task.read`

Liest ein Ticket mit Akzeptanzkriterien, Kommentaren, Agentenlaeufen und Event-Historie.

Input:

```json
{
  "taskId": "FW-115"
}
```

Output:

```json
{
  "task": {},
  "agentRuns": [],
  "events": []
}
```

### `harness.task.comment`

Speichert einen Kommentar am Ticket und schreibt ein `comment.created`-Event.

Input:

```json
{
  "taskId": "FW-115",
  "body": "Umsetzung abgeschlossen, Tests laufen.",
  "actor": {
    "actorType": "agent",
    "actorId": "agent-developer-1",
    "authorName": "Codex",
    "runId": "run-..."
  }
}
```

### `harness.task.transition`

Aendert den Ticketstatus nur entlang der erlaubten Uebergaenge und schreibt ein `mcp.status_changed`-Event mit `fromStatus`, `toStatus`, `reason` und `runId`.

Input:

```json
{
  "taskId": "FW-115",
  "status": "Review",
  "reason": "Akzeptanzkriterien implementiert.",
  "actor": {
    "actorType": "agent",
    "actorId": "agent-developer-1",
    "authorName": "Codex",
    "runId": "run-..."
  }
}
```

Erlaubte Uebergaenge:

| Von | Nach |
| --- | --- |
| `Ready` | `In Progress`, `Blocked` |
| `In Progress` | `Review`, `Blocked` |
| `Review` | `Testing`, `Changes Requested`, `Blocked` |
| `Testing` | `Done`, `Changes Requested`, `Blocked` |
| `Changes Requested` | `In Progress`, `Ready`, `Blocked` |
| `Blocked` | `Ready` |
| `Done` | kein MCP-Uebergang |

### `harness.agent_runs.list`

Listet Agentenlaeufe fuer ein Ticket oder das gesamte Board.

Input:

```json
{
  "taskId": "FW-115"
}
```

## Nachvollziehbarkeit

Jede schreibende MCP-Aktion erzeugt einen Eintrag in `task_events`. `harness.task.read` liefert die Events zusammen mit den `agent_runs` aus. Damit kann ein Agentenlauf spaeter rekonstruieren:

- welcher Actor gehandelt hat
- welche `runId` beteiligt war
- welcher Statuswechsel durchgefuehrt wurde
- welche Kommentare waehrend des Laufs entstanden sind

## Implementierungsstand

Der MCP-Server selbst ist noch nicht enthalten. Vorbereitet sind:

- maschinenlesbarer Vertrag: `mcpToolContract`
- Tool-Funktionen: `mcpReadTask`, `mcpCommentOnTask`, `mcpTransitionTask`, `mcpListAgentRuns`
- eingeschraenkter Statusautomat: `transitionTaskStatus`
- Event-Ausgabe: `listTaskEvents`
