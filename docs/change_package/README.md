# Handoff: Froschwerk Harness — Redesign „Papier"

## Überblick

Neues visuelles Konzept für den Froschwerk Agent Harness (Next.js, `app/page.tsx` + `app/globals.css`). Das bestehende Navy/Mint-Design wird durch eine warme Papier-Palette mit Serifen-Überschriften ersetzt. Die Informationsarchitektur bleibt weitgehend erhalten (Sidebar, Board, Ticketdetail), aber drei Dinge ändern sich strukturell:

1. Der Mira-Chat ist kein schwebendes, resizebares Fenster mehr, sondern eine feste rechte Spalte, die die Ticketdetail-Spalte ersetzt.
2. Die Agenten-Information zieht aus der Sidebar und dem Debug-Panel in eine eigene, vollwertige Agentenseite.
3. Kennzahlen werden nicht mehr in Kacheln dargestellt, sondern als Textzeile.

Drei Ansichten sind ausgearbeitet: **Board**, **Board mit offenem Mira-Chat**, **Agentenseite**.

## Zu den Design-Dateien

Die HTML-Dateien in diesem Bündel sind **Design-Referenzen**, keine Produktionsdateien. Sie sind reine Layout-Prototypen mit Inline-Styles und Beispieldaten, ohne Interaktion und ohne State. Die Aufgabe ist, diese Layouts im bestehenden Next.js-Projekt nachzubauen: als React-Markup in `app/page.tsx` (bzw. neuen Route-Dateien) mit Klassen in `app/globals.css`, wie es das Projekt heute schon macht. Inline-Styles aus den Prototypen sollen **nicht** übernommen werden — sie sind nur das Transportmittel.

## Fidelity

**High-fidelity.** Farben, Schriftgrößen, Abstände und Texte sind final gemeint und können direkt übernommen werden. Wo eine Angabe fehlt, gilt die nächstliegende Regel aus dem Abschnitt „Design-Tokens".

---

## Was sich gegenüber dem Ist-Zustand ändert

### Wo die Informationen heute stehen

| Information | Heute (`app/page.tsx` / `globals.css`) | Neu |
|---|---|---|
| Agentenliste mit Status | Sidebar, Abschnitt `AGENTENSTATUS` (Zeile ~1129), Klasse `.agent-row`, inkl. `<select class="agent-provider-select">` pro Agent | Sidebar zeigt nur noch Name + Kurzstatus, verlinkt auf die Agentenseite. Providerwahl zieht auf die Agentenseite (rechte Spalte, Abschnitt Konfiguration) |
| Providerstatus (Codex/Claude) | Sidebar, Abschnitt `VERBINDUNGEN` (Zeile ~1131) mit Refresh-Button | Bleibt in der Sidebar, gleiche Position, neue Typografie. Fehlender Login wird rostfarben ausgezeichnet statt mit Ampelpunkt |
| Agentenübersicht + Agent-Detail | `workspaceView === "agents"` → `.run-transparency-panel` mit `.agent-overview-grid` und `.agent-detail` (Zeile ~1147), eingebettet unter dem Board | Eigene Seite `/agents/[id]` (Ansicht 3). Das eingebettete Panel entfällt |
| Run-Historie, Requests, Tokens, Events | `.run-transparency-panel`, `.run-history`, `.run-data`, `.run-request`; im Ticket-Detailpanel per `globals.css` Zeile 79 ausgeblendet | Live-Log und Laufhistorie sind Hauptinhalt der Agentenseite. Im Ticketdetail bleibt eine Kurzfassung („Läufe", 2 Zeilen) |
| Aktivitätsfeed | `workspaceView === "activity"` → `.activity-feed` | Unverändert als eigene Ansicht, im neuen Stil (nicht in diesem Bündel enthalten) |
| Mira-Chat | `.chat-panel`, `position: fixed`, resizebar über `--chat-panel-width/height`, localStorage-Keys `froschwerk-manager-panel-height` etc., Zeile ~1190 | Feste rechte Spalte, 420px, nicht resizebar. Resize-Handles, `chat-launcher`, `workflow-strip` und die zugehörigen CSS-Variablen entfallen |
| Manager-Workbench (Planvorschau) | `.manager-workbench` innerhalb des Chat-Panels, eigene Resize-Leiste | Planvorschlag erscheint inline im Nachrichtenverlauf als Tabelle mit Haarlinien |
| Kennzahlen | `.metric-grid` mit vier `.metric-card` über dem Board | Eine Textzeile unter der Überschrift: „40 % erledigt · 12 Läufe heute · 128.400 Tokens" |
| Projektübersicht | `.project-overview` (Workspace-Pfad, Fortschritt, Läufe, Archivieren) | Pfad wandert in die Agentenseite und in die Projekteinstellungen; Fortschritt in die Kennzahlenzeile |
| Fortschrittsbalken | Höhe 5px, `border-radius: 9px`, Mint | Höhe 2px, ohne Radius, Rost auf `#e0d8c8` |
| Ticketkarten | Weiß, 1px Rahmen `--line`, Radius 7px, Schatten `0 2px 8px #18223508` | `#fdfbf6`, kein Rahmen, Radius 3px, Schatten `0 1px 2px #241f1a10`. Aktive Karte: 3px Rost links, stärkerer Schatten |
| Statusfarben | Farbige Punkte + farbige Pillen pro Priorität | Nur Text, in Rost (dringend/aktiv), Ocker (wartet), Oliv (erledigt), sonst Braungrau |
| Zahlenformat | teils englische Formate | Deutsch: Punkt als Tausendertrenner, Komma als Dezimaltrenner, `4m 12s` bleibt |

### Was ersatzlos entfällt

- Alle farbigen Statuspillen und Prioritätspillen mit Hintergrund
- `.metric-card` Kacheln inkl. Icons
- Resize-Handles für Chat und Infobereich, samt localStorage-Persistenz der Höhen
- `workflow-strip` und `run-action-confirmation` als schwebende Elemente (Bestätigungen werden inline im Chat gezeigt)
- Emoji-artige Zeichen-Icons (`▦ ◎ ◷ ⌕ ♧`) in der Navigation — die Navigation ist reine Typografie

---

## Ansicht 1 — Board (`01-board.html`)

**Zweck:** Startseite. Zeigt alle Tickets eines Projekts, den laufenden Agenten und das ausgewählte Ticket.

**Layout:** Grid mit drei Spalten, `224px | 1fr | 356px`, Gesamthöhe 100vh, kein Seitenscroll (jede Spalte scrollt für sich).

### Sidebar (224px, `#eae4d7`)

Padding `26px 20px`, Flex-Spalte.

- **Wortmarke:** „Froschwerk" in Instrument Serif 25px, daneben „HARNESS" 10px, `letter-spacing: .14em`, `#a89c86`. Abstand nach unten 24px.
- **Navigation:** Board / Agenten / Aktivität / Läufe, je 13px, Padding `9px 11px`, Zähler rechtsbündig 12px `#a89c86`. Aktiv: Hintergrund `#f3efe6`, Radius 2px, `font-weight: 500`. Inaktiv: `#7d7466`.
- **Abschnittslabel:** 10px, `letter-spacing: .14em`, `#a89c86`, Margin `28px 4px 12px`. Labels: PROJEKTE, AGENTEN, VERBINDUNGEN.
- **Projekte:** Zeile 13px, Padding `9px 11px`. Aktives Projekt: `#f3efe6` + 2px Rost-Balken links.
- **Agenten:** Name links, Kurzstatus rechts (11px). „bereit" oliv `#6f8a56`, laufendes Ticket rost `#b4472c`, „offline" `#a89c86` und Name ebenfalls ausgegraut. Klick öffnet die Agentenseite.
- **Verbindungen:** Provider links, Status rechts. „Plus" oliv, „Login fehlt" rost.
- **Fußzeile:** Trennlinie `1px solid #ded5c4`, Avatar 28px Kreis `#d8cfbc` mit Initiale `#5d5548`, daneben Name 12px und Rolle 10px `#a89c86`.

### Hauptbereich

- **Kopf:** Flex-Zeile, `align-items: flex-end`, Padding `28px 34px 22px`.
  - H1 Instrument Serif 40px, `font-weight: 400`, `line-height: 1.05`. Text ist eine Zusammenfassung in ganzen Sätzen, z. B. „Fünf Tickets, einer läuft."
  - Darunter 13px `#7d7466`, `line-height: 1.6`: die zwei bis drei Dinge, die Aufmerksamkeit brauchen, mit `·` getrennt.
  - Rechts drei Aktionen mit `flex: 0 0 auto; white-space: nowrap`: „Filtern" und „Projekt analysieren" als Outline (1px `#d6cdba`, Radius 2px, `#5d5548`, 12px, Padding `10px 15px`), „Neues Ticket" gefüllt (`#b4472c`, Text `#fdf9f2`, `font-weight: 600`, Padding `10px 16px`).
- **Kennzahlenzeile:** Padding `0 34px 16px`, untere Linie `1px solid #e0d8c8`, 12px `#7d7466`, Abstand 26px. Inhalt: „40 % erledigt" (Zahl in `#241f1a`, `font-weight: 600`), 120×2px Fortschrittsbalken, „12 Läufe heute", „128.400 Tokens", rechtsbündig die Live-Sync-Uhrzeit in Geist Mono `#a89c86`.
- **Board:** Grid `repeat(5, minmax(0,1fr))`, `gap: 22px`, Padding `22px 34px 26px`.
  - **Spaltenkopf:** Instrument Serif 18px + Anzahl 12px `#b3a894`. Kein Punkt, kein Badge.
  - **Karte:** Hintergrund `#fdfbf6`, Radius 3px, Schatten `0 1px 2px #241f1a10`, Padding 16px, Grid mit `gap: 10px`.
    - Zeile 1: Ticket-ID Geist Mono 10px `#a89c86`, rechts Priorität 11px (Urgent rost `#b4472c` `600`, High ocker `#8a6a2c` `600`, Medium/Low `#8a8071` normal).
    - Titel: 14px, `font-weight: 500`, `line-height: 1.35`, `letter-spacing: -.01em`.
    - Beschreibung (optional): 11px `#8a8071`, `line-height: 1.55`.
    - Fußzeile: Zuständigkeit links, Zeitangabe rechts, beide 11px `#a89c86`.
  - **Aktive Karte (In Arbeit):** zusätzlich `border-left: 3px solid #b4472c`, Radius `0 3px 3px 0`, Schatten `0 3px 10px #241f1a1a`, ein 2px Fortschrittsbalken und eine Statuszeile mit 6px Punkt in `#c98a2c`.
  - **Erledigt-Karte:** Hintergrund `#efeade`, kein Schatten, Titel `#5d5548`.
  - **„＋ Ticket":** 12px `#c0b6a2`, Padding `9px 0`, kein Rahmen.
- **Mira-Leiste unten:** Höhe durch Padding `15px 34px`, obere Linie `1px solid #e0d8c8`, Hintergrund `#eae4d7`. Links „Mira" in Instrument Serif 17px rost, Platzhaltertext 13px `#a89c86`, rechts `⏎` in Geist Mono 11px `#c0b6a2`. Klick öffnet Ansicht 2.

### Ticketdetail (356px, `#fdfbf6`)

Padding `26px 28px`, Abschnitte durch `1px solid #e8e0d0` getrennt, jeder Abschnittstitel Instrument Serif 17–19px.

Reihenfolge: Kopfzeile (ID, Priorität, Schließen) → Titel Instrument Serif 26px → Beschreibung 13px → zwei Aktionen → Metadaten (Status, Zuständig, Provider, Lease bis) als Zeilen mit Label links `#a89c86` und Wert rechtsbündig → Akzeptanzkriterien (✓ oliv `#6f8a56`, ○ `#c9bfa9` für offen, offener Text `#8a8071`) → Läufe (je Versuch: Zeile mit Ergebnis rechts, darunter 11px Detailzeile) → Aktivität (Autor 12px `600`, Zeit rechts 11px `#b3a894`, Text 12px `#7d7466`) → Kommentarfeld.

---

## Ansicht 2 — Board mit offenem Mira-Chat (`02-mira-chat.html`)

**Zweck:** Mit dem Manager arbeiten, ohne das Board zu verlassen.

**Layout:** `224px | 1fr | 420px`. Die Ticketdetail-Spalte wird durch den Chat ersetzt — beide sind nie gleichzeitig sichtbar. Das Board behält fünf Spalten, sie werden schmaler (`gap: 16px`, Padding `20px 30px 24px`, Karten `padding: 14px`, Titel 13px).

### Chat-Spalte (420px, `#fdfbf6`)

- **Kopf:** Padding `26px 28px 16px`, untere Linie. „Mira" Instrument Serif 24px, daneben „Hauptmanager · Codex" 12px `#a89c86`, rechts „online" 11px oliv und ein `×`.
- **Nachrichten:** Padding `22px 28px`, `gap: 20px`. **Keine Sprechblasen.**
  - Mira: Autorzeile („Mira" 12px `600` + Zeit 11px `#b3a894`), darunter Text 13px `#4a443b`, `line-height: 1.65`.
  - Nutzer: gleiche Struktur, aber `padding-left: 20px` und `border-left: 2px solid #e0d8c8`; Autorname rost.
- **Planvorschlag:** direkt im Verlauf, als Zeilenliste mit Haarlinien `1px solid #e8e0d0` oben und unten. Je Zeile: Sortierschlüssel (`#10`) Geist Mono 10px `#a89c86` in 26px breiter Spalte, Titel 13px, darunter „Rolle · Priorität" 11px `#a89c86`.
- **Aktionen unter dem Plan:** „Drei Tickets anlegen" gefüllt rost, „Bearbeiten" Outline, „Verwerfen" nur Text `#a89c86`.
- **Vorschläge:** Chips, Padding `6px 11px`, 1px `#e4dccb`, Radius 2px, 11px `#7d7466`, umbrechend.
- **Eingabe:** Padding `16px 28px`, obere Linie, Hintergrund `#f7f3ea`, Platzhalter 13px `#a89c86`, rechts `⏎`.

**Verhalten:** Öffnen über die Mira-Leiste oder die Sidebar; Schließen über `×` bringt das Ticketdetail zurück. Der Zustand (offen/geschlossen) ersetzt `isChatOpen`; die gespeicherten Größen entfallen.

---

## Ansicht 3 — Agentenseite (`03-agent.html`)

**Zweck:** Alles über einen Agenten an einem Ort: Zustand, was er gerade tut, unter welchem Auftrag, mit welchen Rechten, und was er zuletzt getan hat. Ersetzt `.agent-overview-grid` + `.agent-detail` aus dem Debug-Panel.

**Layout:** `224px | 1fr` (Sidebar wie Ansicht 1, Navigationspunkt „Agenten" aktiv, der geöffnete Agent in der Agentenliste hervorgehoben). Der Hauptbereich teilt sich unterhalb der Statuszeile in `1fr | 400px`.

- **Brotkrumen:** „Agenten / Dev Agent", 12px, aktuelles Element `#241f1a`.
- **Kopf:** H1 Instrument Serif 44px. Darunter ein erklärender Satz (max. 70 Zeichen Breite, 14px `#7d7466`): welche Rolle, welcher Provider, welches Modell, was der Agent darf. Rechts: „Auftrag bearbeiten", „Pausieren" (Outline), „Lauf abbrechen" (gefüllt rost).
- **Statuszeile:** Padding `0 40px 16px`, untere Linie, 13px `#7d7466`, Abstand 30px, Werte in `#241f1a`. Inhalt: Laufzeit (mit rostfarbenem `●`), Lease-Ende (Geist Mono), Heartbeat-Alter, Läufe heute, Tokens, Erfolgsquote. **Keine Kacheln.**

### Hauptspalte

- **Aktueller Lauf:** Titelzeile Instrument Serif 22px + Run-ID/Versuch Geist Mono 11px + Prozent rechts. Darunter Ticket-ID, Tickettitel 15px, Priorität. 2px Fortschrittsbalken.
- **Reiter:** Ausgabe / Anfragen · 7 / Ereignisse · 24 / Testchecks · 3, rechtsbündig „Geänderte Dateien · 4". 12px, aktiver Reiter `#241f1a` mit 2px Rost-Unterstrich, inaktiv `#a89c86`. Untere Linie `1px solid #e0d8c8`.
- **Live-Log:** Geist Mono 12px, `line-height: 2.05`, Text `#6b6255`, Zeitstempel `#b3a894`, hervorgehobene Werte `#241f1a`, Erfolgsmeldungen oliv. Die aktive Zeile endet mit einem 7×14px Rost-Block als Cursor. Autoscroll ans Ende, solange der Nutzer nicht selbst gescrollt hat.
- **Frühere Läufe:** Tabelle, Grid `74px 92px 1fr 118px 96px`, `gap: 16px`. Kopfzeile 11px `#a89c86` `letter-spacing: .06em`: ZEIT, TICKET, ERGEBNIS, DAUER, TOKENS. Zeilen 13px, Trennlinie `1px solid #e8e0d0` oben, Ergebnis oliv bei Erfolg, rost bei Fehlschlag. Zeile ist klickbar und öffnet das Run-Detail.

### Rechte Spalte (400px, `#fdfbf6`)

Abschnitte durch `1px solid #e8e0d0` getrennt, Titel Instrument Serif 19px.

1. **Konfiguration** (ohne Titel, direkt oben): Rolle, Provider, Modell, Max. Versuche, Lease-Dauer, Autoprozess — je Label links `#a89c86` / Wert rechtsbündig, 13px. Provider und Modell sind hier editierbar (ersetzt `.agent-provider-select` in der Sidebar).
2. **Auftrag:** rechts oben der Dateiname in Geist Mono 11px (`agents/developer.md`). Text 13px `#4a443b`, `line-height: 1.7`. Darunter „Vollständig ansehen" in Rost.
3. **Rechte:** Häkchenliste, ✓ oliv für gewährt, ○ `#c9bfa9` mit Text `#8a8071` für verweigert.
4. **Arbeitsverzeichnis:** Pfad Geist Mono 12px `#7d7466`, `word-break: break-all`. Darunter „Testbefehl" mit dem Kommando in Mono.
5. **Warteschlange:** je Zeile Ticket-ID Mono 11px, Titel, rechts „als nächstes" / „danach" 11px `#a89c86`.

---

## Interaktion und Verhalten

- **Board → Detail:** Klick auf eine Karte öffnet die Detailspalte; ist der Chat offen, hat der Chat Vorrang und die Karte wird nur markiert.
- **Sidebar → Agentenseite:** Klick auf einen Agentennamen navigiert zu `/agents/[id]`.
- **Live-Daten:** Statuszeile, Fortschrittsbalken und Live-Log werden im bestehenden Polling-Intervall aktualisiert. Der Cursor-Block am Log-Ende blinkt nicht — er markiert nur die aktive Zeile.
- **Hover:** Karten heben den Schatten auf `0 3px 10px #241f1a1a`; Zeilen in Tabellen und Listen bekommen `#f7f3ea` als Hintergrund. Buttons dunkeln um eine Stufe nach (`#b4472c` → `#9c3c24`).
- **Fokus:** 2px Rost-Outline mit 2px Offset, kein Radius.
- **Übergänge:** ausschließlich `background-color` und `box-shadow`, 120 ms, `ease-out`. Keine Bewegung, keine Skalierung.
- **Leere Zustände:** ein Satz in 13px `#a89c86`, kein Bild, kein Rahmen. Beispiel: „Noch keine Läufe für diesen Agenten."
- **Fehler:** rostfarbener Text an der Stelle, wo der Wert stünde. Keine Toasts, keine schwebenden Banner.
- **Responsiv:** unter 1280px entfällt die rechte Spalte (Detail bzw. Chat wird zur Overlay-Spalte über dem Board), unter 1024px wird die Sidebar zur ausklappbaren Leiste. Das Board scrollt horizontal, Mindestbreite je Spalte 220px.

## State

Bestehender State bleibt, mit diesen Änderungen:

- `isChatOpen` bleibt, aber ohne `chatSize`, `managerPanelHeight`, `overviewPanelHeight` und die drei localStorage-Keys.
- Neu: `rightPane: "detail" | "chat" | null` — steuert, was die dritte Spalte zeigt.
- Neu: Route `/agents/[id]` mit `agentId`; die bisherige `workspaceView === "agents"`-Verzweigung entfällt.
- Der aktive Reiter der Agentenseite (`output | requests | events | tests`) ist lokaler State, nicht persistiert.

## Design-Tokens

**Farben**

| Zweck | Wert |
|---|---|
| Seitenhintergrund | `#f3efe6` |
| Sidebar / Fußleisten | `#eae4d7` |
| Karten, rechte Spalten | `#fdfbf6` |
| Erledigt, gedämpfte Flächen | `#efeade` |
| Eingabefeld-Hintergrund | `#f7f3ea` |
| Text primär | `#241f1a` |
| Text Fließtext | `#4a443b` |
| Text sekundär | `#7d7466` |
| Text tertiär / Labels | `#a89c86` |
| Text sehr schwach | `#b3a894`, `#c0b6a2` |
| Linie stark | `#e0d8c8` |
| Linie schwach | `#e8e0d0` |
| Rahmen Buttons | `#d6cdba`, `#ded5c4` |
| Akzent (Rost) | `#b4472c` |
| Akzent Hover | `#9c3c24` |
| Text auf Rost | `#fdf9f2` |
| Warnung / wartet (Ocker) | `#8a6a2c`, Punkt `#c98a2c` |
| Erfolg (Oliv) | `#6f8a56` |
| Leeres Häkchen | `#c9bfa9` |

**Typografie**

- Überschriften: **Instrument Serif**, `font-weight: 400`. Größen: 44 (Seitentitel), 40 (Board), 26 (Ticketdetail), 24 (Chat), 22/19/18/17 (Abschnitte, Spaltenköpfe).
- Fließtext und UI: **Geist**. 15 / 14 / 13 / 12 / 11 px. `font-weight` 500 für Kartentitel und aktive Navigation, 600 für Autoren und gefüllte Buttons, sonst 400.
- Monospace: **Geist Mono**, 10–12 px, für IDs, Zeitstempel, Pfade, Modellnamen und Logs.
- `letter-spacing`: `-.01em` auf Kartentiteln, `.14em` auf Abschnittslabels (10px), `.06em` auf Tabellenköpfen (11px).
- `line-height`: 1.35 Titel, 1.55–1.7 Fließtext, 2.05 im Log.

**Maße**

- Spaltenbreiten: Sidebar 224, Ticketdetail 356, Chat 420, Agenten-Seitenspalte 400.
- Padding: Sidebar `26px 20px`, Hauptbereich `34–40px` horizontal, Karten 16, Kompaktkarten 14.
- Gap: Board 22 (16 bei offenem Chat), Kartenintern 10, Listen 11–12.
- Radius: 2px (Buttons, aktive Navigation), 3px (Karten), 50% (Avatare). Sonst 0.
- Schatten: Karte `0 1px 2px #241f1a10`, aktive Karte `0 3px 10px #241f1a1a`.
- Linien: durchgehend 1px. Fortschrittsbalken 2px, Akzentkante links 3px, aktiver Reiter 2px.

**Schrifteinbindung**

```
https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700;800&family=Geist+Mono:wght@400;500;600&family=Instrument+Serif&display=swap
```

Geist und Geist Mono werden bereits über `next/font/google` in `app/layout.tsx` geladen. **Instrument Serif** muss dort ergänzt werden.

## Assets

Keine. Die Entwürfe verwenden ausschließlich Text, Linien und Flächen. Avatare sind Kreise mit Initiale. Die Zeichen `＋ × ↑ ● ✓ ○ ⏎ ·` sind Textzeichen, keine Icons.

## Dateien

| Datei | Inhalt |
|---|---|
| `01-board.html` | Ansicht 1 — Board mit Ticketdetail (1600×960) |
| `02-mira-chat.html` | Ansicht 2 — Board mit offenem Mira-Chat (1600×960) |
| `03-agent.html` | Ansicht 3 — Agentenseite (1600×1080) |

Alle drei sind eigenständig und im Browser direkt zu öffnen. Die Rahmen haben feste Pixelmaße, damit die Proportionen ablesbar sind — die Umsetzung soll fluid sein.

Referenzdateien im bestehenden Projekt: `app/page.tsx` (Zeilen ~1118–1204 für Shell, Sidebar, Detailpanel, Chat), `app/globals.css` (Zeile 3 Tokens, 9–15 Sidebar, 21 Detailpanel, 22 Chat, 75 Transparenz-Panel).
