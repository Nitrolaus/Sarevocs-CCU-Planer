# WiX-MSI 0.3.121

Dieses Verzeichnis enthält den Quellcode des MSI-Installers für Windows x64. `SetupUI.wxs` beschreibt den Dialog mit Ordnerwahl und Zustimmungs-Checkbox. Der Kopfbereich verwendet das Planer-Logo. Der Build übernimmt die Nutzungsbedingungen aus `installer/SetupWindow.cs` und vergleicht den vollständigen Text mit dem Hash im Zustimmungsbeleg.

`Product.wxs` beschreibt Dateien, Komponenten und Registrierung. `NativePreflight.cpp` prüft die vorhandene Installation, den Ordner und die bekannten Programmdateien. Bei einem Wechsel von MSI 0.3.118 bis 0.3.120 ersetzt Windows Installer das alte Produkt innerhalb derselben Transaktion. Die Wartung für 0.3.121 bietet Reparatur und Deinstallation.

## Paket bauen

Benötigt werden Node.js, PowerShell, WiX 3.14.1 mit UI-Erweiterung, MSVC x64 und das Windows SDK. Verwende die mit `npm run package` erstellte Windows-Anwendung als Grundlage. Der Bau vergleicht jede Programmdatei mit `msi121.tsv`. Abweichende Anwendungsbuilds benötigen ein eigenes geprüftes Manifest.

```powershell
./installer/msi/Build.ps1 -Application 'work/temp/packaged/Sarevocs-CCU-Planer-win32-x64' -BuildDirectory 'work/temp/msi' -WixDirectory 'Pfad/zur/portablen/WiX-Installation'
```

Der Build erzeugt `Sarevocs-CCU-Planer-Setup-0.3.121-Alpha.msi`. Die Anleitung für den früheren gemeinsamen EXE-Installer steht im Tag `v0.3.120-alpha`.

## Ordnerwahl und Daten

Das Setup schlägt den registrierten Ordner vor. Beim Wechsel in einen anderen Ordner müssen das Ziel leer sein und die Dateiprüfungen der alten Installation erfolgreich sein. Profile, Hangar und gespeicherte Sitzung liegen im separaten Windows-Benutzerprofil.

Beim Wechsel von einem veröffentlichten EXE-Installer prüft das Setup die registrierte Version und die Dateigrößen und SHA-256-Prüfsummen aus der zugehörigen Liste `cab<Build>.tsv`. Die Zuordnung ist in `cab-manifests.json` hinterlegt. `harvest.mjs` erzeugt aus jeder Liste eigene bedingte MSI-Komponenten für die zugehörigen Altdateien. Die Dateilisten stammen aus Installationen der öffentlich veröffentlichten EXE-Dateien in der Offline-Windows-Sandbox.

Für eine bestehende MSI-Installation benutzt das Setup den registrierten Programmordner. Bei einer EXE-Altinstallation mit unzureichenden Ordnerrechten kann der Nutzer einen geeigneten neuen Ordner auswählen. Der unsichere Altordner bleibt dabei erhalten.
