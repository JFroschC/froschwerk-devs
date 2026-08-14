# Froschwerk Agent Harness

Lokales Multi-Agent-Taskboard für einen Manager, mehrere Entwickler und Tester.

## Was ist bereits vorhanden?

- lokales Board mit Tickets, Status, Priorität und Detailansicht
- Kommentare und persistenter Manager-Chat
- SQLite als autoritative Datenquelle
- Agenten mit Rollen, Kapazitätslimit und Provider-Zuordnung
- Codex- und Claude-Code-Loginstatus in der Oberfläche
- lokaler Mira-Runner über das vorhandene ChatGPT-/Codex- oder Claude-Abo
- atomare Ticket-Claims, AgentRuns, Leases und Task-Events
- robuster Entwickler- und Tester-Runner für Codex und Claude mit Heartbeats, Recovery und begrenzten Retries
- sequenzieller Autoprozess, der `Review` vor `Ready` übernimmt und nach einem Harness-Neustart fortsetzt
- isoliertes Git-Vertrauen für Workspaces, die einem anderen Windows-Benutzer gehören
- vorbereiteter MCP-Tool-Vertrag für Ticket lesen, kommentieren und eingeschränkte Statuswechsel

## Was ist noch nicht fertig?

Die Kette „Mira → Entwickler → Tester → nächstes Ticket“ ist lokal verdrahtet und gegen Prozessabbrüche abgesichert. Noch offen sind vor allem Run-Detailansichten, Artefakte, Live-Streaming und Backup/Restore; sie blockieren die automatische Abarbeitung nicht.

## Starten

Voraussetzung: Node.js `>=22.13.0`.

Unter Windows wird der getrennte Benutzer `FroschAgent` empfohlen:

1. Einmal `setup-froschwerk-agent.bat` starten, Codex installieren/anmelden und den Laufzeitcheck erfolgreich abschließen.
2. Danach den Harness immer über `start-froschwerk-agent.bat` starten.
3. Im Board beim gewünschten Projekt den Autoprozess mit „aktivieren und starten“ einschalten.

Der Start führt `harness:doctor` aus und bricht mit einer konkreten Diagnose ab, wenn Datenbank, Workspace, Git, Provider-Login oder Profilverzeichnisse nicht funktionieren. `HOME`, `USERPROFILE` und `CODEX_HOME` werden auf das Profil von `FroschAgent` vereinheitlicht. Git erhält `safe.directory` ausschließlich in der Umgebung des jeweiligen Child-Prozesses; die globale Git-Konfiguration wird nicht verändert.

```powershell
npm.cmd install
npm.cmd run dev
```

Danach:

- Frontend: `http://localhost:3000`
- lokale API: `http://127.0.0.1:3001`

## Autoprozess

Beim Aktivieren startet der Harness sofort das nächste wartende Ticket. Die Reihenfolge ist:

`Review → Tester → Done → nächstes Ready → Entwickler → Review`

Laufende Prozesse erneuern ihre Lease alle 30 Sekunden. Nach einem Abbruch werden Entwicklerläufe begrenzt erneut versucht und Testerlauf-Recoveries ebenfalls begrenzt. Wiederholte Tester-Fehler erzeugen höchstens drei Folgefehlerstufen; danach wird das Ticket nachvollziehbar blockiert, statt endlos weiterzulaufen. Beim Neustart erkennt der API-Prozess verwaiste Runs und setzt aktivierte Autoprozesse fort.

Manueller Laufzeitcheck:

```powershell
npm.cmd run harness:doctor
```

## Provider prüfen

```powershell
npm.cmd run providers:check
```

Die App verwendet die lokalen Logins der CLIs. Für Codex muss `OPENAI_API_KEY` leer sein, für Claude `ANTHROPIC_API_KEY`. Die Logins werden nicht in diesem Repository gespeichert.

## Entwickler manuell starten

```powershell
node --experimental-strip-types scripts/run-agent.mjs --agent agent-developer-1
node --experimental-strip-types scripts/run-agent.mjs --agent agent-developer-2
```

Die Provider-Zuordnung kann im Board geändert werden. Details stehen in:

- [aktueller Entwicklungsplan](./docs/AGENT-HARNESS-PLAN.md)
- [Provider-Anbindung](./docs/PROVIDERS.md)
- [Agenten-Provider-Zuordnung](./docs/PROVIDER-ASSIGNMENT.md)
- [SQLite-Dokumentation](./docs/DATABASE.md)
- [MCP-Tool-Vertrag](./docs/MCP-TOOLS.md)
- [UI-Funktionalitätsaudit](./docs/UI-FUNCTIONALITY-AUDIT.md)

## Kontrollierte Codex-Schreibprobe

`start-froschwerk-agent.bat` fragt vor dem Harness-Start nach dem jeweiligen Projekt-Workspace und führt die Probe aus. Bei einem Fehlschlag startet der Harness nicht. Ein leerer Wert überspringt sie bewusst. Für einen nicht-interaktiven Start kann der Workspace über `FROSCH_AGENT_WRITE_PROBE_WORKSPACE` gesetzt werden. Die Probe verlangt explizit `FroschAgent` und startet Codex mit `--cd`, `--add-dir`, `--approve-for-me` und `--ignore-rules`. In Codex CLI 0.147 aktiviert `--approve-for-me` selbst den Workspace-Write-Modus und darf deshalb nicht zusätzlich mit `--sandbox` kombiniert werden. Lokales Regelwerk wird nicht zusätzlich angewandt. Die Probe lässt ausschließlich eine temporäre Prüfdokumentdatei ändern, prüft deren Inhalt nach Prozessende und entfernt sie danach wieder.

```powershell
npm.cmd run codex:verify-write -- --workspace "C:\Users\FroschiO\Froschwerk NEU\FroschwerkCRM-BusinessTool"
```

Die JSON-Ausgabe muss `ok: true`, `persistedBeforeCleanup: true` und `cleanedUp: true` enthalten. Eine fehlgeschlagene Probe lässt keine Produktänderung zurück.

## Checks

```powershell
npm.cmd run lint
npm.cmd test
npm.cmd run build
```

Die Tests prüfen zusätzlich die Syntax aller ausführbaren Harness-Skripte sowie isolierte Entwickler- und Tester-Runner-Smoke-Flows gegen temporäre SQLite-Datenbanken und eine lokale Fake-CLI.

## Sicherheitsgrenzen

Der lokale API-Service ist ohne Authentifizierung und nur für den lokalen Rechner vorgesehen. Destruktive, externe oder produktive Aktionen brauchen später explizite Freigaben. Die Datenbank liegt lokal unter `.data/harness.sqlite` und ist von Git ausgeschlossen.
