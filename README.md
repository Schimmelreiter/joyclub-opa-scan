# Swinger Companion

Tampermonkey-Userscripts für Dating- und Swinger-Seiten, die zusammenarbeiten – und
(in Arbeit) eine Home-Assistant-Integration, die ihre Daten übernimmt.

| Seite | Skript | Installation |
|---|---|---|
| JOYclub | [userscripts/joyclub](userscripts/joyclub/README.md) | [installieren](https://raw.githubusercontent.com/Schimmelreiter/swinger-companion/main/userscripts/joyclub/joyclub-mitglieder-alter-blockieren.user.js) |
| poppen.de | [userscripts/poppen](userscripts/poppen/README.md) | [installieren](https://raw.githubusercontent.com/Schimmelreiter/swinger-companion/main/userscripts/poppen/poppen-opa-schutz.user.js) |

Die Skripte teilen Fickliste, Textvorlagen und Termin-Datei über eine gemeinsame Ablage
(`https://schimmelreiter.github.io/briefkasten.html`, nur lokal im Browser, für keine
Plattform lesbar). Das gemeinsame Datenformat steht in [docs/FORMAT.md](docs/FORMAT.md).

## Home-Assistant-Integration

`custom_components/swinger_companion` (Installation über HACS als benutzerdefiniertes Repository vom Typ *Integration*, oder den Ordner kopieren). Je Person ein Eintrag; jedes Konto auf jeder Seite wird ein eigenes Gerät unter der Person, sobald sein Skript zum ersten Mal sendet. Sensoren je Person: *Zu ficken*, *Gefickt* (Anzahl, Personen als Attribut mit Profil-Links, Treffen, Anmerkung und signierter Bildadresse) und *Letztes Treffen*; je Konto: *Letzte Übertragung*. Einrichtung im Skript: siehe [JOYclub-Anleitung](userscripts/joyclub/README.md#home-assistant).

Updates holt Tampermonkey automatisch. Das Repo hieß früher `joyclub-opa-scan`, das
poppen-Skript lag in `poppen-opa-scan`; beide sind hierher umgezogen.

Inoffiziell, privat und nicht kommerziell – nicht verbunden mit den Betreibern der
genannten Seiten.

Lizenz: siehe [LICENSE](LICENSE).
