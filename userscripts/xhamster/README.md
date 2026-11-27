# Swinger Companion – xHamster (Vorversion)

Ein Tampermonkey-Userscript für [xHamster](https://xhamster.com). Version 0.1 sammelt vor allem, wie die Seiten
aufgebaut sind und welche Anfragen sie stellen (Rekorder), damit die nächsten Versionen Fickliste, Bilder und
Blockieren wie bei JOYclub und poppen.de bekommen können. Teil von [Swinger Companion](../../README.md).

Stand: Version 0.1.5 – Änderungen siehe [changelog.txt](changelog.txt)

## Installation

1. [Tampermonkey](https://www.tampermonkey.net/) installieren.
2. Öffnen und „Installieren“ klicken:
   https://raw.githubusercontent.com/Schimmelreiter/swinger-companion/main/userscripts/xhamster/swinger-companion-xhamster.user.js

## Was es tut

- **Profilkasten** unter dem Nick: Nummer, Alter, Ort, Beziehung zu Dir (Freund, blockiert …), Galerien, Videos, Website.
- **Markierungen** in Dating-Suche, Freundschaftsanfragen, Freunden und Blockierten: Alter, Ort, online, Freund,
  blockiert, **gelöscht** („retired“). Über der Altersgrenze (Menü *Altersgrenzen*, Vorgabe: Männer ab 60) wird
  abgedunkelt oder ausgeblendet. Alle Angaben sind freiwillig – fehlt eine, bleibt sie leer.
- **Fehler 503:** Die Seite wird mit steigendem Abstand (5 s, 10 s, 20 s … höchstens 5 Minuten) neu geladen.

## Rekorder, Scan-Lauf, Aktionstest (Tampermonkey-Menü)

- **Rekorder** (standardmäßig an): merkt sich je Seitentyp den Datenstand der Seite (`window.initials`) und alle
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
