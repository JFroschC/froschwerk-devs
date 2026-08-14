# Harness – aktueller Status

Stand: 13. August 2026

## Manager-Orchestrierung (Phase A–D)

Die Phasen A bis D aus `MANAGER-ORCHESTRATION-PLAN.md` sind implementiert.

- Mira verwendet ein serverseitig validiertes Antwortschema v2 mit Modus, Rückfragen, Annahmen, Risiken und mehreren Aktionen.
- Gesprächszustände, Fragen, Antworten und Manager-Entscheidungen werden projektgebunden persistent gespeichert.
- Die Read-only-Projektanalyse erstellt begrenzte Snapshots des aktiven Workspaces. Secret-Dateien, große Dateien und ausgeschlossene Verzeichnisse gelangen nicht in den Manager-Kontext.
- Ticketpläne werden als bearbeitbare Vorschau gespeichert. Bestätigungen legen alle Tickets, Parent-/Child-Beziehungen und Abhängigkeiten atomar an oder gar nicht.
- Zyklische, projektfremde oder unvollständige Vorschläge werden vor der Ausführung abgelehnt.
- Planfortschritt wird aus den erzeugten Teilaufgaben berechnet.
- Entwickler und Tester arbeiten die bestätigten Tickets über die normalen AgentRuns ab.
- Beim Aktivieren oder Serverneustart übernimmt der Autoprozess sofort wartende `Review`- oder `Ready`-Tickets und arbeitet sie sequenziell ab.
- Entwickler- und Testerprozesse erneuern Leases. Verwaiste Runs werden wiederhergestellt; Retries, Tester-Recoveries und verschachtelte Folgefehler sind begrenzt.
- Der getrennte Windows-Benutzer erhält pro Child-Prozess ein isoliertes Git-`safe.directory`, ein konsistentes Benutzerprofil und einen verpflichtenden Laufzeitcheck.
- Bei `Changes Requested` oder `Blocked` wird eine verknüpfte Folgeaufgabe als neuer, bestätigungspflichtiger Plan vorbereitet.

## Bedienung

1. Im aktiven Projekt `Projekt analysieren` wählen oder Mira schreiben: `Analysiere dieses Projekt und erstelle anschließend einen umsetzbaren Plan.`
2. Offene Rückfragen in den Karten im Mira-Panel beantworten.
3. Ticketentwürfe bei Bedarf bearbeiten oder entfernen.
4. Den Plan bestätigen. Erst dann werden Tickets und Abhängigkeiten angelegt.
5. Den Autoprozess im Mira-Panel aktivieren. Er startet beziehungsweise übernimmt sofort die nächste wartende Aufgabe.

## Validierung

`npm.cmd test` führt Build und die vollständige Node-Testsuite aus. Sie deckt Manager-Schema, Gesprächszustand, Batch-Anlage, Abhängigkeitszyklen, Folgeaufgaben, Secret-sichere Analyse, Runner-Syntax, Leases, Recovery, Retry-Grenzen, Auto-Auswahl sowie isolierte Entwickler-/Tester-Smoke-Flows ab. `npm.cmd run lint` ist ebenfalls fehlerfrei.

## Nächste offene Phasen

Aus Phase E und F bleiben vor allem Run-Detailansichten, Artefakte, Evals sowie Backup/Restore offen. Heartbeats, Prozess-Recovery und die für den Autoprozess nötige Wiederaufnahme sind implementiert.
