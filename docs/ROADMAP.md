# Roadmap

Stand: 15. August 2026

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

Abnahme:

- Build, Tests, Lint und Typecheck sind grün.
- Providerwechsel bleiben nach einem Neustart erhalten.
- Runtime- und Drizzle-Schema beschreiben dieselben Tabellen und Felder.
- Kein Runner kann ein Ticket außerhalb eines gültigen aktiven Runs bearbeiten.

Verifiziert mit `npm.cmd run lint` und `npm.cmd test`: Typecheck, Produktions-Build
und 56 Node-Tests sind erfolgreich.

## Priorität 1 – Agent Lifecycle v2

### Zustandsmodell

- [x] verbindliche Run-Zustände definieren:
  `queued`, `starting`, `running`, `cancelling`, `succeeded`, `failed`,
  `timed_out`, `cancelled` und `lost`
- [x] erlaubte Übergänge zentral validieren
- [x] technische Ursache getrennt vom fachlichen Ticketstatus speichern
- [x] `exitCode`, `signal`, `terminationReason` und relevante Zeitpunkte erfassen

### Heartbeat und Aktivität

- [x] `lastHeartbeatAt`, `lastActivityAt`, aktuelle Phase und optionalen Fortschritt
  am Run speichern
- [x] fehlgeschlagene Lease-Erneuerung im Runner behandeln
- [x] Agentenstatus aus aktiven Runs ableiten
- [x] konfiguriertes `enabled/disabled` von Laufzeitstatus trennen

Die bestehende Lease-Erneuerung alle 30 Sekunden bleibt Grundlage und wird nicht neu
erfunden.

Schritt 1 abgeschlossen am 14. August 2026. Die zentrale Kapselung und Übergabe für
weitere Agenten steht in [AGENT-LIFECYCLE.md](./AGENT-LIFECYCLE.md). Die folgenden
beiden Abschnitte bilden Schritt 2; erst danach ist Prio 1 vollständig abgenommen.

### Supervisor und Recovery

- [x] periodischen, idempotenten Lifecycle-Sweeper einführen
- [x] Lease-Ablauf, fehlenden Prozess, Output-Inaktivität und Serverneustart getrennt
  klassifizieren
- [x] vor Freigabe eines stale Tickets einen noch lebenden Prozess beenden
- [x] PID beziehungsweise Prozessidentität gegen Wiederverwendung absichern
- [x] Manager-Requests in dieselbe beobachtbare Lifecycle-Systematik einordnen

### Stop und Retry

- [x] Abbruch zunächst persistent als `cancelling` markieren
- [x] Runner kooperativ beenden und erst nach bestätigtem Prozessende freigeben
- [x] anschließend begrenzt auf erzwungenen Prozessbaum-Abbruch eskalieren
- [x] Retry immer als neuen Run anlegen; vorherigen Run unverändert als Auditspur behalten
- [x] Benutzerabbruch nicht auf technische Recovery-Grenzen anrechnen

Abnahme:

- [x] Jeder aktive Run besitzt einen aktuellen, sichtbaren Heartbeat.
- [x] Abbruch, Timeout, Prozessverlust und fachlicher Fehler sind eindeutig unterscheidbar.
- [x] Kein Ticket wird erneut gestartet, solange der alte Prozess noch schreiben kann.
- [x] Recovery ist nach Neustarts und bei wiederholter Ausführung idempotent.

Prio 1 abgeschlossen am 14. August 2026. Der Supervisor läuft im API-Server
standardmäßig alle zehn Sekunden (`AGENT_LIFECYCLE_SWEEP_MS`). Er unterscheidet
Lease-Ablauf, Start- und Output-Inaktivität, fehlenden Prozess, Server-Neustart
und PID-Wiederverwendung. Bei unbekannter alter Prozessidentität bleibt ein Run
sicher in `cancelling` und fordert manuelle Klärung an, statt ein möglicherweise
schreibendes Ticket freizugeben.

## Priorität 2 – Agenten-, Run- und Manager-Aktionssteuerung

Prio 2 baut auf dem abgeschlossenen Lifecycle aus Prio 1 auf. Die Oberfläche darf
Lifecycle-Daten nur anzeigen und Aktionen über die zentralen APIs auslösen; sie darf
keine Zustandsübergänge oder Retry-Entscheidungen selbst ableiten. Polling bleibt
zunächst der Synchronisationsmechanismus. SSE/WebSocket wird erst bei nachweislichem
Betriebsbedarf bewertet.

### Schritt 1 – Lauf- und Agenten-Transparenz

Ziel: Ein laufender oder beendeter AgentRun ist ohne Terminal verständlich und mit
seinen Requests, Testergebnissen und Ereignissen nachvollziehbar.

- [x] vorhandene `/api/agent-runs`-Route in den regelmäßigen UI-Sync aufnehmen
- [x] Agentenübersicht und Agenten-Detailseite erstellen
- [x] Run-Historie mit Zustand, Rolle, Provider, Modell, Versuch und Dauer anzeigen
- [x] PID, Prozessidentität, Lease-Ablauf, letzten Heartbeat und letzte Aktivität
  sichtbar machen
- [x] aktuelle Phase, Fortschritt, technische Beendigungsursache, Exit-Code und Signal
  verständlich darstellen
- [x] Request-Ausgabe, Zusammenfassung, Fehler und Testchecks am zugehörigen Run
  anzeigen
- [x] Aktivitätsansicht für Task-Events und Run-Übergänge ergänzen
- [x] leere, fehlende oder historisch unvollständige Daten nachvollziehbar kennzeichnen,
  statt einen laufenden Zustand vorzutäuschen

Abnahme Schritt 1:

- [x] Ein Entwickler- oder Tester-Run lässt sich vom Start bis zum Abschluss ohne Terminal
  nachvollziehen.
- [x] Der Nutzer erkennt innerhalb der Oberfläche, ob ein Agent startet, arbeitet,
  auf kooperative Beendigung wartet, hängt, verloren ging oder beendet wurde.
- [x] Die sichtbaren Werte entsprechen den in Prio 1 gespeicherten Lifecycle-Daten; das
  UI erzeugt keine eigene Zustandslogik.

Schritt 1 abgeschlossen am 14. August 2026. Die UI synchronisiert Runs und
Task-Events weiterhin per Polling. Run-Details werden ausschließlich lesend aus den
persistierten Lifecycle-, Lease-, Request-, Testreport- und Eventdaten zusammengesetzt.

### Schritt 2 – Sichere Run-Aktionen und Auditspur

Ziel: Start, Stop und Retry sind verständlich bedienbar, bestätigen ihre Wirkung und
erhalten die Integritätsregeln aus Prio 1 auch bei mehrfachen Klicks oder veralteter
Oberfläche.

- [x] Start, Stop und Retry mit verständlicher, zustandsabhängiger Bestätigung anbieten
- [x] beim Stop den Zwischenzustand `cancelling`, den Grund und die laufende
  Stop-Eskalation sichtbar halten; das Ticket darf bis zum Terminalzustand nicht als
  erneut startbar erscheinen
- [x] Retry ausschließlich über einen neuen Run auslösen; vorherigen Run, Requests,
  Logs, Testergebnis und Beendigungsursache unverändert als Auditspur behalten
- [x] UI-Aktionen gegen veraltete oder bereits terminale Runs serverseitig eindeutig
  ablehnen und die Oberfläche anschließend synchronisieren
- [x] jede Benutzeraktion, Bestätigung, Ablehnung und resultierende Transition in der
  Aktivitätsansicht nachvollziehbar machen
- [x] Fehlermeldungen für fehlende Berechtigung, Prozessschutz, Retry-Grenze und
  nicht erfüllte Ticketvoraussetzungen verständlich anzeigen

Abnahme Schritt 2:

- Stop und Retry erzeugen eine vollständige Auditspur.
- Kein Bedienablauf kann einen neuen Run starten, solange der alte Prozess noch
  schreiben kann.
- Nach Reload, doppeltem Klick oder paralleler UI-Synchronisierung bleibt genau ein
  kanonischer Run-Zustand sichtbar.

Schritt 2 abgeschlossen am 15. August 2026. Start, Stop und Retry laufen über
serverseitig validierte Aktionsendpunkte. Vor der Ausführung wird die Entscheidung
bestätigt oder abgelehnt und als Task-Event persistiert; Erfolg, Ablehnung und die
bereits zentral gespeicherten Lifecycle-Transitionen bleiben in der Aktivitätsansicht
sichtbar. Retry referenziert einen terminalen Vorgänger, erzeugt ausschließlich einen
neuen Run und kann weder einen noch schreibenden Prozess umgehen noch überschreiben.

### Schritt 3 – Sichtbare und steuerbare Manager-Aktionen

Ziel: Manager-Analysen, Planungen und bestätigte Aktionen erhalten dieselbe
nachvollziehbare Bedienung wie AgentRuns – einschließlich sicherem Abbruch und
eindeutigem Wiederholungsversuch.

- [x] Manager-Analysen, Planungen und Aktionen mit einem persistenten Laufstatus
  versehen und mit Chat, Plan, Request und Audit-Events verknüpfen
- [x] Fortschritt laufender Manager-Aktionen sowie verständliche Fehlerdetails anzeigen
- [x] Manager-Aktionen sicher abbrechen und fehlgeschlagene Aktionen gezielt als neuen
  Versuch wiederholen können
- [x] bei Abbruch verhindern, dass ein teilweise ausgeführter Aktionsbatch unbemerkt
  zurückbleibt; bereits ausgeführte und noch ausstehende Teilaktionen müssen eindeutig
  getrennt dokumentiert sein
- [x] Bestätigungsgrenze, Eingabeparameter, erzeugte Plan-/Ticketreferenzen und
  Ergebnis jedes Manager-Versuchs persistent verknüpfen
- [x] Wiederholung nie am bestehenden Versuch fortschreiben, sondern als neuen,
  verknüpften Versuch mit unveränderter Auditspur anlegen

Abnahme Schritt 3 und Prio 2:

- Auch Manager-Aktionen sind vom Start bis zum Ergebnis sichtbar, abbrechbar und
  eindeutig einem neuen Wiederholungsversuch zuzuordnen.
- Ein abgebrochener oder fehlerhafter Aktionsbatch lässt keine unklaren Teiländerungen
  zurück.
- Alle sichtbaren Run-, Request- und Managerzustände werden weiterhin per Polling
  konsistent aktualisiert.

Schritt 3 und damit Prio 2 abgeschlossen am 15. August 2026. Manager-Analysen,
Planungen und bestätigte Plan-Ausführungen erhalten jeweils einen persistenten
Manager-Versuch. Dieser verknüpft Eingabe, Bestätigungsgrenze, Provider-Request,
Analyse-Snapshot, Plan, Ergebnis, Fehler und Audit-Events. Ein Provider-Prompt kann
gezielt abgebrochen werden. Der atomare Ticketbatch wird nie teilweise geschrieben;
trifft ein Abbruch nach dessen Abschluss ein, dokumentiert der Versuch die schon
ausgeführten und die nicht mehr gestarteten Teilaktionen getrennt. Retry erzeugt
immer einen neuen, mit dem Vorgänger verknüpften Versuch.

## Priorität 3 – Freigabe-Gates und Agent-Adapter

### Freigabe-Gates

- [ ] Aktionen in Risikoklassen einteilen, mindestens `read_only`, `workspace_write`,
  `process_control`, `destructive`, `external` und `production`
- [ ] Freigaben serverseitig erzwingen; eine reine Bestätigung im Frontend reicht nicht
- [ ] ausstehende Freigaben mit Projekt, Aktion, Parametern, anfragender Rolle,
  Freigebendem, Zeitstempel und Status persistent speichern
- [ ] geänderte Aktionsparameter oder Pläne lassen eine bestehende Freigabe verfallen
- [ ] projektbezogene, widerrufbare Automatikregeln nur für ausdrücklich erlaubte
  Aktionsklassen vorsehen
- [ ] Ablehnung, Ablauf und Ausführung vollständig im Auditlog dokumentieren

### Gemeinsames Agent-Adapter-Interface

Ein Agent-Adapter ist die interne, providerneutrale Grenze zwischen Harness und lokaler
CLI. Manager, Entwickler und Tester beschreiben weiterhin ihre jeweilige fachliche
Aufgabe. Der Adapter kapselt dagegen die technischen Unterschiede von Codex und Claude,
damit Lifecycle, Abbruch und Ergebnisauswertung nicht in jedem Runner anders umgesetzt
werden.

- [ ] gemeinsamen Vertrag für Start, Aktivitätsmeldung, Ausgabe, Abbruch, Prozessende,
  normalisiertes Ergebnis und Usage-Daten definieren
- [ ] Codex- und Claude-spezifische Argumente, Umgebungsvariablen und Output-Parser in
  getrennten Provider-Adaptern kapseln
- [ ] Manager-, Entwickler- und Tester-Runner schrittweise auf denselben Adapter und
  dieselben Lifecycle-Regeln umstellen
- [ ] rollenbezogene Prompts, Berechtigungen und Ergebnisformate außerhalb des
  Provider-Adapters getrennt halten
- [ ] Vertrags- und Fehlerszenarien für beide Provider testen, bevor alte Runnerpfade
  entfernt werden

Abnahme:

- Keine riskante Aktion kann allein durch Umgehung der Oberfläche ausgeführt werden.
- Jede Freigabe ist eindeutig, zeitlich und inhaltlich an genau eine Aktion gebunden.
- Codex und Claude liefern für alle Rollen dieselben normalisierten Lifecycle-Ereignisse.
- Ein neuer Provider benötigt einen neuen Adapter, aber keine Kopie aller drei Runner.

## Priorität 4 – Artefakte und Qualität

- [ ] Services und API für die vorhandene `artifacts`-Tabelle implementieren
- [ ] Diffs, Logs und Screenshots projekt- und runbezogen speichern
- [ ] vollständige Testergebnisse mit Checks und Reproduktionsschritten anzeigen
- [ ] Evals für Managerplanung, Folgeaufgaben und Workflowentscheidungen erstellen
- [ ] End-to-End-Tests für Start, Heartbeat, Cancel, Restart und Recovery ergänzen
- [ ] SQLite-Backup, Restore und versionierte Migrationen einführen

## Priorität 5 – Sichere Parallelisierung

Erst nach dem Lifecycle-Meilenstein:

- [ ] freie Entwickler anhand von Kapazität und Provider auswählen
- [ ] mehrere unabhängige Tickets automatisch starten
- [ ] pro parallelem Run einen isolierten Git-Worktree beziehungsweise Workspace nutzen
- [ ] Konflikt-, Merge- und Cleanup-Regeln definieren
- [ ] Autoprozess für parallele Pläne erweitern

Die Datenbasis erlaubt bereits mehrere manuelle Claims. Der automatische Scheduler
wartet derzeit jedoch bei jedem aktiven Run und startet ausschließlich den
Standardentwickler.

## Priorität 6 – Integration und Betrieb

- [ ] optionalen Zugriffsschutz für Netzwerkbetrieb entwerfen
- [ ] Live-Streaming nur bei echtem Betriebsbedarf ergänzen
- [ ] Betriebs- und Restore-Dokumentation vervollständigen

## Priorität 7 – Board-, Ticket- und Mira-UI vervollständigen

### Papier-Redesign und Mira-Rechtsleiste

- [x] schwebendes, resizebares Mira-Fenster durch eine feste rechte Spalte ersetzen
- [x] gespeicherte Chat-/Plan-Größen und Resize-Interaktion ersatzlos entfernen
- [x] Ticketdetail und Mira-Chat als gegenseitig ausschließliche rechte Ansicht führen
- [x] Board, Aktivität, Läufe und Run-Detail im Papier-Design konsistent darstellen
- [x] Agentenstatus, Konfiguration, Auftrag, Rechte und Laufhistorie auf eine eigene
  Agentenansicht verlagern

Abgeschlossen am 15. August 2026. Die ausgearbeiteten Design-Referenzen bleiben unter
[`change_package/`](./change_package/README.md) als Dokumentation; die produktive
Umsetzung liegt in `app/page.tsx`, `app/globals.css` und `app/layout.tsx`.

### Allgemeine UI-Funktionen

- [ ] Suche über Tickets, Kommentare, Agenten und Runs implementieren
- [ ] Boardfilter nach Status, Priorität, Agent, Provider und Projekt ergänzen
- [ ] Benachrichtigungen für Fehler, Blockaden, Testergebnisse und abgeschlossene Runs
  anzeigen
- [x] Ticketdetail zuverlässig schließen und die Auswahl zurücksetzen
- [x] funktionslose Spaltenmenüs entfernen
- [ ] Ticket-Abhängigkeiten im Detail anzeigen und bearbeiten
- [ ] eigene Kommentare bearbeiten und löschen können

Abnahme:

- Mira bleibt ohne Größenverwaltung als feste, responsive rechte Ansicht bedienbar und
  kann jederzeit zum Ticketdetail zurückwechseln.
- Alle sichtbaren Bedienelemente besitzen eine nachvollziehbare Funktion oder werden
  nicht angezeigt.
- Tickets und relevante Laufereignisse lassen sich ohne manuelles Durchsuchen aller
  Spalten auffinden und eingrenzen.

## Nicht Teil des nächsten Meilensteins

- öffentliche Bereitstellung der nicht authentifizierten lokalen API
- unbeaufsichtigte produktive oder destruktive Aktionen
- parallele Agentenarbeit ohne Workspace-Isolation
- neue Manager-Planungsfunktionen vor Behebung der Lifecycle-Integritätslücken
