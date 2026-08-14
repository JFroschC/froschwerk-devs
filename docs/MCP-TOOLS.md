# MCP-Tool-Vertrag

Stand: 14. August 2026

## Status

Der Harness enthält einen maschinenlesbaren Tool-Vertrag und lokale DB-Funktionen.
Ein ausführbarer MCP-Server-Adapter ist noch nicht implementiert. Die beschriebenen
Tools stehen externen Codex-Sitzungen daher noch nicht als echte MCP-Tools zur
Verfügung.

Die fachlichen Regeln liegen in `db/mcp-tools.ts` und `db/local.ts`.

## Ziel und Grenzen

Über den geplanten Adapter darf ein Agent:

- Tickets mit Akzeptanzkriterien, Kommentaren, Runs und Events lesen
- nachvollziehbare Kommentare speichern
- eingeschränkte Statusübergänge ausführen
- Agentenläufe für ein Ticket oder Projekt auflisten

Nicht erlaubt sind:

- Tickets frei löschen oder beliebig umschreiben
- Secrets oder Provider-Logins lesen
- freie Statusstrings setzen
- abgeschlossene Tickets ohne Manageraktion wieder öffnen
- aktive Leases umgehen

## Actor-Kontext

Schreibende Funktionen akzeptieren einen Actor:

```json
{
  "actorType": "agent",
  "actorId": "agent-developer-1",
  "authorName": "Codex",
  "runId": "run-..."
}
```

`runId` verbindet Aktion, Ticket und Agentenlauf. Fehlt der Actor, verwendet die
aktuelle Implementierung einen Codex-Standardactor.

## Vorgesehene Tools

### `harness.task.read`

Liest ein Ticket einschließlich Akzeptanzkriterien, Kommentaren, AgentRuns und
Task-Events.

```json
{ "taskId": "FBT-477-A56D" }
```

### `harness.task.comment`

Speichert einen Kommentar und erzeugt ein `comment.created`-Event.

```json
{
  "taskId": "FBT-477-A56D",
  "body": "Umsetzung abgeschlossen; Testgate erfolgreich.",
  "actor": {
    "actorType": "agent",
    "actorId": "agent-developer-1",
    "authorName": "Codex",
    "runId": "run-..."
  }
}
```

### `harness.task.transition`

Ändert den Ticketstatus nur entlang des erlaubten Übergangsgraphen und schreibt ein
`mcp.status_changed`-Event.

### `harness.agent_runs.list`

Listet Agentenläufe für ein Ticket oder das gesamte Board.

## Erlaubte Statusübergänge

| Von | Nach |
| --- | --- |
| `Ready` | `In Progress`, `Blocked` |
| `In Progress` | `Review`, `Blocked` |
| `Review` | `Testing`, `Changes Requested`, `Blocked` |
| `Testing` | `Done`, `Changes Requested`, `Blocked` |
| `Changes Requested` | `In Progress`, `Ready`, `Blocked` |
| `Blocked` | `Ready` |
| `Done` | kein MCP-Übergang |

Jede schreibende Aktion erzeugt einen Eintrag in `task_events`.

## Bekannte Lücken vor dem MCP-Server

1. Der Übergangsgraph ist eingeschränkt, aber noch nicht vollständig rollenbezogen
   autorisiert.
2. Ein Agent darf einen angegebenen `runId` noch nicht durchgängig gegen das aktive
   Ticket und seine Rolle validieren.
3. Der Netzwerk-/Transportadapter und seine lokale Zugriffskontrolle fehlen.

Der Ticket-Identifier akzeptiert projektunabhängige Großbuchstaben-, Ziffern-,
Unterstrich- und Bindestrich-Präfixe, daher beispielsweise sowohl `FW-115` als auch
`FBT-477-A56D`.

Diese Punkte werden vor beziehungsweise gemeinsam mit dem MCP-Server gemäß
[ROADMAP.md](./ROADMAP.md) umgesetzt.
