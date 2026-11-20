# Guthaben, Datum und Hersteller

Beim vorhandenen Hangarabruf wird zusätzlich genau eine feste Leseabfrage des RSI-Store-Credit-Ledgers versucht. Sie startet keine neue Anmeldung, führt keine Zahlung aus und verändert kein Pledge. Fehlende Sitzung, Schutzabfrage, fehlendes CSRF-Merkmal oder unlesbare Antwort lassen den erfolgreich gelesenen Hangar nutzbar; das Guthaben bleibt dann „Nicht gelesen“. Ein belegter Nullsaldo erscheint als 0,00.

Das Guthaben steht oben beim lokalen Profil, in der von RSI gemeldeten Währung. Es wird weder versteuert noch als bestätigter Euro-Kassenbetrag umgerechnet. Der Tooltip nennt den letzten Lesezeitpunkt. Die profilgebundene letzte Beobachtung bleibt lokal gespeichert; eine spätere fehlgeschlagene Gesamtverbindung macht sie nicht zu einer neuen Live-Bestätigung. Ein erfolgreicher neuer Hangarstand ohne lesbares Guthaben zeigt „Nicht gelesen“.

Die Ausnahme durch die schreibgeschützte Sitzung akzeptiert nur die fest hinterlegte Ledger-Abfrage mit exakt passendem Anfrageinhalt. Mutationen, veränderte Abfragen, andere Endpunkte und Datei-Uploads erhalten keine Freigabe. Authentifizierungswerte bleiben im Arbeitsspeicher der bestehenden isolierten RSI-Sitzung; sie werden nicht an die Programmoberfläche gegeben oder protokolliert. Passwort, MFA und Sitzungsschutz bleiben unverändert.

## Datum an Bestandsgegenständen

Das vorhandene Datum aus dem RSI-Hangar erscheint kompakt im Bestandsabzeichen der CCU-Karten und in der Herkunftsangabe der Bestandstabelle. Es ist das Datum des Pledges, kein selbst ermittelter Zahlungsbeleg. Bei Geschenken und umgebauten Schiffen ist damit weder ein persönlicher Kauf noch das Erwerbsdatum des heutigen Modells oder das Datum eines angewendeten Upgrades bewiesen. Fehlende oder mehrdeutige Angaben werden nicht durch das Importdatum ersetzt.

Bestand und CCU-Vorrat sortieren standardmäßig absteigend nach diesem Datum: neueste zuerst, gegebenenfalls mit der von RSI mitgelieferten Uhrzeit. Fehlende oder unlesbare Daten stehen am Ende; gleiche Angaben behalten ihre bisherige Reihenfolge. Paketkinder bleiben zusammen. Die logische Von→Nach-Reihenfolge der Kette wird dadurch nicht verändert.

## Hersteller

In „Schiffe & Fahrzeuge“ steht der Hersteller zwischen aktuellem Modell und Versicherung. Grundlage ist die eindeutige Modellzuordnung im vorhandenen RSI-Schiffskatalog. Varianten werden nicht unscharf zusammengelegt. Beispielsweise gehört eine heutige Prospector zu MISC, auch wenn ihr Paket ursprünglich eine Hornet enthielt. RSI wird platzsparend abgekürzt; der vollständige Hersteller steht im Tooltip. Ein nicht eindeutig zugeordnetes Modell erhält „Nicht belegt“.

Die Guthabenanzeige ist zunächst Information. Sie verteilt das Guthaben nicht automatisch auf mehrere Ziele und rechnet es nicht stillschweigend von den Vergleichspreisen ab. Warbond-Zahlungen benötigen weiterhin Frischgeld. [RSI: Store Credits verwenden](https://support.robertsspaceindustries.com/hc/en-us/articles/115013173287-Spend-Store-Credit).

Der neue Abruf wurde mit einer lokalen RSI-/TLS-Nachbildung und synthetischen Konten geprüft. Die Annahme durch eine echte RSI-Sitzung ist ohne einen echten Kontotest noch nicht nachgewiesen.
