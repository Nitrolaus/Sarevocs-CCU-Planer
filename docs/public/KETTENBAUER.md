# Ketten selbst bauen

Ab 0.3.30 steht die Kette über dem Vorrat. Der Vorrat lässt sich zwischen Kartenband und Raster mit 3, 4 oder 5 Spalten umschalten (Startwert 4; Ansichtsauswahl während der geöffneten Ansicht). Kettenglieder zeigen die Leserichtung nach rechts. Ungültige Rückwärtsanschlüsse sind Verbindungskonflikte ohne Kaufknopf; eigene CCUs bleiben vorhandene Exemplare.

Zusätzliche Standard-Schritte erhalten bei aktuellen belegten Schiffswerten einen **Richtwert aus der Wertdifferenz**, keinen bestätigten Kaufpreis. Sprache, Währung und eingestellter MwSt.-Satz werden berücksichtigt. Ein fehlender Wert oder veralteter Wechselkurs bleibt offen; Teilsummen nennen die Zahl unbekannter Positionen. Vorhandene CCUs bedeuten null zusätzliche Kosten, historische Anschaffungskosten werden davon getrennt gezeigt. Paketpreise werden nicht beliebig auf mehrere enthaltene Schiffe oder CCUs verteilt. Historische Steuergrundlagen werden nicht aus heutigen Einstellungen erfunden. Eine vollständige Investitionssumme erscheint nur bei vollständigen Kostenbelegen und gültiger Verbindung.

Im Menü **CCU-Planer** stehen die Zielkarten, darunter die Kachel-Arbeitsfläche und anschließend die Angebote. Klicke auf eine Zielkarte, um ihre Kette zu bearbeiten. Die Startbasis ist frei wählbar.

- **Vorschlag:** Der Planer ordnet passende vorhandene CCUs und offene Verbindungen. Die Automatik berücksichtigt den nominalen Basiswert, damit nicht allein die Nähe eines teuren vorhandenen Schiffs zum Ziel entscheidet. Das ist kein Beleg der günstigsten oder heute kaufbaren Kette.
- **Selbst bauen:** Einen Vorschlag übernehmen und frei verändern. Der persönliche Entwurf bleibt je Profil und Ziel gespeichert.
- **Variante:** Bis zu fünf berechnete Alternativen für dieselbe Basis. Die Auswahl ist nicht vollständig. Eigene Wege lassen sich unabhängig davon ausprobieren.

Türkise Kacheln sind vorhandene CCUs, orange Kacheln sind fehlende beziehungsweise noch ungeprüfte Verbindungen. Bereits eingeplante Exemplare sind im Vorrat gedimmt und ausdrücklich beschriftet. Die Suche hilft bei langen Vorräten. Jede Kachel bleibt mit Abstand zur nächsten sichtbar.

Ziehe eine Vorratskachel zwischen die Kettenkacheln, um sie einzufügen. Auf einer Kettenkachel ablegen ersetzt diesen Schritt. Innerhalb der Kette ziehen ordnet um. Mit **+** lässt sich eine Kachel ohne Ziehen einfügen; Pfeiltasten-Schaltflächen verschieben einen Schritt, **×** entfernt ihn. **Rückgängig** stellt die letzte Bearbeitung wieder her. **Vorschlag wiederherstellen** ist ebenfalls rückgängig machbar.

Orangefarbene Verbindungen dürfen mitgezogen werden. Das Öffnen des Shops ist eine separate Schaltfläche. Ziehen, Einfügen, Umordnen, Entfernen und Speichern kaufen nichts und wenden keine CCUs an.

Unpassende Vorwärtsanschlüsse werden rot markiert und mit Text erklärt. Unbekannte Werte bleiben ungeprüft. Verschwundene oder in ihrer Bedeutung geänderte CCU-Exemplare werden nicht still ersetzt. Ein Exemplar darf pro Kette höchstens einmal vorkommen. Ab 0.3.34 werden auch Konflikte zwischen den ausgewählten Zielen erkannt; der lokale Vorrang entscheidet bei neuen Suchen, welche Exemplare verfügbar sind.

Im Vorschlagsmodus wird nach neu gelesenen Käufen neu gerechnet. Im eigenen Entwurf bleiben die gewählten Schritte erhalten; eine genau passende, neu gelesene Bestands-CCU kann eine vorgeschlagene Lücke füllen. Die tatsächliche RSI-Anwendbarkeit bleibt ungeprüft.

**Aktualisieren** im CCU-Planer liest öffentliche Angebote und bei einem echten Profil die vorhandene Hangarsitzung. Es startet keine neue interaktive Anmeldung. Außerdem wird beim Start und täglich um 17:05 Uhr Berlin gelesen, solange die App läuft. Bei Fehlern bleibt der letzte gelesene Stand erhalten.

Entwürfe liegen lokal unter `Daten/Planungen`, getrennt von Inventar und verschlüsselten Sitzungen. Ein Speicherfehler wird angezeigt und ersetzt keine beschädigte Datei. Die dauerhafte Entwurfsfassung bleibt nach einem Neustart erhalten; die Rückgängig-Liste gilt für die offene Ansicht.

Für eine Probe ohne RSI lässt sich Demo-Kettenbau.json in einem Demoprofil importieren. Die Modellnamen darin sind künstlich. Ein ausgewähltes echtes Ziel wird dadurch nicht als erreichbares Angebot bestätigt; offene Verbindungen und Werte bleiben entsprechend ungeprüft.


Ab 0.3.31: Silberne Kettenglieder zeigen die Richtung. Beim Ziehen auf eine Verbindung fahren die Nachbarkarten auseinander. Vor dem Einfügen werden beide neuen Anschlüsse geprüft: direkte Verbindung, Restlücke oder ungeprüfter Anschluss. Bekannte Rückwärtsanschlüsse werden abgewiesen; unbekannte Werte werden nicht als bestätigt behandelt. Beim Loslassen wird nur der lokale Entwurf geändert, Rückgängig bleibt verfügbar. Historische eigene CCUs behalten ihre ursprüngliche Richtung.


### Variantenprüfung ab 0.3.32

**Varianten prüfen** berechnet nach einem Klick bis zu fünf schleifenfreie Wege. Alle im Suchraum vorhandenen Basen werden geprüft; eine ausdrücklich gewählte Basis bleibt eine Einschränkung. **Bester bekannter Weg** zeigt den Weg mit dem kleinsten noch nötigen Zukauf nach dem verfügbaren Preismodell. Bereits bezahlte Ressourcen werden nicht erneut als Zukauf gezählt. Bei gleichen Zusatzkosten entscheiden weniger Kaufpositionen und weniger Schritte; LTI dient erst danach als Gleichstandsregel.

Die erste Kürzestwegprüfung deckt den gesamten bekannten Modellgraphen ab. Unbekannte Preise werden nicht als null eingerechnet. Nicht belegte Kaufkanten bleiben Standardwert-Richtwerte, keine echten Shopangebote. Warbond-Zielwerte ohne bestätigten Von/Nach-Schritt gehen nicht als kaufbare Warbond-CCUs in die Optimierung ein. Die Aussage gilt für den verfügbaren Modellgraphen und die gewählte Basis, nicht für sämtliche gegenwärtigen Shopmöglichkeiten. Fehlende Modellpreise, fehlender Wechselkurs, Prüfgrenzen und unvollständige Alternativsuche werden angezeigt.

Im Preisvergleich stehen belegte bisherige Kosten, nötiger Zukauf, Gesamtkosten und Belegstatus nebeneinander. Ein Gesamtpreis wird nur bei vollständigen Positionen gezeigt. Richtwerte und Umrechnungen tragen ≈. Geldrechnung erfolgt mit ganzen Cent; Beträge außerhalb sicherer Ganzzahlsummen bleiben offen.

Prüfen und Ansehen speichern nichts. Erst **Übernehmen** schreibt den gewählten Weg in den lokalen Entwurf. Der vorherige Entwurf bleibt über **Rückgängig** erhalten. Profil-, Ziel- oder Datenwechsel verwerfen veraltete Suchergebnisse. Keine Käufe, Anwendungen oder neuen Anmeldungen durch die Prüfung.

### Karten und Logikkorrekturen ab 0.3.33

Kettenkarten zeigen „Von“ und „Nach“ getrennt und vollständig. Die Kosten stehen auf gleicher Höhe. Unter der Kette lässt sich der Preisvergleich aufklappen; darunter bleibt der Vorrat im Raster oder Kartenband. Silberne Kettenglieder verbinden die Schritte nach rechts.

Die Suche ordnet schleifenfreie, unterschiedliche Modellwege mit einer A*-Suche und rückwärts berechneten Kostenuntergrenzen. Zuerst zählt der noch nötige Standardwert in USD vor Steuer, danach die Zahl der Zukäufe und Schritte. Euro, Steuer und Cent-Rundung werden anschließend pro echter Kaufposition angezeigt. Mehrere aufeinanderfolgende normale Zukäufe werden zu einer direkten Lücke zusammengefasst: Rundungsreste erzeugen keine zusätzlichen Kaufpositionen. Gleiche CCU-Exemplare belegen keine mehrfachen Variantenplätze; die Exemplare bleiben im Vorrat einzeln auswählbar.

Zusätzlich zu den Angebotsbeobachtungen liest eine feste öffentliche, nicht angemeldete RSI-Abfrage die Standardwerte aus `from.ships` der Upgrade-API: https://robertsspaceindustries.com/pledge-store/api/upgrade/v2/graphql. Nur USD ohne Steuer und ohne Umrechnungsfaktor werden akzeptiert. Die Zuordnung verlangt Modell-ID und Modellname; lediglich die drei alten Hercules-Starlifter-Bezeichnungen haben ausdrücklich hinterlegte Zuordnungen. Zum Beispiel wird „600i Touring Module“ dadurch nicht automatisch zu „600i Touring“. Sechs Stunden alte Werte gelten als veraltet. Die Werte belegen weder die aktuelle Kaufbarkeit eines CCUs noch den historischen Kaufpreis. Abruf beim Start, manuell und zum bestehenden täglichen Termin; kein zusätzliches Polling.

Auch ein berechneter Weg lässt sich jetzt ziehen und bearbeiten. Diese Änderungen bleiben ein vorläufiger Testentwurf. **Übernehmen** speichert ihn, **Rückgängig** arbeitet vorher nur in dieser Vorschau. Beim Wechsel der Vergleichsvariante wird die ungespeicherte Probe verworfen. Gespeicherte eigene Entwürfe bleiben erhalten. Ein früher geplanter Zukauf, der inzwischen exakt durch eigenen Bestand gedeckt wird, bleibt verschiebbar.

### Vorrang und gemeinsame Exemplare ab 0.3.34

Jede Zielkarte hat Vorrang 1, 2 oder 3. Eine Änderung verschiebt die übrigen Ränge eindeutig und bleibt lokal pro Profil gespeichert. Kettenentwürfe werden dadurch nicht umgeschrieben. Ein Hinweis nennt gemeinsam eingeplante konkrete CCUs oder Startbasen, die betroffenen Schiffe und das vorrangige Ziel. Zwei gleichartige, aber tatsächlich getrennte Exemplare sind kein Konflikt.

**Varianten prüfen**, **Bester bekannter Weg** und der Baukasten verwenden für nachrangige Ziele nur freie Exemplare. Bei einer bereits belegten Basis nennt die Auswahl das vorrangige Ziel. Wähle für den neuen Vorschlag eine freie LTI-Basis. Eigene manuelle Schritte bleiben sichtbar. Gesamtkosten bleiben offen, wenn der Entwurf belegte Exemplare benötigt.

Eine Suchvorschau zählt erst nach **Übernehmen** als gespeicherter Entwurf. Prioritäts-, Profil- oder Datenwechsel verwerfen veraltete Suchvorschauen. Eine für diesen Weg erforderliche Kaufposition wird bei der Übernahme nicht durch ein bereits vorrangig verplantes CCU ersetzt. Kauft der Nutzer ein weiteres freies Exemplar und wird es eingelesen, kann es anschließend genutzt werden.

Der Vorrang ist eine lokale Planungshilfe, keine Reservierung bei RSI und keine gemeinsame globale Optimierung aller Zielschiffe. Er verändert weder Bestand noch Schutzwerte. Kaufbarkeit, spätere Messeangebote und unvollständige Preisbelege bleiben ungeprüft.

## Ein CCU für die Planung sperren

Das Schloss in der Aktionszeile einer Bestandskarte sperrt genau dieses einzelne Exemplar. Das geschlossene Schloss leuchtet rot. Ein weiterer Klick gibt es frei. Im Vorrat bleibt das gesperrte CCU sichtbar; gleichartige andere Exemplare bleiben verwendbar. Die lokale Einstellung gilt pro Profil für alle Zielketten, Varianten und Arbeitsentwürfe und überlebt einen Neustart.

Ein gespeicherter Entwurf mit einem gesperrten Exemplar bleibt erhalten und zeigt die betroffene Karte gedämpft. Sein Gesamtpreis wird als ungültig behandelt. Freigeben stellt den bisherigen Anker wieder her; alternativ lassen sich freie Varianten prüfen. Bei nicht lesbaren oder nicht bestätigten Sperrdaten pausieren neue Berechnungen. Die Sperre ändert keine RSI-Pledges, wendet kein Upgrade an und schützt nicht vor manuellen Aktionen auf der RSI-Seite.

## Berater ab 0.3.39

Die drei Umschalter und ihre Beleggrenzen sind in [BERATER.md](BERATER.md) beschrieben. Vorrang ist jetzt fest nach Zielplatz 1, 2, 3.


## LTI-Basis ab 0.3.40

Vor der Kettenberechnung ist die Startbasis selbst zu wählen. Höhere eigene LTI-Schiffe werden nur nach bewusstem Einblenden angeboten. Frühere automatische Vorschläge sind keine Freigabe. Die Einzelheiten und der verständlichere Konfliktberater stehen in [BERATER.md](BERATER.md).

Die begonnene Kette samt Startbasis und Kosten bleibt beim Wechsel zu **Vorrang & freie CCUs** oder **CCU-Kaufoptimierer** sichtbar. Unter **Vorrang & freie CCUs** siehst du die Zuteilung und den freien Vorrat für das ausgewählte Ziel.

Der Vorrat startet als Raster mit fünf Spalten; drei/vier Spalten und das Kartenband bleiben wählbar. Nur die Zielkarte der angezeigten Kette hat den leuchtenden türkisen Rahmen und „Aktuell bearbeitet“. Ziel 1 wird nicht zusätzlich markiert; die Auswahl ändert den Vorrang nicht.
