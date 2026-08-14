# Archiv: UI-Funktionalitätsaudit vom 12.08.2026

> Historischer Auditstand vor der Umsetzung von Runnerstart, Heartbeats, Recovery,
> Autoprozess und Manager-Orchestrierung. Nicht als aktuellen Funktionsstand verwenden.
> Siehe [CURRENT-STATUS.md](../CURRENT-STATUS.md) und [ROADMAP.md](../ROADMAP.md).

Stand: 12. August 2026

## Kurzfazit

Das Board kann bereits Tickets laden, auswählen, anlegen, kommentieren und den Status ändern. Viele Elemente sind aber noch reine Layout-Platzhalter. Die größte funktionale Lücke ist die Agentensteuerung: „Nächstes Ticket starten“ reserviert aktuell nur einen AgentRun/Lease; der eigentliche CLI-Prozess wird noch nicht aus der Website heraus gestartet und überwacht.

Die Prüfung basiert auf der laufenden HTML-Ausgabe, den UI-Handlern in `app/page.tsx` und den vorhandenen lokalen API-Routen. Der In-App-Browser konnte den lokalen Host in dieser Prüfumgebung nicht erreichen; die lokale Site selbst antwortet auf `http://localhost:3000`.

## Funktioniert bereits

- Board mit Statusspalten
- Ticketkarte auswählen und Detailansicht aktualisieren
- Neues Ticket über „Neues Ticket“ oder „Ticket hinzufügen“ anlegen
- Ticketstatus im Detail ändern
- Kommentar am ausgewählten Ticket speichern
- Chatnachrichten persistent speichern
- Einfache Chataktion zum Ticketanlegen
- Chataktion „Nächste Aufgabe“ reserviert den nächsten Claim
- Providerstatus aktualisieren
- Provider pro Agent im Board ändern
- Chatvorschläge senden direkt eine Manageranfrage
- Freie Managerfragen an den lokalen CLI-Provider senden

## Sichtbare Elemente ohne Funktion

| UI-Element | Aktueller Zustand | Benötigte Umsetzung | Priorität |
| --- | --- | --- | --- |
| Navigation „Agenten“ | kein Click-Handler, keine Ansicht | Agentenübersicht mit Runs, Provider, Status und Kapazität | P1 |
| Navigation „Aktivität“ | kein Click-Handler, keine Ansicht | globale Event-/Run-Timeline | P1 |
| Suche | kein Click-Handler | Tickets, Kommentare, Runs und Agenten durchsuchen | P2 |
| Benachrichtigungen | kein Click-Handler | Fehler, Blockaden, Testergebnisse und abgeschlossene Runs anzeigen | P2 |
| „Mit Mira chatten“ | kein Click-Handler | Chatpanel fokussieren/öffnen | P1 |
| „Filtern“ | kein Click-Handler | Filter nach Status, Priorität, Agent, Provider und Projekt | P1 |
| Spaltenmenü `•••` | kein Click-Handler | Spalte sortieren, Status konfigurieren oder Tickets filtern | P2 |
| Detail-Header `×` | kein Click-Handler | Detailpanel schließen bzw. Auswahl zurücksetzen | P2 |
| Chat-Header `•••` | kein Click-Handler | Chat löschen/exportieren, Provider anzeigen, Run starten | P2 |
| Zuständigkeit im Ticketdetail | nur Textanzeige | Agent auswählbar machen und API-Zuweisung verwenden | P1 |
| Priorität im Ticketdetail | nur Badge | Priorität bearbeiten und speichern | P1 |
| Akzeptanzkriterien | nur Anzeige | Kriterien hinzufügen, bearbeiten, abhaken und sortieren | P1 |
| Kommentarbereich | Speichern funktioniert | Bearbeiten, löschen, Markdown/Links und Agentenkommentare | P2 |
| Ticketkarte Kommentarzähler | nicht klickbar | direkt zum Kommentarbereich springen | P2 |
| Manager-Statuskarte | statischer Text | echten AgentRun-/Providerstatus anzeigen | P1 |
| Agentenstatus | Statusanzeige vorhanden | Start, Pause, Stop, Retry und Run-Details | P0 |

## Funktionen mit nur teilweiser Umsetzung

### Nächstes Ticket starten

Die UI ruft `POST /api/workflow/next` auf. Das reserviert ein Ticket atomar, erzeugt eine Lease und startet im lokalen API-Service den passenden Entwicklerprozess. Es fehlen aber noch:

- keinen sichtbaren Live-Runstatus
- keinen Heartbeat
- keine automatische Übergabe an den Tester
- keine strukturierte Ergebnisübernahme

### Mira-Chat

Chatten mit Mira ist über den echten Manager-Runner möglich. Mira erhält den aktuellen Board-Kontext und liefert eine strukturierte Aktion; die Anwendung führt nur kontrollierte Aktionen aus:

- `create_task` → lokales Ticket anlegen
- `start_next` / `start_task` → Entwicklerlauf starten
- `start_tester` → Tester-Lauf starten
- `comment_task` → Manager-Kommentar speichern
- `none` → reine Chatantwort

Board, Ticketdetails, Chat und Agentenliste werden im geöffneten Browser automatisch alle zwei Sekunden aus SQLite synchronisiert. Nach einer Rückkehr zum Browser-Tab wird ebenfalls sofort synchronisiert. Neue Chatnachrichten scrollen automatisch ans Ende. Der gesamte Datenkontext ist an das aktive Projekt gebunden; ein Projektwechsel wechselt Board, Tickets und Mira-Chat gemeinsam.

### Ticketbearbeitung

Statusänderung und Kommentare funktionieren. Die API kann bereits mehr als das UI anbietet, unter anderem Priorität und Zuweisung. Diese Felder müssen noch als echte Formulare im Detailpanel ergänzt werden.

## Backend-Funktionen, die noch im UI fehlen

- Agentenliste und Agenten-Detailseite
- AgentRun-Liste mit queued/running/succeeded/failed
- Run-Logs und CLI-Ausgabe am Ticket
- Start-/Stop-/Retry-Buttons mit Bestätigung
- Lease-Ablauf und Heartbeat sichtbar machen
- Testergebnis mit Pass/Fail, Checks und Reproduktionsschritten
- Artefakte wie Diff, Log und Screenshot am Ticket
- Blockade-/Changes-Requested-Workflow
- Abhängigkeiten zwischen Tickets
- Projekte und Workspace-Auswahl
- Live-Updates ohne manuellen Reload

## Empfohlene Umsetzungsreihenfolge

### 1. UI-Platzhalter entfernen

- Navigation als echte Ansichten oder Tabs verdrahten
- Mira-Button fokussiert das Chatpanel
- Detailpanel schließen/öffnen
- Filterpanel mit echten Ticketfiltern
- Suche und Aktivitätsansicht

### 2. Ticketdetail vervollständigen

- Zuständiger Agent editierbar
- Priorität editierbar
- Akzeptanzkriterien CRUD
- Dependencies anzeigen und bearbeiten
- Kommentare bearbeiten/löschen

### 3. Agentensteuerung bauen

- Agentenübersicht
- Run-Detailseite
- Start/Stop/Retry
- sichtbarer Prozessstatus
- Logs und Fehler
- sichere Bestätigungen für Schreib- und Stop-Aktionen

### 4. Automatische Orchestrierung

- Mira claimt ein Ticket
- Harness startet den passenden Entwickler-Runner
- Runner meldet Ergebnis strukturiert zurück
- Manager übergibt an Tester
- Tester speichert TestReport
- Manager setzt `Done`, `Changes Requested` oder `Blocked`

### 5. Stabilität und Qualität

- Heartbeats und Timeouts
- Retry-Regeln
- SSE/WebSocket-Liveupdates
- E2E-Tests für die Hauptflows
- Backup/Restore der lokalen SQLite-Datenbank

## Konkrete nächste Tickets

1. `UI-001`: Navigation, Mira-Button und Detailpanel verdrahten
2. `UI-002`: Filter- und Suchpanel implementieren
3. `UI-003`: Ticketdetail um Priorität, Zuständigkeit und Akzeptanzkriterien erweitern
4. `AGENT-001`: Agentenübersicht mit Runstatus bauen
5. `AGENT-002`: Start-/Stop-/Retry-Steuerung an Runner anschließen
6. `FLOW-001`: Automatische Entwickler-zu-Tester-Orchestrierung
7. `QA-001`: Testergebnisse, Logs und Artefakte im Ticket anzeigen
