# Loaner und Beiboote

Unter **Bestand → Loaner & Beiboote** stehen öffentliche Regelhinweise und optionale **persönliche Benutzerangaben**, keine von RSI bestätigten Kontozuteilungen. Die Quelle und ihr Stand sind sichtbar. Grundlage sind eingelesene Modellnamen und zwei öffentliche RSI-Quellen:

- [Loaner Ship Matrix](https://support.robertsspaceindustries.com/hc/en-us/articles/360003093114-Loaner-Ship-Matrix)
- [Included Vessels – Snub Fighters and Rovers](https://support.robertsspaceindustries.com/hc/en-us/articles/4408770370455-Included-Vessels-Snub-Fighters-and-Rovers)

Verwendet wird das aktuelle Schiff nach angewendeten Upgrades. Ein unbenutztes CCU auf ein Zielschiff erzeugt keinen Anspruch auf dessen Loaner. Buybacks und entfernte Pledges werden nicht berücksichtigt. Bei noch ungeklärten Upgrades wird keine Zuordnung geraten.

Ohne persönliche Bestätigung trägt jede Zeile „Unbestätigt“ und „Nur RSI-Regel · kein Zuteilungsnachweis“. „RSI-Regel für“ nennt den veröffentlichten Ausgangstext der Quelle. Der Tooltip erklärt den Bezug zu eingelesenen Modellen sowie Quellenstand und Abrufzeit. Ein vorübergehender Ersatz für ein noch nicht verfügbares Beiboot wird als unbestätigter Loaner-Regelhinweis geführt. Gleichartige Regelhinweise werden einmal angezeigt, ihre Herkunft bleibt vollständig. Ein Modell, das selbst im eingelesenen Bestand steht, wird als solches gekennzeichnet und nicht umklassifiziert.

Beispiel: Die öffentliche Zuordnung S-65 Stingray → Starfarer beweist nicht, dass ein bestimmtes Konto einen Starfarer erhalten hat. Ein Giveaway bleibt ein eingelesener eigener Pledge; aus der Herkunft wird weder eine Zuteilung noch eine pauschale Giveaway-Ausnahme erfunden. Die allgemeine Dragonfly-Zeile wird nicht auf die dort nicht ausdrücklich benannten Varianten Star Kitten, Black oder Yellowjacket übertragen.

Diese abgeleiteten Einträge verändern weder Besitz-Zähler noch Inventar, LTI, Kaufwerte, Schutzwerte oder Kettenressourcen. Sie sind keine eigenen Pledges und können im Planer nicht aufgewertet werden. Es werden keine zusätzlichen Loaner rekursiv aus einem Loaner hergeleitet.

RSI setzt einen gültigen Star-Citizen-Spielzugang voraus. Ist er im eingelesenen, möglicherweise nur teilweisen Bestand nicht belegt, zeigt die Ansicht dies an. Eine Quellenzuordnung bestätigt nicht die tatsächliche Verfügbarkeit am Terminal im Spiel und gilt nicht als PTU-Nachweis.

Der Planer lädt die zwei festen öffentlichen JSON-Artikel ohne RSI-Konto, Cookies oder Zugangsdaten: beim Start und täglich um 17:00 Uhr Europe/Berlin. „Aktualisieren“ in diesem Filter prüft nur die öffentlichen Quellen und öffnet keine Anmeldung. Bei einer fehlerhaften oder älteren Quelle bleibt der letzte gültige gemeinsame Stand erhalten. Fehlen die Daten, wird „nicht verfügbar“ angezeigt; dies bedeutet nicht, dass keine Loaner existieren.

Schreibweisen werden exakt oder über ausdrücklich veröffentlichte Gruppen und begrenzte Schreibweisen zugeordnet. Eine unscharfe Suche legt keine Identität fest. Neue, nicht unterstützte Gruppen werden als ungeklärt gemeldet. Ein nicht passender Regeltext bedeutet nicht, dass ein Konto keine Loaner hat. Quellen und Herkunft der lokalen Schiffsgrafiken stehen in SCHIFFSBILDER.md.

Für einen Test ohne Anmeldung liegt `tests/fixtures/loaner-inventory.json` als klar gekennzeichnete Demodatei bei. Sie enthält ausschließlich erfundene Pledges und Kontoreferenzen.

## Deine Bestätigung

Rechtsklick auf eine Zeile öffnet das Dropdown „Loaner-Status (deine Angabe)“. Die Auswahl wird sofort lokal gespeichert:

- Unbestätigt / zurücksetzen: entfernt deine Angabe für diese Zuordnung.
- Vorhanden – selbst bestätigt: zeigt „Selbst bestätigt“ in Türkis.
- Nicht vorhanden – selbst bestätigt: zeigt „Nicht vorhanden“ neutral an. Die Zeile bleibt zur späteren Korrektur sichtbar.

Der Tooltip nennt Datum und Uhrzeit der Benutzerangabe. Jede Auswahl kann über dasselbe Menü geändert werden; auch Umschalt+F10 öffnet es für die fokussierte Zeile. Escape oder ein Klick außerhalb schließt das Menü.

Die Angabe bleibt getrennt pro lokalem Profil unter Loanerbewertungen im Datenordner erhalten. Sie ist an das Modell, die konkreten zugehörigen Pledge-/Schiffexemplare und den Regelinhalt gebunden. Geänderte Zuordnungen erhalten einen anderen Schlüssel und starten unbestätigt; bloße erneute Abrufe oder andere Reihenfolge ändern den Schlüssel nicht. Eine ältere Angabe bezieht sich weiterhin auf ihr angezeigtes Datum und ist keine automatische Prüfung der heutigen Spielverfügbarkeit.

Deine Angaben sind keine RSI-Kontonachweise. Sie ändern weder gekaufte Schiffe noch CCUs, LTI, Schutzwerte oder Kettenressourcen. Sie werden nicht an RSI gesendet oder in den Inventar-Export übernommen. Wenn eine Bestätigung nicht lesbar ist oder nicht gespeichert werden kann, bleibt die bestehende Datei erhalten; es wird keine erfolgreiche Speicherung behauptet.
