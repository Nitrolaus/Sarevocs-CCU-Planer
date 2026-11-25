# Windows-Installer-Patch für 0.3.118

Das MSP aktualisiert die bereits installierte MSI-Version 0.3.118 im bisherigen Programmordner. Es nutzt die bestehende Produktkennung und die Windows-Installer-Rücksicherung. Der vollständige MSI-Installer hat eine eigene Produktkennung und ist für Neuinstallationen und die bisherigen EXE-Installationen vorgesehen.

## Build

`LegacyMsi119.patch` enthält die Änderungen am MSI-Quellstand `v0.3.118-alpha`. Wende die Datei in einer separaten Kopie dieses Tags mit `git apply` an. Baue dort das MSI mit `installer/msi/Build.ps1` und den verpackten 0.3.119-Anwendungsdateien aus diesem Release. Der MSI-Dateiname des Zwischenbuilds bleibt `Sarevocs-CCU-Planer-Setup-0.3.118-Alpha.msi`. Seine Produktversion ist 0.3.119.

Für das Delta brauchst du das ursprüngliche WiX-Debugpaket (`.wixpdb`) des veröffentlichten MSI 0.3.118 und das `.wixpdb` des neuen Zwischenbuilds. Führe im Build-Ordner mit WiX 3.14.1 aus:

```powershell
torch.exe -p -xi baseline-03118.wixpdb update-03119.wixpdb -out delta.wixmst
candle.exe Patch.wxs -out Patch.wixobj
light.exe Patch.wixobj -out Patch.wixmsp
pyro.exe Patch.wixmsp -t Msi118 delta.wixmst -out Sarevocs-CCU-Planer-Update-0.3.118-auf-0.3.119.msp
```
