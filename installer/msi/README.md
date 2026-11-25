# WiX-MSI 0.3.125

Dieses Verzeichnis enthält den Quellcode des MSI-Installers für Windows x64. `SetupUI.wxs` beschreibt den Dialog mit Ordnerwahl und Zustimmungs-Checkbox. Der Kopfbereich verwendet das Planer-Logo. Der Build übernimmt die Nutzungsbedingungen aus `installer/SetupWindow.cs` und vergleicht den vollständigen Text mit dem Hash im Zustimmungsbeleg.

`Product.wxs` beschreibt Dateien, Komponenten und Registrierung. `NativePreflight.cpp` prüft die vorhandene Installation, den Ordner und die bekannten Programmdateien. Beim Wechsel von MSI 0.3.118 bis 0.3.120 installiert Windows Installer zuerst die neue Version. Er entfernt die bestätigte Altversion nach Abschluss der Installation. So bleiben ihre Dateien und ihre MSI-Registrierung während des Updates verfügbar. Die Wartung für 0.3.125 bietet Reparatur und Deinstallation.

## Paket bauen

Benötigt werden Node.js, PowerShell, WiX 3.14.1 mit UI-Erweiterung, MSVC x64 und das Windows SDK. Verwende die mit `npm run package` erstellte Windows-Anwendung als Grundlage. Der Bau vergleicht jede Programmdatei mit `msi125.tsv`. Abweichende Anwendungsbuilds benötigen ein eigenes geprüftes Manifest.

```powershell
./installer/msi/Build.ps1 -Application 'work/temp/packaged/Sarevocs-CCU-Planer-win32-x64' -BuildDirectory 'work/temp/msi' -WixDirectory 'Pfad/zur/portablen/WiX-Installation'
```

Der Build erzeugt `Sarevocs-CCU-Planer-Setup-0.3.125-Alpha.msi`. Die Anleitung für den früheren gemeinsamen EXE-Installer steht im Tag `v0.3.120-alpha`.

## Ordnerwahl und Daten

Das Setup schlägt den registrierten Ordner vor. Beim Wechsel in einen anderen Ordner müssen das Ziel leer sein und die Dateiprüfungen der alten Installation erfolgreich sein. Profile, Hangar und gespeicherte Sitzung liegen im separaten Windows-Benutzerprofil.

Beim Wechsel von einem veröffentlichten EXE-Installer prüft das Setup die registrierte Version und die Dateigrößen und SHA-256-Prüfsummen aus der zugehörigen Liste `cab<Build>.tsv`. Die Zuordnung ist in `cab-manifests.json` hinterlegt. `harvest.mjs` erzeugt aus jeder Liste eigene bedingte MSI-Komponenten für die zugehörigen Altdateien. Die Dateilisten stammen aus Installationen der öffentlich veröffentlichten EXE-Dateien in der Offline-Windows-Sandbox.

Das Update von MSI 0.3.121 bis 0.3.124 verwendet denselben ProductCode und den registrierten Programmordner. Windows Installer kann dabei das ursprünglich registrierte MSI-Quellpaket anfordern. Nach einem Update von 0.3.121 auf 0.3.122 kann der registrierte Dateiname weiterhin auf 0.3.121 lauten. Lege das jeweils ursprünglich verwendete MSI neben das neue und behalte beide Dateinamen bei. Beende den Planer im Windows-Infobereich und führe im Ordner mit den MSI-Dateien den folgenden Befehl aus.

```powershell
msiexec.exe /i ".\Sarevocs-CCU-Planer-Setup-0.3.125-Alpha.msi" REINSTALL=ALL REINSTALLMODE=vamus
```

Falls die ursprüngliche MSI fehlt, kann sie erneut aus dem [Release 0.3.121 Alpha](https://github.com/Nitrolaus/Sarevocs-CCU-Planer/releases/tag/v0.3.121-alpha) geladen werden.

Von MSI 0.3.118 bis 0.3.120 schlägt das Setup den Unterordner `CCU_Planer-Programm` vor. Über „Durchsuchen …“ lässt sich auch ein anderer geeigneter leerer Ordner wählen. Die Desktop-Verknüpfung heißt „Sarevoc´s CCU Planer Alpha“. Bei einer EXE-Altinstallation mit unzureichenden Ordnerrechten bleibt die Wahl eines geeigneten neuen Ordners möglich. Der unsichere Altordner bleibt dabei erhalten.
