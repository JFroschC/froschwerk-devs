# Provider und Agentenzuordnung

Stand: 15. August 2026

Der Harness startet lokal installierte Codex- und Claude-Code-CLIs. Die Website fragt
keine Passwörter, OAuth-Tokens oder API-Keys ab. Authentifizierung und Abo-Nutzung
bleiben vollständig in den jeweiligen CLIs.

## Standardzuordnung

- Mira (`agent-manager`) → Codex
- Dev Agent (`agent-developer-1`) → Codex
- Dev Agent 2 (`agent-developer-2`) → Claude Code
- QA Bot (`agent-tester-1`) → Codex

Die Auswahl wird in `agents.provider` gespeichert und in der Agentenansicht geändert.
Die Seitenleiste zeigt nur Name, Kurzstatus und Verbindungsstatus.
`migrateAgents()` ergänzt Standardwerte nur für Datenbanken aus der Zeit vor der
Provider-Spalte oder für leere Werte; eine gespeicherte Auswahl bleibt nach einem
Neustart erhalten.

## Lokale Anmeldung

### OpenAI Codex

```powershell
codex.cmd --login
```

Im Browser `Sign in with ChatGPT` verwenden.

### Claude Code

```powershell
claude.exe
```

Danach `/login` ausführen und das Claude-Pro-/Max-Konto auswählen.

Das Setup für `FroschAgent` fragt nach dem Codex-Login optional nach einer
Claude-Einrichtung. Es installiert Claude Code bei Bedarf, startet die interaktive
Anmeldung und prüft danach `claude.exe auth status --json`. Bei der Anmeldung muss das
Pro-/Max-Abo gewählt werden, nicht „Claude Console“ (API-Abrechnung).

## Sicherheitsregeln

- `OPENAI_API_KEY` bleibt für den ChatGPT-Abo-Betrieb leer.
- `ANTHROPIC_API_KEY` bleibt für den Claude-Abo-Betrieb leer.
- Die App speichert keine Provider-Zugangsdaten.
- Child-Prozesse laufen nur im konfigurierten Projekt-Workspace.
- Git-Vertrauen wird ausschließlich im Child-Environment gesetzt.
- Die lokale API darf nicht öffentlich freigegeben werden.

Ein gesetzter API-Key wird durch die Laufzeitprüfungen erkannt und kann den
Abo-Betrieb blockieren.

## Aktuelle Rollen und Modelle

| Rolle | Codex-Standard | Override |
| --- | --- | --- |
| Manager | `gpt-5.6-luna` | `MANAGER_CODEX_MODEL` |
| Entwickler | `gpt-5.6-terra` | `DEVELOPER_CODEX_MODEL` |
| Tester | `gpt-5.6-luna` | `TESTER_CODEX_MODEL` |

Weitere Rollenoptionen:

- Manager-Reasoning: `MANAGER_CODEX_REASONING_EFFORT`
- Entwickler-Reasoning: `DEVELOPER_CODEX_REASONING_EFFORT`
- Tester-Reasoning: `TESTER_CODEX_REASONING_EFFORT`
- Entwickler-Service-Tier: `DEVELOPER_CODEX_SERVICE_TIER`
- Tester-Service-Tier: `TESTER_CODEX_SERVICE_TIER`
- Claude-Tester: standardmäßig `sonnet`, Override über `CLAUDE_TESTER_MODEL`

Es gibt keinen gemeinsamen `gpt-5.5`-/`CODEX_MODEL`-Standard mehr.

## Berechtigungsmodell

### Mira

Mira läuft mit Codex im Read-only-Sandboxmodus. Sie schlägt strukturierte Aktionen
vor; die Harness-Anwendung validiert, speichert und führt sie über kontrollierte APIs
aus.

### Entwickler

Der Entwickler arbeitet mit Schreibrechten im gewählten Workspace. Er bearbeitet ein
gültig reserviertes Ticket und durchläuft anschließend das vollständige
Projekt-Testgate.

### Tester

Der Tester darf Produktivcode laut Rollenregel nicht ändern, kann aber bei Bedarf
Testdateien stabilisieren. Technisch läuft Codex derzeit mit `workspace-write` und
Claude mit Edit-Rechten; die Einschränkung auf Testdateien wird durch Prompt und
Workflowregeln durchgesetzt, nicht durch einen echten Read-only-Dateisystemmodus.

Diese Grenze muss bei sicherheitskritischen Erweiterungen berücksichtigt werden.

## Status prüfen

```powershell
npm.cmd run providers:check
npm.cmd run harness:doctor
```

Die Provider-API und die Seitenleiste zeigen Installation, Version, Loginmethode,
Abo-Hinweis und API-Key-Erkennung. Geheimnisse werden nicht ausgegeben.

## Entwickler manuell starten

Der normale Weg führt über Board, Mira oder den Workflow-Endpoint. Für Diagnosezwecke:

```powershell
node --experimental-strip-types scripts/run-agent.mjs --agent agent-developer-1
node --experimental-strip-types scripts/run-agent.mjs --agent agent-developer-2
```

Ein manueller `--provider`-Override ist möglich. Der direkte `--task`-Modus verlangt
einen gültigen aktiven `--run-id`, dessen Agent, Rolle und Ticket exakt passen.

## Request-Tracking

Jede Manager-, Entwickler-, Tester- und zentrale Testanfrage wird als
`agent_request` gespeichert. Erfasst werden unter anderem:

- Projekt, Ticket, Run, Agent und Rolle
- Provider und Modell
- Start, Ende und Dauer
- geschätzte beziehungsweise gemeldete Tokens
- Prompt-/Antwortvorschau und Fehler

Die UI zeigt eine kompakte Request- und Tokenübersicht. Die Agentenansicht und der
Run-Detail-Drawer stellen die vollständigen Request-, Event- und Testdaten dar.
