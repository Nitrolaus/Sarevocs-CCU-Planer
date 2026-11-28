# FleetYards-Dateiexport

## Deutsch

Du entscheidest, welche Schiffe und Angaben du weitergeben möchtest. Der Planer speichert eine lokale JSON-Datei. Er verbindet sich dafür nicht mit FleetYards und benötigt keine Zugangsdaten für diesen Dienst.

1. Öffne **Bestand → Exportieren … → FleetYards (.json)**.
2. Wähle einzelne Schiffexemplare in der Tabelle aus. Anfangs ist nichts ausgewählt. Suche, Herstellerfilter, Auswahlansichten und Seitenwahl helfen auch bei mehreren Hundert Schiffen. „Treffer übernehmen“ gilt für alle gefilterten Treffer, nicht nur die sichtbare Seite.
3. Rechts stehen die Vorgaben für **Preis** und **Datum**. Beide bleiben zunächst **leer**. Du kannst stattdessen bekannte Angaben oder eigene Ersatzwerte verwenden. Ersatzpreise unterstützen USD, EUR und GBP.
4. Klicke in der Tabelle auf den Exportpreis oder das Exportdatum eines Schiffes. Rechts kannst du für genau dieses Exemplar abweichende Angaben festlegen. „Wie Vorgabe“ übernimmt die allgemeine Auswahl, „Zurücksetzen“ entfernt die individuellen Einstellungen.
5. Prüfe die Dateivorschau und speichere die JSON-Datei. Erst du entscheidest anschließend, ob du sie bei FleetYards importierst.

Dein lokaler Bestand und seine Kaufpreise werden durch diese Einstellungen nicht geändert. Die Freigaben gelten nur für diesen geöffneten Export. Beim erneuten Öffnen sind die Schiffsauswahl leer und Preis-/Datumsfreigaben ausgeschaltet. Ungültige Ersatzwerte verhindern das Speichern; ein leeres Feld wird nicht heimlich durch Null oder den Originalwert ersetzt.

### Genau das Format der Hangar-XPLOR-Vorlage

Die Datei ist eine Liste von Objekten mit genau diesen acht Feldern in der Reihenfolge der [offiziellen FleetYards-Beispieldatei](https://github.com/fleetyards/fleetyards/blob/main/public/examples/hangar-xplor-example.json):

| Feld | Standard / wählbare Angabe |
| --- | --- |
| `manufacturer` | Zugeordneter Hersteller |
| `name` | Eindeutig zugeordnetes Schiffsmodell |
| `lti` | `false` als neutraler Platzhalter; bekannte LTI-Angabe nur auf Wunsch |
| `warbond` | `false` als neutraler Platzhalter; ausdrücklich belegte Warbond-Angabe nur auf Wunsch |
| `package_id` | Neue laufende Exportkennung, z. B. `00000001`; niemals die echte RSI-Kennung |
| `pledge` | Allgemeiner Titel wie `Standalone Ship - Avenger Titan`; originaler Paketname nur auf Wunsch |
| `pledge_date` | `""`, bekanntes Datum oder dein Ersatzdatum; nichtleere Werte wie `January 1, 2020` |
| `cost` | `""`, bekannter Gesamtpreis oder dein Ersatzwert; nichtleere Werte wie `$10.00 USD`, `€10.00 EUR`, `£10.00 GBP` |

Die neutralen Boolean-Platzhalter bedeuten bei ausgeschalteter Freigabe ausdrücklich **keine Auskunft über die echte Versicherung oder Kaufart**. Loaner und enthaltene Beiboote werden nicht zusätzlich als eigene Schiffe exportiert. Identische eigene Schiffe bleiben einzelne Exemplare. Nicht eindeutig zugeordnete Modelle lassen sich nicht auswählen.

### Was „bekannt“ bedeutet

Ein bekannter Schiffspreis enthält die belegte Startbasis und vollständig belegte angewendete CCUs. Eine unvollständige Kette bleibt leer; der ursprüngliche Tokenpreis wird nicht als Gesamtpreis ausgegeben. Währungen bleiben erhalten, insbesondere GBP; der Export erfindet keinen historischen Wechselkurs. Ein gemeinsamer Paketgesamtpreis wird nicht jedem enthaltenen Schiff erneut zugeschrieben. Nur ein bereits belegter bzw. vom Nutzer zugeordneter passender Einzelanteil kann als Einzelpreis dienen.

Ein bekanntes Datum ist das belegte Kaufdatum, soweit vorhanden, sonst das RSI-Hangardatum „Erhalten am“. Dieses Hangardatum belegt keinen persönlichen Kaufzeitpunkt. Wer es nicht weitergeben will, lässt das Feld leer oder setzt ein eigenes Datum.

### Schutzgrenzen und Importtest

RSI-Kontodaten, Seriennummern, Bestellnummern und echte RSI-IDs werden nicht exportiert. Namen und Stückzahlen der ausgewählten Modelle stehen zwangsläufig in der Datei. Originale Paketnamen, Preise und Daten nur nach ausdrücklicher Auswahl. Ein Profilwechsel während des Speicherns verwirft den Export.

Das genaue Acht-Felder-Format enthält keine `public`-Eigenschaft. Die Sichtbarkeit neuer Einträge richtet sich deshalb nach deinen FleetYards-Einstellungen. Der aktuell geprüfte [FleetYards-Importer](https://github.com/fleetyards/fleetyards/blob/main/app/lib/hangar_importer.rb) nutzt `name` zur Modellzuordnung, übernimmt `cost`, `pledge_date`, `lti` und `warbond` aber nicht als solche in seine Fahrzeugdaten. Die Angaben stehen in der Datei; ihre Anzeige bei FleetYards wird nicht zugesichert.

Dateierzeugung, Freigaben, Auswahl, Seitenwechsel und Speichern wurden lokal mit erfundenen Testdaten geprüft. Ein echter Import in ein FleetYards-Konto steht aus. Dass die bisherige Datei nur drei Felder enthielt, beweist allein noch nicht die Ursache eines fehlgeschlagenen Imports.

## English

Open **Inventory → Export … → FleetYards (.json)**. Select individual ship copies using search, manufacturer filters and pagination. Nothing is selected initially. Bulk selection applies to all matching rows, including other pages.

Price and date default to **empty**. Choose known values or your own replacements for all ships, or click a price/date cell to edit one ship copy. Replacement prices support USD, EUR and GBP. Reset restores the global choice. These settings affect only the export copy; reopening starts with no selected ships and no price/date disclosure. Invalid replacement values block saving rather than silently becoming zero or the original value.

The JSON follows the official Hangar XPLOR example exactly: `manufacturer`, `name`, `lti`, `warbond`, `package_id`, `pledge`, `pledge_date`, `cost`. Export IDs are newly numbered, never real RSI IDs. Package titles are generic unless explicitly enabled. Empty dates/prices use empty strings. Non-empty values use strings such as `January 1, 2020` and `$10.00 USD`. LTI/Warbond use neutral `false` placeholders unless disclosure is enabled; those placeholders do not describe the real insurance or purchase type.

Known totals require documented base and applied CCU costs. Incomplete totals stay empty, never the original token price alone. Native currencies are retained. A package total is not duplicated across its ships; only a matching allocated individual share may be used. A known date is a documented purchase date, otherwise the RSI hangar received date, which is not proof of a personal purchase date.

Account details, serial numbers, order numbers and real RSI IDs are excluded. Ship models and quantities remain visible. Loaners and included craft are not added as extra owned ships. Unmatched models cannot be selected. Switching profiles during saving cancels the export.

There is no `public` property in this exact format: review your FleetYards visibility settings. The currently reviewed importer resolves `name` but does not import the price/date/LTI/Warbond fields as vehicle attributes. Local tests used fictional data; live FleetYards account acceptance remains unverified.
