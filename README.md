# Froschwerk Agent Harness

Lokales Multi-Agent-Taskboard für einen Manager, mehrere Entwickler und Tester. Der
Harness verwaltet Projekte, Tickets, Abhängigkeiten, Agentenläufe und Testergebnisse
in einer lokalen SQLite-Datenbank und startet Codex beziehungsweise Claude Code über
deren lokale Abo-Logins.

## Was ist vorhanden?

- Projektverwaltung mit getrennten Workspaces, Boards und Mira-Chats
- Ticketboard mit Status, Priorität, Akzeptanzkriterien, Kommentaren und Abhängigkeiten
- SQLite als autoritative Laufzeit-Datenquelle
- Manager-Orchestrierung mit Projektanalyse, Rückfragen, Planvorschau und atomarer
  Ticketanlage
- Entwickler- und Tester-Runner für Codex und Claude Code
- AgentRuns, AgentRequests, Leases, Task-Events und TestReports
- Lease-Erneuerung, Timeouts, begrenzte Retries und Recovery nach Prozessabbrüchen
- sequenzieller Autoprozess: `Review → Tester → Done → nächstes Ready → Entwickler → Review`
- vollständiges Projekt-Testgate vor der Übergabe eines Entwicklerlaufs an den Tester
- isoliertes Git-Vertrauen für Workspaces eines getrennten Windows-Benutzers
- vorbereiteter MCP-Tool-Vertrag; ein ausführbarer MCP-Server ist noch nicht enthalten

Der Manager- und Workflow-Kern ist nutzbar. Der nächste Ausbau ist nicht ein erster
Heartbeat, sondern ein vollständiges Agent-Lifecycle-Management mit klaren
Run-Zuständen, Supervisor, Run-Details und sicheren Stop-/Retry-Abläufen.

Den verifizierten Stand und bekannte Einschränkungen beschreibt
[CURRENT-STATUS.md](./docs/CURRENT-STATUS.md). Die priorisierten nächsten Schritte
stehen in [ROADMAP.md](./docs/ROADMAP.md).

## Voraussetzungen

- Windows für den vorgesehenen getrennten Agentenbetrieb
- Node.js `>=22.13.0`
- lokal installierte und angemeldete Codex- beziehungsweise Claude-Code-CLI
- keine API-Keys für den Abo-Betrieb

## Starten

Für den getrennten Benutzer `FroschAgent`:

1. Einmal `setup-froschwerk-agent.bat` ausführen.
2. Codex beziehungsweise Claude Code lokal anmelden.
3. Den Laufzeitcheck erfolgreich abschließen.
4. Danach den Harness über `start-froschwerk-agent.bat` starten.

Direkter Entwicklungsstart:

```powershell
npm.cmd install
npm.cmd run dev
```

Danach sind erreichbar:

- Frontend: `http://localhost:3000`
- lokale API: `http://127.0.0.1:3001`

Der Start führt `harness:doctor` aus. Er bricht mit einer Diagnose ab, wenn
Datenbank, Workspace, Git-Vertrauen, Provider-Login oder Profilverzeichnisse nicht
funktionieren. `HOME`, `USERPROFILE` und `CODEX_HOME` werden für Child-Prozesse
konsistent gesetzt. Git-`safe.directory` wird nur im jeweiligen Child-Environment
gesetzt; die globale Git-Konfiguration bleibt unverändert.

## Autoprozess

Der Autoprozess ist projektbezogen und standardmäßig deaktiviert. Beim Aktivieren
übernimmt er zunächst ein wartendes `Review`-Ticket, danach das nächste ausführbare
`Ready`-Ticket. Solange ein Run aktiv ist, startet er keinen weiteren automatischen
Run; der automatische Pfad ist damit derzeit bewusst sequenziell.

Entwickler und Tester verlängern ihre Lease alle 30 Sekunden. Die Standard-TTL beträgt
120 Sekunden. Abgelaufene Leases und verwaiste Prozesse werden begrenzt wiederhergestellt.
Das ist die vorhandene technische Heartbeat-Basis; eine sichtbare
`lastHeartbeatAt`-/Lifecycle-Historie fehlt noch.

## Provider prüfen

```powershell
npm.cmd run providers:check
```

Die App verwendet die lokalen CLI-Logins. Für den Abo-Betrieb müssen
`OPENAI_API_KEY` und `ANTHROPIC_API_KEY` leer sein. Zugangsdaten werden nicht in
diesem Repository gespeichert. Details stehen in [PROVIDERS.md](./docs/PROVIDERS.md).

## Laufzeit prüfen

```powershell
npm.cmd run harness:doctor
```

## Kontrollierte Codex-Schreibprobe

Die Schreibprobe prüft vor dem Harness-Start, ob der getrennte Benutzer im gewählten
Projekt-Workspace tatsächlich schreiben kann. Sie darf ausschließlich eine temporäre
Prüfdatei ändern und entfernt diese anschließend.

```powershell
npm.cmd run codex:verify-write -- --workspace "C:\Users\FroschiO\Froschwerk NEU\FroschwerkCRM-BusinessTool"
```

Die JSON-Ausgabe muss `ok: true`, `persistedBeforeCleanup: true` und
`cleanedUp: true` enthalten.

## Qualitätsprüfungen

```powershell
npm.cmd run lint
npm.cmd test
npm.cmd run build
```

`npm.cmd test` führt bereits den Produktions-Build und die vollständige
Node-Test-Suite aus. Ein separater TypeScript-Check ist momentan noch nicht Teil
dieses Gates; die bekannte Lücke ist in [CURRENT-STATUS.md](./docs/CURRENT-STATUS.md)
und [ROADMAP.md](./docs/ROADMAP.md) dokumentiert.

## Dokumentation

- [Aktueller Stand](./docs/CURRENT-STATUS.md)
- [Roadmap](./docs/ROADMAP.md)
- [SQLite und Datenmodell](./docs/DATABASE.md)
- [Provider und Agentenzuordnung](./docs/PROVIDERS.md)
- [MCP-Tool-Vertrag](./docs/MCP-TOOLS.md)
- [Operative Übergabe vom 13.08.2026](./docs/UEBERGABE-2026-08-13.md)
- [Historische Dokumente](./docs/archive/README.md)

## Sicherheitsgrenzen

- Die lokale API lauscht nur auf `127.0.0.1` und besitzt keine Authentifizierung.
- Der Harness ist nicht für eine öffentliche oder produktive Netzfreigabe vorgesehen.
- Agenten arbeiten ausschließlich im konfigurierten Projekt-Workspace.
- Destruktive, externe oder produktive Aktionen benötigen eine ausdrückliche Freigabe.
- Die Datenbank liegt unter `.data/harness.sqlite` und wird nicht in Git gespeichert.
