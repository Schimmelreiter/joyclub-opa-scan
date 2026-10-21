# joyclub-opa-scan

Implementiert einen Schutz vor sabbernden alten Opas in JOYclub.

Ein Tampermonkey-Userscript für [joyclub.de](https://www.joyclub.de). Es findet Mitglieder, die nach festen Regeln zu alt sind (bzw. Paare mit großem Altersunterschied), schreibt ihnen eine Profilnotiz und setzt sie auf die JOYclub-Ignorierliste – in Gruppen, auf Partys und in der Mitgliedersuche.

Stand: Version 1.70 – Änderungen siehe [changelog.txt](changelog.txt)

---

## Installation und Updates

1. [Tampermonkey](https://www.tampermonkey.net/) im Browser installieren.
2. Diesen Link öffnen und auf „Installieren“ klicken:
   https://raw.githubusercontent.com/Schimmelreiter/joyclub-opa-scan/main/joyclub-mitglieder-alter-blockieren.user.js
3. Updates holt Tampermonkey automatisch (`@updateURL`), standardmäßig einmal täglich – sofort über *Dashboard → Nach Updates suchen*.

Alle gespeicherten Daten (Protokoll, Whitelist, Scan-Stände …) liegen im Tampermonkey-Speicher und bleiben bei Updates erhalten.

---

## Regeln: Wer wird ignoriert?

| Regel | Einstellung | Standard |
|---|---|---|
| Männer und ähnliche Profiltypen über einem Höchstalter | `MAX_AGE`, `ONLY_TYPES` | über 49; Mann, Transmann, Non-binary, Transvestit, Männer-Paar |
| Gemischte Paare mit großem Altersunterschied („Sugar Daddy“) | `COUPLE_AGE_GAP` | ab 18 Jahren Unterschied |
| Gemischte Paare, bei denen beide alt sind („Geronto-Paar“) | `COUPLE_BOTH_MIN_AGE` | beide ab 60 |
| Frauen | – | werden nie ignoriert |
| Whitelist | `WHITELIST` + gelernte Einträge | werden nie ignoriert |

Vor dem Ignorieren schreibt das Skript eine Profilnotiz, z. B.
`Alter Sack (Party) geblockt am 21.10.2026 um 12:00`, `Sugar Daddy (Gruppen) ignoriert am …` oder `Geronto-Paar (Party) ignoriert am …`.
Die Quelle in Klammern sagt, wo das Mitglied gefunden wurde.

Ignoriert wird über das Profil (Notiz speichern → *Profiloptionen → Profil ignorieren → Ignorieren*) bzw. im Hintergrund über die Ignorierliste `/ignore/`.

`DRY_RUN: true` schaltet einen Testmodus ein, in dem nichts verändert wird.

---

## Whitelist

- **Feste Einträge** in `CONFIG.WHITELIST`, gruppiert nach Grund (Veranstalter, DJ, Party, Freundeslisten, manuell).
- **Automatisch ergänzt:**
  - Moderatoren der gescannten Gruppen (fallen bei Verlust des Moderatorenstatus wieder heraus),
  - Veranstalter gescannter Partys (dauerhaft, werden ggf. entsperrt),
  - VIP-Gäste, die im Veranstaltungstext verlinkt sind,
  - Mitglieder, die über „Nicht mehr ignorieren“ entsperrt wurden.
- Whitelist-Einträge bekommen eine eigene Profilnotiz, z. B. `Whitelist: Party "…" am …` oder `Whitelist: Veranstalter von "…"`.
- Profil-Links der Whitelist-Mitglieder werden gelernt, sobald sie irgendwo auftauchen.

---

## Gruppen: Opa-Scan

Auf der Gruppenübersicht `/groups/` steht der Button **„Opa-Scan starten“** neben dem Regionen-Filter.

- Liest die Mitgliederlisten aller eigenen Gruppen im Hintergrund (mit Geschlechterfilter und allen Seiten).
- Ignoriert Treffer nach den Regeln, Moderatoren kommen auf die Whitelist.
- Reihenfolge: am längsten nicht bearbeitete Gruppe zuerst.
- Jede Gruppenkarte zeigt ein Badge mit dem Datum des letzten vollständigen Scans.
- In Mitgliederlisten wird „Mann“ je nach Alter zu **Jungschwanz / Schwanz / Opa** (mit Opa-Icon).

---

## Partys: Opa-Scan

### Start

Zwei Übersichtsseiten der eigenen Eventanmeldungen haben einen Button **„Opa-Scan starten“**:

- `/profile/appointments/<eigene ID>…html` – neben der Überschrift „Eventanmeldungen“
- `/dates_partys/events/registrations/` („Dates & Events“) – links neben „Vergangene Events“; das Skript lädt vorher alle per Scrollen nachladbaren Partys

### Ablauf (im Hintergrund)

Ein Klick auf „Opa-Scan starten“ öffnet sofort das Scan-Popup (keine Browser-Meldungen): Es sammelt die Partys, nennt ihre Zahl bzw. den Grund, warum gerade kein Scan möglich ist, und startet erst mit **„Jetzt scannen …“**. Danach wird daraus „Abbrechen“.

Der Scan läuft in unsichtbaren Frames; die Übersichtsseite bleibt offen, das Popup zeigt Fortschritt und Statistik. Für jede Party:

1. Veranstalter dauerhaft auf die Whitelist (und ggf. entsperren).
2. VIP-Gäste aus dem Veranstaltungstext auf die Whitelist.
3. Gästeliste „Alle“ vollständig lesen.
4. Jede Anmeldung einordnen:
   - Paare werden direkt anhand der beiden Altersangaben entschieden,
   - Männer etc. werden nur auf dem Profil geprüft, wenn schon das Anmeldealter über `MAX_AGE` liegt,
   - Frauen, externe und anonyme Anmeldungen, Shops sowie Club-/Veranstalter-Profile (`business_profile`) werden übersprungen.
5. Profile im Hintergrund prüfen (Ergebnis wird 1 Jahr zwischengespeichert) und Treffer ignorieren.

**Effizienz:**
- Erneute Scans prüfen nur Neuanmeldungen seit dem letzten Scan; ändern sich die Regeln, wird automatisch wieder vollständig gescannt.
- Reihenfolge: am längsten nicht gescannte Party zuerst – die nächste anstehende Party wird vorgezogen, wenn alle schon einmal gescannt wurden und der älteste Scan jünger ist als die Zeit bis zu dieser Party.
- Fehlschläge werden mit Party, Profil-Link, Schritt und Meldung gespeichert und sind exportierbar.

### AWO-Faktor

Ein Maß für den Opa-Anteil einer Party:

- **Männer:** Opas ÷ erwartete Männer, mit erwartet = ⌈Jungschwänze/3⌉ + ⌈Schwänze·2/3⌉ + Opas
- **Paare:** Geronto-Paare (beide ab 60, Einzelalter ab 60 oder Sugar Daddy) ÷ alle Paare
- **AWO = ⅔ · Männer + ⅓ · Paare** (fehlt eine Gruppe, zählt nur die andere)
- Farben: unter 10 % hellgrün, unter 25 % grün, unter 35 % orange, ab 35 % rot

Angezeigt wird er auf der Event-Seite (rechts in der Reiterleiste), als Badge auf den Karten der Eventanmeldungen und auf „Dates & Events“ hinter „… Personen angemeldet.“ samt Zeitpunkt des letzten Scans.

### Event-Seite

- Die Gästeliste wird im Hintergrund in zusätzliche Reiter aufgeteilt: **Männer → Jungschwänze / Schwänze / Opas**, **Paare → Paare / Geronto-Paare**. Die Originalliste bleibt sichtbar, bis die Reiter fertig sind.
- Gäste werden nach Anmeldealter eingefärbt; ignorierte Mitglieder bekommen ein rotes X.
- Klick auf ein ignoriertes Mitglied öffnet ein Popup *„Du ignorierst …“* mit Grund (Profilnotiz) und den Buttons **Trotzdem öffnen**, **Nicht mehr ignorieren** (entsperrt und setzt auf die Whitelist) und **Abbrechen**.
- Reiter **„Opa-Liste“** (zwischen „Dates“ und „Kommentare“): Testlauf des Scans für diese Party; listet alphabetisch alle bereits ignorierten bzw. die Kriterien erfüllenden Gäste mit Profil-Links und der Wahl *Ignorieren / Whitelist*, dann „Anwenden“.

---

## Mitgliedersuche

Im Seitenkopf der Suche `/member/` steht rechts neben der Lupe (Namenssuche) ein eigener Button mit **Opa-mit-Lupe-Icon**. Er öffnet ein Popup mit drei Möglichkeiten:

### Mit aktuellen Sucheinstellungen filtern

Lädt die gerade eingestellte Suche in einem unsichtbaren Frame komplett nach, bestimmt die Treffer nach den Regeln (MAX_AGE, Typen, Paar-Regeln, Whitelist) und ignoriert sie im Hintergrund (Notiz-Quelle „Suche“).

### Systematische Suche

Ein zweites Popup spiegelt die JOYclub-Filter **Ich suche** (Frauen, Männer, Paare, Non-binary) und **Alter** (18 bis 70+) und listet alle Bundesländer aus `CONFIG.AREAS` mit Checkbox und Zahl der Umkreise (Hamburg und Bremen laufen unter „Niedersachsen / Hamburg / Bremen“). Die Auswahl wird gemerkt.

Ablauf:
- Für jeden Umkreis (50 km um eine Stadt) und jedes Alter einzeln – rückwärts von 70+ bis zur Untergrenze – wird die Suche per Deeplink aufgerufen:
  `/member/<ort>-x<GeoNames-ID>-r/is-<typen>/?user_geo_distance=50&user_age=<alter>_<alter>`
  (JOYclub nutzt GeoNames-IDs als Orts-ID; `70_70` bedeutet „70 und älter“, Werte über 70 kennt die Suche nicht.)
- Jede Einzelsuche wird wiederholt, bis ein Durchlauf keine neuen Profile mehr bringt (höchstens 20, bei 70+ höchstens 200 Durchläufe); Treffer werden nach jedem Durchlauf ignoriert.
- Paare werden anhand ihrer zwei Altersangaben entschieden; Paare mit nur einer Altersangabe werden auf dem Profil geprüft und gesondert gemerkt.
- Fortschritt: jeder Umkreis zählt gleich viel; innerhalb eines Umkreises zählt 70+ zehnfach, jedes weitere Alter einfach.
- Protokoll je Einzelsuche: Stadt, Bundesland, Orts-ID, Alter, Zahl der Durchläufe bis ohne neue Treffer, gefundene und ignorierte Profile, ob die Obergrenze erreicht wurde.

### Sonstiges

- Das Popup während des Scans entspricht dem des Party-Scans (Warnhinweis, Fortschrittsbalken, Statistik, Abbrechen); am Ende gibt es Export-Buttons für Protokoll, Paare mit einer Altersangabe und Fehlschläge.
- Header-Badge mit der Zahl der vom Skript blockierten Opas.
- Die alte Behandlung der Suche (Einfärben, Badges, Automatik, Ignorieren im Tab, Umbenennung „Mann“) ist mit `MEMBER_SEARCH: false` abgeschaltet, der Code bleibt im Skript.

---

## Profilseiten

- „Mann“ wird im Profilkopf zu Jungschwanz / Schwanz / Opa (mit Opa-Icon).
- Alter, Typ und „zuletzt online“ werden mitgeschrieben; daraus berechnet das Skript Geburtsjahr-Spannen (bei Paaren für beide Personen).

---

## Exporte und Menü

Im Tampermonkey-Menü (alle Exporte als CSV mit `;`, Excel-tauglich):

| Menüeintrag | Inhalt |
|---|---|
| Automatik an/aus | Automatik-Modus der alten Mitgliedersuche (nur mit `MEMBER_SEARCH: true`) |
| Liste exportieren | alle vom Skript ignorierten Mitglieder mit Quelle, Grund, Zeitpunkt |
| alle Konten mit Geburtsjahr exportieren | alle gesehenen Konten mit Geburtsjahr-Spannen |
| Vorgemerkte exportieren | Mitglieder, die genau `MAX_AGE` alt sind (Vormerkliste) |
| Online-Angaben exportieren | vorkommende „zuletzt online“-Texte |
| Whitelist exportieren | feste und gelernte Whitelist mit Grund |
| Gruppen (zuletzt bearbeitet) exportieren | Gruppen mit Datum des letzten Scans |
| Fehlschläge des Party-Scans exportieren / löschen | gespeicherte Fehlschläge |
| Protokoll der Mitgliedersuche exportieren | Protokoll der systematischen Suche je Einzelsuche |
| Paare mit nur einer Altersangabe exportieren | in der Suche gefundene Paare mit nur einem Alter |
| Fehlschläge der Mitgliedersuche exportieren | gespeicherte Fehlschläge der Mitgliedersuche |
| Partys beim nächsten Scan vollständig prüfen | vergisst die bereits geprüften Anmeldungen |
| Lauf zurücksetzen | Notfall: beendet alle laufenden Vorgänge und gibt die Tab-Sperre frei |

---

## Technisches

- **Tab-Sperre:** Immer nur ein Tab arbeitet; andere Tabs zeigen nur an.
- **Hintergrund-Frames:** Gästelisten, Event-Seiten und Profile werden in unsichtbaren Frames geladen, damit die aktuelle Seite stehen bleibt.
- **Fehleranzeige:** Startfehler erscheinen in einem Panel mit „Alles zurücksetzen“.
- **Popups:** alle im selben Stil (dunkler Kasten, große Buttons untereinander wie bei JOYclub; rot nur für Buttons, die einen Scan starten; vorausgewählter Button weiß umrandet, Esc schließt).
- **Umkreise:** `CONFIG.AREAS` enthält 90 Städte mit GeoNames-ID, deren 50-km-Umkreise ganz Deutschland abdecken – gruppiert nach Bundesland (NRW zuerst und vollständig, dann absteigend).
