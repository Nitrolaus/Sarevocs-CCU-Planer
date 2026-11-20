# Alpha-Test 0.3.74

Der Installer ist eine unsignierte Windows-11-Testversion von Sarevoc´s CCU Planer. [Quellcodelizenz](../../LICENSE) · [Fehler melden](https://github.com/Nitrolaus/Sarevocs-CCU-Planer/issues/new?template=fehler.yml)

1. SHA-256 der Setup-EXE mit `Get-FileHash -Algorithm SHA256` gegen SHA256.txt prüfen.
2. Setup starten und einen Programmordner auswählen. Eine laufende Vorversion wird vor dem Update beendet. Lokale Daten bleiben erhalten. Die Ersteinrichtung fragt Sprache, Währung und Mehrwertsteuersatz ab.
   Wähle für die Installation und für vertrauliche Exporte einen Ordner, den nur du und die Systemverwaltung ändern können.
3. Über das Desktop-Symbol starten. Ein zweiter Start soll das vorhandene Fenster anzeigen. Das Schließen des Fensters legt das Programm in den Tray; „Beenden“ im Tray beendet es vollständig.
4. Die leere Installation enthält keine Konten, Schiffe, CCUs, Sitzungen oder Zielauswahl eines anderen Nutzers. Zum Test ohne RSI liegt eine synthetische Demodatei in der Quelle (siehe ENTWICKLUNG.md).
5. Unter „CCU-Planer“ stehen Zielkarten und Kettenband über den Angeboten. Bestand ist türkis, fehlende Käufe sind orange. Ungeprüfte Übergänge und Kosten bleiben gekennzeichnet.
6. Öffentliche Angebote, Katalog und Eurokurs werden beim Start und täglich um 17:05 Uhr Europe/Berlin geprüft, solange das Programm läuft. Sommerzeit wird berücksichtigt. Es gibt keinen 30-Minuten-Abruf und keinen geplanten Windows-Hintergrunddienst. Nach Standby wird ein verpasster Termin einmal nachgeholt.
7. „Im RSI-Shop öffnen“ führt im Standardbrowser zum offiziellen Shop-Einstieg; dort werden die Upgrade-Schiffe ausgewählt. Das Programm kauft, schmilzt und wendet nichts an.

Eine RSI-Anmeldung ist für diese automatisierten Prüfungen nicht benutzt worden. Wer seinen eigenen Hangar testen möchte, meldet sich selbst direkt auf der offiziellen RSI-Seite an. Zugangsdaten, Sitzungsdateien und Token niemals mit Fehlerberichten weitergeben.

Bei Problemen reichen Programmversion, betroffener Bereich und eine Beschreibung ohne Kontodaten. Für diesen Test bitte keine kompletten Datenordner oder Diagnosearchive schicken.

Unter „Loaner & Beiboote“ werden öffentliche RSI-Regeln den gelesenen aktuellen Schiffen zugeordnet. Für einen Test ohne Anmeldung die beigefügte Demo-Loaner.json in einem Demoprofil importieren: drei eigene Schiffe ergeben fünf unbestätigte öffentliche Regelhinweise. Ohne persönliche Bestätigung muss jede Regelzeile Unbestätigt und kein Zuteilungsnachweis anzeigen. Die eigenen Schiff-/CCU-Zähler dürfen dadurch nicht steigen. Details und Grenzen: [Loaner](LOANER.md).

Die Loaner-Zuordnung setzt eine tatsächliche Spielverfügbarkeit voraus, die du im Spiel prüfen kannst. Beobachtete Warbond-Zielwerte dienen der lokalen Kettenvorschau. Konkrete Upgrade-Preise prüfst du im Shop. Eurobeträge berücksichtigen den eingestellten Mehrwertsteuersatz. Die Zielkarten zeigen neutrale Schiffssilhouetten. Ein Klick öffnet bei belegtem Link die RSI-Schiffseite. [Schiffssilhouetten](SCHIFFSBILDER.md)

Rechtsklick auf eine Regelzeile: im Dropdown vorhanden bestätigen, anschließend nicht vorhanden wählen und danach unbestätigt/zurücksetzen. Eine Bestätigung muss einen Programmneustart überleben, in einem anderen Profil getrennt bleiben und die Besitz-Zähler nicht verändern.

Die Zielkarten vergleichen vorhandene CCUs und Lücken pro frei gewähltem Ziel. Die Startbasis bleibt je Ziel während der geöffneten Ansicht erhalten. Neue Hangarbeobachtungen berechnen die Vorschläge neu. Beim Start und täglich um 17:05 Uhr wird auch das gewählte echte Profil mit seiner gespeicherten Sitzung gelesen, solange das Programm läuft. Bei abgelehnter Sitzung bleibt der letzte Stand erhalten; eine neue Anmeldung öffnet sich nicht automatisch. Käufe nach dem Tagesabruf über Aktualisieren oder beim nächsten Programmstart einlesen.

Beobachtete eigenständige CCUs mit eindeutigem strukturiertem Ausgang/Ziel können zur Vorschau gehören, obwohl die RSI-Anwendbarkeit weiterhin ungeprüft bleibt. Bloße Titel, ungeprüfte Fremdexporte, angewendete CCUs und Buybacks werden nicht so aufgewertet. Zielkarten sind Alternativen, keine gemeinsame Reservierung. Offene Lücken haben keinen bestätigten Kaufpreis; die Vorschau beweist weder die billigste Kette noch aktuelle Kaufbarkeit.

Freier Kettenbau: [Anleitung](KETTENBAUER.md). Mit türkisen und orangefarbenen Kacheln ziehen, ersetzen, umordnen, Rückgängig und eine andere Variante testen. Einen Entwurf nach Programmneustart sowie in einem anderen Profil prüfen. Rot markierte Verbindungen dürfen nicht als gültige Kette gelten. Demo-Kettenbau.json enthält ausschließlich künstliche Daten.
