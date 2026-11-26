# WiX-MSI 0.3.130 – Doppelklick-Update

Ab diesem Stand bekommt jede dreiteilige Programmversion automatisch eine eigene MSI-Produktkennung. Die gemeinsame UpgradeCode bleibt unverändert. Damit startet die neue MSI beim Öffnen ein Versionsupgrade statt der bisherigen Wartung mit manuell gesetzten REINSTALL-Parametern. Die Produktkennung wird in `product-identity.mjs` deterministisch aus der Version berechnet; ein erneuter Bau derselben Version behält seine Wartungsidentität.

Die MSI erkennt bekannte Vorgänger, wählt ihren registrierten Programmordner voraus und lässt die Bedingungen im normalen Dialog bestätigen. Der alte Ordner bleibt erhalten; es wird kein zusätzlicher Unterordner angelegt. Die Entfernung der Vorgängerversion ist nach `InstallInitialize` innerhalb der Windows-Installer-Transaktion eingeplant und erfolgt vor dem Schreiben der neuen Programmdateien. So können auch die unveränderten Prüfungen alter Pakete noch ihren eigenen Dateistand prüfen. Bei einem Fehler soll Windows die alte Installation zurücksichern. Die Sandbox-Prüfung erfolgt ohne die heruntergeladenen MSI-Dateien der Vorgänger; Ergebnisse werden separat festgehalten.

Die geschützten Anwendungsdaten werden weiterhin unabhängig vom Programmordner im Windows-Benutzerprofil verwaltet. Derselbe 0.3.130-Installer öffnet bei bereits installierter 0.3.130 den Wartungsdialog für Reparatur und Deinstallation. Eine Reparatur verwendet die gerade geöffnete MSI mit vollständiger Neucache-Anforderung.

Das Paket 0.3.130 enthält den Warbond-Hinweis und das vereinfachte MSI-Update. Der konkrete Testumfang und die bekannten Grenzen stehen in den [Release-Hinweisen](https://github.com/Nitrolaus/Sarevocs-CCU-Planer/releases/tag/v0.3.130-alpha). Windows-Rückgabecode 3010 bedeutet einen erfolgreichen Vorgang mit Neustartbedarf; die Prüftreiber behandeln ihn gesondert und kontrollieren zusätzlich die installierten Dateien. Ein allgemeiner Standardbenutzer- oder VirusTotal-Nachweis wird daraus nicht abgeleitet.

Dieses Verzeichnis enthält den Quellcode des MSI-Installers für Windows x64. `SetupUI.wxs` beschreibt den Dialog mit Ordnerwahl und Zustimmungs-Checkbox. Der Kopfbereich verwendet das Planer-Logo. Der Build übernimmt die Nutzungsbedingungen aus `installer/SetupWindow.cs` und vergleicht den vollständigen Text mit dem Hash im Zustimmungsbeleg.

`Product.wxs` beschreibt Dateien, Komponenten und Registrierung. `NativePreflight.cpp` prüft die vorhandene Installation, den Ordner und die bekannten Programmdateien. Für MSI 0.3.118 bis 0.3.129 bleiben die veröffentlichten Dateilisten und Produktkennungen als bekannte Vorgänger erhalten. Eine unerkannte oder widersprüchliche Registrierung wird nicht ungeprüft übernommen. Bei einer neuen Version müssen deren Vorgängermanifest und bekannte Produktkennung ebenfalls aufgenommen werden.

## Paket bauen

Benötigt werden Node.js, PowerShell, WiX 3.14.1 mit UI-Erweiterung, MSVC x64 und das Windows SDK. Verwende die mit `npm run package` erstellte Windows-Anwendung als Grundlage. Der Bau vergleicht jede Programmdatei mit `msi130.tsv`. Abweichende Anwendungsbuilds benötigen ein eigenes geprüftes Manifest.

```powershell
./installer/msi/Build.ps1 -Application 'work/temp/packaged/Sarevocs-CCU-Planer-win32-x64' -BuildDirectory 'work/temp/msi' -WixDirectory 'Pfad/zur/portablen/WiX-Installation'
```

Der Build erzeugt `Sarevocs-CCU-Planer-Setup-0.3.130-Alpha.msi`. Die Anleitung für den früheren gemeinsamen EXE-Installer steht im Tag `v0.3.120-alpha`.

## Ordnerwahl und Daten

Im weiterentwickelten Quellstand kann ein gemeinsam beschreibbarer Programmordner nach einer ausdrücklichen Risikoabfrage verwendet werden. Die native MSI-Abfrage zeigt den betroffenen Pfad und erklärt, dass veränderte Programmdateien unter dem Windows-Konto des Nutzers ausgeführt werden könnten. Standardmäßig ist „Nein“ ausgewählt. „Ja“ gibt genau diesen Ordner für den aktuellen Installationslauf frei. Beim Wechsel des Ordners ist eine neue Zustimmung erforderlich.

Für eine unbeaufsichtigte Installation kann `CCUFOLDERRISKROOT` ausdrücklich auf den vollständigen Zielpfad gesetzt werden. Ohne diese pfadbezogene Angabe stoppt eine stille Installation bei weitreichenden oder nicht eindeutig bewertbaren Ordnerrechten. Die Freigabe erteilt keine Windows-Schreibrechte. Unterordner von „Programme“ sind als Ziel möglich, sofern Windows den Schreibzugriff gestattet.

Die Freigabe betrifft die Bewertung der Ordnerrechte. Physische Pfadprüfung, Datei-Prüfsummen, Verknüpfungsprüfung und transaktionale Rücksicherung werden weiterhin ausgeführt. Persönliche Daten und die gespeicherte Sitzung liegen im Windows-Benutzerprofil.

Das Setup schlägt den registrierten Ordner vor. Beim Wechsel in einen anderen Ordner müssen das Ziel leer sein und die Dateiprüfungen der alten Installation erfolgreich sein. Profile, Hangar und gespeicherte Sitzung liegen im separaten Windows-Benutzerprofil.

Beim Wechsel von einem veröffentlichten EXE-Installer prüft das Setup die registrierte Version und die Dateigrößen und SHA-256-Prüfsummen aus der zugehörigen Liste `cab<Build>.tsv`. Die Zuordnung ist in `cab-manifests.json` hinterlegt. `harvest.mjs` erzeugt aus jeder Liste eigene bedingte MSI-Komponenten für die zugehörigen Altdateien. Die Dateilisten stammen aus Installationen der öffentlich veröffentlichten EXE-Dateien in der Offline-Windows-Sandbox.

Für ein Versionsupdate mit 0.3.130 ist vorgesehen: den Planer vollständig einschließlich Tray beenden, die neue MSI per Doppelklick öffnen und den Update-Dialog bestätigen. Manuelle REINSTALL-Parameter sind für dieses Versionsupgrade nicht erforderlich und werden zurückgewiesen, damit kein unvollständiger Wartungslauf als Update ausgegeben wird. Der von Windows verwaltete Installer-Cache bleibt regulär erhalten; der Anwender soll keine heruntergeladene alte MSI mehr bereithalten müssen. Ein fehlender oder beschädigter Windows-Installer-Cache ist ein gesonderter Fehler und wird nicht durch ungeprüfte Registry-Änderungen überspielt.

Bei vollständiger MSI-Oberfläche kann Windows `REINSTALL=ALL` vor dem serverseitigen Ablauf in `REINSTALL=Planner` auflösen. Die Vorabprüfung erkennt diese gleichwertige Darstellung nur dann an, wenn `Planner` die gesamte Funktionstabelle des aktiven MSI bildet. Der Paket-Neucache mit `REINSTALLMODE=vamus`, bekannte Dateiprüfsummen und der Ausschluss einer gleichzeitigen Deinstallation bleiben Pflicht.

Der registrierte MSI-Programmordner wird vorausgewählt. Über „Durchsuchen …“ lässt sich bei einem Versionswechsel auch ein anderer geeigneter leerer Ordner außerhalb der Altinstallation wählen. Die Desktop-Verknüpfung heißt „Sarevoc´s CCU Planer Alpha“. Bei einer EXE-Altinstallation mit unzureichenden Ordnerrechten bleibt die Wahl eines geeigneten neuen Ordners möglich. Der unsichere EXE-Altordner bleibt dabei erhalten.
