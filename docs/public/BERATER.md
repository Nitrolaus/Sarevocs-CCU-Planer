# Vorrang, freie CCUs und heutiger CCU-Kaufoptimierer

Im Kettenbauer bleiben die Startbasis, die begonnene Kette und ihre Kosten beim Wechsel der Ansichten sichtbar. **Vorrang & freie CCUs** zeigt die Zuteilung und die freien Exemplare für das aktive Ziel. Der **CCU-Kaufoptimierer** steht unterhalb der Kette.

## Startbasis bewusst wählen

Für jedes Ziel ist zuerst ein eigenes Schiff oder Fahrzeug mit belegtem LTI als Startbasis auszuwählen. Es wird kein vorhandener Rumpf automatisch vorgewählt. Die Standardliste bietet günstige Basen bis etwa 50 EUR Richtwert vor Steuer an; höhere und unbekannte Werte erscheinen erst nach bewusstem Einblenden. Die Grenze wird mit aktuellem Eurokurs berechnet. Fehlt ein verlässlicher Kurs, wird kein unbekannter Betrag als günstig eingestuft. Nicht-LTI-Basen werden nicht angeboten.

Die Auswahl selbst bestätigt genau dieses Exemplar für dieses Ziel. Ein höherwertiges LTI-Schiff wie die Hull B darf nur durch diese ausdrückliche Auswahl zur Basis werden. Bereits gespeicherte alte Entwürfe bleiben erhalten, benötigen aber einmal eine bewusste Bestätigung oder neue Auswahl. Ein früher automatisch gespeicherter Basisname reicht nicht. Ist die Basis entfernt oder LTI nicht mehr belegt, pausiert die Planung. Neue Bestätigungen werden zusammen mit dem lokalen Entwurf gespeichert; ältere Programmversionen können dieses zusätzliche Feld nicht lesen.

## Vorrang & freie CCUs

Der Planer teilt konkrete LTI-Basen und CCU-Exemplare in der Reihenfolge **Ziel 1 → 2 → 3** zu. Der Baukasten bietet die Exemplare an, die nach den vorrangigen Ketten frei sind. Zwei physisch getrennte Exemplare desselben Modells oder CCUs bleiben einzeln verfügbar.

Wenn die gespeicherte Startbasis bereits zu einem früheren Ziel gehört, steht das direkt an der Auswahl. Wähle dann bewusst eines der freien LTI-Exemplare. Besetzte CCUs in einem bestehenden Entwurf bleiben dort sichtbar, damit du sie entfernen oder einen Vorschlag aus dem freien Bestand prüfen kannst.

Mit **Bester bekannter Weg** kannst du einen Ersatzvorschlag für das aktive Ziel prüfen und anschließend übernehmen. Die Zuteilung gilt lokal im Planer. Solange vorrangige Ketten offen sind, ist die Anzeige der freien Exemplare vorläufig.

## Heutiger CCU-Kaufoptimierer

Zuerst für jedes Ziel selbst eine LTI-Startbasis wählen, dann Warbond-Ziel auswählen und **Einstiege prüfen** drücken. Grundlage sind aktuelle öffentliche RSI-Ausgangsschiffswerte und beobachtete Open-Hangar-Zielpreise. Der Optimierer vergleicht alle Ausgangsschiffe der höchsten Preisstufe **streng unter dem Warbond-Zielpreis**. Gleichpreisige Modelle werden vollständig berücksichtigt, einschließlich offizieller Modelle aus der RSI-Ausgangsliste ohne Matrixeintrag.

Für jedes Ausgangsschiff und jedes Ziel vergleicht die Suche den besten bekannten Weg ohne Neukauf mit einem Weg, der genau diesen hypothetischen Einstieg enthält. Berechnet werden Anschluss davor, neuer CCU-Preis und sämtliche Lücken danach. Bestands-CCUs verursachen keinen zusätzlichen Kaufbetrag. Nachrangige Ziele erhalten nur freie CCU-Exemplare; ihre selbst gewählte Basis bleibt fest.

Die Tabelle zeigt noch nötigen Zukauf einschließlich Einstieg und den Vorteil gegenüber dem Weg ohne diesen Neukauf. Gleiche Ergebnisse bleiben gleichwertig; negative Vorteile bedeuten Mehrkosten. Ein bereits vorhandenes gleichwertiges CCU kann den Kauf überflüssig machen. Auch ein neu gekauftes CCU ist zuerst dem ersten Ziel mit einem positiven Vorteil zugeordnet, selbst wenn ein nachrangiges Ziel mehr sparen könnte. Die Einstiege sind Alternativen, keine gemeinsame Einkaufsliste. „Anschluss und Vergleich“ zeigt die getrennten Wege; **RSI-Upgrades** öffnet nur die offizielle allgemeine Upgrade-Seite im Standardbrowser.

## Beleggrenzen

- Zukaufpreise sind Richtwerte. Open Hangar beobachtet ein Zielangebot, bestätigt aber keinen konkreten kaufbaren Von→Nach-Schritt. Die Steuer wird mit dem eingestellten Satz berechnet. Euro ist eine Umrechnung, kein bestätigter RSI-Euro-Kassenpreis.
- Die Suche ordnet nach USD vor Steuer, dann nach Lücken und Schritten. Die Anzeige summiert positionsweise mit den vorhandenen Euro-/Steuereinstellungen wie der Kettenbauer.
- Der Suchraum enthält Bestand, normale Lücken und genau den untersuchten neuen Warbond-Einstieg. Mehrere gleichzeitig neu zu kaufende Warbonds werden noch nicht gemeinsam optimiert. Untersucht wird die nächste niedrigere Preisstufe, nicht jede beliebige entfernte Einstiegspreisstufe.
- Varianten werden nicht unscharf zusammengelegt. Widersprüchliche Werte, uneindeutige Zuordnung, veraltete Daten, unbekannte Preise und Suchgrenzen werden sichtbar gekennzeichnet.
- Ein Suchlimit beweist keinen besten Weg. Ein bewiesener Weg gilt im bekannten, belegbaren Suchraum; Kaufbarkeit und Anwendbarkeit bleiben ungeprüft.
- Hypothetische Kaufkarten werden weder als bezahlt noch als Bestands-CCU gespeichert. Keine Bestellung, kein Anwenden, keine Kontoänderung und keine zusätzliche Anmeldung.
