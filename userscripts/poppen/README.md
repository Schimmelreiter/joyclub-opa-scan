# poppen-opa-scan

Implementiert einen Schutz vor sabbernden alten Opas auf poppen.de.

Ein Tampermonkey-Userscript für [poppen.de](https://www.poppen.de). Es findet Mitglieder, die nach einstellbaren Regeln zu alt sind (bzw. Paare mit großem Altersunterschied), und setzt sie mit einer Notiz auf die Blockierliste von poppen.de – bei Interaktionen (Likes, Sticker, Nachrichten), Profilbesuchern, in Gruppen und in der Mitgliedersuche. Dazu kommen eine private Fickliste, Figur-Badges in der Suche, eine Whitelist für Mitglieder verwalteter Gruppen und die Prüfung von Gruppen-Beitrittsanfragen.

Das Gegenstück für JOYclub: [joyclub-opa-scan](https://github.com/Schimmelreiter/joyclub-opa-scan).

Stand: Version 2.8 – Änderungen siehe [changelog.txt](changelog.txt)

---

## Installation und Updates

1. [Tampermonkey](https://www.tampermonkey.net/) im Browser installieren.
2. Diesen Link öffnen und auf „Installieren“ klicken:
   https://raw.githubusercontent.com/Schimmelreiter/poppen-opa-scan/main/poppen-opa-schutz.user.js
3. Updates holt Tampermonkey automatisch (`@updateURL`), standardmäßig einmal täglich – sofort über *Dashboard → Nach Updates suchen*.

Beim ersten Start fragt Tampermonkey nach den Rechten des Skripts (u. a. Zugriff auf `img-z.poppen.de`, um kleine Kopien von Profilbildern zu speichern).

> **Erst testen:** Auf der Seite *Opa-Schutz → Experten-Einstellungen* gibt es den **Testlauf**. Dann wird nichts blockiert oder entsperrt, nur protokolliert (Konsole, F12).

### Wo liegen die Daten?

| Was | Wo |
|---|---|
| Einstellungen, Schalter, Zustände | Tampermonkey-Speicher |
| Mitglieder-Gedächtnis (ein Eintrag je Mitglied), Profilbilder, Profil-Archiv, Warteliste, Fickliste, API-Rekorder | Datenbank des Browsers für poppen.de (IndexedDB) |

Das Mitglieder-Gedächtnis kann mit Gruppen-Scans weit über 100.000 Einträge groß werden. In der Browser-Datenbank wird jeder Eintrag einzeln gelesen und geschrieben; im Tampermonkey-Speicher würde alles bei jedem Seitenaufruf geladen. **Wer im Browser die Website-Daten von poppen.de löscht, löscht auch das Gedächtnis** – deshalb regelmäßig *Alle Daten sichern*.

---

## Regeln: Wer wird blockiert?

Die Mitglieder werden in drei **Gruppen** eingeteilt: **Männer**, **Frauen** und **Paare**. Standardmäßig gelten für eine Gruppe **gemeinsame Grenzen für alle Quellen** (Zeile „Global“). Schaltet man das in den Experten-Einstellungen ab, hat jede Gruppe je **Quelle** (Interaktionen, Profilbesucher, Gruppen, Mitgliedersuche) eigene Altersgrenzen. Die Quelle **Partygäste** sind poppens Events („Gehe“ und „Vielleicht“); ihre Grenzen starten mit den Werten der Profilbesucher. Alle Schieberegler reichen von 18 bis 99; **99 ist ein offenes Ende** (schließt auch 100-Jährige ein).

- **„Grenzen altern mit mir“:** je Gruppe ein Schalter für die visuelle Einstufung und einer für „Ignorieren ab“. An deinem Geburtstag (Geburtsdatum aus dem eigenen Profil; sonst, sobald das Skript das höhere Alter bemerkt) steigen die Grenzen um ein Jahr. Dadurch wird **niemand entsperrt** – entsperrt wird nur, wen eine von Hand nach oben geschobene Grenze freigibt.

- **Visuelle Einstufung** in drei Stufen (zwei Grenzen): bis zur ersten Grenze Stufe 1 (grün), bis zur zweiten Stufe 2 (orange), darüber Stufe 3 (rot).
- **Ignorieren ab** einem Alter.

| Gruppe | Bezeichnungen (Einzahl) | Visuell bis | Ignorieren ab | Profiltypen (Standard) | Schalter (Standard) |
|---|---|---|---|---|---|
| Männer | Jungspund / Mann / Opa | 29 / 48 | 50 | Mann | Visuell an, Ignorieren an |
| Frauen | junge Frau / Frau / Oma | 29 / 48 | 50 | Frau | aus |
| Paare | junges Paar / Paar / Geronto-Paar | 29 / 48 | 50 | Paar | aus |

- **Profiltypen** von poppen.de: Mann (`m`), Frau (`w`), Paar (`p`), Trans (`ts`), Nicht-binär (`tv`). Jeder Typ gehört zu höchstens einer Gruppe; nicht zugeordnete Typen werden nicht bearbeitet.
- **Paare:** Paar-Regel „einer über der Grenze“ oder „beide über der Grenze“; auf Wunsch getrennte Grenzen für Frau und Mann. **Sugar Daddy** und **Sugar Mom** (großer Altersabstand) mit eigenem Schalter.
- **Warnalter:** Ein Jahr vor der Grenze wird ein Mitglied dunkelorange markiert und **vorgemerkt**. Sobald es laut Geburtszeitraum sicher über der Grenze ist, kommt es auf die Warteliste.

### Nie blockiert

- **Whitelist** (Namen, Präfixe, eigene Gruppen) – auf der Seite *Opa-Schutz* bearbeitbar.
- **poppen-Mitarbeiter** (`payclass: site_admin`).
- **Freunde und Favoriten** – die Listen (`friends/list`, `favourite/list`) werden täglich und beim Öffnen der Seiten eingelesen; zusätzlich fragt das Skript vor jeder Sperre die Profil-Kurzinfo ab (`friend_status`). Opa-Sperren von Freunden und Favoriten werden aufgehoben.
- **Gruppen-Leitung:** Besitzer und Moderatoren aller eigenen Gruppen (`group/profile`, `group/moderator/list`); bereits vom Opa-Schutz Blockierte werden entsperrt.
- **Mitglieder verwalteter Gruppen**, je Gruppe abschaltbar – aber nur, wenn du die Gruppe **allein leitest**: als Moderator nie (es gibt den Besitzer), als Besitzer nur ohne weitere Moderatoren; eigene Zweitprofile zählen nicht. Leitest du nicht allein, werden die Whitelist-Einträge dieser Gruppe sofort entfernt und die Mitglieder nach den Regeln geprüft. Wer aus allen verwalteten Gruppen verschwindet, bleibt noch **30 Tage** geschützt (er könnte sich nur unsichtbar geschaltet haben). Bereits vom Opa-Schutz Blockierte werden entsperrt. Über das Gruppenanfragen-Popup Aufgenommene sind sofort geschützt.

### Bezeichnungen und Notizen

Die Notiz auf der Blockierliste lautet z. B. `Opa (Likes) geblockt am 24.10.2026 um 14:01`. Die Quelle in Klammern sagt, wo das Mitglied gefunden wurde. Ältere Notizen („Alter Sack (Suche) geblockt am …“) werden weiter erkannt.

- Ist das **eigene Profil ein Mann**, heißt alles „**Oma**“ statt „Opa“.
- Liegt **genau einer** der eigenen Wohnsitze (Haupt- oder Zweitwohnsitz) im **Ruhrgebiet**, heißt es „**Oppa**“ bzw. „**Omma**“. Liegen mehrere in Gebieten mit Sonderregeln, gilt der zuerst genannte. Das Rheinland ist angelegt, hat aber noch keine Sonderregeln.

---

## Quellen und Scans

Alle Quellen außer den Profilbesuchern laufen über die Schnittstellen von poppen.de (`/v2-api/…`), ohne Profilaufrufe. Automatische Abfragen von Profilangaben (`user/info`) zählen bei poppen als **Profilbesuch** und laufen deshalb nur noch unsichtbar (Gruppenregeln: vorher still unsichtbar schalten, 90 Sekunden nach der letzten Abfrage zurück); vermessen wird ganz ohne Profilaufruf über die Suchfilter.

| Quelle | Woher | Notiz-Quelle |
|---|---|---|
| Interaktionen | Likes (`rates`), Sticker (`my/received/gift`), Unterhaltungen (`messenger/group/list`, ohne Nachrichtentexte) | Likes / Sticker / Nachrichten |
| Profilbesucher | Besucherliste (unsichtbar geladen und durchgescrollt) | Besucher |
| Gruppen (Whitelist) | Leitung aller Gruppen, Mitglieder verwalteter Gruppen (`group/attendee/manage/list`, siehe Whitelist); entfernt besonders böse Popsters aus verwalteten Gruppen; bei „Alle Scans“ standardmäßig an | Gruppen |
| Gruppen (Blacklist) | Mitglieder der Gruppen, in denen du Mitglied bist (`group/attendee/list`), nach den Regeln; bei „Alle Scans“ standardmäßig aus, Auswahl wird gemerkt | Gruppen |
| Mitgliedersuche | ganz Deutschland, Alter für Alter ab der Grenze (`user/search`) | Suche |
| Partygäste (Events) | alle Events weltweit (`event/search`), je Liste „Gehe“ (`event/attendee/list`) und „Vielleicht“ (`event/bookmark/list`); vorerst **nur einlesen und einfärben** (keine Warteliste, keine Whitelist) und den AWO-Faktor berechnen | Events |

**Opa-Scan** (Profil-Menü → *Opa-Scan*): Popup mit allen Scans, zwei Fortschrittsbalken, Statistik und Zusammenfassung.

**Auf den Seiten selbst** (Besucher, Likes, Sticker, Posteingang, Suche, Gruppen-Mitglieder, Event-Teilnehmer) werden die Karten markiert. Ist der Schalter *Opa-Schutz* an und die Automatik der Seite eingeschaltet, kommen Treffer auf die Warteliste.

Nebenbei merkt sich das Skript zu jedem Mitglied uid, Nick (und frühere Nicks), Alter, Geschlecht, Geburtszeitraum (aus Alter, Geburtsjahr und Sternzeichen) und – bei Likes, Stickern, Nachrichten, Besuchern und selbst geöffneten Profilen – eine kleine Kopie des Profilbilds.

---

## Blocken im Hintergrund

Scans **lesen** komplett und legen Treffer auf eine **Warteliste**. Geblockt wird **im Hintergrund**, einer nach dem anderen:

- solange der Schalter *Opa-Schutz aktiv* an ist; zwischen zwei Sperren eine zufällige Pause von **1–3 Sekunden**,
- **andere Vorgänge haben Vorrang** (Scans, Blockierliste, Gruppenanfragen, Speichern mit „Regeln geändert“, Fickliste-Import, „Trotzdem öffnen“ – auch in anderen Tabs): Das Blockieren pausiert und läuft danach weiter,
- nur ein Tab arbeitet; wird er geschlossen, übernimmt ein anderer poppen.de-Tab, sobald dieser seit einer Minute offen ist,
- nach mehreren Fehlschlägen hintereinander 5 Minuten Pause,
- Reihenfolge nach der **Rangfolge der Quellen**, innerhalb einer Quelle die Ältesten zuerst,
- vor jeder Sperre: Whitelist, Mitarbeiter, Freund, Favorit, verwaltete Gruppe und aktuelle Grenzen erneut prüfen.
- Von poppen.de **gesperrte Profile** („Blockiertes Profil“) und Profile **in Echtheitsprüfung** („Popster verifizieren“) werden beim Aufruf erkannt, im Gedächtnis mit Datum markiert und bei neuen Einträgen ans Ende der Warteliste gestellt (schon eingereihte bleiben, wo sie sind). In Listen stehen sie mit Vermerk „· von poppen gesperrt“ bzw. „· in Echtheitsprüfung“; der Vermerk verschwindet, sobald das Profil wieder zu sehen ist.

**Jetzt abarbeiten** (Experten-Einstellungen bzw. Opa-Scan) arbeitet die Warteliste in diesem Tab bis zum Ende ab – auch bei ausgeschaltetem Schalter.

Geblockt wird über `ignore/add`, die Notiz über `ignore/comment/add`. Die Notiz ist Pflicht und hat einen festen Text: Lässt sie sich nicht schreiben, wird die Sperre zurückgenommen und das Mitglied bleibt auf der Warteliste; nach drei Fehlversuchen fällt es heraus. Ohne bekannte Benutzer-ID trägt das Skript den Namen im unsichtbaren Rahmen über „Benutzer hinzufügen“ ein.

---

## Oberfläche

- **Kopfleiste:** Opa-Symbol mit der Zahl der Blockierten (Tooltip: „X geblockt, Y in der Warteschlange“); Klick öffnet immer die Einstellungen (dort steht oben die Warteliste). Läuft ein Scan, öffnet sich danach dort das „Scan läuft“-Fenster. Ein **gelber Punkt** zeigt offene Gruppenanfragen in verwalteten Gruppen; Klick öffnet die Anfragenseite.
- **Profil-Menü** (Klick auf das eigene Profilbild): *Fickliste* und *Opa-Scan* (vor „Profil bearbeiten“), *Opa-Schutz* (danach, Opa mit Stift; öffnet die Einstellungen) und der Schalter **Opa-Schutz aktiv** (vor „Unsichtbar“) für die Automatik.
- **Einstellungen:** In der linken Spalte stehen **Meine Fickliste** (nach „Meine Kontaktanzeigen“) und **Opa-Schutz** (vor „Privatsphäre“).

### Events

- Vorerst wird bei Events **nur eingefärbt**: Die Listen **„Gehe“** und **„Vielleicht“** werden gekennzeichnet und im Opa-Scan (Quelle *Partygäste*) ins Gedächtnis gelesen – niemand kommt dadurch auf die Warteliste, Veranstalter kommen nicht auf die Whitelist (2.34 hatte das kurz getan; diese Vermerke wirken seit 2.36 nicht mehr).
- **AWO-Faktor** (gemeinsame Formel mit dem JOYclub-Skript): Anteil der erwartungsgemäß anwesenden Gäste der Stufe 3 (Opa/Oma/Geronto-Paar) an „Gehe“, je Gruppe gewichtet. Stufe mit den Grenzen der Quelle *Partygäste*; unbekanntes Alter → Stufe 3; Paar mit nur einem Alter → Partner ergänzt (Frau bekannt → Mann +7, Mann bekannt → Frau −7), dann Paar-Regel (einer → höhere, beide → niedrigere Stufe), Sugar Daddy/Mom → Stufe 3. **Unsichtbare** Gäste zählen als Stufe 3; da poppen ihr Geschlecht nicht zeigt, werden sie anteilig wie die sichtbaren Gäste auf Männer/Frauen/Paare verteilt. Erwartete Anwesenheit je Gruppe und Stufe und die Gewichtung stehen in der Karte **AWO-Faktor** der Einstellungen (Standard: Männer 33/66/95 %, Frauen 95 %, Paare 90 %; Gewichtung Männer 67 · Frauen 0 · Paare 33). Berechnet nur, wenn der Party-Scan die Liste vollständig gelesen hat.
- **Plaketten in der Event-Suche** (`/search/event`, rechts oben auf dem Bild): Datum der letzten vollständigen Prüfung (Opa-Symbol, „--.--.----“ = noch nie) und darunter der AWO-Faktor – unter 10 % hellgrün, unter 25 % grün, unter 35 % orange, ab 35 % rot, „AWO –“ = noch nicht berechnet.
- Auf jeder Event-Seite: **„Als Treffen in die Fickliste …“** – trägt das Event bei einer Person der Fickliste ein (Was = Event, Wo = Ort/Straße bzw. „Online“, Datum, Uhrzeit, Link); ein Treffen am selben Tag wird ergänzt.

### Kontobindung

Die Daten in einem Browser-Profil gehören genau **einem poppen-Konto**. Beim ersten Start mit vorhandenen Daten fragt das Skript einmal: „Gehören die vorhandenen Opa-Schutz-Daten zu <Nick>?“ Ist ein anderes Konto angemeldet (z. B. versehentlich im falschen Browser-Profil), bleibt das Skript **komplett aus** – keine Scans, kein Schreiben, kein Briefkasten – und zeigt nur einen roten Hinweis. Übergeben lassen sich die Daten nur bewusst: Experten-Einstellungen › **Kontobindung** › „Daten an anderes Konto übergeben“ (das nächste andere Konto wird innerhalb von 7 Tagen gefragt). „Wiederherstellen“ lehnt Sicherungen eines anderen Kontos ab. Gehört die gemeinsame Ablage laut `owner` einem anderen Konto, schreibt das Skript weder Fickliste noch Textvorlagen.

### Seite „Opa-Schutz“ (`/setting/profile#opa-schutz`)

- **Anmeldung:** Auf der Anmeldeseite wartet das Skript bis zu 20 Sekunden auf die vom Browser gespeicherten Anmeldedaten; nach erfolgter Anmeldung lädt die Seite neu.
- Titel mit Versionsnummer. Kopfzeile: „Derzeit blockiert: n (Blockierliste + Warteliste) / Höchstzahl“ und „Mit neuen Einstellungen“ (derzeit blockiert − fallen weg + kommen dazu, aus dem Gedächtnis berechnet). Damit die Zahl stimmt, gleicht das Skript die Blockierliste still mit dem Gedächtnis ab, ohne etwas zu ändern: beim ersten Mal und monatlich vollständig, sonst täglich bzw. nach einem Update nur die neuesten Einträge. Währenddessen steht dort der Fortschritt („Blockierliste wird eingelesen: n von x (… %)“).
- Je Gruppe: Schalter „Visuelle Einstufung“/„Ignorieren aktiv“ (was gerade nichts bewirkt, ist ausgeblendet: Visuell-Teile nur bei „Visuelle Einstufung“, Ignorieren-Teile nur bei „Ignorieren aktiv“, Profiltypen und Paar-Zeilen bei einem von beiden; die Spalten behalten ihre Breite), darunter „Grenzen altern mit mir“, Grenzen (eine Zeile „Global“ bzw. je Quelle mit „Werte der ersten Zeile übernehmen“), Bezeichnungen (oben Einzahl, unten Mehrzahl), Profiltypen; bei Paaren Paar-Regel, getrenntes Alter (je eine Zeile für Frau und Mann), Sugar Daddy/Mom.
- Allgemein: Warnalter, Whitelist (mit Gruppen), automatische Whitelist (nur lesbar).
- Gruppen: verwaltete Gruppen mit Schalter „Mitglieder whitelisten“, übrige Gruppen mit Haken für den Gruppen-Scan.
- Automatik, automatische Anmeldung, Wartungsseite. Die Regeln für Gruppenanfragen stehen im Regel-Editor der jeweiligen Gruppe (Anfragen- bzw. Bearbeiten-Seite).
- **Experten-Einstellungen** (immer zugeklappt): **Gemeinsame Grenzen für alle Quellen**, Rangfolge der Quellen (untereinander, mit ▲▼), API-Rekorder, **Kontobindung**, Datensicherung, **Gedächtnis** (Wissen über andere Mitglieder, Fickliste & Textvorlagen: Export/Import), Warteliste (Anzeigen, **Jetzt abarbeiten**, Leeren), am Ende Debug, Testlauf, Obergrenze erster Scan und Höchstzahl der Einträge auf der Blockierliste (Standard 10.000.000). Feste Werte im Skript: Pause zwischen Sperren 1–3 s, Messung gültig 90 Tage (unbekannt 30), Schonfrist 30 Tage.
- Wer die Seite mit ungespeicherten Änderungen verlässt, wird gefragt.
- **Regeln geändert:** Beim Speichern zeigt ein Popup, wie viele Sperren wegfallen oder dazukommen und wie viele Notizen abweichen: speichern und anwenden, nur entsperren, nur sperren, nur speichern oder verwerfen.

### Blockierliste (`/setting/privacy/ignore-list`)

Beim Öffnen passiert nichts automatisch. Unter „Benutzer hinzufügen“ stehen:

| Button | Wirkung |
|---|---|
| **Reparieren** | liest die ganze Liste über die Schnittstelle; nicht mehr Blockierte fallen aus dem Gedächtnis, Einträge mit Opa-Notiz werden übernommen, alle Notizen abgeglichen (auch von Hand geänderte und die von Hand Blockierter), fehlende Notizen ergänzt; ersetzt das monatliche vollständige Einlesen |
| **Synchronisieren – poppen.de hat Vorrang** | übernimmt Einträge mit Opa-Notiz samt Quelle (unbekannte Quelle → „Sync“); im Skript Blockierte, die auf poppen.de fehlen, gelten als entsperrt |
| **Synchronisieren – Script hat Vorrang** | blockiert im Skript Blockierte neu und entsperrt Einträge mit Opa-Notiz, die das Skript nicht (mehr) blockieren würde – nach einer Rückfrage mit Zahlen |
| Notizen abgleichen (Haken) | passt Opa-Notizen an die aktuelle Vorlage an |

Von Hand Blockierte (ohne Opa-Notiz) werden nie angefasst. Der **Mülleimer** fragt bei vom Opa-Schutz Blockierten nach: *Trotzdem entsperren / Trotzdem entsperren & Whitelist / Abbrechen*.

### Profil eines Geblockten

Auf „Du hast diesen Popster blockiert“ kommen **Trotzdem öffnen** (einmalig entsperren, beim Verlassen wieder sperren) und **Nicht mehr ignorieren** dazu, darunter der Grund (die Notiz).

### Sichtbarkeit

Funktionen, die ein Profil aufrufen (Prüfung von Gruppenanfragen, „Trotzdem öffnen“), warnen vorher: *Unsichtbar schalten und fortfahren / Sichtbar fortfahren / Abbrechen*. Beim Unsichtbar-Schalten (`wio/state`) wartet das Skript 15 Sekunden und stellt danach den vorherigen Zustand wieder her.

---

## Blockierende Popsters

Alle 30 Minuten liest das Skript die Liste der Popsters, die dich blockieren (`ignore/be-ignored/uid/list`), und merkt sie sich als „besonders böse“. Diese Popsters werden beim Scan **Gruppen (Whitelist)** (und im täglichen Hintergrundlauf) aus deinen **verwalteten** Gruppen entfernt – vorher mit einem Vermerk am Mitglied („Ignorant (Gruppe) blockiert am … um …“).

Die Zuordnung User-ID → Nickname liegt dauerhaft im Tampermonkey-Speicher und überlebt so das Löschen der poppen.de-Browserdaten; das Profilgedächtnis dient nur als Rückfallebene. Geänderte Nicknames (gleiche ID) werden nach jedem Whitelist-Scan und einmal täglich nachgeführt. Entfernt wird anhand der ID, nicht des Namens.

Angezeigt wird die Liste unter *Datenschutzeinstellungen → **Blockierende Popsters*** (auf `/setting/privacy/home`, direkt über „Wer kann was sehen“). Die Ansicht ist **nicht änderbar**: bekannte Mitglieder mit Bild, Name (Link zum Profil) und „Geschlecht · Alter · Ort“, sonst ein Platzhalter mit der ID. Platzhalter werden über die **ID-Auflösung** nachgetragen (`messenger/group/item/p2p`, gedrosselt, je ID einmal) – aber erst, wenn deren Selbsttest an bekannten Profilen bestanden ist (Nick, Geschlecht, Alter; zudem darf beim Auflösen kein leerer Chat entstehen). Dieselbe Auflösung ergänzt fehlende Nicknames bei „Besonders böse Popsters“, im Gedächtnis und auf der Warteliste.

## Gruppen-Beitrittsanfragen

Je Gruppe gibt es einen **Regel-Editor** (Anfragen- und Bearbeiten-Seite der Gruppe) mit je einem Block pro Geschlecht: „Automatisch annehmen, wenn …“ und „Automatisch ablehnen, wenn …“. Jedes Glied hat seine eigene Verknüpfung davor (UND / ODER / UND NICHT / ODER NICHT); **UND bindet stärker als ODER**. Jede UND-Strecke steht in einem eigenen Kasten, jeder ODER-Abschnitt der obersten Ebene ist eine Hauptgruppe mit eigener **Begründung**. Pfeile je Glied: ⇐ aus der Gruppe heraus, ⇑/⇓ in die Gruppe darüber/darunter, ⇒ in eine neue Gruppe, ↑/↓ verschieben. Verneinte Operatoren gibt es nicht (das macht „… NICHT“); bei der ethnischen Zugehörigkeit ist „keine Angabe“ ein eigener Wert-Chip.

- **Im Hintergrund:** Meldet die Glocke „… möchte deiner Gruppe … beitreten“ oder hat eine verwaltete Gruppe mit Regeln offene Anfragen, bearbeitet das Skript sie über die Schnittstellen (`group/attendee/approve`/`deny`), höchstens alle 15 Minuten je Gruppe. Wer schon unter „Bearbeitete Beitrittsanfragen“ steht, wird wieder so entschieden.
- **Notiz zuerst:** Vor jedem Annehmen/Ablehnen wird die Notiz geschrieben: `Angenommen|Abgelehnt in "<Gruppe>" [wegen <Begründung>] am TT.MM.JJJJ`. Das gilt auch für die Original-Knöpfe der Seite: ein eigener Text im Notizfeld wird zur Begründung, Ignorier-/Whitelist-Notizen bleiben erhalten.
- **Bearbeitete Beitrittsanfragen** (Menüpunkt unter „Beitrittsanfragen“): alle Entscheidungen mit Papierkorb. Abgelehnte: aus der Liste nehmen und Ablehnungs-Notiz löschen. Angenommene: Notiz wird zu `Entfernt aus "<Gruppe>" am TT.MM.JJJJ`, dann Rauswurf aus der Gruppe.
- Der Knopf **Automatische Annahme/Ablehnung** auf der Anfragenseite prüft alle offenen Anfragen sichtbar; nicht Entscheidbares geht in die manuelle Prüfung (Angaben, Fotos, Notizfeld).

---

## Fickliste

Nur für dich sichtbar.

- **Button** nach „Nachricht senden“ mit fünf Zuständen und denselben Symbolen wie im JOYclub-Skript: *Ficken?*, *Will ich*, *Gefickt*, *Nein, danke!*, *Nie wieder!*; Menü mit den anderen Zuständen, „Fickstatus zurücksetzen“ und „Treffen eintragen“.
- **Abschnitt „Fickliste“** im Profil unter „Fotos“/„Videos“: Status, Treffen (Datum, was, wo, Link, Notiz), **Anmerkungen** (freies Textfeld zur Person, bis 8000 Zeichen, mit ✎ bearbeiten), Profile auf anderen Plattformen, Profil-Archiv.
- **Meine Fickliste** (Einstellungen): Zähler je Zustand als Filter, Filter nach Mitglied, Was, Wo, Datum und Plattform (Mehrfachauswahl, „Andere / ohne“), Sortierung nach Datum oder Name; Personen ohne Treffen erscheinen ebenfalls. Gelöschte Profile sind durchgestrichen, deaktivierte rot. Hinter dem Status stehen die Plattform-Symbole.
- **Kasten im eigenen Profil** über den Statistiken: Zähler und die letzten Ficks mit drei verschiedenen Personen.
- **Profil-Archiv:** Bei jedem Profilaufruf und jeder Statusänderung wird ein Stand gespeichert; Navigation ‹ › und « » (direkt vor/nach einem Treffen).
- **Externe Ficks:** Personen ohne poppen-Profil mit eigenem Bild, Typ, Ort und Texten.
- **Andere Plattformen** (Popup **„Auch auf …“**: im Menü des Fickliste-Buttons, im Fickliste-Kasten über den Knopf **+** hinter „Auch auf:“ und in „Meine Fickliste“ je Person): JOYclub, xHamster, Eronity, SpicyMatch, Kaufmich, Fetish.com, Gays.com, Telegram (`@Name`/`t.me/Name` → `https://t.me/Name`), WhatsApp (Nummer/`wa.me` → `https://wa.me/49…`, „00“ wird „+“, ohne Vorwahl +49), Threema (`https://threema.id/ID`), Signal (Nummer → `https://signal.me/#p/+49…`, Benutzername nur als Text mit ⧉) und „Andere …“ mit eigenem Plattformnamen. Je Profil Häkchen „Profil gelöscht“ (durchgestrichen) und ✕ zum Entfernen. Als Symbole dienen die echten Favicons der Seiten, fest ins Skript eingebaut (es wird nichts nachgeladen); Eronity und „Andere“ zeigen ein Kürzel (bei „Andere“ die ersten 2 Buchstaben). Die Favicons gehören den jeweiligen Markeninhabern. **Vorschläge:** Importierte Einträge der gewählten Plattform ohne poppen-Profil lassen sich mit einem Klick zusammenführen (neuerer Status gewinnt, Treffen, Profile und Verlauf werden übernommen, Anmerkungen angehängt).
- **Links von Treffen** öffnen immer in einem neuen Tab auf der Plattform, für die sie eingetragen sind.
- **Gelöschte Konten** im Posteingang: früherer Name durchgestrichen, Link aufs Profil-Archiv, Bild aus dem Archiv.

### Austausch mit JOYclub

*Exportieren* / *Importieren* in „Meine Fickliste“. Die Datei ist mit dem eigenen Nick verschlüsselt (AES-GCM, Schlüssel per PBKDF2-SHA256 mit 150.000 Runden). Enthält ein importierter Eintrag ein poppen.de-Profil, wird er zu einem poppen-Eintrag (sofort, wenn das Mitglied bekannt ist, sonst beim nächsten Profilaufruf). Beim Import werden Einträge **automatisch verknüpft**, wenn ein Link übereinstimmt (Groß-/Kleinschreibung, `https`, `www.`, Schrägstrich am Ende und Umlaut-Kodierung spielen keine Rolle); weitere Links werden übernommen, bei mehreren Treffern wird gefragt.

```
Datei:  { format:'fickliste-enc', platform, account, alg:'AES-GCM/PBKDF2', salt, iv, data }
Inhalt: { format:'fickliste', version:1, platform, exported, persons:[
          { id, status:'want'|'done'|'no'|'never'|null, statusAt,
            main:{ pf, uid, nick, url },
            profiles:[{ pf, url, name, uid?, pfName?, dead?, text?, status?, statusAt?, sync? }],
            meets:[{ id, date:'YYYY-MM-DD', time, where, club, link, pf, uid?, note }],
            history:[{ at, what }], ext? } ] }
```

- `where` = „Was“ (Party, Anlass), `club` = „Wo“ (Club, Ort).
- `profiles[].pfName`: freier Plattformname bei `pf:'other'`; `profiles[].dead:true`: Profil gelöscht.
- `profiles[].status`/`statusAt`: eigener Status eines Profils; `sync:true` übernimmt Statuswechsel der Person.
- `meets[].uid` (mit `pf`): Profil, zu dem das Treffen gehört; ohne `uid` gehört es zu `main`.
- Unbekannte Felder werden unverändert durchgereicht.

---

## Gruppen-Newsfeed

Auf `/groups/feed` bekommt jeder Beitrag einen **Rahmen in der Farbe seines Verfassers** (grün, orange, rot, weiß …); in der Zeile unter dem Gruppennamen steht nach dem Nick die Einstufung mit Alter, bei „Moppel-Liebhaber“ auch die Figur-Stufe („Üppig · BMI 41“). Kommentierende bekommen die Einstufung hinter dem Nick. Das Gruppenbild bleibt unverändert. Verfasser (`feed/groups`, nicht der Gruppenbesitzer) und Kommentierende (`v2/comment/list`) kommen nebenbei ins Gedächtnis (Quelle Gruppen), mit Fakecheck-Stand und Single-Status.

**Smileys:** In Kommentaren und Beiträgen zeigt poppen Kürzel nur als Text. Das Skript wandelt sie beim Absenden (`v2/comment/add`, `group-feed/status-update/add`) in Unicode-Smileys um: poppen-Kürzel („:D“ → 😃, „;)“ → 😉) und JOYclub-Kürzel („*kuss*“ → 💋). Nur ganze Kürzel; Uhrzeiten wie „12:30“ und Links bleiben unverändert.

## Messenger: Termine

In der rechten Spalte eines Chats steht zwischen „Aktionen“ und „Anhänge“ der Abschnitt **Termine** (nur Chrome/Edge). Er liest eine lokale Textdatei, die einmal gewählt wird (im Abschnitt selbst oder auf der Seite *Opa-Schutz* unter „Party-Termine“). Jede Zeile hat das Format `wann - wo - was - Link`; `was` und `Link` sind optional, `wann` darf ein Zeitraum sein (`14.09.-23.09.2026`, `14.-23.09.2026`, `28.12.2026 - 02.01.2027`).

- Gelesen wird von oben; vergangene Termine werden übersprungen (ein Zeitraum zählt bis zu seinem letzten Tag), nach den ersten **5 kommenden** ist Schluss. Diese stehen nach Datum sortiert (gleiches Datum: Reihenfolge der Datei).
- Jeder Termin ist eine Zeile mit „wann - wo - was“ als Beschriftung; ein Klick hängt die vollständige Zeile (mit Link) an den Text im Eingabefeld an – steht dort schon etwas, auf einer neuen Zeile (ohne Return) – und **sendet die Nachricht** (z. B. „Da könntest Du mich treffen:“ + Termin). Kommt sie nicht durch, erscheint „Nicht gesendet“.
- Die Datei wird beim Aufklappen neu gelesen. Chrome fragt gelegentlich, ob der Zugriff weiter erlaubt ist („Zugriff auf die Datei erlauben“).
- **Eine Datei für alle Skripte:** Der Browser lässt die gewählte Datei nicht zwischen Websites teilen (und verrät keinen Pfad), deshalb liegt im Briefkasten der zuletzt gelesene Stand samt Dateiname und Änderungsdatum. Wer die Datei lesen darf, legt einen **neueren** Stand dort ab; wer sie (noch) nicht lesen darf, nimmt den Stand aus dem Briefkasten („Stand aus dem Briefkasten (gelesen von JOYclub) …“). Wählt man eine Datei mit anderem Namen, fragt das Skript, ob für **alle** Skripte gewechselt werden soll; die anderen zeigen dann „Die Termin-Datei wurde auf X gewechselt – hier neu wählen“. Der Text bleibt immer roh, mit allen vier Angaben.

## Messenger: Textvorlagen

Eigene Textbausteine (bis **100**, je bis **8000 Zeichen**), gespeichert im Tampermonkey-Speicher.

- **Knopf** mit dem Vorlagen-Symbol links neben der Eingabezeile (`/inbox/p/<Nick>`). Ein Klick zeigt die **Namen** der Vorlagen; ein Klick darauf fügt den Text an der Schreibmarke ein (nicht gesendet).
- **Verwalten** über das Drei-Punkte-Menü des Messengers → **Textvorlagen** (nach „Nachrichtenfilter“): Liste, Bearbeiten (Name + Nachricht mit Zeichenzähler), Löschen, Export/Import.
- **Termine-Bereich:** Enthält der Name „Termin“, erscheinen im Bearbeiten-Fenster die nächsten 5 Termine aus der Termin-Datei; „Alle übernehmen“ ersetzt den Text. 
- **Termin-Kurzform:** Beim Einfügen wird eine Zeile `wann - wo - Link` ohne „was“ anhand der Termin-Datei wieder zur vollen Zeile ausgeschrieben.
- **Export/Import** per Datei oder Zwischenablage, in derselben verschlüsselten Hülle wie die Fickliste (`templates` statt `persons`). Beim Import werden Smileys zwischen JOYclub, poppen.de und Unicode übersetzt (Tabelle fest im Skript); gleiche Vorlagen bleiben unverändert, nur vorne/hinten verlängerte werden ergänzt, sonst Rückfrage. Nicht übersetzbare Smileys stehen im Bericht.
- **Gemeinsamer Bestand** (gemeinsames Regelwerk mit dem JOYclub-Skript, siehe [FORMAT.md](FORMAT.md)): Die Vorlagen liegen im Briefkasten in JOYclub-Schreibweise und werden hier beim Anzeigen/Einfügen übersetzt. Schreiben zwei Stellen gleichzeitig: Ist die andere Fassung unverändert, wird geschrieben; sind es nur Ergänzungen, werden beide zusammengeführt (die ältere zuerst); sonst gewinnt die gerade gespeicherte Fassung und die andere kommt für **30 Tage in den Papierkorb**. Neue Vorlagen bekommen IDs `x:<zufall>`; Felder des JOYclub-Skripts (`pfIds`, `owner`) bleiben erhalten. Gehört der Bestand laut `owner` einem anderen Konto, wird nicht abgeglichen.
- **Gedächtnis-Import:** Datei des eigenen Kontos (auch über die „Ich“-Profile erkannt) → Vorlagen ohne Rückfrage abgleichen, einschließlich Löschungen (nur, wenn die Vorlage hier seit dem letzten Import unverändert ist). Datei eines anderen Kontos → Schalter **„Auch Textvorlagen migrieren“** (Standard aus): aus = Vorlagen bleiben unberührt; an = abgleichen ohne Löschen, „Termine“ wird nie übernommen. Beim ersten Import ohne gemeinsamen Stand werden nur neue Namen angelegt und gleiche Texte verknüpft. Danach zeigt ein Bericht je Vorlage, was passiert ist.

## Moppel-Liebhaber (Figur)

Alle Figur-Funktionen greifen nur, wenn in den Einstellungen **„Benutzer ist Moppel-Liebhaber“** an ist (Standard: aus). Dort lassen sich drei BMI-Grenzen (Regler 25–60, farbig von rot nach grün), die Bezeichnungen der Stufen (Standard: Kurvig · Üppig · XXL; darunter poppens „Plus-Size“), der Suchradius (Schieberegler wie poppens Radius: 5 km … 450 km, Weltweit, dazu 75 km) und die Profiltypen einstellen; sie sind nur bei eingeschaltetem Schalter zu sehen.

### Mitgliedersuche

- poppens „Kurvig“ heißt „Mollig“; „Plus-size“ bleibt. Der Figur-Filter bekommt die Zusatzoptionen der eigenen Stufen (Standard: Kurvig, Üppig, XXL). Sie suchen „Plus-size“ und blenden nur aus, wer nach berechnetem BMI darunter liegt; Mitglieder ohne Größe/Gewicht bleiben.
- **Badges** in Stufenfarbe (z. B. „XXL · BMI 46“), Stufe 0 „Plus-Size“ nur bei entsprechender Profilangabe.
- **Sortierung „BMI“** (zwischen „Entfernung“ und „Alter“): absteigend, ohne Angaben ans Ende. Umsortiert wird nur bei „BMI“.
- **Vermessung ohne Profilbesuch:** Profilangaben (`user/info`) zählen bei poppen als Besuch. Deshalb grenzt die XXL-Suche Größe und Gewicht nur über die Suchfilter ein: zuerst die genaue Größe (Bereiche halbieren, leere überspringen), dann je Größe das Gewicht in Bändern an den BMI-Stufengrenzen, bis auf etwa 1 BMI-Punkt. Wer in zwei getrennten Bändern auftaucht (Angabe fehlt), gilt als „ohne Gewicht“. Schon genau vermessene Zellen werden nicht erneut geteilt. Profile, die du selbst öffnest, werden weiter genau gelesen. Messungen bleiben 90 Tage gültig.
- Die **Figur-Klappliste** passt ihre Höhe bei jedem Neuzeichnen an, damit alle Zusatzstufen erreichbar bleiben.

### Paare

Bei Paaren lassen sich „Paar (Frau)“ und „Paar (Mann)“ getrennt anhaken; vermessen wird, wer angehakt ist. Angezeigt wird ein Wert – je nach eigenem Profil: Mann/Trans (Hetero, Bi, keine Angabe) → Frau, Mann Gay → Mann, Frau (Hetero, Bi, keine Angabe) → Mann, Frau Gay → Frau, eigenes Paar → Frau (Männer-Paar → Mann), Nicht-binär → Frau, wenn „Paar (Frau)“ angehakt ist. Ist diese Person nicht angehakt, gilt die angehakte. Gleichgeschlechtliche Paare folgen dem Haken ihres Geschlechts, angezeigt wird der höhere Wert.

### XXL-Suche und XXL-Seite

- **XXL-Suche** (letzte Quelle im Opa-Scan; nur bei eingeschaltetem „Moppel-Liebhaber“ angeboten und ausgeführt, beim ersten Öffnen angehakt): je ausgewähltem Profiltyp von 18 bis unter die Ignorier-Grenze, im eingestellten Radius (75 km = Suche mit 100 km, Rest verworfen), Figur „Plus-size“, vermessen über die Suchfilter (siehe oben, grob 2 Suchabfragen je Person). Paare: Größe/Gewicht gehören zu einem der beiden (angezeigt als „einer von beiden“). BMI, Figur-Angabe, Entfernung, Anmeldedatum u. a. kommen ins Gedächtnis.
- **Menüpunkt unter „Entdecken“** nach „Popsters“, benannt nach der Mehrzahl der höchsten Stufe (Standard „XXL“), mit Frau- bzw. Mann-Symbol je nach eigener Suche.
- **Seite** (`/search/member#xxl`) wie die Mitgliedersuche, aber aus dem Gedächtnis (ab „Plus-Size“). poppens eigene Suche wird auf dieser Seite unterdrückt (keine echte Suche, deine gespeicherten Suchfilter bleiben unverändert); der Menüpunkt ist hervorgehoben. Die Filter ersetzen poppens Suchfilter in der linken Leiste, im poppen-Design (Klapplisten, Schieberegler, Kästchen): Geschlecht, Alter, Radius, mit Bildern, jetzt online, nur verifiziert, Figur (Plus-Size + eigene Stufen), „auch unklarer BMI“, „nur anschreibbare“ (ungeprüfte bleiben und werden im Hintergrund geprüft), Suche nach, Beziehungsstatus (aus selbst geöffneten Profilen, unbekannt bleibt drin), Sternzeichen, Raucher, Sexualität, Größe 130–220, Gewicht 0–300. Die Ergebnisse nutzen die ganze restliche Breite. Sortierung: Entfernung, BMI (Standard), Alter, letzter Login, Anmeldedatum. Neue Messungen aus einem Scan in einem anderen Tab erscheinen von selbst. Mit gesetztem Radius fallen Mitglieder ohne bekannte Entfernung heraus; ein Hinweis nennt ihre Zahl. Profilbilder kommen aus der gespeicherten Kopie; ohne Bild steht poppens Platzhalter wie im Profil. poppens Bildadressen laufen nach einigen Tagen ab; bei abgelaufener oder fehlender Adresse holt das Skript gedrosselt eine neue (`messenger/group/item/p2p`, kein Profilbesuch, höchstens alle 3 Tage je Mitglied) und speichert eine Kopie. Sichtbare Karten kommen zuerst.

### Anschreibbar

Ob ein Mitglied Nachrichten filtert („Du kannst nur einen Sticker senden“, `messenger/p2p/permission` → Code 20903), merkt sich das Skript je eigenem Profil: passiv bei jedem „Nachricht senden“, aktiv gedrosselt für Mitglieder ab „Plus-Size“ ohne Ignorier-Kriterien, erneut nach 30 Tagen. Nutzbar als Filter auf der XXL-Seite und als Feld „Anschreibbar“ im Regel-Editor. Beim Gedächtnis-Import nur aus dem eigenen Profil übernommen.

---

## Mitgliedersuche: deine Suche bleibt deine

poppen.de merkt sich die zuletzt abgeschickte Suche auf dem Server. (Die XXL-Seite zählt nicht als Suchseite.) Damit der Teilscan „Mitgliedersuche“ sie nicht überschreibt: Hintergrund-Suchen **pausieren**, solange `/search` in irgendeinem Tab offen ist, und laufen erst **5 Minuten** nach dem Verlassen weiter (der Fortschritt bleibt). Deine Suche wird gemerkt, beim Laden der Suchseite wiederhergestellt und nach jedem Hintergrundlauf auf dem Server zurückgeschrieben.

---

## Sonderseiten

Wartung (neuer Versuch nach 15 Minuten), Werbe-Zwischenseiten (werden übersprungen; „Du hast die Regie!“ immer, auch bei Seitenwechseln ohne Neuladen), „Seite nicht gefunden“ (einmal neu laden) und abgemeldet. Auf der Login-Seite schaltet das Skript „Angemeldet bleiben“ ein und klickt **nur dann** auf „Anmelden“, wenn der Browser die Felder selbst ausgefüllt hat – höchstens einmal je 30 Minuten. Ein Passwort speichert das Skript nicht.

---

## Ablage und Datenschutz

- **Gedächtnis, Warteliste, Bilder, Profil-Archiv:** verschlüsselt (AES-GCM) in einer unauffällig benannten Datenbank des Browsers auf poppen.de. poppen.de sieht nur unlesbare Daten. Der Schlüssel liegt im Tampermonkey-Speicher und als Kopie im Briefkasten.
- **Fickliste und Textvorlagen:** ein gemeinsamer Bestand im Briefkasten (`schimmelreiter.github.io`, für keine Plattform lesbar), den alle Opa-Scan-Skripte benutzen. Format: [FORMAT.md](FORMAT.md).
- **Rettungsanker:** gepackte Kopie im Tampermonkey-Speicher (übersteht „Website-Daten löschen“). **Einstellungs-Spiegel** im Briefkasten (übersteht eine Neuinstallation).

## Daten sichern und austauschen

| Funktion | Inhalt |
|---|---|
| Alle Daten sichern / wiederherstellen | Einstellungen, Gedächtnis, Bilder, Archiv, Warteliste; die Fickliste verschlüsselt mit dem Nick |
| Gedächtnis exportieren / importieren (mischen) | nur das Wissen über andere Mitglieder (z. B. für ein zweites Konto); Geburtszeiträume werden geschnitten, neuere Messungen gewinnen |

### API-Rekorder

Schneidet die Abfragen der Seite an `/v2-api/` mit (nur neue Muster, je zwei Beispiele, Listen gekürzt) und exportiert sie als JSON. **E-Mail-Adressen, Passwörter, Zugangsschlüssel, Nachrichten- (auch eingebettete beim Senden) und Profiltexte, private Notizen, Wünsche, Interview-Antworten, Telefonnummern und Koordinaten werden geschwärzt; von Geburtstagen bleibt nur das Jahr.** Standardmäßig aus.

---

## Abgleich mit JOYclub (gemeinsame Ablage)

Das Skript teilt Fickliste, Textvorlagen und Termin-Datei mit dem [JOYclub-Skript](https://github.com/Schimmelreiter/joyclub-opa-scan) (ab 1.96) über eine gemeinsame Ablage, ohne Export/Import von Hand.

- Beide Skripte betten eine leere, neutrale Seite (GitHub Pages, `opa-gemeinsam`) unsichtbar ein und lesen und schreiben deren lokalen Speicher. Der Seiten-Code von poppen.de und JOYclub kommt nicht heran. Das Format steht in [FORMAT.md](FORMAT.md).
- Jeder Eintrag ist versioniert; gleichzeitiges Schreiben wird gemischt oder landet im Papierkorb (Textvorlagen 30 Tage).
- Das JOYclub-Skript macht beim Speichern sein Profil zum Hauptprofil; das poppen-Profil steht dann unter „Auch auf …“. Das poppen-Skript findet solche Personen trotzdem und baut sie nicht um.
- Smileys werden zwischen den Plattformen übersetzt.
- Der frühere Austausch per Nachricht über den alten Briefkasten ist seit 2.38 abgeschaltet; seit 2.43 läuft das Skript nicht mehr auf joyclub.de und verändert keine Fensternamen (die Tab-Kennung liegt im sessionStorage). Blockiert eine Sicherheitsrichtlinie oder ein Werbeblocker die Ablage, bleiben Export/Import von Hand der Weg.

## Lizenz

GPL-3.0, siehe [LICENSE](LICENSE).

## API

Eine Beschreibung der internen poppen.de-Schnittstellen, soweit bekannt, steht in [API.md](API.md).
