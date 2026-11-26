# FleetYards-Dateiexport

## Deutsch

Du entscheidest, welche Schiffe du als Datei weitergeben möchtest. Der Planer verbindet sich dafür nicht mit FleetYards und benötigt keine Zugangsdaten für diesen Dienst.

1. Öffne im gewünschten Profil **Bestand → Exportieren … → FleetYards (.json)**.
2. Wähle links die gewünschten Schiffexemplare aus. Anfangs ist nichts ausgewählt. Suche, Herstellerfilter und die Ansichten „Alle“, „Im Export“ und „Ausgeblendet“ helfen bei großen Beständen. Die Auswahl bleibt beim Blättern erhalten.
3. Prüfe rechts die Zusammenfassung und die **Dateivorschau**. Bei identischen Schiffen zählt jedes Exemplar einzeln. Nicht eindeutig zugeordnete Modelle lassen sich nicht auswählen.
4. Speichere die JSON-Datei an einem selbst gewählten Ort. Erst du entscheidest anschließend, ob du sie bei FleetYards importierst oder jemandem gibst.

Die Datei enthält Modellnamen sowie `public: false` und `nameVisible: false`. RSI-Kontodaten, lokale Profilnamen, interne Kennungen, Kaufpreise, Seriennummern und Bestellnummern sind ausgeschlossen. Loaner und enthaltene Beiboote werden nicht als zusätzliche eigene Schiffe exportiert. Auch eine solche reduzierte Datei verrät dem Empfänger die ausgewählten Modelle und Stückzahlen.

Eigene Schiffsnamen und Lackierungen bleiben inaktiv, solange keine verlässliche Zuordnung im gespeicherten Bestand belegt ist. Der Export rät keine Werte und liest dafür keine zusätzliche RSI-Seite. Ein Profilwechsel während des Speicherns verwirft den Export.

Die Privatsphäre-Angaben stehen in der Datei. Welche Sichtbarkeit FleetYards nach dem Import tatsächlich verwendet, hängt zusätzlich von dessen Importfunktion und deinen dortigen Einstellungen ab. Prüfe diese vor dem Teilen. In dieser Version wurden Dateierzeugung und Schutzgrenzen lokal geprüft; ein echter Import in ein FleetYards-Konto wurde nicht durchgeführt.

## English

Choose which ships to share as a file. The planner does not connect to FleetYards or request credentials for that service.

1. Open **Inventory → Export … → FleetYards (.json)** in the desired local profile.
2. Select individual ship copies. Nothing is selected initially. Use search, manufacturer filters, selection views, and pagination for large fleets. Selections survive page changes.
3. Review the summary and **File preview**. Identical ships remain separate copies. Models without a unique catalogue match cannot be selected.
4. Save the JSON locally. You decide whether to import it into FleetYards or share it afterwards.

The file contains model names, `public: false`, and `nameVisible: false`. It excludes RSI account details, local profile names, internal IDs, purchase prices, serial numbers, and order numbers. Loaners and included craft are not exported as additional owned ships. Recipients can still see the selected models and quantities.

Custom ship names and paints stay disabled without documented associations in the saved inventory. No values are guessed and no additional RSI page is read for this export. Switching profiles while saving cancels the export.

Privacy flags are included in the file. FleetYards' actual visibility also depends on its importer and your settings there; review them before sharing. File generation and privacy boundaries were tested locally. A real import into a FleetYards account was not performed for this release.
