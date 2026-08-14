# Archiv: Agenten und Provider-Zuordnung vom 12.08.2026

> Historischer Stand. Die gültigen Inhalte wurden in
> [PROVIDERS.md](../PROVIDERS.md) zusammengeführt.

Die Zuordnung wird in SQLite in `agents.provider` gespeichert und kann im Board pro Agent geändert werden.

## Standardzuordnung

- Mira (`agent-manager`) → Codex-Abo
- Dev Agent (`agent-developer-1`) → Codex-Abo
- Dev Agent 2 (`agent-developer-2`) → Claude-Abo
- QA Bot (`agent-tester-1`) → Codex-Abo

Jeder Agent hat zusätzlich eine eigene Rolle, einen Status und ein `max_concurrency`-Limit. Dadurch können später mehrere Entwickler gleichzeitig unterschiedliche Tickets bearbeiten.

## Wie die Auswahl verwendet wird

```powershell
node --experimental-strip-types scripts/run-agent.mjs --agent agent-developer-1
node --experimental-strip-types scripts/run-agent.mjs --agent agent-developer-2
```

Der Runner liest den Provider des Agenten aus SQLite. Ein bewusster manueller Override ist möglich:

```powershell
node --experimental-strip-types scripts/run-agent.mjs --agent agent-developer-1 --provider claude
```

Die Auswahl im Board ändert die persistierte Zuordnung per `PATCH /api/agents/:id`.

## Aktueller Ablauf

1. `POST /api/workflow/next` reserviert ein Ready-Ticket atomar, legt AgentRun sowie Lease an und startet den passenden Entwicklerprozess.
2. `scripts/run-agent.mjs --agent <agent-id>` arbeitet das Ticket in der passenden lokalen CLI ab.
3. Bei erfolgreichem Entwicklerabschluss wechselt das Ticket nach `Review`; der Runner ruft automatisch `POST /api/workflow/test` auf.
4. `scripts/run-tester.mjs` prüft das Ticket read-only und speichert einen TestReport.
5. Ein bestandenes Ergebnis setzt das Ticket auf `Done`, ein fehlgeschlagenes auf `Changes Requested`.
6. Mira beantwortet freie Chatfragen über `POST /api/chat/manager` mit ihrem ausgewählten Provider.
7. Ticketanlage, Ticketstart und Statusaktionen bleiben kontrollierte Harness-API-Aktionen.

Die minimale automatische Kette ist vorhanden. Noch offen sind Prozessüberwachung, Heartbeats, Abbruch/Retry über die UI, strukturierte Entwicklerzusammenfassungen und ein echter Manager-Toolvertrag.

## Lokale Konten

Die Website fragt keine Login-Daten ab. Codex und Claude Code verwenden ihre lokalen Sitzungen. `npm.cmd run providers:check` prüft Installation, Loginmethode und ob versehentlich ein API-Key gesetzt ist.

## Kompatibilität

Für den aktuell installierten Codex-CLI-Stand wird standardmäßig `gpt-5.5` verwendet. Das kann mit `CODEX_MODEL` überschrieben werden, sobald die CLI-Version ein anderes Modell unterstützt.
