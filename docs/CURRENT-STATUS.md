# Aktueller Stand

Stand: 15. August 2026

Dieses Dokument beschreibt ausschließlich den verifizierten gegenwärtigen Stand des
Froschwerk Agent Harness. Geplante Arbeit steht in der [Roadmap](./ROADMAP.md),
historische Audits und Übergaben im [Archiv](./archive/README.md).

## Verifiziert

- Node.js `>=22.13.0`
- `npm.cmd test`: Typecheck, Produktions-Build und 59 von 59 Node-Tests erfolgreich
- `npm.cmd run lint` und `npm.cmd run typecheck`: erfolgreich
- bestehende SQLite-Datenbanken werden für die Lifecycle-Prozessidentität idempotent
  migriert

## Produkt- und Workflow-Funktionen

- Projekte besitzen eigene Workspaces, Boards und Mira-Chats.
- Tickets unterstützen Status, Priorität, Akzeptanzkriterien, Kommentare,
  Abhängigkeiten, Parent-/Child-Beziehungen und Planreihenfolge.
- Die Manager-Orchestrierung analysiert Projekte lesend, verarbeitet Rückfragen,
  erzeugt bestätigungspflichtige Pläne und legt Ticketbatches atomar an.
- Jeder Manager-Versuch (Analyse, Planung, bestätigte Plan-Ausführung) speichert
  Status, Phase, Eingabe, Bestätigung, verknüpften Provider-Request, Snapshot/Plan,
  Ergebnis, Fehler und eigene Audit-Events. Abbruch und Retry sind sichtbar; ein
  Retry ist immer ein neuer, mit dem Vorgänger verknüpfter Versuch.
- Entwickler- und Tester-Runner starten Codex oder Claude Code über lokale
  Abo-Logins. Der Autoprozess bleibt bewusst sequenziell und projektbezogen.

## Agenten-Lifecycle und Run-Steuerung

- AgentRuns verwenden die zentral validierten Zustände `queued`, `starting`,
  `running`, `cancelling`, `succeeded`, `failed`, `timed_out`, `cancelled` und
  `lost`.
- Leases, Heartbeats, Aktivität, Phase, Fortschritt, PID/Prozessidentität,
  technische Beendigungsdaten, Requests und Testergebnisse sind persistent.
- Der Lifecycle-Supervisor behandelt Lease-Ablauf, Inaktivität, fehlende Prozesse,
  Neustarts und PID-Wiederverwendung. Ein Ticket bleibt bei `cancelling` gesperrt,
  bis das Prozessende sicher bestätigt ist.
- Start, Stop und Retry verlangen in der UI eine Bestätigung und werden danach
  serverseitig gegen Ticketstatus, Rolle, aktive Runs, Kapazität und
  Retry-Voraussetzungen geprüft.
- Jeder Retry erhält einen neuen Run. Der terminale Vorgänger einschließlich Requests,
  Logs, Testergebnis und Beendigungsgrund bleibt unverändert erhalten.
- Bestätigung, Abbruch der Bestätigung, serverseitige Ablehnung und akzeptierte Aktion
  werden als `agent.action_*`-Events gespeichert; Lifecycle-Transitionen bleiben
  eigene kanonische Events.

Details: [Agent-Lifecycle-Vertrag](./AGENT-LIFECYCLE.md).

## Oberfläche

- Polling synchronisiert Board, Runs, Requests und Task-Events alle zwei Sekunden.
- Die Oberfläche verwendet ein warmes Papier-Design mit Instrument Serif für
  Überschriften und semantischen CSS-Tokens; die Design-Referenzen liegen unter
  [`change_package/`](./change_package/README.md).
- Mira ist eine feste rechte Spalte, die im Board das Ticketdetail ersetzt. Die früheren
  schwebenden Chat- und Resize-Panels samt gespeicherten Größen existieren nicht mehr.
- Agenten besitzen eine eigene Ansicht mit aktuellem Lauf, Anfrage-/Event-/Testreiter,
  Laufhistorie, Provider-Konfiguration, Auftrag, Rechten und Warteschlange.
- Projektbezogene Run-Historie, Aktivität und Run-Detail-Drawer zeigen Lifecycle-,
  Request-, Test- und Eventdaten ohne eigene UI-Zustandslogik.
- Leere oder historisch unvollständige Daten werden ausdrücklich gekennzeichnet.
- Die Aktivitätsansicht macht Run-Transitionen sowie Start-, Stop- und
  Retry-Entscheidungen nachvollziehbar.
- Der Mira-Bereich zeigt die jüngsten Manager-Versuche mit Phase, Fehlern,
  Verknüpfungen und ihren Cancel-/Retry-Aktionen. Polling aktualisiert diese Werte
  zusammen mit dem übrigen Workspace.
- Die Providerwahl liegt in der Agentenansicht; die Seitenleiste zeigt nur den
  Verbindungs- und Kurzstatus.

## Noch offen / bewusste Grenzen

- Die Artefakttabelle hat noch keinen Schreib-/Lese-Service und keine UI.
- Die API ist nur für `127.0.0.1` vorgesehen und nicht authentifiziert.
- Mehragenten-Parallelisierung, Worktree-Isolation, Backup/Restore, Evals und
  Streaming sind nicht implementiert.
- Provider-Zugangsdaten werden nicht gespeichert; für den Abo-Betrieb bleiben
  `OPENAI_API_KEY` und `ANTHROPIC_API_KEY` leer.
- Die Agentenseite ist derzeit eine clientseitige Workspace-Ansicht, keine eigene
  URL-Route pro Agent.
