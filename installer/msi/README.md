# WiX-MSI 0.3.118 Alpha

Dieses Verzeichnis enthält den Quellcode des MSI-Installers für Windows x64. `SetupUI.wxs` beschreibt den Dialog mit Ordnerwahl und Zustimmungs-Checkbox. Der Kopfbereich verwendet das Planer-Logo. Der Build übernimmt die Nutzungsbedingungen aus `installer/SetupWindow.cs` und vergleicht den vollständigen Text mit dem Hash im Zustimmungsbeleg.

`Product.wxs` beschreibt Dateien, Komponenten und Registrierung. `NativePreflight.cpp` prüft die vorhandene Installation, den Ordner und die bekannten Programmdateien. Windows Installer führt den Austausch und die Rücksicherung mit seinen Standardaktionen durch.

## Paket bauen

Benötigt werden Node.js, PowerShell, WiX 3.14.1 mit UI-Erweiterung, MSVC x64 und das Windows SDK. Verwende die mit `npm run package` erstellte Windows-Anwendung als Grundlage. Der Bau dieses Release-Pakets verlangt, dass die Programmdateien mit dem geprüften Manifest `msi118.tsv` übereinstimmen. Abweichende Anwendungsbuilds benötigen ein eigenes geprüftes Manifest.

```powershell
./installer/msi/Build.ps1 -Application 'work/temp/packaged/Sarevocs-CCU-Planer-win32-x64' -BuildDirectory 'work/temp/msi' -WixDirectory 'Pfad/zur/portablen/WiX-Installation'
```

## Ordnerwahl und Daten

Das Setup schlägt beim Wechsel von CAB 0.3.117 den registrierten Ordner vor. Beim Wechsel in einen anderen Ordner müssen das Ziel leer sein und die Dateiprüfungen der alten Installation erfolgreich sein. Der Installer berücksichtigt beim Aufräumen die geprüften Programmdateien aus `cab117.tsv`. Profile, Hangar und gespeicherte Sitzung liegen im separaten Windows-Benutzerprofil.
