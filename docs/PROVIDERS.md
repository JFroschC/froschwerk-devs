# Provider-Verbindungen ohne eigene API-Key-Abrechnung

Der Harness startet die lokal installierten CLIs. Die Website erhält keine Passwörter, OAuth-Tokens oder API-Keys. Codex CLI und Claude Code verwalten ihre Login-Sitzungen selbst.

## OpenAI Codex mit ChatGPT-Abo

```powershell
codex.cmd --login
```

Im Browser **Sign in with ChatGPT** auswählen. Der Harness startet danach `codex exec` mit dieser lokalen Sitzung.

## Claude Code mit Claude Pro/Max

```powershell
claude.exe
```

Danach `/login` verwenden und das Claude-Pro-/Max-Konto auswählen. Nicht das Claude-Console-Konto verwenden.

Für diese Betriebsart darf `ANTHROPIC_API_KEY` nicht gesetzt sein. Ein gesetzter API-Key kann die Abo-Anmeldung übersteuern und zusätzliche API-Kosten verursachen. Usage Credits sollten in den Claude-Einstellungen deaktiviert bleiben, wenn ausschließlich die Plan-Nutzung verwendet werden soll.

## Sicherheitsregeln

- `OPENAI_API_KEY` und `ANTHROPIC_API_KEY` bleiben für den Abo-Modus leer.
- Die App fragt niemals Login-Daten ab.
- Die Provider-CLIs behalten ihre eigene Authentifizierung.
- Der Harness startet Prozesse nur im gewählten Workspace.
- Codex läuft beim Manager im Read-only-Modus.
- Der Entwickler-Runner verwendet den vom Agenten gewählten Schreib-/Berechtigungsmodus.
- Die lokale API ist nicht für öffentliche Erreichbarkeit gedacht.

## Status prüfen

```powershell
npm.cmd run providers:check
```

Oder über die App beziehungsweise:

```text
GET http://localhost:3000/api/providers
```

Der Status enthält Installation, Version, Loginmethode, Abo-Hinweis und eine API-Key-Erkennung. Es werden keine geheimen Token ausgegeben.

## Agenten starten

Der Provider wird normalerweise aus `agents.provider` gelesen:

```powershell
node --experimental-strip-types scripts/run-agent.mjs --agent agent-developer-1
node --experimental-strip-types scripts/run-agent.mjs --agent agent-developer-2
```

`agent-developer-1` verwendet standardmäßig Codex, `agent-developer-2` Claude. Ein expliziter Override ist möglich:

```powershell
node --experimental-strip-types scripts/run-agent.mjs --agent agent-developer-1 --provider claude
```

Ohne `--task` claimt der Runner das nächste Ready-Ticket für den angegebenen Agenten und beendet den angelegten AgentRun nach dem CLI-Prozess. Mit `--task` kann ein vorhandenes Ticket gezielt an die CLI übergeben werden; dieser direkte Modus ist aktuell noch nicht vollständig mit einem neuen AgentRun verknüpft.

## Mira-Chat

Freie Fragen werden über `POST /api/chat/manager` an den Provider weitergereicht, der bei `agent-manager` gespeichert ist. Dabei erhält Mira ausschließlich das aktive Projekt, dessen Workspace und dessen Board-Kontext sowie die letzten 20 Chatnachrichten dieses Projekts. Mira antwortet strukturiert mit einer vorgeschlagenen Aktion; die Harness-Anwendung führt nur freigegebene Aktionen wie `create_task`, `start_task`, `start_next`, `start_tester` oder `comment_task` lokal aus.

Für den aktuell installierten Codex-CLI-Stand wird standardmäßig `gpt-5.5` verwendet. Mit `CODEX_MODEL` kann das Modell nach einem CLI-Upgrade überschrieben werden.

## Offene Provider-Themen

- Prozessüberwachung und sichtbare Runsteuerung statt nur automatischem Start
- strukturierte Provider-Outputs statt reiner Textzusammenfassung
- Prozessabbruch, Heartbeats und Timeoutbehandlung
- Tester-Adapter mit eigenem Provider und Read-only-Regeln
- Nutzungs-/Kostenanzeige pro Agent und Provider

Weitere Zuordnungsdetails stehen in [PROVIDER-ASSIGNMENT.md](./PROVIDER-ASSIGNMENT.md).
