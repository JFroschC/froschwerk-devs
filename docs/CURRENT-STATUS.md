# Aktueller Stand

Stand: 14. August 2026

Dieses Dokument ist die zentrale Quelle für den verifizierten Ist-Zustand des
Froschwerk Agent Harness. Zukunftsarbeit gehört in [ROADMAP.md](./ROADMAP.md);
historische Entwürfe und Audits liegen unter [archive/](./archive/README.md).

## Verifizierter Ausgangspunkt

- Git-Baseline: Initial-Commit `cb176550bc70463e44c75c950af04467db312f46`
  vom 14.08.2026
- Node.js: `>=22.13.0`
- `npm.cmd test`: Typecheck, Build erfolgreich, 54 von 54 Tests bestanden
- `npm.cmd run lint`: erfolgreich
- `npm.cmd run typecheck`: erfolgreich
- die Dokumentationskonsolidierung dieses Stands ist nach dem Initial-Commit entstanden
  und bis zu einem neuen Commit als Arbeitsänderung sichtbar

Der normale `npm.cmd test`-Lauf enthält den vollständigen TypeScript-Check vor Build
und Node-Test-Suite.

## Implementiert

### Projekt und Board

- mehrere lokale Projekte mit eigenem Workspace, Board und Mira-Chat
- Tickets mit Status, Priorität, Akzeptanzkriterien, Parent-/Child-Beziehungen,
  Abhängigkeiten und Planreihenfolge
- Kommentare, Task-Events und atomare Ticket-Claims
- Projektanlage, -bearbeitung, -auswahl und -archivierung

### Manager-Orchestrierung

Die ehemaligen Manager-Phasen A bis D sind weitgehend umgesetzt:

- validiertes Antwortschema v2
- persistente Gespräche, Rückfragen und Antworten
- begrenzte Read-only-Projektanalyse mit Secret- und Größenfiltern
- Planvorschau mit Bearbeiten, Entfernen und Bestätigen
- atomare Anlage mehrerer Tickets einschließlich Abhängigkeiten
- Planfortschritt und verknüpfte Folgeaufgaben
- kontrollierte Übergabe an Entwickler und Tester

Der automatische Ablauf unterstützt Abhängigkeiten, arbeitet aber derzeit bewusst
sequenziell. Ein aktiver Run blockiert den Start eines weiteren automatischen Runs.

### Entwickler, Tester und Lifecycle-Basis

- Codex- und Claude-Runner mit lokalen Abo-Logins
- AgentRuns und AgentRequests mit Provider-, Modell-, Dauer- und Usage-Daten
- Leases mit standardmäßig 120 Sekunden TTL
- Lease-Erneuerung alle 30 Sekunden durch Entwickler und Tester
- Idle- und Gesamttimeouts
- begrenzte Entwickler-Retries und Tester-Recovery
- Erkennung verwaister Runs beim Start und bei Workflow-/Boardzugriffen
- Windows-Prozessbaum-Abbruch
- vollständiges Projekt-Testgate vor `Review`
- zentrale Tester-Suite mit TestReport und Folgeaufgaben bei Produktfehlern

Die vorhandene Lease-Erneuerung ist eine technische Heartbeat-Basis, aber noch kein
vollständiges Lifecycle-Management. Es fehlen insbesondere explizite
Heartbeat-/Aktivitätszeitpunkte, ein dauerhafter Supervisor und klar getrennte Zustände
für Start, Abbruch, Timeout und verlorene Prozesse.

### Oberfläche

- Board, Ticketdetail, Projekte, Chat und Providerwahl
- Entwickler- und Testerstart für ein ausgewähltes Ticket
- Abbruch eines ausgewählten aktiven Runs
- Request-/Tokenübersicht
- automatischer Abgleich mit SQLite alle zwei Sekunden
- knappe Anzeige des aktuellen Runs beziehungsweise letzten Testergebnisses

Noch nicht vorhanden sind eine Agenten-Detailseite, vollständige Run-Historie,
Lease-/Heartbeat-Anzeige, Run-Logs, Testchecks und eine echte Artefaktansicht.

### MCP

Der Tool-Vertrag und die lokalen DB-Funktionen zum Lesen, Kommentieren, eingeschränkten
Statuswechsel und Auflisten von Runs existieren. Ein ausführbarer MCP-Server-Adapter
ist noch nicht implementiert.

## Bekannte technische Probleme

Die Prio-0-Integritätslücken sind geschlossen: gespeicherte Provider bleiben bei
Migrationen erhalten, Runtime- und Drizzle-Schema enthalten dieselben Tabellen und
Felder, und Start-/Finish-Grenzen prüfen Rolle, aktiven Run und Folgestatus. Der
direkte `--task`-Modus erfordert einen passenden aktiven `--run-id`; ein Testerprozess
prüft ebenfalls seine Bindung an den aktiven Tester-Run.

1. **Agentenstatus:** `agents.status` ist derzeit überwiegend Konfiguration und wird
   nicht zuverlässig aus aktiven Runs abgeleitet.
2. **Artefakte:** Die Tabelle existiert, aber es gibt noch keinen Schreib-/Lese-Service
   und keine UI. Die lokale Datenbank enthielt beim letzten Audit null Artefakte.

Die verbleibende priorisierte Arbeit steht in [ROADMAP.md](./ROADMAP.md).

## Operativer Boardzustand

Die [Übergabe vom 13.08.2026](./UEBERGABE-2026-08-13.md) ist noch relevant:

- Projekt `FroschwerkBusinessTool`
- Autoprozess deaktiviert
- keine aktiven Runs beim letzten Abgleich
- `FBT-477-A56D – Echter Datei-Upload` weiterhin in `Review`

Vor einer erneuten Aktivierung des Autoprozesses müssen die dort beschriebenen
Testannahmen und Cleanup-Pfade korrigiert und die vollständige Produktsuite erneut
ausgeführt werden.

## Bewusste Betriebsgrenzen

- Die API ist lokal, nicht authentifiziert und nur für `127.0.0.1` vorgesehen.
- Provider-Zugangsdaten werden nicht gespeichert.
- Für den Abo-Betrieb bleiben `OPENAI_API_KEY` und `ANTHROPIC_API_KEY` leer.
- Automatische Parallelisierung über mehrere Entwickler ist noch nicht implementiert.
- Parallele Produktänderungen besitzen noch keine Worktree-Isolation.
- Backup/Restore, Evals, Streaming und Zugriffsschutz sind offen.
