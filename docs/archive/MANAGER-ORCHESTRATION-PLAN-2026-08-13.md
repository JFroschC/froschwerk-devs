# Archiv: Manager-Orchestrierung und Projektplanung

> Historischer Entwurf und Umsetzungsplan vom 13.08.2026. Die Phasen A bis D sind
> weitgehend umgesetzt. Offene Arbeit wurde in [ROADMAP.md](../ROADMAP.md) konsolidiert.

Stand: 13. August 2026

## Zielbild

Mira ist die zentrale Projektmanagerin des Harness. Sie kann ein aktives Projekt analysieren, Anforderungen verstehen, fehlende Informationen erfragen, einen umsetzbaren Plan erzeugen, mehrere Tickets inklusive Folgeaufgaben anlegen und danach den normalen Entwickler-/Tester-Workflow steuern.

Das Board bleibt die verbindliche Wahrheit. Mira schlägt Aktionen vor; die Harness-Anwendung validiert, bestätigt und führt sie aus. Kein Agent darf ungeprüft direkt die Datenbank oder den Workflow manipulieren.

## Beispiel: Projektstart mit komplexem Ticket

Ein Ticket wie „Projektvorbereitung und Grundstruktur planen“ ist nicht zwingend eine einzelne Entwicklungsaufgabe. Mira soll es als Planungs- oder Epic-Ticket erkennen und in konkrete Arbeit zerlegen:

1. Projektanforderungen und Nutzerrollen dokumentieren.
2. Datenmodell und zentrale Beziehungen definieren.
3. Technische Projektstruktur und Architekturentscheidung dokumentieren.
4. Offene Fragen und Risiken klären.
5. Umsetzungsreihenfolge und Abhängigkeiten festlegen.
6. Konkrete Entwickler-Tickets mit Akzeptanzkriterien erstellen.
7. Nach jedem Ergebnis bei Bedarf Folge-Tickets für Fehler, offene Kriterien oder neue Erkenntnisse anlegen.

Mira darf dabei nicht behaupten, dass die Vorbereitung erledigt ist, solange die erzeugten Teilaufgaben nicht bearbeitet und getestet wurden. Das ursprüngliche Ticket bleibt bis zur Erfüllung seiner Kriterien offen oder wird als Planungs-Epic mit Fortschritt geführt.

## Manager-Antwortprotokoll

Die bisherige einzelne `action` wird zu einem versionierten Antwortobjekt erweitert:

```json
{
  "schemaVersion": 2,
  "reply": "Ich habe das Projekt analysiert und einen Plan vorbereitet.",
  "mode": "analysis|planning|execution|status",
  "questions": [
    {
      "id": "user-roles",
      "question": "Soll es mehrere Benutzerrollen geben?",
      "options": ["Ja", "Nein", "Noch offen"],
      "required": true
    }
  ],
  "actions": [
    {
      "type": "create_tasks",
      "requiresConfirmation": true,
      "tasks": [
        {
          "clientId": "plan-1",
          "title": "Datenmodell definieren",
          "description": "...",
          "priority": "high",
          "acceptance": ["..."],
          "parentTaskId": "optional",
          "dependsOnClientIds": []
        }
      ]
    }
  ],
  "assumptions": [],
  "risks": [],
  "summary": "..."
}
```

Unterstützte Aktionsgruppen:

- `analyze_project`: Read-only-Analyse des aktiven Workspaces.
- `create_tasks`: mehrere Tickets in einem validierten Batch anlegen.
- `update_tasks`: bestehende Ticketentwürfe nach Nutzerfreigabe ändern.
- `create_follow_up_tasks`: Folgeaufgaben aus Ergebnis, Blockade oder Testergebnis erzeugen.
- `set_dependencies`: Abhängigkeiten und Reihenfolge festlegen.
- `start_task` / `start_next` / `start_tester`: kontrollierte Workflow-Aktionen.
- `comment_task`: nachvollziehbare Rückmeldung am Ticket speichern.
- `none`: reine Antwort ohne Änderung.

Die Anwendung führt keine Aktion aus, wenn die Aktion ungültige Ticket-IDs, zyklische Abhängigkeiten, einen falschen Projektbezug oder fehlende Pflichtfelder enthält.

## Frage-/Antwort-Workflow

Wenn Mira für eine sinnvolle Planung Informationen benötigt, antwortet sie mit `questions` und dem Status `needs_input`. Die Anwendung speichert Konversations-ID und Projekt-ID, offene Fragen, Mira-Antwort, Nutzerantwort, Zeitpunkt und Gesprächsstatus.

Die UI zeigt Fragen als Antwortkarten und erlaubt zusätzlich Freitext. Nach der Antwort wird die Planung mit demselben Gesprächszustand fortgesetzt. Eine offene Frage darf nicht durch einen neuen Chat-Request verloren gehen.

## Projektanalyse

Die Analyse arbeitet ausschließlich im Workspace des aktiven Projekts und zunächst read-only. Sie sammelt einen begrenzten, nachvollziehbaren Kontext:

- Projektart, Beschreibung und hinterlegte Befehle
- Dateibaum mit Ausschlüssen für `.git`, `node_modules`, Build- und Secret-Dateien
- zentrale Konfigurationsdateien wie `package.json`, README und Testkonfiguration
- vorhandene Testbefehle und deren letzter bekannter Status
- Git-Status, sofern ein Repository vorhanden ist
- bestehende Tickets, Runs, Blockaden und Projektrisiken

Die Analyseergebnisse werden als Projekt-Snapshot mit Zeitstempel gespeichert. Große Dateien und vollständige Chat-Historien werden nicht ungegrenzt an Mira gesendet. Ältere Gespräche werden zu einer Projektsummary verdichtet; Request-, Token- und Laufzeitdaten bleiben separat nachvollziehbar.

## Batch-Tickets, Epics und Folgeaufgaben

Für mehrere erzeugte Tickets benötigt die Datenbasis:

- stabile Batch-/Plan-ID
- optionales Parent- oder Epic-Ticket
- `parentTaskId` für Teilaufgaben
- Ticket-Abhängigkeiten mit Zyklusprüfung
- Herkunft (`createdBy: manager`, Plan-ID und auslösendes Gespräch)
- Reihenfolge und Priorität
- Änderungs- und Bestätigungsstatus

Der Batch wird in der UI als Vorschau angezeigt. Jedes Ticket kann vor der Freigabe bearbeitet oder entfernt werden. Die Anlage erfolgt atomar: Entweder werden alle gültigen Tickets angelegt oder keines. Nach der Anlage schreibt Mira eine Zusammenfassung in den Projektchat.

Folgeaufgaben entstehen nur aus einem klaren Anlass, zum Beispiel:

- Testergebnis `Changes Requested`
- reproduzierbarer Fehler
- blockierte Abhängigkeit
- nicht erfülltes Akzeptanzkriterium
- neue Anforderung aus einer beantworteten Rückfrage

Automatisch erzeugte Folgeaufgaben erhalten einen Verweis auf Ursprungs-Ticket, Run und Testergebnis. Wiederholte identische Folgeaufgaben werden über eine Herkunfts-ID verhindert.

## Ausführungsmodell

Der Zielablauf lautet:

`Analyse` → `Rückfragen` → `Planvorschau` → `Freigabe` → `Tickets anlegen` → `Abhängigkeiten prüfen` → `Entwickler` → `Tester` → `Ergebnis` → `Folgeaufgabe oder nächstes Ticket`

Mira kann nach einem bestandenen Ticket automatisch fortfahren, wenn der Nutzer den Autoprozess aktiviert hat. Bei Fehlern, Blockaden, neuen Anforderungen oder riskanten Aktionen pausiert der Ablauf und schreibt eine verständliche Rückmeldung in den Projektchat.

Mehrere Entwickler bleiben möglich: Das Claim-/Lease-System entscheidet anhand von Abhängigkeiten, Kapazität und Agentenzuordnung, welche Tickets parallel bearbeitet werden dürfen. Tickets derselben Abhängigkeitskette bleiben sequenziell.

## UI-Umfang

### Chat

- aktive Projektbindung sichtbar
- Analyse- und Planungsaktionen
- automatische Scrollposition nur bei neuen Nachrichten, manuelles Scrollen bleibt möglich
- Fragekarten und Freitextantwort
- Aktionsvorschau mit Bearbeiten, Bestätigen und Verwerfen
- Fortschritt laufender Manageraktionen
- Abbrechen, Wiederholen und Fehlerdetails
- Chat-Historie und komprimierte Projektsummary

### Board und Ticketdetail

- Plan-/Epic-Kennzeichnung
- Parent-/Child-Tickets und Abhängigkeiten
- Fortschritt eines Plans
- Folgeaufgaben und Herkunft anzeigen
- Testergebnis, Logs und Agentenläufe am Ticket
- blockierte Kriterien und offene Fragen sichtbar

### Projekte

- Projektanalyse starten
- Projektplan anzeigen
- aktive Planläufe und offene Rückfragen
- Fortschritt über Tickets, Runs und Testergebnisse
- eigener Chat und eigenes Board je Projekt

## Sicherheit und Kostenkontrolle

- Mira erhält nur den Kontext des aktiven Projekts.
- Dateizugriff der Analyse ist read-only und auf den Workspace begrenzt.
- Batch-Anlage, Workflow-Starts und destruktive Aktionen laufen über validierte Harness-APIs.
- Riskante Aktionen benötigen eine Bestätigung oder eine ausdrücklich aktivierte Automatik.
- Jede Provider-Anfrage erhält Projekt-, Rollen-, Run- und Request-ID.
- Prompt, Antwort, geschätzte/exakte Tokens, Dauer, Status und Fehler werden erfasst.
- Lange Planungen nutzen Zusammenfassungen und Kontextgrenzen, damit nicht unnötig viele Abo-Tokens verbraucht werden.
- Provider-Logins bleiben in den lokalen Codex-/Claude-CLIs; der Harness speichert keine Zugangsdaten.

## Umsetzungsphasen

### Phase A – Manager-Protokoll und Gesprächszustand

- [x] Antwortschema v2 mit `actions`, `questions`, `mode` und `schemaVersion`
- [x] Managerantwort serverseitig validieren und fehlerhafte Antworten sicher ablehnen
- [x] Gesprächsstatus `open`, `needs_input`, `awaiting_confirmation`, `completed`, `failed`
- [x] offene Fragen und Nutzerantworten persistent speichern
- [x] alte Einzelaktion kompatibel weiterverarbeiten

### Phase B – Analyse und Kontext

- [x] Read-only-Projektanalyse als eigener Service
- [x] Dateiausschlüsse, Secret-Schutz und Kontextlimits
- [x] Projekt-Snapshot mit Ergebnis und Zeitstempel
- [x] Analyse-Button und Analyseergebnis im Chat/Projektbereich
- [x] Request- und Tokenverbrauch der Analyse sichtbar machen

### Phase C – Planung und Batch-Anlage

- [x] Plan-/Batch-Modell in SQLite
- [x] Parent-/Child-Tickets und Herkunft speichern
- [x] mehrere Ticketentwürfe in einer Managerantwort
- [x] Vorschau, Bearbeiten, Entfernen und Bestätigen
- [x] atomare Batch-Anlage mit Duplikat- und Validierungsprüfung
- [x] automatische Abhängigkeiten und Reihenfolge

Die Reihenfolge eines Plans wird explizit über `sequence` (10, 20, 30 …) angegeben. Die JSON-Reihenfolge allein ist keine Ablaufgarantie. Fachliche Voraussetzungen werden zusätzlich mit `dependsOnClientIds` beschrieben; gleiche sequence ist nur für bewusst parallele Aufgaben vorgesehen.

### Phase D – Abarbeitung komplexer Pläne

- [x] Planfortschritt aus Teilaufgaben berechnen
- [x] Entwickler und Tester über normale AgentRuns abarbeiten
- [x] automatisches Weitergehen bei Erfolg
- [x] Changes Requested, Blocked und Folgeaufgaben korrekt behandeln
- [x] Rückmeldung jedes Übergangs im Projektchat
- [x] parallele unabhängige Teilaufgaben zulassen

### Phase E – Betriebsoberfläche

- [ ] Agentenliste und Agent-Detailseite
- [ ] AgentRun-Liste mit `queued`, `running`, `succeeded`, `failed`, `blocked`
- [ ] Run-Logs und CLI-Ausgabe am Ticket
- [ ] Start-, Stop- und Retry-Buttons mit Bestätigung
- [ ] Lease-Ablauf und Heartbeat sichtbar
- [ ] Testergebnis mit Pass/Fail/Blocked, Checks und Reproduktionsschritten
- [ ] Diff, Logs und Screenshots als projektspezifische Artefakte
- [ ] Live-Updates ohne manuellen Reload

### Phase F – Qualität und Wiederverwendung

- [ ] Manager-Evals für Analyse, Rückfragen und Ticketzerlegung
- [ ] Workflow-Evals für Folgeaufgaben und Abhängigkeiten
- [x] Wiederherstellung nach Server-/CLI-Abbruch
- [ ] SQLite-Backup und Restore
- [ ] vollständige Projektdokumentation für zukünftige Harness-Projekte

## Abnahmekriterien für den ersten nutzbaren Meilenstein

Der Meilenstein ist erreicht, wenn der Nutzer in einem aktiven Projekt schreiben kann:

> Analysiere das Projekt, frage mich bei Unklarheiten und erstelle danach einen umsetzbaren Plan.

Dann muss das System:

1. ausschließlich den aktiven Workspace und das aktive Board verwenden,
2. bei fehlenden Angaben eine persistente Frage stellen,
3. mehrere Ticketentwürfe mit Akzeptanzkriterien und Abhängigkeiten erzeugen,
4. eine bearbeitbare Freigabevorschau zeigen,
5. die bestätigten Tickets korrekt im Projektboard anlegen,
6. sie über Entwickler und Tester abarbeiten können,
7. bei Fehlern oder neuen Erkenntnissen Folgeaufgaben verknüpft anlegen,
8. den gesamten Ablauf im Chat, Auditlog und Request-Tracking nachvollziehbar darstellen.
