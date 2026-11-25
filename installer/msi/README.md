# Gemeinsames WiX-Setup 0.3.120

`Bundle.wxs` beschreibt den einzelnen Download. WiX Burn wählt für Neuinstallationen und frühere EXE-Installationen das eingebettete MSI. Bei den vorhandenen MSI-Produkten 0.3.118 und 0.3.119 verwendet Burn das eingebettete Windows-Installer-Update. Der Build setzt für beide Wege dieselben verpackten Anwendungsdateien ein.

Dieses Verzeichnis enthält den Quellcode des MSI-Installers für Windows x64. `SetupUI.wxs` beschreibt den Dialog mit Ordnerwahl und Zustimmungs-Checkbox. Der Kopfbereich verwendet das Planer-Logo. Der Build übernimmt die Nutzungsbedingungen aus `installer/SetupWindow.cs` und vergleicht den vollständigen Text mit dem Hash im Zustimmungsbeleg.

`Product.wxs` beschreibt Dateien, Komponenten und Registrierung. `NativePreflight.cpp` prüft die vorhandene Installation, den Ordner und die bekannten Programmdateien. Windows Installer führt den Austausch und die Rücksicherung mit seinen Standardaktionen durch.

## Paket bauen

Benötigt werden Node.js, PowerShell, WiX 3.14.1 mit UI-, Bal- und Util-Erweiterung, MSVC x64 und das Windows SDK. Verwende die mit `npm run package` erstellte Windows-Anwendung als Grundlage. Der Bau vergleicht jede Programmdatei mit `msi120.tsv`. Abweichende Anwendungsbuilds benötigen ein eigenes geprüftes Manifest.

```powershell
./installer/msi/Build.ps1 -Application 'work/temp/packaged/Sarevocs-CCU-Planer-win32-x64' -BuildDirectory 'work/temp/msi' -WixDirectory 'Pfad/zur/portablen/WiX-Installation'
```

Erstelle den MSI-Zwischenbuild für die Produktkennung 0.3.119 mit `Build.ps1 -ProductCode '{142B7731-1211-4ED2-AE86-C572D7053119}'` in einem separaten Build-Ordner. Wende für die Produktkennung 0.3.118 `patch-03118/LegacyMsi120.patch` auf eine Kopie des Tags `v0.3.118-alpha` an und baue dort ein weiteres MSI mit derselben Anwendung. Die Zwischenpakete dienen WiX zur Erzeugung der Transformationen für die beiden Produktkennungen.

`Build-CommonBundle.ps1` erhält das neue MSI für Neuinstallationen und die beiden neuen WiX-Debugpakete. Als Ausgangspunkte verwendet es die archivierten WiX-Debugpakete von 0.3.118, vom Zwischenbuild für das veröffentlichte MSP auf 0.3.119 und vom veröffentlichten 0.3.119 Ordnerwechsel-Test. Die ersten beiden behalten dieselbe Produktkennung. Das neue MSP enthält für beide Versionsstände einen eigenen Transformationspfad und lässt das bereits installierte MSP in seiner Reihenfolge bestehen. Der Build prüft die SHA-256-Werte der MSI-Dateien neben den Debugpaketen. Die Ausgabe `Sarevocs-CCU-Planer-Setup-0.3.120-Alpha.exe` ist die gemeinsame Installationsdatei.

## Ordnerwahl und Daten

Das Setup schlägt den registrierten Ordner vor. Beim Wechsel in einen anderen Ordner müssen das Ziel leer sein und die Dateiprüfungen der alten Installation erfolgreich sein. Profile, Hangar und gespeicherte Sitzung liegen im separaten Windows-Benutzerprofil.

Beim Wechsel von einem veröffentlichten EXE-Installer prüft das Setup die registrierte Version und die Dateigrößen und SHA-256-Prüfsummen aus der zugehörigen Liste `cab<Build>.tsv`. Die Zuordnung ist in `cab-manifests.json` hinterlegt. `harvest.mjs` erzeugt aus jeder Liste eigene bedingte MSI-Komponenten für die zugehörigen Altdateien. Die Dateilisten stammen aus Installationen der öffentlich veröffentlichten EXE-Dateien in der Offline-Windows-Sandbox.

Für eine bestehende MSI-Installation benutzt das Setup den registrierten Programmordner. Bei einer EXE-Altinstallation mit unzureichenden Ordnerrechten kann der Nutzer einen geeigneten neuen Ordner auswählen. Der unsichere Altordner bleibt dabei erhalten.
