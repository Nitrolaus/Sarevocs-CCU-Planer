# Mein Kaufpreis und RSI-Shoppreis

Unter **Schiffe & Fahrzeuge** hat jedes enthaltene Modell eine kompakte Zeile. Erklärungen stehen im Tooltip. Über **Rechtsklick** oder **Umschalt+F10** öffnest du **Details & Herkunft** oder **Kaufpreis aufschlüsseln**. Dasselbe Menü gibt es bei CCUs, Paketen und Add-ons; die Tabelle erhält keine zusätzlichen Zeilenbuttons. Herkunft, Inhalt, angewendete CCUs und Preisbelege bleiben dort nachvollziehbar.

**Mein Kaufpreis** zeigt den belegten persönlichen Kaufpreis. Bei einem gebauten Schiff umfasst er die Startbasis und die belegten Preise der angewendeten CCUs. Fehlt ein erforderlicher Betrag, bleibt die Gesamtsumme offen; der Tokenpreis wird nicht als fertiger Schiffspreis ausgegeben. Die Details erklären die vorhandenen Beträge und fehlenden Belege. **Hangar-Log prüfen** ist im Menü verfügbar, wenn ein zusätzlicher Abruf für diesen Eintrag möglich ist.

Der Abgleich prüft Pledge-ID, RSI-Profil, Bestellnummer und Artikelname. Mehrdeutige Positionen und bestellweite Rabatte lassen sich nicht zuverlässig einem Schiff zuordnen. Ein Hangar- oder Einschmelzwert ist kein persönlicher Kaufpreis.

Ein erfasster Kaufpreis für ein Paket mit mehreren Schiffen steht einmal für das gesamte Paket. Die Details kennzeichnen ihn als gemeinsamen Kaufpreis. Bei einem eindeutig belegten, unveränderten LTI-Mehrschiffpaket kannst du einen eigenen Anteil für das gewählte Schiff eintragen. Die vorhandenen Prüfungen gegen Doppelzuordnung und zu hohe Gesamtanteile gelten weiterhin. Ein Paketpreis wird nicht automatisch auf seine Bestandteile verteilt.

Liefert die Hangarseite keinen RSI-Kontonamen, wird der Kaufpreis nur mit eindeutig passender bezahlter Bestellposition aus derselben RSI-Sitzung belegt. Ein Wert aus dem Kaufprotokoll allein reicht dann nicht aus.

Enthält eine Bestellposition mehrere Exemplare desselben Artikels, zeigt der Planer den Betrag pro Exemplar. Dafür müssen die zugeordneten Einträge in die Bestellmenge passen und der Positionsbetrag muss sich centgenau teilen lassen. Bestellweite Rabatte bleiben dabei ausgeschlossen.

Erkannte Geschenke und unklare Zuordnungen bleiben ohne belegten Kaufpreis. Der Abgleich liest eine begrenzte Anzahl aktueller Bestellseiten. Ältere oder nicht eindeutig lesbare Käufe können weiterhin offen bleiben.

**RSI-Shoppreis** zeigt den öffentlichen Standardpreis des Modells als Richtwert. Der im Shop angezeigte Endbetrag kann abweichen. Das Modell wird seiner exakten Variante zugeordnet. Der Datenstand steht im Tooltip.

Die Bestandstabelle vergleicht die RSI-Dollarwerte mit demselben EZB-Kurs und zeigt je Spalte einen Betrag. Bei fehlendem Kurs zeigt sie den Originalbetrag. Ein erfasster Rechnungsbetrag wird bei der Währungsumrechnung in seiner vorliegenden Höhe verwendet. Die Exporttabelle enthält zusätzlich die Angaben zur Steuerbasis.

Der Bestellabgleich läuft beim regulären Hangarabruf mit der bestehenden RSI-Sitzung. Kaufen, Einschmelzen und Anwenden bleiben gesperrt. Der Planer speichert nur die belegte Wertinformation oder den Status einer ausgeschlossenen Zuordnung zum vorhandenen Hangar-Eintrag.

RSI beschreibt die Pledgewert-Grundlage in [Reclaim a Pledge](https://support.robertsspaceindustries.com/hc/en-us/articles/115013193627-Reclaim-a-Pledge). Die aktuelle Modellzuordnung beruht auf dem öffentlichen Schiffskatalog und den Standardwerten der Upgrade-API.
