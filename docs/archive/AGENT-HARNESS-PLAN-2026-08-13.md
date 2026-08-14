# Archiv: Agent Harness – Entwicklungsplan vom 13.08.2026

> Historischer Planungsstand. Nicht als aktuelle Roadmap verwenden.
> Aktueller Stand: [CURRENT-STATUS.md](../CURRENT-STATUS.md).
> Aktive Planung: [ROADMAP.md](../ROADMAP.md).

## Ziel

Eine lokal laufende Taskboard- und Verwaltungsanwendung für einen Hauptmanager, Entwickler-Agenten und Tester-Agenten.

Das Board ist die zentrale Wahrheit für Tickets, Status, Kommentare, Agentenläufe, Leases, Testergebnisse und Blockaden. Provider werden über lokale Codex- und Claude-Code-CLIs verwendet, damit kein eigener API-Key im Harness nötig ist.

## Aktueller Stand auf einen Blick

| Bereich | Status | Anmerkung |
| --- | --- | --- |
| Taskboard und Ticketdetails | Fertig | Tickets anlegen, ansehen, Status/Priorität ändern |
| Kommentare | Fertig | Benutzer-, Manager-, Entwickler- und Tester-Kommentare |
| SQLite-Persistenz | Fertig | Lokale Datenbank unter `.data/harness.sqlite` |
| Agenten und Provider-Auswahl | Fertig | Provider pro Agent in SQLite, Auswahl im Board |
| Mira-Chat | MVP fertig | Freie Fragen und strukturierte Manageraktionen über lokale CLI; Aktionen werden kontrolliert ausgeführt |
| Entwickler-CLI-Runner | Fertig | Codex/Claude wird mit Benutzerprofil-, Git-, Timeout- und Recovery-Schutz gestartet |
| Parallele Entwickler | Datenbasis fertig | Atomare Claims und Kapazitätslimits vorhanden |
| Automatische Orchestrierung | Fertig für sequenzielle Pläne | Aktivieren und Neustart setzen Review/Ready → Entwickler → Tester → nächstes Ticket fort |
| Tester-Runner | MVP fertig | Review-Ticket wird geprüft und auf Done/Changes Requested gesetzt |
| MCP-Schnittstelle | Vorbereitet | Tool-Vertrag und eingeschränkte Ticketaktionen sind definiert; Server-Adapter fehlt noch |

## Rollen

### Mira – Hauptmanager

- chatten und den aktuellen Board-Stand erklären
- Tickets aus kontrollierten Aktionen anlegen
- nächste Ready-Tickets reservieren
- Agentenläufe und Blockaden zusammenfassen
- später Entwickler- und Tester-Läufe orchestrieren
- keinen Produktivcode direkt ändern

### Entwickler-Agent

- ein reserviertes Ticket bearbeiten
- Code im Workspace ändern
- relevante Tests ausführen
- Ergebnis, Risiken und Blockaden melden

### Tester-Agent

- Akzeptanzkriterien und Änderungen prüfen
- Tests und Browser-Flows ausführen
- Testbericht, Logs und Fehler am Ticket speichern
- keinen Produktivcode ändern

## Tatsächlicher aktueller Ablauf

1. Die Website lädt Tickets, Chat und Agenten über die lokale API.
2. Ticketanlage, Kommentare und Statusänderungen werden direkt in SQLite gespeichert.
3. `POST /api/workflow/next` reserviert atomar das nächste Ready-Ticket für `agent-developer-1`, legt einen `agent_run` und eine Lease an und startet die passende lokale CLI.
4. `scripts/run-agent.mjs --agent <agent-id>` arbeitet das Ticket ab; ein erfolgreicher Abschluss startet automatisch den Tester.
5. Freie Fragen an Mira laufen über `POST /api/chat/manager` mit Miras aktuell ausgewähltem Provider.
6. Mira liefert eine strukturierte JSON-Aktion (`create_task`, `start_next`, `start_task`, `start_tester`, `comment_task`); die Harness-Anwendung validiert und führt sie kontrolliert aus.

Der Button „Nächstes Ticket starten“ reserviert das nächste Ready-Ticket und startet den lokalen Entwicklerprozess. Im Ticketdetail kann ein konkretes Ready-Ticket über „Entwickler starten“ ausgelöst werden.

## Provider-Zuordnung

Die Standardzuordnung ist:

- Mira (`agent-manager`) → Codex-Abo
- Dev Agent (`agent-developer-1`) → Codex-Abo
- Dev Agent 2 (`agent-developer-2`) → Claude-Abo
- QA Bot (`agent-tester-1`) → Codex-Abo

Die Zuordnung kann im Board geändert werden. Die lokalen CLIs verwalten ihre Logins selbst; der Harness speichert keine Zugangsdaten.

## Statusmodell

Geplantes Modell:

`Inbox` → `Ready` → `In Progress` → `Review` → `Testing` → `Done`

Fehlerpfad:

`Testing` → `Changes Requested` → `In Progress`

Nach wiederholten Fehlern:

`Changes Requested` → `Blocked`

Im UI sind `Ready`, `In Progress`, `Review`, `Testing`, `Changes Requested`, `Blocked` und `Done` sichtbar.

## Phasen

### Phase 1 – Taskboard-Basis

- [x] lokales Vinext-Frontend
- [x] Board mit Statusspalten
- [x] Ticketanlage und Ticketdetails
- [x] Status, Priorität und Zuweisung
- [x] Kommentare am Ticket
- [x] SQLite-Datenbank und lokale API
- [x] Eventlog, AgentRuns und Leases
- [x] atomarer Ticket-Claim mit Kapazitätslimit
- [x] Migration der bestehenden SQLite-Datei für Agent-Provider

### Phase 2 – Hauptmanager

- [x] Manager-Cockpit und Chatfenster
- [x] persistenter Chatverlauf
- [x] Ticketanlage über den echten Manager-Chat
- [x] kontrolliertes Starten des nächsten Claims
- [x] Providerstatus für Codex und Claude
- [x] freie Managerfragen über lokalen CLI-Runner
- [x] strukturierte Manageraktionen mit kontrollierter Ausführung
- [ ] Streaming und laufender Chatstatus
- [ ] Freigabe-Gates für riskante Aktionen

### Phase 3 – Entwickler und Tester

- [x] Agenten mit eigener Provider-Zuordnung
- [x] manueller Codex-/Claude-Entwickler-Runner
- [x] parallele Entwicklerbasis über agent-id-basierte Claims
- [ ] gemeinsames Agent-Adapter-Interface
- [x] automatischer Start des Entwickler-Runners über den Workflow-Endpoint
- [x] Tester-Runner mit Read-only-Provider-Modus
- [x] strukturierte TestReport-Übernahme in SQLite
- [ ] Testberichte und Artefakte im UI
- [x] Heartbeats, laufende Lease-Verlängerung und Prozess-Recovery
- [x] robuste, begrenzte Retry- und Timeout-Logik

### Phase 4 – Board-Integration

- [ ] lokaler MCP-Server
- [x] Codex-/Claude-Tools zum Lesen, Kommentieren und Statusändern vorbereiten
- [x] eingeschränkte Agentenberechtigungen für MCP-Statuswechsel vorbereiten
- [ ] Git-Diff, Logs und Screenshots als Artefakte
- [ ] Testerübergabe inklusive Akzeptanzkriterien

### Phase 5 – Stabilität und Betrieb

- [ ] Evals für Manager-, Entwickler- und Tester-Verhalten
- [ ] Kosten-/Nutzungsübersicht der jeweiligen Abos
- [ ] mehrere Projekte und Workspace-Auswahl
- [ ] Live-Updates per SSE oder WebSocket
- [ ] optionaler Zugriffsschutz für Netzwerkbetrieb
- [ ] Backup-/Restore-Konzept für SQLite

## Sicherheits- und Betriebsregeln

- API-Keys bleiben für den Abo-Modus leer.
- Der Harness fragt niemals Provider-Login-Daten ab.
- Agenten dürfen nur im ausdrücklich gewählten Workspace arbeiten.
- Tester ändern keinen Produktivcode.
- Destruktive, externe oder produktive Aktionen brauchen später eine Freigabe.
- Ein Ticket darf nur eine aktive Lease besitzen.
- Kein Ticket wird ohne Ergebnis oder Blockade stillschweigend als erledigt markiert.
- Der lokale API-Service ist aktuell ohne Authentifizierung und nicht für öffentliche Erreichbarkeit gedacht.

## Nächster sinnvoller Meilenstein

Die minimale automatische Orchestrierung ist vorhanden: Der Workflow startet den Entwicklerprozess, ein erfolgreicher Entwicklerlauf startet den Tester, und der Tester setzt das Ticket auf `Done` oder `Changes Requested`. Der nächste große Ausbau ist die Manager-Orchestrierung mit Projektanalyse, Rückfragen, Planvorschau, Batch-Tickets, Abhängigkeiten und verknüpften Folgeaufgaben. Der damalige Zielplan steht im [archivierten Manager-Orchestrierungsplan](./MANAGER-ORCHESTRATION-PLAN-2026-08-13.md).
