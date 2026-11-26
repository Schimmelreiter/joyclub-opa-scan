# Gemeinsame Ablage „opa-gemeinsam“ – Formatdefinition

Diese Ablage teilen sich alle Opa-Scan-Skripte (poppen.de, JOYclub, künftig weitere). Sie liegt als IndexedDB
`opa-gemeinsam` auf `schimmelreiter.github.io` und wird nur im unsichtbaren Briefkasten-Rahmen
(`briefkasten.html`) geöffnet. Keine der Plattform-Seiten kann sie lesen.

## Grundregeln (robust gegen künftige Änderungen)

1. **Formatversion:** In `meta` steht der Eintrag `{ k: "schema", schema, minRead }`.
   - `schema` ist die höchste bekannte Formatversion. Ein Skript erhöht sie, wenn es Neues schreibt, und senkt sie nie.
   - `minRead` ist die kleinste Version, die ein Skript verstehen muss, um überhaupt zu lesen. Sie wird nur bei
     grundlegenden Umbauten erhöht. Ein Skript mit kleinerer Version schreibt dann nicht mehr und zeigt einen Hinweis.
2. **Nur hinzufügen, nie umdeuten:** Ein Feld behält für immer seine Bedeutung. Wer etwas grundlegend ändert,
   legt ein neues Feld an.
3. **Unbekanntes mitführen:** Ein Skript liest die Felder, die es kennt. Beim Zurückschreiben übernimmt es den
   ganzen Eintrag mit allen unbekannten Feldern unverändert. Kein Skript baut einen Eintrag „neu“ zusammen.
4. **Aufzählungswerte sind feste Codes.** Unbekannte Codes werden als „unbekannt“ angezeigt und unverändert gelassen.
5. **Weggefallene Felder** bleiben unten als „veraltet“ stehen. Nach einer Übergangszeit werden sie durch den
   angegebenen Ersatzwert ersetzt (leer, 0 bzw. „unbekannt“). Ältere Skripte stolpern so nicht darüber.
6. **Plattformbezogenes** wird über den Plattform-Code `pf` gekennzeichnet (`profiles[].pf`, `ich[].pf`, `main.pf`).
7. **Plattform-Codes** sind immer ausgeschrieben und klein: `poppen`, `joyclub`, `xhamster`, `eronity`, `spicymatch`,
   `kaufmich`, `fetish`, `gays`, `telegram`, `whatsapp`, `threema`, `signal`, `other`. Abkürzungen wie `joy`
   gibt es nicht.

## Versionierte Einträge (fick, tpl)

Jeder Eintrag trägt:

| Feld | Bedeutung |
|---|---|
| `id` | stabil; wird nie geändert. Vergeben vom anlegenden Skript: `p:<poppen-uid>` · `j:<JOYclub-Profil-ID>` · `x:<zufall>` (Person ohne Plattform-Profil). Kommt dieselbe Person später auf einer zweiten Plattform dazu, bleibt die alte `id`; das neue Profil steht in `profiles[]`. |
| `rev` | Versionszähler, wird bei jedem Schreiben um 1 erhöht |
| `updatedAt` | Zeitpunkt der letzten Änderung (ms) |
| `updatedBy` | `{ pf, ver, acc }`: Plattform-Code, Skriptversion, Account. **Veraltet:** `{ platform, account }` (Textvorlagen bis poppen 2.32) – beim Lesen `pf || platform` und `acc || account` verwenden, geschrieben wird nur noch `pf`/`ver`/`acc`. |
| `deleted` | `true` = gelöscht (Löschmarke statt echtem Löschen, damit andere Skripte es mitbekommen) |

**Schreiben mit Versionsprüfung:** Lesen und Schreiben passieren in *einer* IndexedDB-Transaktion. Der Schreiber
gibt die Version an, die er gelesen hat (`expect`; `null` für „neu“).
- Stimmt sie, wird geschrieben: `rev + 1`, `updatedAt`, `updatedBy`.
- Stimmt sie nicht, wird **nicht** geschrieben, und der Schreiber bekommt den aktuellen Stand zurück.
  Er mischt seine Änderung darauf (Fickliste: `mergeFick`) und versucht es mit dem neuen `rev` erneut.
  Gleichzeitige Schreiber verlieren so nichts.

**Benachrichtigung:** Nach jedem Schreiben sendet der Briefkasten-Rahmen `BroadcastChannel("opa-gemeinsam")`
die Nachricht `{ store, at, by }`. Alle Rahmen (auch die des anderen Skripts) erfahren so von der Änderung und
lesen neu.

## Ablagen

### `meta` (Schlüssel `k`)
| `k` | Inhalt |
|---|---|
| `schema` | `{ schema, minRead }` |
| `poppen_dbk` | Schlüssel der verschlüsselten poppen-Datenbank (für eine Neuinstallation) |
| `poppen_gm` | `{ at, ver, data }`: Kopie der Einstellungen und kleinen Listen des poppen-Skripts |
| `<plattform>_…` | dasselbe für andere Skripte, je mit eigenem Präfix |
| `termine_file` | gemeinsame Termin-Datei: `{ k, name, size, lastModified, text, at, by:{pf,ver,acc} }` – siehe unten |

**Termin-Datei (`meta.termine_file`):** Der Browser gibt Websites keinen Pfad und lässt den Datei-Griff nicht zwischen Websites teilen; jedes Skript wählt die Datei einmal selbst, geteilt wird der Stand.
- **Eine Datei für alle:** `name` ist die eingetragene Datei. Wählt ein Skript eine Datei mit anderem Namen, fragt es „Termin-Datei für alle Skripte auf X wechseln?“; nur bei „Ja“ wird überschrieben. Skripte, deren eigene Datei einen anderen Namen hat, nehmen den Stand aus dem Briefkasten und bitten, die Datei neu zu wählen.
- **Neuere Datei gewinnt:** Hochgeladen wird nur, wenn `lastModified` der eigenen Datei größer ist als im Eintrag (bei gleichem Namen). Ist der Eintrag neuer, gilt der Eintrag.
- **Text immer roh:** `text` ist der unveränderte Dateiinhalt mit allen vier Angaben je Zeile (`wann - wo - was - Link`). Ein Skript, das eine Angabe nicht anzeigt (JOYclub: „was“ steckt im Link), blendet sie nur in seiner Anzeige aus und lädt trotzdem immer den rohen Dateitext hoch.
- Wer die Datei nicht lesen darf oder keine gewählt hat, verwendet `text` aus dem Briefkasten.

### `ich` (Schlüssel `id = "<pf>:<uid>"`)
Die eigenen Profile. Jedes Skript, das in die Fickliste schreibt, trägt sich beim Start selbst ein:
`{ id, pf, uid, nick, url, at }`. Beim Import einer fremden Fickliste ist man „der Fick“, wenn ein Partner-Eintrag
eines dieser Profile enthält (ID, Nick oder Link).

### `fick` – gemeinsame Fickliste
Eine Person je Eintrag. Alle Felder sind optional außer `id`.

| Feld | Bedeutung |
|---|---|
| `status` | `null` · `"want"` (Will ich) · `"done"` (Gefickt) · `"no"` (Nein, danke!) · `"never"` (Nie wieder!) |
| `statusAt` | Zeitpunkt der Statusänderung (ms) |
| `main` | Hauptprofil `{ pf, uid, nick, url? }` (bei poppen: `uid` + `nick`; bei anderen Plattformen `url`). Jedes Skript darf sein Profil zum Hauptprofil machen; das poppen-Profil steht dann in `profiles[]` (`pf:"poppen"`, `uid`). Das poppen-Skript findet eine Person über die uid in `main` **oder** `profiles[]` und baut Hauptprofil und `id` nicht um (seit 2.38). |
| `profiles[]` | weitere Profile („Auch auf …“), siehe unten |
| `meets[]` | Treffen, siehe unten |
| `notes`, `notesAt`, `notesBy` | Anmerkungen (bis 8000 Zeichen), Zeitpunkt, `{ pf, acc }` |
| `history[]` | `{ at, what }`: Verlauf als Klartext |
| `ext` | Person ohne Plattform-Profil: `{ name, typ, city, short, texts, img (data-URL), gone }` |
| `imported` | Herkunft beim Import (Text) |
| `created` | Anlagezeitpunkt |
| `updated` | **veraltet**, Ersatz: `updatedAt` |
| `joy.notes` | **veraltet**, Ersatz: `notes` |

**`profiles[]`**

| Feld | Bedeutung |
|---|---|
| `pf` | Plattform-Code |
| `url` | Profil-Link |
| `name` | Anzeigename/Nick |
| `uid` | Plattform-ID, falls bekannt |
| `text` | statt Link nur Text (z. B. Signal-Benutzername) |
| `pfName` | Plattformname bei `pf: "other"` |
| `status`, `statusAt` | eigener Status dieses Profils (z. B. ein Paar auf JOYclub anders als auf poppen) |
| `sync` | `true` = Status folgt dem Status der Person |
| `dead` | `true` = Profil gelöscht. **Veraltet:** `deleted`, `gone`; beim Lesen gelten alle drei, geschrieben wird nur `dead`. |

**`meets[]`**

| Feld | Bedeutung |
|---|---|
| `id` | stabil (`m<zufall>`) |
| `date`, `time` | `"JJJJ-MM-TT"`, `"HH:MM"` |
| `where` | „Was“ (Party, Anlass) |
| `club` | „Wo“ (Club, Ort) |
| `link`, `pf` | Link und dessen Plattform-Code |
| `note` | Notiz |
| `at` | Zeitpunkt des Eintragens |
| `imported` | Nick des Exporteurs, wenn aus einer fremden Fickliste übernommen |

**Felder, die das JOYclub-Skript bisher evtl. nicht kennt** (mitführen, nie entfernen): `meets[].pf`, `meets[].imported`,
`profiles[].sync`, `profiles[].dead`, `profiles[].pfName`, `profiles[].text`, `notesBy`, `ext.*`, `imported`, `history[]` und die
Versionsfelder `rev`, `updatedAt`, `updatedBy`, `deleted`.

### `tpl` – gemeinsame Textvorlagen
Regelwerk für Abgleich, Migration und Import: gemeinsam mit dem JOYclub-Skript festgelegt (Kurzfassung unten).

| Feld | Bedeutung |
|---|---|
| `id` | stabil, ändert sich nie: `j:<Notiz-ID auf JOYclub>` (Vorlage stammt vom JOYclub-Server), sonst `x:<zufall>`. Ältere poppen-Vorlagen haben noch eine reine UUID – gilt wie `x:`. |
| `name` | eindeutig unter den nicht gelöschten Einträgen (Vergleich ohne Groß/Klein und Leerraum) |
| `text` | höchstens 8000 Zeichen, **in JOYclub-Schreibweise** (`*name*`-Smileys); andere Plattformen übersetzen beim Anzeigen/Einfügen (`smiley-map.json`) |
| `pfIds` | `{ joyclub: <Notiz-ID> }` – Verknüpfung mit dem JOYclub-Server (vom JOYclub-Skript gesetzt, sonst nur mitführen) |
| `owner` | `ich`-ID des JOYclub-Kontos, dem die Vorlagen gehören (`joyclub:<uid>`). Steht `owner` nicht unter den eigenen `ich`-Einträgen, schreibt das poppen-Skript nicht in `tpl`. |

Höchstens 100 nicht gelöschte Vorlagen. Eine Vorlage namens „Termine“ enthält Termine im Format
`wann - wo - was - Link` (eine Zeile je Termin).

**Vergleich:** „geändert“ heißt Name oder Text weichen ab – Text immer **ohne Smileys/Emoji und ohne Leerraum** verglichen.
**Ergänzung:** Der neue Text enthält alle Absätze des alten in derselben Reihenfolge und hat nur neue Absätze (am Anfang, am Ende oder dazwischen) dazubekommen. Ergänzen beide Seiten dieselbe Stelle, kommen beide Ergänzungen hinein, die ältere zuerst.

**Gleichzeitiges Schreiben ohne JOYclub-Skript (3.1):** Schreiben mit `expect`. Bei abweichendem `rev`: andere Seite unverändert gegenüber dem Gelesenen → schreiben; nur Ergänzungen → zusammenführen; sonst gewinnt die gerade schreibende Fassung, die andere kommt in den Papierkorb (30 Tage). Gelöscht wird nur per Löschmarke; wurde die Vorlage seit dem Lesen anderswo geändert, wird nicht gelöscht.
Mit JOYclub-Skript im Browser-Profil ist der JOYclub-Server maßgeblich (Regeln 3.2/3.3 im JOYclub-Skript).

**Sicherungsdatei** („Gedächtnis sichern“): `templates: [{ id, name, text, updatedAt, updatedBy, pfIds?, owner?, base, hash }]`,
`templatesDeleted: [{ id, name, at }]`, `templatesFmt: "joyclub"` (Text in JOYclub-Schreibweise; fehlt das Feld, ist der Text in poppen-Schreibweise – Dateien vor 2.34).
- `hash` = Prüfsumme der Vorlage in der Datei, `base` = Prüfsumme beim letzten Import dieser Vorlage („gemeinsamer Stand“, `null` = noch nie importiert).
- Prüfsumme = die ersten 16 Hex-Zeichen von SHA-256 über den Text **ohne Smileys und ohne Leerraum** (UTF-8).
- Import Fall A (Konto der Datei = eigenes `ich`): nur in der Datei → anlegen · gleich → nichts · eine Seite seit dem gemeinsamen Stand unverändert → die geänderte gewinnt · nur Ergänzungen → zusammenführen · beide verschieden geändert bzw. erster Import mit verschiedenem Text → überspringen · in der Datei gelöscht und hier seit dem letzten Import unverändert → Löschmarke, alte Fassung in den Papierkorb.
- Fremde Datei: Schalter „Auch Textvorlagen migrieren“ (Standard aus). Aus = Fall C (nie anfassen). An = Fall B: wie A, aber ohne Löschen; beim ersten Import nur neue Namen anlegen und gleiche Texte verknüpfen. „Termine“ einer fremden Datei wird nie übernommen (nur im Fickliste-Import angezeigt).
- Danach ein Bericht je Vorlage: neu · übernommen · zusammengeführt · übersprungen (Grund) · gelöscht · Grenze von 100 erreicht.

**Kontobindung (3.4):** Jedes Skript bindet seinen Tampermonkey-Speicher an genau ein Konto seiner Plattform (poppen: `vaf2_owner { uid, nick, seit }`). Ist ein anderes Konto angemeldet, bleibt das Skript komplett aus und schreibt weder in `fick` noch in `tpl`. Steht in `tpl` ein `owner`, der nicht unter den eigenen `ich`-Einträgen ist, schreibt das Skript ebenfalls weder in `tpl` noch in `fick` (poppen ab 2.37).

### `arch`
Reserviert für ein gemeinsames Profil-Archiv. Das poppen-Skript führt sein Archiv derzeit verschlüsselt lokal.

## Import einer fremden Fickliste – Fallliste

Gilt für beide Skripte wörtlich gleich. „Exporteur“ = `{E}` (Nick aus dem Export).

**Vorbereitung**
- Übernommen wird nur, wo man selbst „der Fick“ ist: Ein Eintrag der fremden Liste enthält eines der eigenen Profile aus `ich`
  (gleiche Plattform + gleiche ID, gleicher Nick ohne Groß/Klein oder gleicher Link).
- Steht man mehrfach in der fremden Liste, werden die Einträge zusammengefasst: Treffen vereint, Status = der höchste
  (Rangfolge `no` < `want` < `done` < `never`).
- Fremder Eintrag ohne Status, aber mit Treffen, zählt als `done`. Fremd `no` oder ohne Status und ohne Treffen → nichts tun.
- Eigener Eintrag = die Person `{E}` in der eigenen Liste (wird bei Bedarf angelegt).
- **Neue Treffen** = fremde Treffen, die es beim eigenen `{E}` noch nicht gibt (gleiches Datum + gleicher Ort/Link).
- **Termine** = zukünftige Zeilen der fremden Vorlage „Termine“ (`wann - wo - was - Link`), Links in neuem Tab.
- **Treffen-Liste** (nur wo unten genannt): je neues Treffen ein Schalter.
  - An, wenn man an dem Tag laut eigener Liste kein Treffen hat oder am selben Ort war.
  - Am selben Ort (mit einer anderen Person) zeigt die Zeile live, wie das neue Treffen mit `{E}` aussähe:
    Leere Felder werden aus dem eigenen Treffen ergänzt, Ergänzungen sind markiert. Das eigene Treffen mit der anderen
    Person bleibt unverändert.
  - War man laut eigener Liste woanders: Schalter **aus** (nicht ausgegraut), darunter rot
    „Laut Deiner Fickliste warst Du an dem Tag woanders (Ort, mit wem).“
  - Übernommene Treffen werden eigene Treffen-Datensätze mit `{E}` als Partner.

**Knopf-Sätze**
- **K4:** [Ja, gerne wieder] → Treffen laut Schaltern + Status `done` · [Ja, einmal ist keinmal] → Treffen + `never` ·
  [Im Leben nicht] → keine Treffen, Status `no` · [Stimmt nicht] → nichts.

| Fall | Eigen | Fremd | Titel | Untertitel | Inhalt | Knöpfe → Wirkung |
|---|---|---|---|---|---|---|
| A | kein Status / nicht in der Liste | want | „{E} will Dich ficken! 😁“ | „Du hast {E} noch nicht in Deiner Fickliste.“ | Termine: „Hier hättet Ihr die Gelegenheit dazu:“ | [Will ich auch!] → `want` · [Nein, danke!] → `no` · [Mal sehen] → nichts |
| — | want | want | **„{E} will Dich auch ficken! 😁“** (fett) | – | Termine: „Hier hättet Ihr die Gelegenheit dazu:“ | [OK] |
| C1 | done | want | „{E} will Dich ficken! 😁“ | „Ihr hattet laut Deiner Fickliste schon das Vergnügen – {E} hat es offenbar noch nicht eingetragen.“ | Termine: „Hier hättet Ihr erneut die Gelegenheit dazu:“ | [OK] |
| C2 | never | want | „{E} will Dich ficken! 😳“ | „... aber eine Wiederholung ist eigentlich überflüssig.“ | Termine: „Hier hättet Ihr erneut die Gelegenheit dazu:“ | [OK] |
| E | no | want | „{E} will Dich ficken! 😳“ | „... das beruht nicht auf Gegenseitigkeit.“ | Termine: „Hier hättet Ihr die Gelegenheit dazu:“ | [Doch, will ich!] → `want` · [Bleibt dabei] → nichts |
| B | kein Status | done oder never | „{E} hat wohl schon mit Dir gefickt!?“ | „{E} hat diese Treffen mit Dir eingetragen. Ausgewählte werden als eigene Treffen mit {E} übernommen.“ | Treffen-Liste; Termine: „Hier hättet Ihr erneut die Gelegenheit dazu:“ | K4 |
| — | want | done | wie B | wie B | wie B | K4 |
| D | want | never | wie B | „... fand es aber nicht so toll.“ | wie B | K4 |
| F | no | done oder never | „{E} hat wohl schon mit Dir gefickt!? 😳“ | „Dabei steht {E} bei Dir auf ‚Nein, danke!‘.“ | wie B | K4 |
| — | done oder never | done oder never | „Erneut gelandet!“ | beide never: „{E} fand es auch nicht so toll.“ · eigen done/fremd never: „Beim nächsten Mal mehr Mühe geben!“ · eigen never/fremd done: „Hätte aber nicht sein müssen ...“ · beide done: „Immer wieder gerne 😁“ | Treffen-Liste (nur neue); Termine: „{E} wäre hier wieder fickbar:“ | mit neuen Treffen: [Ja, gerne wieder] → Treffen + `done` · [Ja, wieder nicht aufgepasst] → Treffen + `never` · [Im Leben nicht] → `no` · [Stimmt nicht] → nichts. Nur Termine: [OK]. Weder neue Treffen noch Termine: kein Dialog. |
| G | beliebig | no | – | – | – | kein Dialog |
| H | beliebig | ohne Status, mit Treffen | wie fremd `done` | | | |
| I | – | mehrfach eingetragen | zusammenfassen (s. o.) | | | |

Smileys: 😁 = breit grinsend, 😳 = große, ungläubige Augen.

## Änderungsliste
| schema | Änderung |
|---|---|
| 1 | erste Fassung (poppen 2.32); Ergänzungen 2.33: IDs `j:`, Plattform-Codes, `updatedBy`-Felder, Feldlisten, Fallliste des Imports; 2.34: Textvorlagen-Regelwerk (JOYclub-Schreibweise, `x:`-IDs, `pfIds`, `owner`, `base`/`hash` in der Sicherungsdatei), Kontobindung (keine Formatänderung); 2.38: poppen-Profil darf unter `profiles[]` stehen, wenn ein anderes Skript `main` belegt (keine Formatänderung) |
