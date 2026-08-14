# Agent Lifecycle Contract

Stand: 14. August 2026

`db/agent-lifecycle.ts` ist die verbindliche, providerneutrale Kapselung des
Run-Lifecycles. Neue Runner, Provider-Adapter und der spätere Supervisor dürfen
Run-Zustände weder frei setzen noch eigene Listen aktiver Zustände pflegen.

## Zustände und Übergänge

`queued` → `starting` → `running` → terminal

Terminal sind `succeeded`, `failed`, `timed_out`, `cancelled` und `lost`.
Ein Abbruch führt zunächst nach `cancelling`. Der Runner beendet seinen Provider
kooperativ; erst nach bestätigtem Prozessende wird `cancelled` persistiert. Direkte
Übergänge sind ausschließlich über `assertAgentRunTransition` zulässig.

## Persistente Beobachtungsdaten

Jeder Run speichert zusätzlich zu Einreichung, Start und Ende:

- `lastHeartbeatAt` – erfolgreiche Lease-Erneuerung des besitzenden Runners;
- `lastActivityAt`, `currentPhase`, `progress` – beobachtbare Arbeit;
- `exitCode`, `signal`, `terminationReason` – technische Beendigung, getrennt
  vom fachlichen Ticketstatus;
- `cancellationRequestedAt` – persistierter Beginn des Stop-Handshakes;
- `processIdentity` – PID plus Prozessstartzeit gegen PID-Wiederverwendung.

Runner rufen `reportAgentRunActivity` bei Start, Provider-Ausgabe und
Projekt-Testphasen auf. `renewAgentRunLease` aktualisiert den Heartbeat. Gibt
eine Lease-Erneuerung `renewed: false` zurück, verliert der Runner die
Schreibberechtigung, beendet seinen Kindprozess und darf den Run nicht mehr
abschließen oder das Ticket weiterbewegen.

## Agentenstatus

`agents.enabled` ist Konfiguration. Der zurückgegebene `runtimeStatus` wird
aus aktiven Runs abgeleitet (`queued`, `starting`, `busy`, `cancelling`,
`idle` oder `disabled`) und darf nicht als Konfiguration persistiert werden.
Der bisherige `agents.status` bleibt nur als Kompatibilitätsfeld erhalten.

## Supervisor und Recovery

Der API-Server startet einen idempotenten Supervisor mit standardmäßig zehn Sekunden
Intervall. Er unterscheidet Lease-Ablauf, Start-/Output-Inaktivität, fehlenden Prozess,
Serverneustart und PID-Wiederverwendung. Vor der Freigabe wird der Abbruch angefordert;
nach `AGENT_CANCEL_GRACE_MS` eskaliert er auf einen validierten Prozessbaum-Abbruch.
Eine nicht verifizierbare alte PID bleibt sicher in `cancelling`: Sie wird weder
beendet noch wird ihr Ticket erneut gestartet.

Benutzerabbrüche enden mit `cancelled` und verbrauchen keine technische
Recovery-Grenze. Lease- und Prozessverluste enden mit `lost`; fachliche Fehler mit
`failed`. Wiederholtes Sweepen ist idempotent.

## Zuständigkeiten

- `db/local.ts`: atomare Persistenz, Transitionen und Reporting-Funktionen.
- `scripts/workflow-orchestrator.mjs`: Startzustand, registrierte PID,
  Supervisor und Stop-Eskalation.
- `scripts/run-agent.mjs`, `scripts/run-tester.mjs`: melden `running`,
  Aktivität und Heartbeats.
- `scripts/process-identity.mjs`: sichere Prozessprüfung anhand von PID und
  Startzeit auf Windows und Unix.
