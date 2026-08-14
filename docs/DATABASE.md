# SQLite und Datenmodell

Stand: 14. August 2026

## Autoritative Laufzeit

Die lokale SQLite-Datenbank ist die autoritative Datenquelle für Projekte, Tickets,
Workflowzustände und Agentenläufe. Sie liegt standardmäßig unter
`.data/harness.sqlite`; `HARNESS_DB_PATH` kann den Pfad überschreiben.

Die Runtime verwendet Node `node:sqlite` mit:

- WAL-Modus
- aktivierten Foreign Keys
- fünf Sekunden Busy Timeout
- Schemaerstellung und additiven Migrationen beim Öffnen der Datenbank

Das tatsächlich ausgeführte Schema steht in `db/local.ts`. `db/schema.ts` spiegelt
dasselbe Tabellen- und Feldmodell für Drizzle und eine mögliche spätere D1-Nutzung,
einschließlich Planreihenfolge, Obsolet-Markierungen und Manager-Task-Sequenzen. Im
Verzeichnis `drizzle/` existiert noch keine vollständige versionierte
Migrationshistorie.

## Tabellen

### Projekte und Agenten

- `projects`: Projektkennung, Workspace, Start-/Testbefehl, Autoprozess und Archivstatus
- `agents`: Rolle, Provider, konfigurierter Status und Kapazitätslimit

Der aktuelle Wert von `agents.status` ist noch kein belastbarer Laufzeitstatus. Eine
Ableitung aus aktiven Runs ist Teil des nächsten Lifecycle-Meilensteins.

### Tickets und Workflow

- `tasks`: Beschreibung, Status, Priorität, Zuweisung, aktiver Run, Retry-Grenzen,
  Parent, Plan, Planreihenfolge, Herkunft und Obsolet-Markierung
- `task_acceptance_criteria`: sortierte Akzeptanzkriterien
- `task_dependencies`: harte Ticketabhängigkeiten
- `comments`: Benutzer-, Manager-, Entwickler- und Testerkommentare
- `task_events`: nachvollziehbare Workflow- und MCP-Ereignisse

### Runs, Requests und Ergebnisse

- `agent_runs`: Rolle, Zustand, Versuch, Ein-/Ausgabe, Zusammenfassung, Fehler, PID,
  Prozessidentität, Heartbeat, Aktivität, Phase, Beendigungsursache und Zeitpunkte
- `agent_leases`: exklusive Reservierung eines Tickets mit Ablaufzeit
- `agent_requests`: einzelne Provider- oder lokale Testanfragen einschließlich Modell,
  Kommando, Dauer, Tokenwerten, Vorschauen und Fehlern
- `test_reports`: Testerstatus, Checks, Logs und Zusammenfassung
- `artifacts`: vorbereitete Metadaten für Diffs, Logs und Screenshots

Die Artefakttabelle besitzt noch keinen produktiven Schreib-/Lese-Service.

### Manager und Planung

- `chat_messages`: projektgebundener Mira-Chat
- `manager_conversations`: persistenter Gesprächszustand
- `manager_conversation_entries`: strukturierte Gesprächseinträge
- `manager_questions`: offene und beantwortete Rückfragen
- `project_analysis_snapshots`: begrenzte Read-only-Projektanalysen
- `manager_plans`: Planvorschau, Status, Annahmen, Risiken und Aktionen
- `manager_plan_tasks`: Ticketentwürfe, Reihenfolge, Parent- und Abhängigkeitsangaben

## Claims und Parallelität

Ein Entwickler-Claim läuft in einer SQLite-Transaktion mit `BEGIN IMMEDIATE`.
Dabei werden geprüft:

1. Agent und Kapazitätslimit
2. Ticketstatus und fehlender aktiver Run
3. Retry-Grenze
4. erfüllte Abhängigkeiten
5. Planreihenfolge, Priorität und Erstellzeit

Der Claim setzt das Ticket atomar auf `In Progress`, legt einen `agent_run` an und
erzeugt genau eine Lease für Ticket und Run. Testerläufe verwenden dasselbe Prinzip
für ein Ticket in `Review`.

Die Datenbasis kann mehrere manuelle Claims tragen. Der automatische Scheduler ist
derzeit sequenziell und wartet, sobald irgendein Run des Projekts aktiv ist.

## Lease, Heartbeat und Recovery

- Standard-TTL: 120 Sekunden über `AGENT_LEASE_TTL_MS`
- Entwickler und Tester erneuern ihre Lease alle 30 Sekunden
- fehlende oder abgelaufene Leases werden beim Lesen, Claimen und beim Start des
  Autoprozesses wiederhergestellt
- Entwicklerfehler erhöhen begrenzt `retry_count`
- Tester-Recovery ist über `TESTER_RECOVERY_LIMIT` begrenzt
- User-Cancel soll keine technische Retry-Grenze verbrauchen

Die Lease-Erneuerung aktualisiert `last_heartbeat_at`; Runner melden zusätzlich
`last_activity_at`, Phase und Fortschritt. Der API-Server startet einen idempotenten
Supervisor mit standardmäßig zehn Sekunden Intervall. Dieser klassifiziert
Lease-Ablauf, Start-/Output-Inaktivität, fehlenden Prozess und Neustart getrennt.
Ein Ticket wird erst freigegeben, nachdem der zugehörige Prozess beendet ist.
`process_identity` kombiniert PID und Prozessstartzeit, damit eine wiederverwendete PID
nicht versehentlich beendet wird. Ist eine alte PID nicht verifizierbar, bleibt der Run
sicher in `cancelling` und braucht manuelle Klärung.

Ein Benutzerabbruch setzt zunächst `cancelling` samt Zeitstempel. Der Runner beendet
seinen Provider kooperativ; nach `AGENT_CANCEL_GRACE_MS` eskaliert der Supervisor
begrenzt auf den Prozessbaum-Abbruch. Erst danach wird der Run `cancelled` und das
Ticket erneut startbar. Ein Benutzerabbruch erhöht weder Entwickler-Retry noch
Tester-Recovery. Manager-Anfragen verwenden dieselben sichtbaren Aktivitätsfelder
`last_activity_at` und `current_phase` in `agent_requests`.

## Statusmodelle

Ticketstatus:

`Ready → In Progress → Review → Testing → Done`

Fehlerpfade:

- `In Progress → Ready` oder `Blocked`
- `Testing → Changes Requested` oder `Blocked`
- `Changes Requested → In Progress`
- `Blocked → Ready` nach bewusster Freigabe

AgentRuns verwenden `queued`, `starting`, `running`, `cancelling`, `succeeded`,
`failed`, `timed_out`, `cancelled` und `lost`. Gültige Übergänge sind zentral in
`db/agent-lifecycle.ts` definiert.

## API-Überblick

### System und Konfiguration

- `GET /api/health/db`
- `GET /api/health/runtime`
- `GET /api/providers`
- `GET /api/agents`
- `PATCH /api/agents/:id`

### Projekte und Tickets

- `GET/POST /api/projects`
- `PATCH /api/projects/:id`
- `GET/POST /api/tasks`
- `GET/PATCH/POST /api/tasks/:id`

### Runs und Workflow

- `GET /api/agent-runs`
- `GET /api/agent-requests`
- `POST /api/agent-runs/:id/cancel`
- `POST /api/agent-runs/:id/finish`
- `POST /api/test-runs/:id/finish`
- `POST /api/workflow/next`
- `POST /api/workflow/test`
- `POST /api/workflow/advance`

### Manager

- `GET/POST /api/chat`
- `POST /api/chat/manager`
- `POST /api/manager/analyze`
- `GET /api/manager/state`
- `POST /api/manager/plans/:id/confirm`
- `POST /api/manager/plans/:id/discard`
- `PATCH/DELETE /api/manager/plans/:id/tasks/:taskId`

## Offene Datenbankarbeit

- versionierte Migrationen einführen
- Artefakt-Services und API implementieren
- Backup und Restore ergänzen

## Sicherheitsgrenze

Die API lauscht lokal auf `127.0.0.1`, besitzt keine Authentifizierung und ist nicht
für öffentliche oder produktive Netzfreigaben vorgesehen.
