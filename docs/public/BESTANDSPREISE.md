# Kaufpreis beim Erwerb und aktueller Kaufpreis

Unter **Schiffe & Fahrzeuge** hat jedes enthaltene Modell eine kompakte Zeile. Die Erklärungen und der Upgrade-Verlauf stehen im Tooltip. Ein erfasster Kaufpreis für ein Paket mit mehreren Schiffen oder Fahrzeugen steht einmal für das gesamte Paket.

**Kaufpreis beim Erwerb** verwendet bei eindeutig zugeordneten RSI-Käufen die bezahlte Bestellposition. Der Abgleich prüft Pledge-ID, RSI-Profil, Bestellnummer und Artikelname. Mehrdeutige Positionen und bestellweite Rabatte lassen sich nicht zuverlässig einem Schiff zuordnen. Steht im Kaufprotokoll ein Wert beim Erwerb, zeigt der Planer ihn als Protokollwert an. Paketbeträge und Ursprungspreise vor späteren Upgrades werden als solche gekennzeichnet. Der Tooltip zeigt Quelle und Originalbetrag.

Liefert die Hangarseite keinen RSI-Kontonamen, wird der Kaufpreis nur mit eindeutig passender bezahlter Bestellposition aus derselben RSI-Sitzung belegt. Ein Wert aus dem Kaufprotokoll allein reicht dann nicht aus.

Enthält eine Bestellposition mehrere Exemplare desselben Artikels, zeigt der Planer den Betrag pro Exemplar. Dafür müssen die zugeordneten Einträge in die Bestellmenge passen und der Positionsbetrag muss sich centgenau teilen lassen. Bestellweite Rabatte bleiben dabei ausgeschlossen.

Bei einem unveränderten RSI-Einzelschiff kann der Hangarwert als gekennzeichneter Richtwert dienen. Erkannte Geschenke und unklare Zuordnungen bleiben ohne Kaufpreis. Der Abgleich liest eine begrenzte Anzahl aktueller Seiten. Ältere oder nicht eindeutig lesbare Käufe können weiterhin offen bleiben.

**Aktueller Kaufpreis** zeigt den öffentlichen Standardpreis des Modells als Richtwert. Der im Shop angezeigte Endbetrag kann abweichen. Das Modell wird seiner exakten Variante zugeordnet. Der Datenstand steht im Tooltip.

Die Bestandstabelle vergleicht die RSI-Dollarwerte mit demselben EZB-Kurs und zeigt je Spalte einen Betrag. Bei fehlendem Kurs zeigt sie den Originalbetrag. Ein erfasster Rechnungsbetrag wird bei der Währungsumrechnung in seiner vorliegenden Höhe verwendet. Die Exporttabelle enthält zusätzlich die Angaben zur Steuerbasis.

Der Bestellabgleich läuft beim regulären Hangarabruf mit der bestehenden RSI-Sitzung. Kaufen, Einschmelzen und Anwenden bleiben gesperrt. Der Planer speichert nur die belegte Wertinformation oder den Status einer ausgeschlossenen Zuordnung zum vorhandenen Hangar-Eintrag.

RSI beschreibt die Pledgewert-Grundlage in [Reclaim a Pledge](https://support.robertsspaceindustries.com/hc/en-us/articles/115013193627-Reclaim-a-Pledge). Die aktuelle Modellzuordnung beruht auf dem öffentlichen Schiffskatalog und den Standardwerten der Upgrade-API.
