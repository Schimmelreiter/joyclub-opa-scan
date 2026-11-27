# Swinger Companion – xHamster

Ein Tampermonkey-Userscript für [xHamster](https://xhamster.com): Opas markieren und blockieren nach denselben Regeln
wie das poppen-Skript, dazu die gemeinsame Fickliste. Teil von [Swinger Companion](../../README.md).

Stand: Version 0.3.1 – Änderungen siehe [changelog.txt](changelog.txt)

## Installation

1. [Tampermonkey](https://www.tampermonkey.net/) installieren.
2. Öffnen und „Installieren“ klicken:
   https://raw.githubusercontent.com/Schimmelreiter/swinger-companion/main/userscripts/xhamster/swinger-companion-xhamster.user.js

## Was es tut

Bei Männern heißt es wie im poppen-Skript „Oma-Schutz“ und „Oma-Scan“ (Ruhrgebiet „Omma“), sonst „Opa“/„Oppa“.

- **Einstellungsseite „Opa-Schutz“** in „Edit profile“ (linke Leiste hinter „Privacy“, auch im Nutzer-Menü):
  Altersgrenzen mit Schiebereglern (Vorgabe von poppen.de, eigene Werte nur für xHamster), Stand von poppen.de,
  Länder für den Moppel-Link, Anzeige, Opa-Scan, Home-Assistant-Adresse und Stand der Bilder und Videos.
- **Werbung** ist ausgeblendet (Werbe-Blöcke mit xHamsters wechselnder Vorsilbe, Cam-, Premium- und Nude-Chat-Links).
- **Textvorlagen** im Messenger: Knopf rechts neben den Smileys; Smileys werden übersetzt, bei Links kommen 10 Sternchen
  an den Anfang.
- **Bilder und Videos an Home Assistant** (Personen der Fickliste mit xHamster-Profil): alle Bilder, alle Short Videos,
  Videos bis 5 je Person, sonst einzeln einschalten (Videoseite, Fickliste). Videos gehen los, sobald der Player beim
  Öffnen des Videos die Videoliste geladen hat.

- **Menü:** Im Nutzer-Menü von xHamster (Klick auf den eigenen Avatar oben rechts) stehen unter „Swinger Companion“
  „Fickliste“ und „Opa-Schutz“ (Einstellungsseite), während eines Laufs auch „Anhalten“. Alle Befehle stehen im
  Tampermonkey-Menü.

- **Regeln von poppen.de:** Altersgrenzen (Stufe 1, Stufe 2, „Ignorieren ab“), Bezeichnungen (Jungspund, Mann, Opa …,
  im Ruhrgebiet „Oppa“), „markieren“/„ignorieren“ je Gruppe und die Whitelist kommen aus der Einstellungs-Kopie, die das
  poppen-Skript im Briefkasten ablegt (alle 30 Minuten neu, Menü *Regeln von poppen.de neu laden*). Ohne poppen-Skript
  gelten dessen Vorgaben: Männer ab 50 ignorieren, Frauen und Paare nur anzeigen. Geändert werden die Regeln nur im
  poppen-Skript. Männer = male, Frauen = female, Paare = „Male and female couple“; andere Angaben bleiben ohne Gruppe.
- **Markierungen** in Dating-Suche, Freundschaftsanfragen, Freunden, Blockierten und der Nachrichtenliste: Bezeichnung in
  der Farbe der Stufe (rot = wird ignoriert), Alter, Ort, online, „bald über der Grenze“, Ausnahme (Whitelist, Freund,
  Fickliste), blockiert, **gelöscht** („retired“). Ignorierte werden abgedunkelt; in der Dating-Suche auf Wunsch
  ausgeblendet (Menü *Opas in der Dating-Suche ausblenden*).
- **Profilkasten** unter dem Nick: Nummer, Bezeichnung, Alter, Ort, Beziehung zu Dir, Galerien, Videos, Website und die
  Stand in der **Fickliste**. Geändert wird er mit dem Fickliste-Knopf in der Knopfleiste des Profils (hinter
  „Friend/Unfriend“, Symbole wie im JOYclub-Skript): *Will ich ficken*, *Gefickt*, *Nie wieder!*, *Nein, danke!*,
  *Fickstatus zurücksetzen*, *Aus der Fickliste löschen*. Die Fickliste ist dieselbe wie bei poppen.de und JOYclub; steht die Person dort schon mit einem anderen
  Hauptprofil (und dem xHamster-Profil unter „Auch auf …“), wird dieser Eintrag geändert. Neue Personen bekommen das
  xHamster-Profil als Hauptprofil und ein Vorschaubild.
- **Fickliste als Übersicht:** Reiter „Fickliste“ hinter „Friends“ im eigenen Profil, in der Seitenleiste von „Friends“
  und im Nutzer-Menü. Sie erscheint in „Friends“ an Stelle der Freundesliste, ein Fick je Zeile: links Bild, Name,
  Status und Profile, rechts Treffen und Anmerkung; Filter nach Status, Suche.
- **Galerien:** Öffnest Du eine Galerie einer Person aus der Fickliste, kommen die Bilder in deren Bilderliste.
- **Opa-Scan** (Menü): geht die Dating-Suche ab der „Ignorieren ab“-Grenze durch, je Land (Vorgabe de, at, ch).
  - *Opa-Scan: Probelauf (zählt nur)* – blockiert nichts, zeigt Treffer und Gründe fürs Überspringen.
  - *Opa-Scan: Opas blockieren* – mit Höchstzahl je Lauf (Vorgabe 200). Der erste Block wird geprüft (xHamster muss
    „blocked“ melden), danach 2–5 s Pause je Block. Bei Fehler 503 wartet er mit steigendem Abstand.
  - Ausgenommen: Whitelist, Freunde, Fickliste, man selbst, schon Blockierte, gelöschte Konten, Profile ohne Alter.
  - Läuft im Hintergrund des Tabs weiter (auch nach Neuladen), *■ Anhalten* oder „Abbrechen“ im Kasten stoppt ihn.
- **Kopfzeile:** „Live Sex“, „Nude Chat“ und „Premium Videos“ sind ausgeblendet. Ist im poppen-Skript „Benutzer ist
  Moppel-Liebhaber“ an, steht vor „Pornstars“ ein Link zur Dating-Suche mit Figur „Large“ bis ein Jahr unter der
  Grenze, Name und Symbol wie dort; Länder auf der Einstellungsseite.
- **Fehler 503:** Die Seite wird mit steigendem Abstand (5 s, 10 s, 20 s … höchstens 5 Minuten) neu geladen.

## Gemeinsame Ablage (Briefkasten)

Wie poppen- und JOYclub-Skript nutzt das Skript den unsichtbaren Briefkasten auf schimmelreiter.github.io (Format:
[FORMAT.md](../../docs/FORMAT.md)). Weil Chrome den Speicher eingebetteter Seiten je besuchter Seite trennt, bettet das
Skript den Briefkasten auch auf poppen.de und joyclub.de ein – dort ohne Oberfläche, nur zum Abgleich. Deshalb fragt
Tampermonkey bei der Installation auch nach diesen Seiten.

## Rekorder, Scan-Lauf, Aktionstest (nur Testkonten des Entwicklers)

- **Rekorder** (nur für die Testkonten an, alle 30 Minuten an Home Assistant): merkt sich je Seitentyp den Datenstand der Seite (`window.initials`) und alle
  nachgeladenen Anfragen an xHamster – gekürzt (Listen auf 3 Beispiele) und geschwärzt (Zugangsdaten, Mailadressen,
  IP-Adressen; Nachrichtentexte nur als Länge, außer den eigenen Testnachrichten).
- **Scan-Lauf:** ruft im aktuellen Tab nacheinander eigenes Profil, Freunde, Anfragen, alle Seiten der Blockierten,
  Benachrichtigungen, Nachrichten, Dating-Suche und ein Profil mit Videos, Kurzvideos, Galerien, Galerie, Bild und
  Video auf. Liest nur.
- **Aktionstest** (mit Partnerkonto, Menü *Partnerkonto eintragen*): entblockt einen Blockierten und blockiert ihn sofort
  wieder (mit Prüfung), schickt dem Partner Testnachrichten in mehreren Varianten (alle 30 s) und hält fest, was
  xHamster daraus macht (Sternchen, umgeleitete Links …), löscht sie wieder, entfreundet den Partner und fragt neu an.
  Im anderen Konto: Menü *Freundschaftsanfrage des Partners annehmen*.
- **Export:** *Rekorder exportieren (Datei)* oder *Rekorder an Home Assistant senden* (Swinger Companion ab 0.6.3;
  Adresse wie beim JOYclub-Skript über *Home-Assistant-Adresse eintragen*). Home Assistant legt die Datei unter
  `<config>/swinger_companion/<Eintrag>/.rekorder/` ab.
