# joyclub-opa-scan

Implementiert einen Schutz vor sabbernden alten Opas in JOYclub.

Ein Tampermonkey-Userscript für [joyclub.de](https://www.joyclub.de). Es findet Mitglieder, die nach festen Regeln zu alt sind (bzw. Paare mit großem Altersunterschied), schreibt ihnen eine Profilnotiz und setzt sie auf die JOYclub-Ignorierliste – bei Interaktionen („Mögen mich“), Profilbesuchern, auf Partys, in Gruppen und in der Mitgliedersuche.

Stand: Version 1.73 – Änderungen siehe [changelog.txt](changelog.txt)

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

`DRY_RUN: true` (auf der Seite „Opa-Schutz“: *Testlauf*) schaltet einen Testmodus ein, in dem nichts verändert wird.

---

## Einstieg: Menü und Titelzeile

<img src="docs/menue-entwurf.png" width="300" alt="Hamburger-Menü (Entwurf): Opa-Scan und Opa-Schutz">

- **Hamburger-Menü**, Block „Profil & Einstellungen“: **Opa-Scan** (Opa-Lupe) vor „Profil verwalten“ startet alle Scans nacheinander; **Opa-Schutz** (Opa) vor dem Sichtbarkeits-Eintrag („Für Freunde sichtbar“ o. ä. – gefunden über das Linkziel `/edit/invisible/`) öffnet die Einstellungen.
- **Titelzeile:** rechts neben „Kontakte“ ein Opa-Button mit Status darunter (*aktiv*, *Testlauf*, *Scan läuft* oder ab 95 % Füllstand die Zahl der Sperren, z. B. *987/1000*); Klick öffnet die Einstellungen. Wie „Kontakte“ auf kleinen Bildschirmen ausgeblendet.
- **Profilverwaltung:** „Opa-Schutz“ ist erster Punkt unter „Sicherheit & Datenschutz“ in der linken Spalte.

---

## Einstellungen: Seite „Opa-Schutz“

Adresse: `https://www.joyclub.de/edit/account/#opa-schutz` – aufgebaut wie JOYclubs Seite „Account“.

<img src="docs/einstellungen.png" width="480" alt="Seite Opa-Schutz">

- **Immer sichtbar:** Höchstalter Männer, Warnalter, Profiltypen, Paar-Modus, Altersunterschied Sugar Daddy, Mindestalter Geronto-Paar, Whitelist (Zusammenfassung + Button **Whitelist bearbeiten**).
- **Experten-Einstellungen** (beim Öffnen immer zugeklappt): Debug-Ausgaben, Testlauf, Suche ignoriert (rote Warnung, wenn an), Obergrenze für den ersten Scan von Profilbesuchern/Interaktionen, **Limit** der Ignorierliste (rot), **Rangfolge der Quellen** (▲▼, Erklärung beim Darüberfahren), Notiz schreiben, Notiz Pflicht.

  <img src="docs/einstellungen-experten.png" width="480" alt="Experten-Einstellungen">
- **Speichern / Abbrechen.** Wer die Seite mit ungespeicherten Änderungen verlässt, wird gefragt (*Speichern und verlassen / Verwerfen und verlassen / Abbrechen*); beim Schließen oder Neuladen des Tabs kommt die Standardabfrage des Browsers.

  <img src="docs/einstellungen-verlassen.png" width="360" alt="Rückfrage beim Verlassen">

**Speicherung:** Die Einstellungen liegen im Tampermonkey-Speicher, zusammen mit dem zuletzt gesehenen Wert aus dem Quelltext. Ändert man einen Wert im Quelltext, gilt ab dann dieser; solange der Quelltext-Wert gleich bleibt, gilt der gespeicherte. Abweichungen vom Quelltext sind mit „°“ markiert, der Link **Quelltext-Wert** setzt zurück. Betroffen: `DRY_RUN`, `DEBUG`, `SEARCH_IGNORE`, `IGNORE_LIMIT`, `MYJOY_FIRST_MAX`, `MAX_AGE`, `WARN_AGE`, `ONLY_TYPES`, `COUPLE_MODE`, `COUPLE_AGE_GAP`, `COUPLE_BOTH_MIN_AGE`, `WHITELIST`, `WRITE_NOTE`, `NOTE_REQUIRED`, `SOURCE_RANK`. Alles andere steht nur im Quelltext.

---

## Whitelist

**Bearbeiten** im Popup „Whitelist bearbeiten“ (Seite „Opa-Schutz“):

<img src="docs/whitelist-popup.png" width="360" alt="Whitelist bearbeiten">

- Oben die Liste **Eigene Whitelist-Gruppen** (alphabetisch): Eingabefeld + „Speichern“ für neue Gruppen, ✎ zum Umbenennen, ✕ zum Löschen. Eine Gruppe darf leer sein; ein schon vorhandener Name wird abgelehnt.
- Darunter je Gruppe eine eigene Liste ihrer Mitglieder (alphabetisch) mit Eingabefeld + „Speichern“ und ✕. Jedes Mitglied darf nur in **einer** Gruppe stehen („Steht schon in …“).
- Löschen einer Gruppe fragt nach, weil auch alle ihre Mitglieder gelöscht werden (vorausgewählt: Abbrechen):

  <img src="docs/whitelist-gruppe-loeschen.png" width="360" alt="Gruppe löschen">
- Ganz unten **Automatisch gefunden** mit Grund und Datum, ✕ entfernt einen Eintrag. Wer in eine eigene Gruppe eingetragen wird, verschwindet dort; automatisch wird niemand aufgenommen, der schon auf der eigenen Whitelist steht.
- „Übernehmen“ überträgt die Änderungen auf die Seite, dauerhaft gespeichert wird erst mit „Speichern“.

Inhalt:

- **Feste Einträge** in `CONFIG.WHITELIST` bzw. auf der Seite „Opa-Schutz“, gruppiert nach Grund (Veranstalter, DJ, Party, Freundeslisten, manuell).
- **Automatisch ergänzt:**
  - Moderatoren der gescannten Gruppen (fallen bei Verlust des Moderatorenstatus wieder heraus),
  - Veranstalter gescannter Partys (dauerhaft, werden ggf. entsperrt),
  - VIP-Gäste, die im Veranstaltungstext verlinkt sind,
  - Mitglieder, die über „Nicht mehr ignorieren“ entsperrt wurden.
- Whitelist-Einträge bekommen eine eigene Profilnotiz, z. B. `Whitelist: Party "…" am …`, `Whitelist: Veranstalter von "…"`, `Whitelist: Profilbesucher am …` oder `Whitelist: Interaktion am …`.
- Profil-Links der Whitelist-Mitglieder werden gelernt, sobald sie irgendwo auftauchen.

---

## Opa-Scan aus dem Menü (alle Scans)

**Opa-Scan** im Hamburger-Menü öffnet ein Popup, das erklärt, was passiert, und alle eingebauten Scans mit Checkbox auflistet – in der aktuellen Rangfolge der Quellen, die Mitgliedersuche wegen ihrer Dauer immer zuletzt. Für Partys gibt es nur einen Eintrag (beide Event-Übersichten zeigen dieselben Partys). Die Auswahl wird gemerkt; anfangs ist alles ausgewählt außer der Mitgliedersuche, die dem Wert von `SEARCH_IGNORE` folgt. Ist das Ignorieren in der Suche aus, steht dort „Sammelt nur Statistiken …“.

<img src="docs/opa-scan-auswahl.png" width="400" alt="Opa-Scan: Auswahl">

Die Scans laufen nacheinander im Hintergrund auf der aktuellen Seite. Oben der Gesamtfortschritt („Scan 2/4: Profilbesucher“), darunter der Fortschritt des laufenden Scans:

<img src="docs/opa-scan-laeuft.png" width="400" alt="Opa-Scan läuft">

Am Ende eine Zusammenfassung je Scan: geprüft, neu ignoriert, verdrängt, „Limit erreicht, nicht gesperrt“ (Mitgliedersuche ohne Ignorieren: „würden ignoriert“).

<img src="docs/opa-scan-fertig.png" width="400" alt="Opa-Scan fertig">

---

## Profilbesucher und Interaktionen

Seiten `/my_joy/visitors/` (Reiter „Profilbesuche“, Quelle **Profilbesucher**) und `/my_joy/voting/top/` („Mögen mich“, Quelle **Interaktionen**). JOYclub wechselt die Reiter ohne Neuladen – das Skript folgt der Adresse.

- **Beim Ansehen:** Karten werden eingefärbt wie Gästelisten (rotes X bei Ignorierten, Klick → Popup „Du ignorierst …“), auch nachgeladene. Für bekannte Mitglieder wird das Datum am Abzeichen als „zuletzt gesehen“ gespeichert (siehe Quellen).
- **Datum:** „Heute“, „Gestern“, Wochentag (der letzte Tag dieses Namens, 2–6 Tage zurück) oder `TT.MM.` (laufendes Jahr, läge es in der Zukunft: Vorjahr).
- **Scan:** Button **Opa-Scan starten** rechts im Kopfbereich → Popup → „Jetzt scannen …“:

  <img src="docs/besucher-start.png" width="400" alt="Scan Profilbesucher">
- Nachgeladen wird im Hintergrund, bis das Datum vor dem Tag des letzten vollständigen Scans dieses Reiters liegt; beim ersten Scan höchstens `MYJOY_FIRST_MAX` (1000) Einträge. Paare mit zwei Altersangaben werden direkt entschieden, Paare mit einer auf dem Profil geprüft; Karten ohne Geschlecht (Clubs, Veranstalter) werden übersprungen. Kein automatischer Start.

---

## Sichtbarkeit (Unsichtbar-Modus)

Profilaufrufe hinterlassen Besuche. Das Skript liest den Status unter dem Profilnamen (leer = sichtbar, „Für Freunde sichtbar“, „Unsichtbar eingeloggt“; „Für Freunde sichtbar“ zählt als unsichtbar).

- Vor **jedem** Vorgang mit Profilaufrufen (alle Scans, Sync mit Profilaufrufen, „Nicht mehr ignorieren“) warnt es bei sichtbarem Login:

  <img src="docs/sichtbar-warnung.png" width="400" alt="Warnung: sichtbar eingeloggt">

  *Unsichtbar schalten und fortfahren* setzt den Status auf „Unsichtbar“ und wartet 15 Sekunden; *Sichtbar fortfahren* lässt alles, wie es ist; vorausgewählt ist *Abbrechen*. Nach dem Vorgang bleibt man unsichtbar.
- Wurde unsichtbar gestartet und schaltet sich jemand während des Vorgangs sichtbar (z. B. in der App), stellt das Skript beim nächsten Seiten- oder Frame-Aufruf den vorherigen Status wieder her und wartet 15 Sekunden.
- Wer auf `/edit/invisible/` „Sichtbar“ speichert, während Vorgänge laufen, wird gefragt:

  <img src="docs/sichtbar-waehrend-scan.png" width="400" alt="Sichtbar machen während eines Scans">

  *Trotzdem sichtbar machen* speichert und behandelt die laufenden Vorgänge wie mit „Sichtbar fortfahren“ gestartet; *Unsichtbar bleiben* (vorausgewählt) bricht das Speichern ab.

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
- `/dates_partys/events/registrations/` („Dates & Events“) – links neben „Vergangene Events“ (mit etwas Abstand); das Skript lädt vorher alle per Scrollen nachladbaren Partys

### Ablauf (im Hintergrund)

Ein Klick auf „Opa-Scan starten“ öffnet sofort das Scan-Popup (keine Browser-Meldungen): Es sammelt die Partys, nennt ihre Zahl bzw. den Grund, warum gerade kein Scan möglich ist, und startet erst mit **„Jetzt scannen …“**. Danach wird daraus „Abbrechen“.

<img src="docs/party-start.png" width="400" alt="Party-Scan vor dem Start">

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
- Klick auf ein ignoriertes Mitglied öffnet ein Popup *„Du ignorierst …“* mit Grund (Profilnotiz) und den Buttons **Trotzdem öffnen**, **Nicht mehr ignorieren** (entsperrt und setzt auf die Whitelist) und **Abbrechen**:

  <img src="docs/popup-ignoriert.png" width="400" alt="Popup für ein ignoriertes Mitglied">
- Reiter **„Opa-Liste“** (zwischen „Dates“ und „Kommentare“): Testlauf des Scans für diese Party; listet alphabetisch alle bereits ignorierten bzw. die Kriterien erfüllenden Gäste mit Profil-Links und der Wahl *Ignorieren / Whitelist*, dann „Anwenden“.

---

## Mitgliedersuche

Im Seitenkopf der Suche `/member/` steht rechts neben der Lupe (Namenssuche) ein eigener Button mit **Opa-mit-Lupe-Icon** <img src="docs/icon-opa-lupe.png" width="28" alt="Icon">. Er öffnet ein Popup mit den Möglichkeiten (ggf. auch „fortsetzen“):

<img src="docs/suche-auswahl.png" width="400" alt="Auswahl-Popup der Mitgliedersuche">

**Ignorieren oder nur zählen:** Mit `SEARCH_IGNORE: false` (Standard; Seite „Opa-Schutz“ → *Suche ignoriert*) erstellt die Mitgliedersuche nur Statistik: Das Popup heißt „Opa-Scan (nur Statistik)“, Paare mit einer Altersangabe werden im Profil nur gelesen, Vorgemerkte nur gezählt, Mehrfachfunde zählen einmal; die Liste „würden ignoriert“ lässt sich exportieren. Grund: Die Suche findet weit mehr Treffer, als die Ignorierliste fasst.

### Mit aktuellen Sucheinstellungen filtern

Lädt die gerade eingestellte Suche in einem unsichtbaren Frame komplett nach, bestimmt die Treffer nach den Regeln (MAX_AGE, Typen, Paar-Regeln, Whitelist) und ignoriert sie im Hintergrund (Notiz-Quelle „Suche“).

### Systematische Suche

Ein zweites Popup spiegelt die JOYclub-Filter **Ich suche** (Frauen, Männer, Paare, Non-binary) und **Alter** (18 bis 70+) und listet alle Bundesländer aus `CONFIG.AREAS` mit Checkbox und Zahl der Umkreise (Hamburg und Bremen laufen unter „Niedersachsen / Hamburg / Bremen“). Die Auswahl wird gemerkt.

<img src="docs/suche-systematisch.png" width="400" alt="Einstellungen der systematischen Suche">

Ablauf:
- Für jeden Umkreis (50 km um eine Stadt) und jedes Alter einzeln – rückwärts von 70+ bis zur Untergrenze – wird die Suche per Deeplink aufgerufen:
  `/member/<ort>-x<GeoNames-ID>-r/is-<typen>/?user_geo_distance=50&user_age=<alter>_<alter>`
  (JOYclub nutzt GeoNames-IDs als Orts-ID; `70_70` bedeutet „70 und älter“, Werte über 70 kennt die Suche nicht.)
- Jede Einzelsuche wird wiederholt, bis ein Durchlauf keine neuen Profile mehr bringt (höchstens 20, bei 70+ höchstens 200 Durchläufe); Treffer werden nach jedem Durchlauf ignoriert.
- Paare werden anhand ihrer zwei Altersangaben entschieden; Paare mit nur einer Altersangabe werden auf dem Profil geprüft und gesondert gemerkt.
- Zu Beginn jedes Such-Scans werden fällige Vorgemerkte (inzwischen über `MAX_AGE`) ignoriert.
- Fortschritt: zwei Balken – **Gesamt** (jeder Umkreis zählt gleich viel; innerhalb eines Umkreises zählt 70+ zehnfach, jedes weitere Alter einfach) und **aktuelle Altersklasse**; die Kopfzeile zeigt Alter und Umkreis als „x/Gesamt“:

  <img src="docs/suche-laeuft.png" width="400" alt="Systematische Suche läuft">
- Protokoll je Einzelsuche: Stadt, Bundesland, Orts-ID, Alter, Zahl der Durchläufe bis ohne neue Treffer, gefundene und ignorierte Profile, ob die Obergrenze erreicht wurde.

### Sonstiges

- Das Popup während des Scans entspricht dem des Party-Scans (Warnhinweis, Fortschrittsbalken, Statistik, Abbrechen); am Ende gibt es Export-Buttons für Protokoll, Paare mit einer Altersangabe und Fehlschläge.
- Header-Badge mit der Zahl der vom Skript blockierten Opas.
- **Markierung der Ergebnisse** (bei normalem Aufruf, nicht in den Scan-Frames): Karten werden wie Gästelisten auf Partys eingefärbt, ignorierte Mitglieder bleiben sichtbar und bekommen ein rotes X; ein Klick darauf öffnet das Popup *„Du ignorierst …“* („Nicht mehr ignorieren“ schreibt hier `Whitelist: Suche am …`). „Mann“ wird zu Jungschwanz / Schwanz / Opa.
- Eine unterbrochene systematische Suche (Abbrechen, Abmeldung) lässt sich im Auswahl-Popup an derselben Stelle fortsetzen.
- Die alte Behandlung der Suche (Panel, Automatik, Ignorieren im Tab) wurde in Version 1.73 entfernt.

---

## Wartung und Abmeldung

Alle Scans (Party, Mitgliedersuche, Gruppen, Profilprüfungen im Hintergrund) erkennen, wenn JOYclub statt der gewünschten Seite etwas anderes liefert:

| Seite | Erkennung | Reaktion |
|---|---|---|
| angemeldet | `body[data-session-user-id]` | normal weiter |
| abgemeldet | Gast-Seite („Erst einloggen, dann loslegen – Fehler 401“, `body.guest`, Login-Link) | Login in einem kleinen Fenster über `www.joyclub.de/webauth/login/` → `identity.joyclub.com`: sind Benutzername und Passwort (vom Browser) ausgefüllt, hakt das Skript „Angemeldet bleiben“ an und klickt „Login“ – höchstens einmal pro Abmeldung und einmal in 30 Minuten. Klappt das nicht (leere Felder, Cloudflare-Prüfung), pausiert der Scan, bis man sich im Fenster selbst angemeldet hat, und läuft dann weiter |
| Wartungsseite | weder angemeldet noch Login-Feld | Uhrzeit aus dem Hinweis lesen („bis voraussichtlich 17 Uhr“) und bis dahin plus zufällig 5–10 Minuten **gar nicht** auf JOYclub zugreifen (ohne Uhrzeit: 30 Minuten plus 5–10); danach den unterbrochenen Schritt wiederholen |

Pausen zählen nicht als Fehlschlag, gelten für alle Tabs und stehen im Protokoll-Export der Mitgliedersuche. Während einer Pause heißt das Popup „Opa-Scan pausiert“.

Auf `identity.joyclub.com` wird das Skript nur aktiv, wenn es den Login selbst angestoßen hat – ein Login von Hand bleibt unberührt.

---

## Ignorierliste synchronisieren

Auf `/ignore/` steht unter „Mitglied sperren“ der Button **Synchronisieren** (mit Kreispfeil) und darunter der Stand des letzten Abgleichs. Ein Klick öffnet:

<img src="docs/sync-auswahl.png" width="400" alt="Sync-Modus wählen">

| Modus | Ohne „Notizen abgleichen“ | Mit „Notizen abgleichen“ |
|---|---|---|
| **JOYclub hat Vorrang** (z. B. nach Verlust der Skript-Daten) | auf JOYclub Gesperrte werden im Skript als gesperrt vermerkt; im Skript Gesperrte, die nicht mehr auf der Liste stehen, gelten als entsperrt; Whitelist-Mitglieder, die gesperrt sind, bleiben gesperrt und werden aufgelistet | zusätzlich Art, Quelle sowie Datum/Uhrzeit aus der Profilnotiz übernehmen |
| **Script hat Vorrang** | auf JOYclub entsperren, wer dem Skript nicht als gesperrt bekannt ist oder auf der Whitelist steht; im Skript Gesperrte, die auf JOYclub fehlen, mit Notiz wieder sperren | weicht die Notiz in Art („Alter Sack“ / „Sugar Daddy“ / „Geronto-Paar“) oder Quelle ab (auch: leer), wird entsperrt, die Notiz angeglichen und wieder gesperrt; bei Entsperrten werden die eigenen Notizzeilen entfernt (Whitelist-Mitglieder bekommen ihre Whitelist-Zeile) |

Fehlen dem Skript Angaben, ergänzt es sie beim ohnehin nötigen Profilaufruf (Typ, Alter); ist keine Quelle bekannt, gilt „Sync“. Das Popup zeigt den Fortschritt aus Einlesen und Änderungen (deren Umfang erst nach dem Einlesen feststeht) und warnt, die Seite nicht zu verlassen:

<img src="docs/sync-fertig.png" width="400" alt="Synchronisierung fertig">

---

## Quellen, „zuletzt gesehen“ und das Limit der Ignorierliste

### Rangfolge

Jede Sperre merkt sich ihre Quelle. Standard: **Interaktionen** (`Likes`) > **Profilbesucher** (`Besucher`) > **Partygäste** (`Party`) > **Gruppen** > **Mitgliedersuche** (`Suche`) > **Synchronisation** (`Sync`); änderbar auf der Seite „Opa-Schutz“ (gilt ab dann, bestehende Sperren werden nicht umsortiert). Einträge ohne Quelle stehen ganz unten. Dieselbe Rangfolge gilt für die Quelle der Vorgemerkten. Die Profilnotiz auf JOYclub gleicht der nächste Sync „Script hat Vorrang“ mit Notizen an.

### „Zuletzt gesehen“

Gespeichert für Sperren und in der Konten-Liste: Partydatum (beim Scan und schon beim Ansehen einer Gästeliste), Besuchs- bzw. Like-Datum. Gruppen und Suche haben kein Datum.

| Sichtung in … | Ergebnis |
|---|---|
| höherer Quelle | Quelle steigt, Datum = Datum dieser Sichtung (darf dabei einmalig sinken) |
| gleicher Quelle | nur ein neueres Datum ersetzt das alte |
| niedrigerer Quelle | Quelle und Datum bleiben |

Beispiel: Partygäste, 01.10.2026 + „Mögen mich“ vom 25.09.2026 → Interaktionen, 25.09.2026. Wer früher auf einer Party war, aber jetzt über Gruppen oder Suche gesperrt wird, behält deren Quelle, bis ihn wieder eine Party zeigt.

### Limit und Verdrängung

JOYclub behält nur die letzten `IGNORE_LIMIT` (1000) Sperren. Jeder Scan liest zu Beginn die Ignorierliste ein und zeigt den Füllstand („Ignorierliste: 987/1.000 (13 frei)“). Ist sie voll, macht das Skript vor einer neuen Sperre genau einen Platz frei – und entfernt dabei die eigene Notizzeile des Verdrängten:

1. Nur Einträge aus **gleich- oder niedrigerrangigen** Quellen; von Hand Gesperrte nie. Ist nichts verdrängbar, wird nicht gesperrt („Limit erreicht, nicht gesperrt“).
2. Niedrigste Quelle zuerst; darin wer **am längsten nicht gesehen** wurde (ohne Datum = 01.01.1970), aber nur, wenn „zuletzt gesehen“ in der Vergangenheit liegt (eine heutige Party gilt als zukünftig); bei Gleichstand die älteste Sperre.
3. Liegt alles in der Zukunft: **Altersregel** – Opas und Geronto-Paare mit den wenigsten Tagen über ihrer Grenze (Opa: 50. Geburtstag; Geronto-Paar: 60. Geburtstag des Mannes), bei Gleichstand zuerst das Paar. Das Alter kommt aus den Geburtszeiträumen (mit Sternzeichen), sonst aus der Mitte des Zeitraums.
4. Sugar Daddys sind von der Altersregel ausgenommen. Ein **neuer Sugar Daddy** verdrängt, wenn sonst nichts geht, den Sugar Daddy mit dem jüngsten Mann – nur wenn der neue Mann älter ist; bei gleichem Alter gewinnt der größere Altersunterschied, bei gleichem Unterschied bleibt der bisherige. Neue Opas oder Paare verdrängen nie Sugar Daddys.

Im Script-Speicher steht beim Verdrängten „entsperrt (Platz für neue Sperre, Limit)“.

---

## Profilseiten

- „Mann“ wird im Profilkopf zu Jungschwanz / Schwanz / Opa (mit Opa-Icon).
- Alter, Typ und „zuletzt online“ werden mitgeschrieben; daraus berechnet das Skript Geburtsjahr-Spannen (bei Paaren für beide Personen).
- **Sternzeichen** aus dem Steckbrief grenzen den Geburtszeitraum weiter ein (Grenztage ±1 Tag; bei Paaren je Person über Geschlechts-Symbol und Alter zugeordnet). Passt ein Sternzeichen nicht zum Zeitraum, wird es ignoriert.

---

## Exporte und Menü

Im Tampermonkey-Menü (alle Exporte als CSV mit `;`, Excel-tauglich):

| Menüeintrag | Inhalt |
|---|---|
| Liste exportieren | alle vom Skript ignorierten Mitglieder mit Quelle, Grund, Zeitpunkt, „zuletzt gesehen“ |
| alle Konten mit Geburtsjahr exportieren | alle gesehenen Konten mit Geburtsjahr-Spannen, „zuletzt gesehen“ (Datum, Quelle), Sternzeichen |
| Vorgemerkte exportieren | Mitglieder, die genau `MAX_AGE` alt sind (Vormerkliste) |
| Online-Angaben exportieren | vorkommende „zuletzt online“-Texte |
| Whitelist exportieren | feste und gelernte Whitelist mit Grund |
| Gruppen (zuletzt bearbeitet) exportieren | Gruppen mit Datum des letzten Scans |
| Fehlschläge des Party-Scans exportieren / löschen | gespeicherte Fehlschläge |
| Protokoll der Mitgliedersuche exportieren | Protokoll der systematischen Suche je Einzelsuche |
| Paare mit nur einer Altersangabe exportieren | in der Suche gefundene Paare mit nur einem Alter |
| Fehlschläge der Mitgliedersuche exportieren | gespeicherte Fehlschläge der Mitgliedersuche |
| Mitgliedersuche – „würden ignoriert“ exportieren | Treffer der Suche im Statistik-Modus (`SEARCH_IGNORE: false`) |
| Einstellungen (Opa-Schutz) öffnen | öffnet die Seite „Opa-Schutz“ |
| Partys beim nächsten Scan vollständig prüfen | vergisst die bereits geprüften Anmeldungen |
| Erledigt-Liste leeren | löscht das Protokoll der vom Skript Ignorierten (mit Rückfrage) |
| Fehlschläge leeren | löscht alle gespeicherten Fehlschläge (mit Rückfrage) |
| Typen-Info leeren | löscht die gesammelten Infos zu anderen Profiltypen (mit Rückfrage) |
| Lauf zurücksetzen | Notfall: beendet alle laufenden Vorgänge und gibt die Tab-Sperre frei |

---

## Technisches

- **Tab-Sperre:** Immer nur ein Tab arbeitet; andere Tabs zeigen nur an.
- **Hintergrund-Frames:** Gästelisten, Event-Seiten und Profile werden in unsichtbaren Frames geladen, damit die aktuelle Seite stehen bleibt.
- **Fehleranzeige:** Startfehler erscheinen in einem Panel mit „Alles zurücksetzen“.
- **Popups:** alle im selben Stil (dunkler Kasten, große Buttons untereinander wie bei JOYclub; rot nur für Buttons, die einen Scan starten; vorausgewählter Button weiß umrandet, Esc schließt).
- **Umkreise:** `CONFIG.AREAS` enthält 90 Städte mit GeoNames-ID, deren 50-km-Umkreise ganz Deutschland abdecken – gruppiert nach Bundesland (NRW zuerst und vollständig, dann absteigend).
