# SQLite-Datenbank

## Lokaler Betrieb

`npm.cmd run dev` startet:

- Vinext-Frontend auf `http://localhost:3000`
- lokale Node-SQLite-API auf `http://127.0.0.1:3001`

Die Datenbank wird beim ersten Zugriff unter `.data/harness.sqlite` angelegt. Der Pfad kann mit `HARNESS_DB_PATH` überschrieben werden. `.data` ist von Git ausgeschlossen.

Die Runtime verwendet Node `node:sqlite` mit WAL-Modus, Foreign Keys und Busy Timeout. Das Schema wird beim Start erstellt. Bestehende Datenbanken werden minimal migriert; aktuell betrifft das vor allem die Spalte `agents.provider`.

## Tabellen

- `projects`: gekapselte Produkte/Arbeitsbereiche mit Typ, Workspace-Pfad, Start-/Testbefehlen und Archivstatus
- `agents`: Name, Rolle, Provider, Status und `max_concurrency`
- `tasks`: Titel, Beschreibung, Status, Priorität, Zuweisung, Retries und aktiver Lauf
- `task_acceptance_criteria`: prüfbare Anforderungen pro Ticket
- `task_dependencies`: Ticketabhängigkeiten
- `comments`: Benutzer-, Manager-, Entwickler- und Tester-Kommentare
- `agent_runs`: queued/running/succeeded/failed-Läufe
- `agent_leases`: exklusive, zeitlich begrenzte Ticketreservierungen
- `task_events`: Workflow-Historie
- `test_reports`: Pass/Fail, Checks, Logs und Zusammenfassung; wird nach einem Tester-Run erzeugt
- `tasks.plan_sequence` und `manager_plan_tasks.sequence`: explizite fachliche Reihenfolge eines Manager-Plans
- `artifacts`: Pfade zu Diffs, Logs und Screenshots
- `chat_messages`: persistenter, projektbezogener Manager-Chat

## Parallelität

Der Claim läuft in einer SQLite-Transaktion mit `BEGIN IMMEDIATE`. Dabei werden abgelaufene Leases behandelt, die Kapazität des Agenten geprüft und das nächste passende Ready-Ticket reserviert.

Damit zwei Entwickler parallel arbeiten können, ruft jeder Prozess `claimNextTask(agentId)` mit einer eigenen Agent-ID auf. SQLite verhindert, dass dasselbe Ticket doppelt geclaimt wird. Die Agenten `agent-developer-1` und `agent-developer-2` sind bereits angelegt.

### Plan-Reihenfolge

Manager-Pläne verwenden eine positive `sequence`, üblicherweise 10, 20, 30. Beim Bestätigen wird sie als `plan_sequence` am Ticket gespeichert. Der Entwickler-Claim berücksichtigt zuerst Tickets mit Plan-Reihenfolge und sortiert diese nach `plan_sequence`; bei gleicher Reihenfolge gelten Priorität und Erstellzeitpunkt als Tie-Breaker. Tickets ohne Plan verwenden weiterhin Priorität und danach Erstellzeitpunkt. Abhängigkeiten bleiben harte Voraussetzungen und können ein Ticket trotz früherer sequence blockieren.

## Relevante API-Routen

- `GET /api/health/db`: Datenbankstatus und Tabellenzähler
- `GET /api/agents`: Agenten inklusive Provider-Zuordnung
- `PATCH /api/agents/:id`: Provider eines Agenten ändern
- `GET /api/providers`: lokale CLI-Installation und Loginstatus
- `GET/POST /api/tasks`: Tickets lesen und anlegen
- `PATCH /api/tasks/:id`: Status, Priorität oder Zuweisung ändern
- `POST /api/tasks/:id`: Kommentar speichern
- `POST /api/workflow/next`: nächstes Ticket atomar claimen
- `POST /api/workflow/test`: Review-Ticket für den Tester claimen und Testerprozess starten
- `POST /api/agent-runs/:id/finish`: Lauf beenden und Lease freigeben
- `POST /api/test-runs/:id/finish`: Testergebnis speichern und Ticket auf `Done` oder `Changes Requested` setzen
- `GET /api/agent-runs`: AgentRuns für Statusanzeigen
- `GET/POST /api/chat`: Chatverlauf lesen und Nachricht speichern
- `POST /api/chat/manager`: freie Frage über Miras lokalen Provider beantworten

## Noch offene Datenbankthemen

- Testberichte und Artefakte vollständig in der UI anzeigen
- strukturierte Agentenoutputs speichern und durchsuchen
- Heartbeat-/Timeout-Felder für laufende Prozesse
- echte Status-Transitionsregeln statt freier Statusstrings
- Backup, Restore und Datenbankmigrationen mit Versionshistorie

Die API ist aktuell lokal und ohne Authentifizierung. Sie ist nicht für öffentliche Erreichbarkeit vorgesehen.
