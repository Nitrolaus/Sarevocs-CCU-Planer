# Ergänzende Laufzeit-Lizenzquellen

`scripts/notices.mjs` verfolgt produktive Abhängigkeiten einschließlich verschachtelter Versionen. Vorhandene LICENSE-/NOTICE-Dateien und in README eingebettete Lizenztexte bleiben in THIRD_PARTY_NOTICES.md erhalten.

- saxes 5.0.1: Das npm-Paket lässt die eigene LICENSE-Datei weg. saxes-5.0.1-LICENSE.txt stammt unverändert aus https://raw.githubusercontent.com/lddubeau/saxes/v5.0.1/LICENSE . ISC, mit dortigen historischen Hinweisen.
- binary 0.3.0: MIT-Erklärung in README.markdown; Urheberangabe aus package.json.
- chainsaw 0.1.0: MIT/X11-Erklärung und Urheberangabe in package.json.
- buffers 0.1.1: Historischem npm-Tarball fehlt das Lizenzfeld. Nachgetragene MIT/X11-Upstream-Erklärung: Commit 1b745ee35d33eb166e15ef1866073a07c6d7de87. Archivierter Quellpaketnachweis: https://sources.debian.org/copyright/license/node-buffers/0.1.1-2/ . Upstream-Fassung mit Lizenzfeld: https://github.com/bitpay/node-buffers/blob/master/package.json . Der Generator nennt diese ergänzende Herkunft ausdrücklich und übernimmt die Urheberangabe aus dem Paket, statt dort eine LICENSE-Datei zu behaupten.

Bei den drei alten MIT/X11-Abhängigkeiten ergänzt der Generator den vollständigen MIT-Erlaubnistext samt separat genannter Originalurheberschaft. Entwicklerpakete werden nicht allein wegen ihrer Installation als Programmlaufzeit ausgewiesen.
