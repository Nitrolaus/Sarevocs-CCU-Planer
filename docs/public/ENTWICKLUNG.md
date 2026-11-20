# Entwicklung und Prüfung

Windows 11 x64, Node.js 24 mit npm und PowerShell 7 werden vorausgesetzt. Pakete werden ausschließlich projektlokal installiert. Der Windows-Installer nutzt den vorhandenen .NET-Framework-Compiler unter Windows sowie einen portablen NSIS-Compiler (hier 3.12). Der Compilerpfad ist über CCU_NSIS_COMPILER einstellbar; es wird keine systemweite NSIS-Installation vorausgesetzt. Der Installer schreibt ohne automatische Rechteerhöhung in den gewählten Programmordner. Frühere Squirrel-Installationen werden erst nach erfolgreicher neuer Installation entfernt; Daten und Sitzungen bleiben getrennt in LocalAppData.

```powershell
pwsh -NoProfile -File .\Entwickeln.ps1 -Aktion Installieren
pwsh -NoProfile -File .\Entwickeln.ps1 -Aktion Pruefen
pwsh -NoProfile -File .\Entwickeln.ps1 -Aktion Installer
node scripts/verify-installer.mjs
```

Installieren lädt die festgeschriebenen npm-Abhängigkeiten und die Electron-Laufzeit. Caches und temporäre Entwicklerdaten liegen unter `work` im Projekt. Es werden keine globalen npm-Pakete installiert. Der Installer-Build liegt zunächst unter `work/temp`; die exakten Dateien stehen in `work/temp/bootstrapper-artifacts.json`.

`npm test` prüft Domänenlogik, Import, Versicherung, Ketten, Sicherheit und den täglichen Abruf mit synthetischen Daten. Die Zeitsteuerung wird ohne reale Wartezeiten einschließlich Sommerzeitwechsel, Standby-Nachholen und Beenden geprüft.

```powershell
node scripts/chain-ui.mjs
node scripts/euro-settings-ui.mjs
node scripts/loaners-ui.mjs
node scripts/approved-assets.mjs
```

Die UI-Prüfungen verwenden getrennte synthetische Profile und sperren reale Netzaufrufe. Sie öffnen keine echte RSI-Anmeldung oder den Standardbrowser. Eine importierbare Demodatei liegt bereits unter `tests/fixtures/demo-inventory.json`; sie enthält keine echten Kontodaten.

Die Grafikprüfung setzt einen aktuellen Build voraus. Sie prüft die freigegebenen SHA-256-Werte, sämtliche ICO-Frames, tatsächliche Alpha-Kanäle, enge Motivgrenzen und die Logos im isolierten Renderer. Die 16-px-Traygrafik behält bewusst ihren scharfen binären Alpha-Kanal. Quelle und Zuordnung: `assets/README.md` und `assets/approved-assets.json`.

`node scripts/loaner-sources.mjs` prüft separat die zwei öffentlichen RSI-Artikel über die echte Electron-Transportschicht, ohne Konten oder Sitzungen zu laden. Dafür ist Internetzugriff nötig. Die normalisierten Testdaten und Belege bleiben unter `work/temp`.

Einige optionale Regressionstests unterstützen `--baseline` und benötigen dazu `--baseline-dir=<Pfad>` zu einer selbst vorgehaltenen, passenden historischen Quellversion. Historische Entwickler-Checkpoints und lokale Übergabeskripte sind nicht Bestandteil dieser bereinigten Quelle.

Keine Laufzeitdaten, Anmeldungen, Schlüssel, privaten Projektnotizen oder Screenshots committen. Der enthaltene Git-Bundle exportiert ausschließlich den bereinigten Commit, keine zuvor lokal vorgemerkten privaten Dateien oder unerreichbaren Git-Objekte.

Vor dem Alpha-Build ein frisches `build`-Verzeichnis verwenden. Die Prüfung gegen die Dateiliste in `scripts/packaged-app-files.mjs` hält frühere Grafiken und lokale Arbeitsdateien aus der Anwendungsnutzlast heraus.

Gezielte Ordnerwahl- und Bildprüfungen: `node scripts/install-location-test.mjs`, `node scripts/custom-install-close-test.mjs`, `node scripts/cad-artwork-ui.mjs`. Sie verwenden ausschließlich synthetische Ordner und Profile. Die tatsächliche Installation in das Windows-Benutzerkonto ist ein gesonderter Schritt.
