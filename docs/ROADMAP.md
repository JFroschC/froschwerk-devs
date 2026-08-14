# Roadmap

Stand: 14. August 2026

Diese Roadmap ersetzt die früheren Phasenpläne. Bereits umgesetzte Funktionen stehen
in [CURRENT-STATUS.md](./CURRENT-STATUS.md); historische Entwürfe bleiben unter
[archive/](./archive/README.md) erhalten.

## Ziel

Der Harness soll Agentenläufe zuverlässig starten, überwachen, abbrechen,
wiederherstellen und nachvollziehbar darstellen. Anschließend kann die vorhandene
Multi-Agent-Datenbasis sicher für parallele Arbeit genutzt werden.

## Priorität 0 – Ausgangspunkt stabilisieren (abgeschlossen am 14. August 2026)

Diese Punkte werden vor neuen Lifecycle-Funktionen erledigt:

- [x] gespeicherte Provider-Zuordnungen bei Datenbankmigrationen erhalten
- [x] Runtime-SQL und `db/schema.ts` vollständig synchronisieren
- [x] vorhandene 48 TypeScript-Fehler beheben
- [x] `typecheck` als npm-Skript ergänzen und in das Qualitätsgate aufnehmen
- [x] beschädigte UTF-8-Strings korrigieren
- [x] direkten `--task`-Runnerpfad ohne gültigen AgentRun verhindern
- [x] Finish-Endpunkte auf Rolle, aktuellen Runstatus und erlaubten Folgestatus prüfen
- [x] Testerstart zusätzlich an den aktiven Run des Tickets binden
- [x] MCP-Ticketpräfix projektunabhängig machen

Abnahme:

- Build, Tests, Lint und Typecheck sind grün.
- Providerwechsel bleiben nach einem Neustart erhalten.
- Runtime- und Drizzle-Schema beschreiben dieselben Tabellen und Felder.
- Kein Runner kann ein Ticket außerhalb eines gültigen aktiven Runs bearbeiten.

Verifiziert mit `npm.cmd run lint` und `npm.cmd test`: Typecheck, Produktions-Build
und 54 Node-Tests sind erfolgreich.

## Priorität 1 – Agent Lifecycle v2

### Zustandsmodell

- [ ] verbindliche Run-Zustände definieren, zum Beispiel
  `queued`, `starting`, `running`, `cancelling`, `succeeded`, `failed`,
  `timed_out`, `cancelled` und `lost`
- [ ] erlaubte Übergänge zentral validieren
- [ ] technische Ursache getrennt vom fachlichen Ticketstatus speichern
- [ ] `exitCode`, `signal`, `terminationReason` und relevante Zeitpunkte erfassen

### Heartbeat und Aktivität

- [ ] `lastHeartbeatAt`, `lastActivityAt`, aktuelle Phase und optionalen Fortschritt
  am Run speichern
- [ ] fehlgeschlagene Lease-Erneuerung im Runner behandeln
- [ ] Agentenstatus aus aktiven Runs ableiten
- [ ] konfiguriertes `enabled/disabled` von Laufzeitstatus trennen

Die bestehende Lease-Erneuerung alle 30 Sekunden bleibt Grundlage und wird nicht neu
erfunden.

### Supervisor und Recovery

- [ ] periodischen, idempotenten Lifecycle-Sweeper einführen
- [ ] Lease-Ablauf, fehlenden Prozess, Output-Inaktivität und Serverneustart getrennt
  klassifizieren
- [ ] vor Freigabe eines stale Tickets einen noch lebenden Prozess beenden
- [ ] PID beziehungsweise Prozessidentität gegen Wiederverwendung absichern
- [ ] Manager-Requests in dieselbe beobachtbare Lifecycle-Systematik einordnen

### Stop und Retry

- [ ] Abbruch zunächst persistent als `cancelling` markieren
- [ ] Runner kooperativ beenden und erst nach bestätigtem Prozessende freigeben
- [ ] anschließend begrenzt auf erzwungenen Prozessbaum-Abbruch eskalieren
- [ ] Retry immer als neuen Run anlegen; vorherigen Run unverändert als Auditspur behalten
- [ ] Benutzerabbruch nicht auf technische Recovery-Grenzen anrechnen

Abnahme:

- Jeder aktive Run besitzt einen aktuellen, sichtbaren Heartbeat.
- Abbruch, Timeout, Prozessverlust und fachlicher Fehler sind eindeutig unterscheidbar.
- Kein Ticket wird erneut gestartet, solange der alte Prozess noch schreiben kann.
- Recovery ist nach Neustarts und bei wiederholter Ausführung idempotent.

## Priorität 2 – Agenten- und Run-Oberfläche

- [ ] vorhandene `/api/agent-runs`-Route in den regelmäßigen UI-Sync aufnehmen
- [ ] Agentenübersicht und Agenten-Detailseite erstellen
- [ ] Run-Historie mit Zustand, Rolle, Provider, Modell, Versuch und Dauer anzeigen
- [ ] PID, Lease-Ablauf, letzten Heartbeat und letzte Aktivität sichtbar machen
- [ ] Request-Ausgabe, Zusammenfassung, Fehler und Testchecks anzeigen
- [ ] Start, Stop und Retry mit verständlicher Bestätigung anbieten
- [ ] Aktivitätsansicht für Task-Events und Run-Übergänge ergänzen
- [ ] Polling zunächst weiterverwenden; SSE/WebSocket erst bei erkennbarem Bedarf ergänzen

Abnahme:

- Ein Run lässt sich vom Start bis zum Abschluss ohne Terminal nachvollziehen.
- Der Nutzer erkennt innerhalb der Oberfläche, ob ein Agent arbeitet, wartet, hängt
  oder beendet wurde.
- Stop und Retry erzeugen eine vollständige Auditspur.

## Priorität 3 – Artefakte und Qualität

- [ ] Services und API für die vorhandene `artifacts`-Tabelle implementieren
- [ ] Diffs, Logs und Screenshots projekt- und runbezogen speichern
- [ ] vollständige Testergebnisse mit Checks und Reproduktionsschritten anzeigen
- [ ] Evals für Managerplanung, Folgeaufgaben und Workflowentscheidungen erstellen
- [ ] End-to-End-Tests für Start, Heartbeat, Cancel, Restart und Recovery ergänzen
- [ ] SQLite-Backup, Restore und versionierte Migrationen einführen

## Priorität 4 – Sichere Parallelisierung

Erst nach dem Lifecycle-Meilenstein:

- [ ] freie Entwickler anhand von Kapazität und Provider auswählen
- [ ] mehrere unabhängige Tickets automatisch starten
- [ ] pro parallelem Run einen isolierten Git-Worktree beziehungsweise Workspace nutzen
- [ ] Konflikt-, Merge- und Cleanup-Regeln definieren
- [ ] Autoprozess für parallele Pläne erweitern

Die Datenbasis erlaubt bereits mehrere manuelle Claims. Der automatische Scheduler
wartet derzeit jedoch bei jedem aktiven Run und startet ausschließlich den
Standardentwickler.

## Priorität 5 – Integration und Betrieb

- [ ] lokalen MCP-Server auf Basis des vorhandenen Tool-Vertrags implementieren
- [ ] MCP-Berechtigungen rollen- und projektbezogen validieren
- [ ] optionalen Zugriffsschutz für Netzwerkbetrieb entwerfen
- [ ] Live-Streaming nur bei echtem Betriebsbedarf ergänzen
- [ ] Betriebs- und Restore-Dokumentation vervollständigen

## Nicht Teil des nächsten Meilensteins

- öffentliche Bereitstellung der nicht authentifizierten lokalen API
- unbeaufsichtigte produktive oder destruktive Aktionen
- parallele Agentenarbeit ohne Workspace-Isolation
- neue Manager-Planungsfunktionen vor Behebung der Lifecycle-Integritätslücken
