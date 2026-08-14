# Übergabe Agent Harness – 13.08.2026

Stand der Prüfung: 13.08.2026, 18:10 Uhr (Europe/Berlin)

## Kurzfassung

Der Harness wurde heute an mehreren Stellen repariert. Der aktuelle Harness-Build und seine vollständige Testsuite sind grün: **50/50 Tests bestanden**.

Der zuletzt bearbeitete CRM-Task `FBT-477-A56D – Echter Datei-Upload` ist noch **nicht fachlich fertig geprüft**. Ein älterer QA-Test enthält eine durch die neue Funktion veraltete Annahme und räumt nach einer fehlgeschlagenen Assertion seinen HTTP-Server nicht auf. Dadurch hing der zentrale Testlauf ohne sichtbaren Abschluss.

Für zukünftige Entwicklerläufe existiert nun ein verbindliches vollständiges Projekt-Testgate: Ein Ticket gelangt nur noch nach einem erfolgreichen Gesamttest vom Entwickler auf `Review` und damit zum Tester.

## Aktueller Board- und Prozesszustand

Projekt: `FroschwerkBusinessTool`

- Workspace: `C:\Users\FroschiO\Froschwerk NEU\FroschwerkCRM-BusinessTool`
- Testbefehl: `npm test` beziehungsweise aufgelöst `node --test tests/**/*.test.js`
- Autoprozess: **deaktiviert**
- Aktive Runs in SQLite: **keine**
- Die zuvor verwaisten PIDs `16044`, `18904`, `4668` und `560` sind nicht mehr aktiv.

Relevante Tasks:

| Task | Titel | Status |
| --- | --- | --- |
| `FBT-477-A56D` | Echter Datei-Upload | `Review` |
| `FBT-743-6BBE` | Ansprechpartner nutzbar machen | `Done` |
| `FBT-320-C259` | Testergebnis zu FBT-743-6BBE beheben | `Done` |
| `FBT-374-42C7` | Testergebnis zu FBT-320-C259 beheben | `Done` |

Die Ansprechpartner-Kette ist damit vollständig abgeschlossen. Offen ist der Upload-Task.

## Morgen als Erstes

1. Harness vollständig neu starten, damit alle neuen Runner- und API-Änderungen geladen sind.
2. `FBT-477-A56D` von `Review` auf `Ready` setzen.
3. **Den Entwickler starten, nicht direkt den Tester.**
4. Der Entwickler muss den veralteten QA-Test korrigieren und seine Cleanup-Pfade absichern.
5. Nach seiner Abschlussantwort führt der Harness automatisch einmal die vollständige Projektsuite aus.
6. Nur wenn dieses Gate erfolgreich ist, geht `FBT-477-A56D` automatisch auf `Review` und kann getestet werden.
7. Danach kann der Autoprozess wieder aktiviert werden.

## Konkreter aktueller Produkt-/Testfehler

Betroffene Datei:

`C:\Users\FroschiO\Froschwerk NEU\FroschwerkCRM-BusinessTool\tests\unit\qa-fbt-623-attachment-error-cases.test.js`

Der zweite Test erwartet derzeit, dass `ownerType: "invoice"` beim generischen Attachment-Endpunkt ungültig ist und HTTP 400 liefert. Das neue Ticket `FBT-477-A56D` erweitert die erlaubten Besitzer jedoch ausdrücklich um:

- Kunden
- Projekte
- Aufgaben
- Angebote
- Rechnungen

`invoice` ist daher keine gültige Negativprobe mehr. Der Test muss auf eine wirklich ungültige Besitzerart wie `bogus` umgestellt werden oder – falls eine unbekannte Rechnung geprüft werden soll – den fachlich vorgesehenen Not-found-Vertrag testen.

Zusätzlich liegen die Aufrufe `await close(runtime.server)` nur am erfolgreichen Ende der drei Testfälle. Schlägt vorher eine Assertion fehl, bleibt der Server offen. Alle drei Testfälle müssen die Bereinigung unmittelbar nach dem Serverstart registrieren oder mit `try/finally` garantieren. Geeignete Muster sind beispielsweise `t.after(...)`, `afterEach(...)` oder ein `try/finally` um den gesamten Testkörper.

Der beobachtete Hänger war exakt dieser Worker:

`tests\unit\qa-fbt-623-attachment-error-cases.test.js`

Alle anderen Test-Worker waren bereits beendet.

## Heute behobene Harness-Probleme

### 1. Codex konnte unter dem separaten Windows-Benutzer nicht gestartet werden

Ursache war die indirekte Ausführung von `codex.cmd`, die unter Windows zu einem doppelt gequoteten `""node""` führte. Außerdem musste das Laufzeit-Environment das Benutzerprofil und die Windows-Schreibweise `Path`/`PATH` konsistent behandeln.

Korrektur:

- Codex wird über seine JavaScript-CLI mit dem aktuellen `process.execPath` gestartet.
- Windows-Workspace-Pfade mit Leerzeichen werden als echte Argumente übergeben.
- Das Environment des ausgewählten Benutzers bleibt konsistent.
- Git-Vertrauen wird isoliert injiziert, ohne globale Git-Konfiguration zu verändern.

### 2. `.env not found`

Die `.env`-Datei ist für den normalen Abo-/Login-Betrieb nicht zwingend erforderlich. Die Skripte verwenden bewusst `--env-file-if-exists=.env` und dürfen ohne Datei weiterlaufen. Eine `.env` wird nur für optionale lokale Overrides benötigt. API-Keys sollen für den Abo-Login nicht gesetzt werden.

### 3. Codex war fertig, aber der Entwicklerlauf blieb aktiv

Codex hatte bereits ein JSONL-Ereignis `turn.completed` ausgegeben, während ein Child-Prozess die Pipe offen hielt. Der Harness wartete früher ausschließlich auf das Prozessende.

Korrektur:

- `turn.completed` wird jetzt gepuffert und zuverlässig erkannt.
- Die Abschlussantwort wird sofort als Ticket-Kommentar gespeichert.
- Der Run wird im Board abgeschlossen.
- Übrig gebliebene CLI-Childs werden anschließend beendet.

### 4. Echte Produktfehler wurden als Infrastrukturblockade eingestuft

Normale Exit-Codes ungleich null gelten jetzt als fehlgeschlagener Projekt-Test. Nur ein tatsächlicher Startfehler bleibt eine Infrastrukturblockade. Dadurch erzeugt ein reproduzierbarer Testfehler wieder eine fachliche Folgeaufgabe.

### 5. `--test-force-exit` verursachte falsche Fehler

Unter Node 24.15 auf Windows verursachte `--test-force-exit` nach vollständig bestandenen Subtests den libuv-Fehler `UV_HANDLE_CLOSING`.

Nachweis:

- Betroffene Dateien einzeln ohne Force-Exit: erfolgreich.
- Dieselben Dateien mit Force-Exit: reproduzierbarer libuv-Abschlussfehler.
- Vollständige damalige CRM-Suite ohne Force-Exit: **115/115 bestanden, Exit-Code 0**.

Korrektur:

- Der Harness injiziert `--test-force-exit` nicht mehr.
- Konfigurierte npm-Testskripte werden direkt aus `package.json` aufgelöst.
- Entwickler werden ausdrücklich auf garantierten Cleanup statt Force-Exit hingewiesen.

Wichtig: Die 115/115 beziehen sich auf den Stand vor der späteren Upload-Änderung. Der aktuelle Upload-Stand muss nach Korrektur des veralteten QA-Tests erneut vollständig laufen.

### 6. Statisch `blocked` plus zentraler Test `succeeded` blieb fälschlich blockiert

Der statische Tester durfte den zentralen Test laut Arbeitsregel nicht selbst starten und meldete deshalb `blocked`. Obwohl der Harness-Test danach erfolgreich war, blieb der Gesamtstatus blockiert.

Korrektur:

- Wenn die einzigen statischen Blocker ausdrücklich nur auf den zentralen Harness-Test warten, hebt ein erfolgreicher zentraler Test sie auf.
- Echte statische Blockaden bleiben blockiert.
- Statische Produktfehler und fehlgeschlagene zentrale Tests bleiben Fehler.

Dieser Fix schloss die Ansprechpartner-Kette korrekt ab:

`FBT-320-C259 → Done` → `FBT-743-6BBE → Review → Testing → Done`

### 7. Hängende Projekt-Tests lieferten minutenlang keine Information

Der alte Idle-Timeout betrug 15 Minuten. Zudem wurde ein gestarteter, aber nicht terminierender Test früher als Infrastrukturproblem behandelt.

Korrektur:

- Standardmäßige Inaktivitätsgrenze für Projekt-Tests: **60 Sekunden**.
- Über `PROJECT_TEST_IDLE_TIMEOUT_MS` weiterhin konfigurierbar.
- Ein bereits gestarteter Test, der nicht terminiert, ist ein fehlgeschlagener Testlauf. Typische Ursache sind geleakte Server, Sockets oder Worker.
- Der Fehlerauszug wird im Testbericht gespeichert und kann eine Entwickler-Folgeaufgabe auslösen.

### 8. „Lauf abbrechen“ änderte nur das Board, nicht die Prozesse

Die Oberfläche rief den separaten Harness-API-Server auf. Dort fehlte `/api/agent-runs/:id/cancel`; der Fallback schrieb nur `cancelled` nach SQLite.

Korrektur:

- Der separate API-Server besitzt jetzt den Cancel-Endpunkt.
- Auch der alte `/finish`-Fallback mit `status: "cancelled"` ruft die echte Prozessbeendigung auf.
- Künftige Abbrüche beenden den gesamten Prozessbaum und geben anschließend den Task frei.

### 9. Neues verbindliches Entwickler-Testgate

Der wichtigste präventive Fix:

- Der Entwickler erhält die letzten fünf Ticket-Aktivitäten und damit vorherige Testfehler als Kontext.
- Er muss repositoryweit nach alten Tests zu geänderten APIs, Routen, Enums, Entitäten, Schemafeldern und Verträgen suchen.
- Bei einer beabsichtigten Vertragsänderung muss er veraltete Tests im selben Ticket aktualisieren, ohne sinnvolle Abdeckung zu entfernen.
- Tests mit Servern, DBs, Workern, Timern, Streams oder Temp-Dateien müssen ausfallsicheren Cleanup besitzen.
- Nach der Entwicklerantwort startet der Harness selbst einmal die vollständige Projektsuite.
- Gate erfolgreich: Entwickler-Run `succeeded`, Task `Review`.
- Gate fehlgeschlagen oder hängt: Entwickler-Run `failed`, Task `Ready`, Fehlerauszug im Ticket, keine Übergabe an QA.
- Im Autoprozess kann der nächste begrenzte Entwickler-Retry den gespeicherten Fehler direkt bearbeiten.

Das Gate kann ausschließlich für isolierte Harness-Smoke-Tests über `DEVELOPER_PROJECT_TEST_GATE=off` deaktiviert werden. Im normalen Betrieb ist es standardmäßig aktiv.

### 10. Tester-Regeln wurden ebenfalls verschärft

Der Tester muss zusätzlich:

- ältere Tests zu geänderten Verträgen gezielt prüfen,
- veraltete Annahmen erkennen,
- Cleanup bei Servern, DBs, Workern, Timern, Streams und Temp-Dateien prüfen,
- den ausstehenden zentralen Test nicht mehr allein als Grund für `blocked` verwenden.

## Verifikation des Harness

Letzter vollständiger Lauf:

```text
npm.cmd test
Build: erfolgreich
Tests: 50
Bestanden: 50
Fehlgeschlagen: 0
```

Zusätzlich explizit verifiziert:

- erfolgreicher Entwickler-Gate-Lauf setzt das Ticket auf `Review`,
- fehlgeschlagener Entwickler-Gate-Lauf hält das Ticket auf `Ready`,
- Gate-Request und Ergebnis werden im Request-Tracking gespeichert,
- erfolgreiche zentrale Tests lösen reine Test-Deferrals auf,
- echte statische Blocker bleiben blockiert,
- Test-Timeouts werden als Testfehler behandelt,
- beide Cancel-API-Wege sind erreichbar,
- ausführbare Harness-Skripte bestehen Syntaxchecks.

## Wichtige geänderte Harness-Dateien

- `scripts/runtime-env.mjs`
- `scripts/codex-cli.mjs`
- `scripts/codex-turn-events.mjs`
- `scripts/project-test-command.mjs`
- `scripts/project-test-result.mjs`
- `scripts/run-agent.mjs`
- `scripts/run-tester.mjs`
- `scripts/workflow-orchestrator.mjs`
- `scripts/api-server.mjs`
- zugehörige Regressionstests unter `tests/`

Der Harness-Workspace erscheint Git vollständig ungetrackt. Deshalb ist momentan kein sinnvoller normaler Git-Diff/Commit-Verlauf verfügbar. Keine globalen Git-Einstellungen wurden verändert.

## Sicherheitsregel für morgen

Wenn ein Lauf wieder scheinbar hängt, nicht raten und nicht mehrere Tests parallel starten. Zuerst prüfen:

1. aktiver `agent_run` und `agent_request`,
2. aktuell lebende Child-Prozesskette,
3. konkrete letzte Testdatei,
4. letzte Ausgabezeit und Idle-Grenze,
5. ob der Task-Status und der echte Prozesszustand übereinstimmen.

Erst danach abbrechen oder erneut starten. Alte Testreports bleiben als Historie erhalten; falsche Resultate werden durch neue nachvollziehbare Läufe korrigiert und nicht aus der Datenbank gelöscht.
