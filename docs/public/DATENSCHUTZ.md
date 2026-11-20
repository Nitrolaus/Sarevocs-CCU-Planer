# Lokale Daten und Schutzgrenzen

Mit „Exportieren …“ erzeugst du ausdrücklich eine Excel- oder PDF-Datei am selbst gewählten Speicherort. Sie enthält deinen lokalen Profilnamen sowie die ausgewählten Bestands-, Ketten- oder Angebotsdaten. Diese Angaben sind beim Weitergeben der Datei für den Empfänger lesbar. Anmeldecookies, Schlüssel, Passwort, MFA und rohe Sitzungs-/Quelldaten werden nicht in diesen Bericht übernommen. Der Export benötigt keine neue RSI-Anmeldung und überträgt die Datei nicht automatisch.

Die Testauslieferung enthält ausschließlich Programmcode, eigene Symbole, notwendige Laufzeitkomponenten und synthetische Testdaten. Inventar, Profilnamen, gespeicherte Sitzungen, Schlüssel, Diagnosen, lokale Einstellungen und ausgewählte Zielschiffe werden nicht übernommen.

Der Planer speichert eigene Laufzeitdaten pro Windows-Benutzer unter LocalAppData. Sitzungen werden getrennt vom Inventar verschlüsselt gespeichert; Windows-Schutz und geschützte Ordnerrechte müssen dafür verfügbar sein. Das RSI-Passwort wird direkt bei RSI eingegeben und vom Planer nicht gespeichert. Die Gültigkeit einer Sitzung bestimmt RSI.

Auch MFA-Eingaben speichert der Planer nicht. Die optionale gespeicherte Sitzung ist ausdrücklich wiederverwendbar: Der Planer entschlüsselt sie intern für Lesezugriffe. Windows-Verschlüsselung bedeutet nicht, dass ausschließlich RSI oder Windows auf sie zugreifen könnten. Du kannst die Sitzung im Planer gezielt löschen.

Vor der Installation werden die Nutzungsbedingungen angezeigt beziehungsweise über einen Link lesbar gemacht. Ohne aktives Häkchen beginnt die Installation nicht. Nach erfolgreicher Installation wird nur die Kennung der bestätigten Fassung im eigenen Windows-Benutzer-Registrierungsschlüssel gespeichert. Dieser Beleg enthält keine RSI-Kontodaten; eine stille Installation ohne passenden Beleg wird abgewiesen.

Ein automatisches Wiederherstellen einer vorhandenen Sitzung ist keine Garantie, dass RSI sie weiterhin akzeptiert. Kauf-, Einschmelz-, Geschenk- und Änderungsaktionen bleiben im eingebetteten Fenster gesperrt. Das Öffnen einer Shop-Seite im Standardbrowser führt keine Bestellung aus.

Beim Hangarabruf gleicht der Planer Kaufpreise lesend mit dem RSI-Kaufprotokoll und der Bestellübersicht ab. Dazu verarbeitet er die Antworten vorübergehend im Speicher. Lokal verbleiben zum vorhandenen Bestand nur zugeordneter Betrag, Währung, Preisquelle oder der Status einer ausgeschlossenen Zuordnung. Bestellnummern, Adressen, Zahlungsmethoden und vollständige Bestellseiten werden weder gespeichert noch protokolliert.

Der öffentliche Katalog, Open-Hangar-Angebote und der EZB-Eurokurs werden ohne Weitergabe der gespeicherten RSI-Sitzung geladen. Quellenangaben und Fremdlizenzen stehen in THIRD_PARTY_NOTICES.md. Der Tagesabruf gilt nur im laufenden Programm; ein beendeter Planer ruft nichts ab.

Für konkrete Upgrade-Preise fragt der Planer beim Anzeigen einer Kette die öffentliche RSI-Schnittstelle ab. Dafür sendet er die öffentlichen Katalogkennungen der in dieser Ansicht benötigten Start- und Zielschiffe sowie gegebenenfalls die Angebotskennung. Solange die Ansicht geöffnet ist, kann sich diese Abfrage etwa alle fünf Minuten wiederholen. Die Abfrage verwendet eine getrennte Verbindung ohne RSI-Sitzung. Inventar, Profilnamen und Hangar-Exemplarnummern bleiben lokal.

Die offizielle RSI-Anmeldeseite kann die benötigten Komponenten von reCAPTCHA und Cookiebot laden. Bei „Angemeldet bleiben“ speichert der Planer die für die offizielle RSI-Domain zugelassenen Sitzungscookies einschließlich wiederverwendbarer Anmeldecookies verschlüsselt.

Persönliche Loaner-Bestätigungen werden getrennt pro lokalem Profil als Status, Datum und Schlüssel der Zuordnung unter Loanerbewertungen gespeichert. Sie enthalten keine Anmeldedaten und werden weder an RSI gesendet noch automatisch veröffentlicht oder dem Inventar-Export beigefügt. Die Installerauslieferung enthält diese persönlichen Dateien nicht.

Ein selbst eingetragener Giveaway-Spendername wird lokal pro Profil und Hangar-Exemplar gespeichert. In der Bestandstabelle ist er als eigene Angabe erkennbar.
