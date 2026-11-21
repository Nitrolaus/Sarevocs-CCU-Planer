# Änderungen

## 0.3.78 · Alpha

- Das offizielle CAPTCHA kann seine eingebetteten Fenster wieder auf der RSI-Anmeldeseite laden. Käufe und Änderungen am RSI-Bestand bleiben gesperrt.

## 0.3.68 · Alpha-Kandidat

- Die Bestandstabelle zeigt „Kaufpreis beim Erwerb“ und „Aktueller Kaufpreis“ mit je einem Betrag. Für beide RSI-Preise gilt derselbe Umrechnungskurs. Preisquellen stehen im Tooltip.
- RSI-Paketwerte erscheinen bei fehlendem Einzelbeleg nicht als Anschaffungspreis eines einzelnen Schiffs.

## 0.3.67 · Alpha-Kandidat

- Community-Links in der Hilfe haben rechts ausgerichtete Pfeile und eine sichtbare Tastaturmarkierung. Lange Namen passen auch bei kleineren Fensterbreiten in die Karten.
- Unter „Daten & Einstellungen“ lässt sich wählen, ob das X den Planer im Tray weiterlaufen lässt oder vollständig beendet.

## 0.3.66 · Alpha-Kandidat

- Die CCU-Preiswahl ist automatisch. Ein passender RSI-Shopbetrag hat Vorrang. Für die Umrechnung aus USD verwendet der Planer den aktuellen EZB-Kurs und kennzeichnet das Ergebnis als Richtwert.
- Kettenvorschläge, Flottenplan und Exporte verwenden dieselbe Preislogik. Die Mehrwertsteuer wird einmal berücksichtigt.

## 0.3.65 · Alpha-Kandidat

- Der Hinweis auf das unabhängige Star-Citizen-Fanprojekt steht in der Seitenleiste unter dem Programmnamen. Er folgt der gewählten Sprache.

## 0.3.64 · Alpha-Kandidat

- Ko-fi und PayPal sind in der Seitenleiste erreichbar. Beide Schaltflächen öffnen erst nach einem Klick die jeweilige Unterstützungsseite im Standardbrowser.
- Die README kennzeichnet den Planer als unabhängiges Fanprojekt. Zielkarten und Flottenplan behalten die neutralen Schiffssilhouetten.

## 0.3.63 · Alpha-Kandidat

- Das RSI-Fenster prüft Ziel, Methode und Anmeldephase bei jeder Anfrage. Die Hangar-Folgeseiten werden mit einer Größenbegrenzung während des Lesens verarbeitet.
- Zielkarten und Flottenplan zeigen neutrale Schiffssilhouetten. Das Alpha-Paket enthält weder Zahlungslinks noch lokale Kontodaten.

## 0.3.62

- Die Zielkarten zeigen den festen CCU-Vorrang und das gerade bearbeitete Ziel. Im Kettenbauer steht, wie viele Exemplare bereits für ein vorrangiges Ziel eingeplant sind.
- Automatische Vorschläge und „Bester bekannter Weg“ berücksichtigen preislich belegbare Warbond-Zwischenschiffe auch dann, wenn diese in keiner vorhandenen CCU vorkommen.

## 0.3.61

- Die Schaltflächen verwenden die Glasoptik des linken Menüs mit einem Verlauf von Türkis zu Orange und sichtbarem Maus- und Tastaturfokus.
- Automatische Kettenvorschläge enthalten ausschließlich vorhandene CCUs und Zukäufe mit berechenbarem Preis. Fehlt eine vollständige Route, weisen Ketten- und Flottenplan darauf hin. Eigene Entwürfe können weiterhin offene Positionen enthalten.

## 0.3.60

- Oben an der CCU-Kette steht die Summe für den noch nötigen Zukauf. Offene Positionen und bereits bezahlte CCUs sind getrennt ausgewiesen.
- Unter „Sprache & Preise“ lässt sich für die Planung ein datierter RSI-Shopkurs in Euro pro US-Dollar eintragen. Kette, Flottenplan und Kettenexport runden je Position. Der Flottenplan berücksichtigt zusätzlich das gewählte Store-Credit-Budget und den Frischgeldbedarf.
- „Bester bekannter Weg“ berücksichtigt passende Warbond-Einstiege bei der Rangfolge. Die Flottenkarten zeigen die belegten Zielplätze und deren Vorrang.
- Für zehn Schiffe stehen eigene CAD-Fan-Illustrationen bereit. Bei weiteren Modellen erscheint ein lokaler Platzhalter. Der geprüfte Link öffnet die offizielle Schiffseite.
- Der Store-Credit-Abruf erfolgt im Hauptprozess. Der Planer speichert neue Sitzungscookies nach einer Hangarprüfung mit passendem RSI-Handle. Datierte Bestandsimporte weisen zukünftige Zeitstempel zurück.
- Bei einem Wechsel des Installationsordners übernimmt das neue Setup die Bereinigung. Bei der Deinstallation prüft es das Ziel von Desktop- und Startmenüverknüpfungen.

## 0.3.59

- Der CCU-Planer vergleicht die gewählte Hangarbasis mit einer ausgewählten LTI-Basis aus Buy Back. Beide Vorschläge zeigen fehlende und verwendete CCUs, Frischgeld und Store Credits. Der Rückkaufpreis fließt in die Vorschau ein.
- Der Export verwendet Checkboxen für einzelne Bestandsbereiche einschließlich Paints, die aktuelle Kette und Messeangebote. Excel schreibt je Auswahl ein Tabellenblatt, PDF einen Abschnitt.

## 0.3.58

- Dezente Ko-fi- und PayPal-Schaltflächen mit transparentem Hintergrund unten in der Seitenleiste. Ko-fi zeigt das Logo aus dem Creator Kit, PayPal einen schlichten Schriftzug. Beide öffnen die bestehenden Unterstützungsseiten von Joystick Guardian im Standardbrowser.

## 0.3.57

- Dezente Glasflächen im linken Menü und auf Ziel- und Flottenkarten. Der aktive Menüpunkt und die ausgewählte Karte behalten ihre türkise Markierung.
- Ko-fi und PayPal stehen am Fuß der Seitenleiste. Beide Schaltflächen öffnen auf Klick dieselben öffentlichen Unterstützungsseiten wie Joystick Guardian im Standardbrowser.

## 0.3.56

- „Buy Back“ unter „Bestand“ zeigt Rückkaufeinträge pro Profil. Eine bestehende RSI-Sitzung kann die Rückkaufliste lesend abrufen. Pledge-Kaufaktionen bleiben gesperrt. Fehlende oder ungeprüfte Angaben zu Versicherung, Preis und Store Credits bleiben offen.

## 0.3.55

- Das in der Einkaufsliste eingestellte Store-Credit-Budget wird pro Profil gespeichert. Der Flottenplan nutzt dieselbe Grenze und begrenzt den Einsatz auf das zuletzt gelesene Guthaben.

## 0.3.54

- Der Flottenplan vergleicht einzelne Ziele mit der gemeinsamen Planung. Die Karten zeigen Frischgeld, Store Credits und offene Preise. Der gemeinsame Plan vergibt Bestands-CCUs und das Guthaben in Zielplatzreihenfolge 1 → 2 → 3.
- Vergleiche verändern die gespeicherten Entwürfe nicht. „Variante übernehmen“ speichert die gewählten Zielplätze und öffnet den Kettenbauer.

## 0.3.53

- Die Themenleiste unter „Hilfe & Einstieg“ markiert den gewählten Link und den passenden Abschnitt. Die Auswahl bleibt sichtbar, wenn die gesamte Hilfe ohne Scrollen ins Fenster passt.

## 0.3.52

- Die Messe-Info verwendet den gesamten Messezeitraum, wenn der öffentliche Kalender zusätzlich einzelne Ausstellertage meldet. Ein späterer Kalendereintrag für einen Ausstellertag verkürzt einen bereits erfassten Messezeitraum nicht.
- Beim Wechsel vom Ausstellertag zum vollständigen Messezeitraum gleicht der Planer vorhandene Angebotsstände erneut ab. Bereits als gesehen markierte Meldungen bleiben gesehen. Der Installationstag begrenzt den Rückblick weiterhin.

## 0.3.51

- Neue Einkaufsliste fürs Messefinale direkt unter dem Kettenbauer. Sie verarbeitet die gewählten Ketten in Zielreihenfolge und verteilt ein gemeinsames Store-Credit-Budget auf passende Standard-CCUs.
- Direkt passende Warbond-CCUs werden als Frischgeld eingeplant. Die Mehrwertsteuerberechnung berücksichtigt nur den bar zu zahlenden Anteil. Bereits eingeplante CCUs, unklare Preise und widersprüchliche Entwürfe werden in der Einkaufsliste sichtbar behandelt.

## 0.3.50

- Neuer Menüpunkt „Hilfe & Einstieg“ für Star-Citizen-Neulinge mit Einstiegshilfe, CCU-Beispielkette, Hinweisen zu Warbond, Store Credits, LTI und der Bedienung des Planers.
- Die Hilfe folgt der global gespeicherten Sprache Deutsch oder Englisch. Ihre vier Verweise auf die offizielle RSI-Hilfe öffnen sich auf Klick im Standardbrowser.

## 0.3.49

- Automatische Kettenvorschläge berücksichtigen die Zielreihenfolge bereits beim Berechnen und lassen reservierte Exemplare aus. Bei baugleichen Bestands-CCUs bleibt jedes freie Exemplar einzeln nutzbar.
- Zielkarten, Vorschlag und Varianten verwenden dieselben Vorrangregeln. Gespeicherte manuelle Entwürfe bleiben erhalten. Ihr bestehender Konflikthinweis zeigt weiterhin, wenn sie sich ein Exemplar teilen.

## 0.3.48

- Die Messe-Info zeigt für jeden Warbond den Preisvorteil gegenüber dem regulären Zielwert sowie alle RSI-Ausgangsschiffe auf der nächstniedrigeren Preisstufe und den geschätzten Preis des jeweiligen CCUs.
- Die Tabelle prüft anhand des aktuellen Profils automatisch den Anschluss an die Zielketten. Sie zeigt den vorrangigen günstigeren Weg und dessen Ersparnis beim Zukauf. Bei fehlender Basis, veralteten Werten oder unvollständiger Prüfung bleibt das Ergebnis offen.

## 0.3.47

- Die Messe-Info steht oben im CCU-Planer und meldet neu beobachtete Warbond-CCU-Ziele mit Preis und „Für meine Kette prüfen“. Der angezeigte Warbond-Zielwert ist unabhängig vom später gewählten Ausgangsschiff.
- Ungesehene Meldungen bleiben beim Aktualisieren und nach einem Neustart erhalten. Der Rückblick beginnt beim späteren Datum von Messestart und Installation und benötigt vergleichbare Angebotsstände. Läuft eine neue erkannte Messe an, endet der Rückblick auf die vorige.
- „Gesehen“ blendet die einzelne Meldung dauerhaft aus. Ein Angebot, das im aktuellen Angebotsstand fehlt, bleibt bis dahin mit „Nicht mehr verfügbar“ sichtbar. Bei alten Angebotsdaten bleibt die Verfügbarkeit ungeprüft.

## 0.3.46

- Nutzungsbedingungen freundlicher formuliert und in kurze Absätze mit acht hervorgehobenen Überschriften gegliedert. Größeres, verstellbares Lesefenster mit größerer Schrift, scrollbar und mit dauerhaft erreichbarem Schließen-Knopf.
- Neuer Abschnitt „Sicherheitskonzept“ erklärt Windows-Verschlüsselung, getrennte Sitzungsablage, Ordnerrechte, interne Wiederverwendung der Sitzung und die Grenzen gegenüber Schadsoftware im Windows-Benutzerkonto. Kauf-/Änderungssperren bleiben erhalten; kein Versprechen einer absoluten Sicherheit.
- Bedingungen erklären auch selbst gewählte Excel-/PDF-Exporte und die darin enthaltenen Profildaten. Fassung 2 erhält einen eigenen textgebundenen Zustimmungsbeleg. Eine Zustimmung zur vorherigen Fassung wird nicht stillschweigend übernommen; bloßes Öffnen des Lesefensters bestätigt nichts.
- Installer bleibt beim vorhandenen NSIS-Verfahren ohne ausgelieferte Squirrel.exe. Keine neue RSI-Anmeldung; installierte 0.3.45 und deren Sitzungsdaten bleiben bei der Entwicklung unverändert.

## 0.3.45

- „Exportieren …“ im Bestand und CCU-Planer: lokale Excel- oder PDF-Momentaufnahme für Bestand, angezeigte CCU-Kette oder Messeangebote. Die Vorschau bleibt bis zum Speichern unverändert; nach erfolgreichem Export schließt der Dialog.
- Native Zahlen und Datumszellen, Filter und fixierte Überschriften in Excel; mehrseitiges PDF mit wiederholten Tabellenköpfen. Türkis kennzeichnet Bestand, Orange geplante Käufe. Währung und Mehrwertsteuersatz folgen den Einstellungen; Originalbeträge bleiben sichtbar.
- Paket-Kaufwerte stehen einmal je Pledge. Historische Zahlungen erhalten keine neue MwSt.; Summen verschiedener Steuerbasen bleiben getrennt. Fehlende Preise bleiben offen. Warbond-Zielwerte werden niemals als Preis eines einzelnen CCUs verwendet.
- Export rekonstruiert die angezeigte Kette einschließlich Testvorschau aus lokalen Bestands- und Planungsdaten; Sperren und vorrangige Zielketten werden beachtet. Eigene Entwürfe ändern sich nicht.
- Speichern über temporäre Datei und atomare Umbenennung mit Änderungsprüfung; falsche Endung, fremdes Profil und paralleles Speichern werden abgewiesen. PDF-Fenster bleibt unsichtbar, ohne Anmeldung oder Netzwerkzugriff. Vorhandene JSON-Sicherung bleibt erhalten.
- Knebels öffentlich verlinkte Originaltabelle wurde als Aufbau- und Rechenreferenz analysiert. Weder seine Datei noch historische Beispielpreise werden ausgeliefert. ExcelJS mit Laufzeit-Lizenzhinweisen hinzugefügt; keine Installation oder neue RSI-Anmeldung.

## 0.3.44

- Paint-Summen direkt unter den drei Kennzahlen: RSI-Einschmelzbasis, identischer Ersatz und danach mögliche freie Store Credits. Nächste und höchste bekannte Rabattstufe mit fehlenden unterschiedlichen Shop-Positionen; Zusatzkäufe werden vollständig gegengerechnet. Höhere Rabatte können sich auch nicht lohnen. Keine Kauf- oder Reclaim-Aktion.
- Ausgeschlossene Paint-Pledges lassen sich ausblenden. Diese lokale Anzeigeeinstellung verändert weder Rechnung noch Schutzregeln.
- Hangar-Folgeseiten werden nacheinander mit Fortschritt, Datenbudget und begrenzten Wiederholungen vorübergehender Fehler gelesen. Abbruch, doppelte Seiten, Identitätswechsel und unvollständige Leseversuche ersetzen keinen gültigen Bestand. Nach erkannter Sitzung beendet keine feste Prüfzeit den großen Hintergrundimport.
- Eigener kurzer Profildialog mit Tastaturbedienung, Schutz vor doppeltem Absenden und automatischem Schließen nach erfolgreichem Anlegen. Ein Auswahlfehler nach dem Speichern erzeugt beim Wiederholen kein zweites Profil. Dateiimport öffnet die Prüfung erst nach tatsächlicher Auswahl.
- Freundlichere Installerinfo und lesbare Nutzungsbedingungen mit nicht vorausgewählter Zustimmung. Stille Installation verlangt eine bereits bestätigte aktuelle Fassung. Der lokale Zustimmungsbeleg wird erst nach erfolgreicher Installation gespeichert.
- Sprache/Währung/MwSt.-Einrichtung einschließlich Listen, Zahlenpfeilen und Abbrechen dunkel; Auswahllisten passen sich an größere Schrift an. Keine neue RSI-Anmeldung, keine Änderung der Kauf- und Änderungssperren.

## 0.3.43

- Tatsächliche kleine Mindestbreiten in allen Bestandsreitern, Loaner- und Paint-Tabellen. Kompakte Anfangsbreiten und engere Innenabstände; lange Inhalte erzwingen keine Mindestbreite mehr. Doppelklick passt weiterhin an den Inhalt an.
- Neue Breitenpräferenz getrennt von den breiten Altwerten. Manuell gewählte schmale Breiten bleiben über Neustart und Filterwechsel erhalten; volle Angaben stehen in Tooltips.
- RSI-Datumslabels „Created:“ und „Erstellt:“ werden bei Datumsanzeige, Sortierung und Paint-Fristprüfung korrekt erkannt. Ungültige oder zu junge Daten werden weiterhin abgewiesen.
- Paint-Berater zeigt die identischen Ersatzartikel direkt samt Preis, unterscheidet Pledges von einzelnen Farben und markiert Paint-Beigaben in Schiffspaketen mit einem roten geschlossenen Schloss sowie einer eigenen Schutzspalte. Diese Kennzeichnung ist kein entsperrbarer Schalter.
- Geschützte Pledges bleiben sichtbar, aber ohne Ersatzkauf und Ersparnis. Keine Kauf-/Reclaim-Funktion, keine neue RSI-Anmeldung.
- Installer mit kompakter Info zu lokalen Daten, Passwort/MFA, wiederverwendbarer Windows-verschlüsselter Sitzung und gesperrten Hangaränderungen.

## 0.3.42

- Verstellbare Spalten mit Mindestbreiten, gespeicherten Breiten, Tastaturbedienung und seitlichem Scrollen in den kompakten Bestands- und Loaner-Tabellen. Spaltensortierung bleibt für später.
- Spielpakete und geschützte Spielzugänge dürfen sich überschneiden. Nur ausdrücklich gelesene SC-/SQ42-Game-Access-Markierungen bestimmen den Zugangsfilter; Altbestände ohne diese Angaben werden nicht geraten.
- Neuer Paint-Berater mit eigenem Menüpunkt: vollständige Paint-Inhalte, Paket-/Einzelangebote und aktuelle Mengenstaffeln vergleichen, ungeprüfte oder ausgeschlossene Fälle getrennt darstellen.
- Öffentliche Paint-Preise über feste lesende Abfragen in einer getrennten flüchtigen Sitzung ohne Anmelde-Cookies. Veraltete oder unvollständige Quellen liefern keine neue Ersparnisrechnung.
- Reclaim-Steuerelemente werden ausschließlich gelesen. Keine Kauf-, Warenkorb-, Geschenk- oder Einschmelzfunktion; bestehende Kauf- und Änderungssperren bleiben erhalten.

## 0.3.41

- Einheitliche kompakte Bestandstabelle mit sieben Spalten; Paketgesamtwerte bleiben einmalig, einzelne CCU-Exemplare getrennt.
- Reihenfolge: Alle Gegenstände, Schiffe & Fahrzeuge, CCUs, Spielpakete, Spielzugänge, Loaner & Beiboote. „Ungeklärt“ entfernt; echte Leseprobleme bleiben am Eintrag sichtbar.
- Spielpakete mit Schiff und separate Spielzugänge anhand belegter Inhalte unterschieden. Eine Zuordnung zum geschützten RSI-Game-Library-Zugang wird daraus nicht behauptet.
- Loaner-Zeilen verdichtet; persönliche Bestätigungen und Rechtsklickkorrekturen erhalten.
- Eng begrenzte interne Wartungsmethode zum Entfernen eines ausdrücklich ausgewählten Demoprofils; echte Profile werden abgewiesen.

## 0.3.40

- Store-Credit-Guthaben oben beim Profil: feste lesende Ledger-Abfrage in der bestehenden Sitzung, Originalwährung und Lesezeitpunkt, unbekannt bleibt von null unterschieden.
- RSI-Pledge-Datum kompakt an Bestands-CCUs und in der Herkunftsangabe; kein erfundenes persönliches Kaufdatum.
- Bestand und CCU-Vorrat standardmäßig neueste Erwerbsdaten zuerst, unbekannte Daten zuletzt; Kettenreihenfolge bleibt erhalten.
- Hersteller des heutigen Modells zwischen Schiff/Fahrzeug und Versicherung; kompakte Zeilenhöhe erhalten.

- Verpflichtende bewusste LTI-Startbasis je Ziel. Alte automatische Basen erhalten keine Freigabe; höherwertige eigene LTI-Schiffe nur nach Einblenden und eigener Auswahl.
- Verständliche Konflikterklärung pro Exemplar mit Empfänger, Ersatzweg und Mehrkosten. Keine automatische Ersatzbasis aus vorhandenen Schiffen.
- Begonnene Kette, Startbasis und Kosten bleiben beim Wechsel zu Konfliktberater oder Kaufoptimierer sichtbar; Beratung erscheint darunter und verändert den Entwurf nicht.
- CCU-Vorrat standardmäßig im Fünfspalten-Raster. Nur die Zielkarte der aktuell angezeigten Kette erhält einen deutlich leuchtenden türkisen Rahmen und eine Beschriftung; Ziel 1 wird nicht zusätzlich markiert.

- Bestand: Ungeklärt und Noch zu prüfen zählen nur echte Lese- und Zuordnungsprobleme. Fehlende Versicherung oder ungeprüfte Anwendbarkeit allein gelten nicht mehr als Fehler.
- Windows-Taskleiste: Explizite Icon- und Startzuordnung zur aktuellen installierten EXE bei unveränderter AppID. Tray-Grafik bleibt erhalten.
- Installer: Eine verwaiste alte Squirrel-Update.exe allein löst keine erneute Deinstallation mehr aus.

## 0.3.39

- Drei Umschalter im Kettenbauer: Kette bauen, Konflikte lösen und CCU-Kaufoptimierer.
- Fester Vorrang Ziel 1 → 2 → 3; konfliktfreie Vorschau mit freien physischen Exemplaren, Alternativbasen und Mehrkosten. Gültige eigene Entwürfe bleiben erhalten.
- Explizite gemeinsame Übernahme speichert alle betroffenen Ziele atomar; veraltete Vorschauen werden abgewiesen.
- Heutiger CCU-Kaufoptimierer vergleicht sämtliche gleichpreisigen Einstiege der nächstniedrigeren RSI-Preisstufe, kompletten Zukauf und Alternative ohne Neukauf.
- Warbond-Einstiege bleiben hypothetisch und ungeprüft; keine Käufe, kein automatisches Anwenden und keine erneute Anmeldung.
## 0.3.38

- Schloss-Button pro physischem CCU-Exemplar in Kette und Vorrat; gesperrt leuchtet das geschlossene Schloss rot.
- Gesperrte Exemplare bleiben im Bestand sichtbar, werden pro Profil gespeichert und aus allen Zielketten, Varianten und Drag-and-drop-Einfügungen ausgeschlossen.
- Gespeicherte Entwürfe bleiben erhalten; enthaltene gesperrte Exemplare erhalten keinen gültigen Gesamtpreis.

## 0.3.37

- Leere Ordnerwahl für Neuinstallationen; erkannte Version und bisheriger Ordner bei Updates.
- Dunkler Fortschritts- und Abschlussdialog, echte Kopierfortschrittswerte und UTF-8-Korrektur für Produktnamen.
- Eine zentrale Verknüpfungserstellung bereinigt eindeutig zugehörige falsch benannte Duplikate.

## 0.3.36

- Zehn freigegebene transparente CAD-Fan-Bilder in den Zielkarten, genaue Zuordnung nach Katalog-ID und Modellname; bestehende Shop-Links und Ersatzgrafiken bleiben erhalten.
- Dunkle Ordnerauswahl im Installer; Programmdateien lassen sich außerhalb des Benutzerordners installieren. Daten und geschützte Sitzung behalten ihren bisherigen Ort.
- Nativer Startschutz und geordnetes Beenden gelten auch für frei gewählte Installationsordner. Keine automatische RSI-Anmeldung oder Programmstart durch den Installer.


## 0.3.35 – transparente CAD-Zielgrafiken

- Galaxy und Liberator mit eigenen, inoffiziellen CAD-Illustrationen: Silberkonturen, dezentes Türkis und echter Alphakanal. Beide Grafiken lokal enthalten und ohne Bildnetzwerk verfügbar.
- Zuordnung verlangt Katalog-ID und Modellname. Der vorhandene Bildklick öffnet weiterhin nur die geprüfte offizielle Schiffseite; keine Kaufaktion.
- Für weitere Modelle bleibt die bisherige Bild-/Ersatzdarstellung erhalten. Keine automatische Bildgenerierung und keine Behauptung einer CC0-Freigabe der zugrunde liegenden CIG-Schiffdesigns.

## 0.3.34 – Schiffswerte und Vorrang in der Kettenplanung

- Unter Schiffe & Fahrzeuge eine kompakte Zeile je Modell, mit RSI-Kaufwert und heutigem Standardwert. Gemeinsame Paketpreise werden nur einmal gezeigt.
- Vorhandene explizite USD-Hangarwerte werden ausgewertet; keine Verwechslung mit ursprünglichem Basiskaufpreis oder persönlicher Zahlung bei Geschenken. Historische Steuerbasis bleibt erhalten.
- Euro-Richtwerte mit Originalbetrag, heutiger Wert nach gewähltem Mehrwertsteuersatz. Krone, Nur upgraden und Upgrade-Tooltip bleiben erhalten.
- Mit 200 Schiffen, Profilwechsel, unbekannten Modellvarianten und 125 % Skalierung geprüft. Keine zusätzliche RSI-Anmeldung oder Änderung am Bestand.
- Kompaktere Kettenkarten bei erhaltener Richtung, Kosten und Drag-and-drop. Gewählte Zielschiffe können persönliche RSI-Bildvorschauen zeigen; Bildklick öffnet die offizielle Schiffseite. Keine Schiffbilddateien im Installer, öffentliche Weitergabe nicht freigegeben.
- Vorrang 1/2/3 an den Zielkarten, lokal pro Profil gespeichert. Gemeinsam beanspruchte physische CCU-Exemplare und Startbasen werden mit betroffenen Zielen und Vorrang angezeigt; eigene Entwürfe bleiben erhalten.
- Variantenprüfung und bester bekannter Weg lassen vorrangig eingeplante Exemplare weg. Auch nach Übernahme bleibt ein nötiger Zukauf ein Zukauf und wird nicht durch ein für das andere Ziel eingeplantes CCU ersetzt.
- Getrennte gleiche Exemplare bleiben nutzbar; Ressourcenkonflikte werden nicht als gültige Gesamtkosten ausgegeben. Kein Nachweis eines global optimalen Flottenplans oder echter CCU-Kaufbarkeit.

## 0.3.33 – klare Karten und verlässlichere Varianten

- Getrennte Von-/Nach-Felder, ausgerichtete Kosten, aufklappbarer Preisvergleich unter der Kette und Vorrat darunter; silberne Ketten und Raster bleiben erhalten.
- Berechnete Wege als frei bearbeitbare Testentwürfe mit Drag-and-drop, Rückgängig und ausdrücklicher Übernahme. Auch inzwischen durch Bestand gedeckte Kaufpositionen bleiben verschiebbar.
- Zusätzliche feste öffentliche RSI-Abfrage für Standard-Schiffswerte ohne Anmeldung. Eindeutige Modellzuordnung und Erhalt älterer Hercules-Bezeichnungen.
- Normale Restlücken zusammengefasst; Varianten nach nominalem Zukauf vergleichen, identische Exemplare nicht mehrfach als Modellweg anbieten. Ungeprüfte Kaufpreise bleiben erkennbar.

## 0.3.30 – großes Logo und überarbeiteter Kettenplaner

- Logo auf Menübreite, Name mittig in Orbitron und nur „Sarevoc´s“ kursiv. Seitenleiste bleibt bei kleinen Fensterhöhen bedienbar.
- Kette über dem Vorrat, sichtbare Kettenglieder nach rechts, Kartenband oder Raster mit 3/4/5 Spalten und Abstand.
- Rückwärtsanschlüsse als Verbindungskonflikt statt fiktiver Kauf-CCU. Vorhandene Exemplare und gespeicherte Entwürfe behalten ihre Richtung und Zuordnung.
- Zusätzliche Kosten pro Schritt und als Summe: Standard-Schiffswertdifferenzen als Richtwert, konfigurierte Währung/MwSt., offene Beträge ausdrücklich markiert. Erfasste Anschaffungskosten und gesamte Investition getrennt; keine erfundenen Kaufpreise.

## 0.3.29 – freigegebene Grafiken

- Hauptlogo mit Chromkreuz, unverändertes Programmicon und das ausdrücklich freigegebene Tray-Icon V2 eingebunden. Keine zusätzlichen Bildränder oder Zustandsfarben.
- Fenster, EXE und Installer-Konfiguration verwenden das Programmicon; das Tray erhält seine eigene Grafik. Bestehende Tray-Funktionen bleiben erhalten.

## 0.3.28 – eine Navigation und freier Kettenbau

- Drei doppelte Menüeinträge zum CCU-Planer zusammengeführt; Zielkarten direkt anklickbar. Aktualisieren liest auch den gespeicherten Hangar, ohne eine neue interaktive Anmeldung zu starten.
- Vorhandene und fehlende CCUs als Kacheln mit Abstand: ziehen, ersetzen, umordnen, entfernen, per Plus oder Pfeil bedienen und rückgängig machen.
- Bis zu fünf Vorschlagsvarianten für eine Basis sowie eigene, pro Profil und Ziel gespeicherte Entwürfe. Unpassende Reihenfolgen, fehlende Exemplare und Speicherfehler bleiben sichtbar.
- Die automatische Basiswahl bewertet auch den nominalen Basiswert. Sie bevorzugt nicht mehr allein ein teures vorhandenes Schiff nahe am Ziel. Keine Kaufpreis- oder Optimalitätsgarantie.

## 0.3.27 – allgemeine Kettenplanung aus Hangarbeobachtungen

- Strukturierte eigenständige CCUs aus einem datierten RSI-Hangarstand können in die Vorschau eingehen. Importstatus, Schutz und Anwendbarkeit werden dabei nicht verändert.
- Frei gewählte Zielkarten zeigen Bestands-CCUs, Lücken und Startbasis. Basiswahl bleibt je Ziel während der Ansicht erhalten; neue Käufe berechnen die Alternativen neu.
- Tagesabruf auf 17:05 Europe/Berlin gesetzt und um das ausgewählte Hangarprofil mit gespeicherter Sitzung ergänzt. Keine neue interaktive Anmeldung, kein 30-Minuten-Polling und kein Windows-Dienst.
- Enthält die noch nicht installierten Korrekturen aus 0.3.25/0.3.26.

## 0.3.26 – korrigierbare Selbstbestätigung

- Rechtsklick auf eine Loaner-Regel öffnet ein Status-Dropdown: unbestätigt/zurücksetzen, vorhanden oder nicht vorhanden – jeweils als persönliche Benutzerangabe.
- Bestätigungen mit Datum pro lokalem Profil gespeichert. Geänderte zugehörige Schiffexemplare oder Regelzuordnungen übernehmen keinen unpassenden alten Status.
- Speichern, Korrigieren, Rücksetzen, Neustart, Profilwechsel und Fehlerfälle geprüft. Kein RSI-Login oder Schreibzugriff auf das RSI-Konto.
- Enthält die Korrekturen aus 0.3.25; diese Zwischenversion wurde nicht installiert.

## 0.3.25 – keine behaupteten Loaner-Zuteilungen

- Öffentliche Regelhinweise jetzt direkt in jeder Zeile als unbestätigt und ohne Zuteilungsnachweis gekennzeichnet. Veröffentlichter Regeltext und Quellenstand sichtbar.
- Keine Übertragung der allgemeinen Dragonfly-Zeile auf unbenannte Varianten wie Star Kitten.
- Giveaway-Herkunft erzeugt weder einen Zuteilungsnachweis noch eine erfundene generelle Ausschlussregel. Gelesene Schiffe bleiben erhalten.
- Keine Änderungen an Inventar, Zählern, Kettenressourcen, RSI-Sitzungen oder Kauf-/Änderungssperren.

## 0.3.24 – Loaner und Beiboote

- Bestandsfilter „Loaner & Beiboote“ mit zugehörigen aktuellen Schiffen, getrennten Arten und datierten Quellen-Tooltips.
- Öffentliche RSI-Matrix und Beiboot-Artikel ohne Konto- oder Sitzungsdaten. Tagesabruf 17:00 Europe/Berlin und manuelle Aktualisierung ohne Login.
- Gemeinsame Loaner einmal mit allen Ursprüngen; unbenutzte CCUs, entfernte Pledges und Buybacks erzeugen keine Zuordnung. Keine rekursive Herleitung aus Loanern.
- Gekaufter Bestand, Kosten, Versicherung und Kettenressourcen bleiben unverändert. Spielverfügbarkeit bleibt ausdrücklich ungeprüft.

## 0.3.23 – bereinigte Testversion

- Öffentliche Angebote, Schiffskatalog und Eurokurs beim Start und täglich 17:00 Uhr Europe/Berlin statt alle 30 Minuten. Sommerzeit und einmaliges Nachholen nach Standby berücksichtigt.
- Anzeige des täglichen Termins auf Deutsch und Englisch.
- Bereinigter erster Quellstand und portable Entwicklerpfade; private Projekthistorie und Laufzeitdaten ausgeschlossen.

## 0.3.22

- Fehlende CCU-Schritte können den offiziellen RSI-Shop-Einstieg im Standardbrowser öffnen. Keine unbestätigten Vorauswahlparameter.
- Kompaktes Kartenband mit türkisfarbenem Bestand und orangefarbenen Kauf-Lücken.

Frühere interne Entwicklungsberichte sind nicht Bestandteil dieser Testübergabe.


## 0.3.31 – Silberketten und Einrasten

- Silberne, plastische Kettenglieder mit Richtungspfeilen.
- Animierter Einfügeplatz nur während Drag-and-drop; Nachbarn weichen auseinander.
- Anschlussprüfung vor dem Loslassen, Ablehnung bekannter Rückwärtsanschlüsse, ehrliche Restlücken und ungeprüfte Werte.
- Rückgängig, Varianten, Raster, Profiltrennung und bestehende lokale Entwürfe erhalten. Keine neue RSI-Anmeldung durch das Setup; Kauf- und Änderungssperren unverändert.


## 0.3.32 – Variantenprüfung und Preisvergleich

- Explizite Schaltflächen Varianten prüfen und Bester bekannter Weg; maximal fünf nach zusätzlichem Zukauf gereihte Vergleichswege.
- Globale Kürzestwegprüfung aller erlaubten Basen und vorhandenen CCUs im belegbaren Modellgraphen, anschließend schleifenfreie Yen-Alternativen statt Ausschluss einzelner erster CCUs.
- Separate Worker-Berechnung mit sichtbaren Prüfgrenzen, Daten-/Profilbindung und ohne Netz-/Anmeldeaktionen.
- Preisvergleich: bisher bezahlt, noch zu kaufen, Gesamtkosten und Preisbeleg. Historische Kosten nur aus Belegen; Standard-Wertdifferenzen ausdrücklich Richtwerte.
- Vorschau verändert keine persönlichen Entwürfe; Übernehmen ist ausdrücklich, vorheriger Entwurf über Rückgängig wiederherstellbar.
- Grenzen und fehlende Preisbelege sichtbar; keine globale Shop-Optimalität oder bestätigte Warbond-Kaufkante behauptet. Kauf-/Änderungs-/Sitzungsschutz unverändert.
