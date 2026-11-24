import fs from 'node:fs';
import path from 'node:path';
const own = JSON.parse(fs.readFileSync('package.json', 'utf8'));
// Follow production dependencies only, including nested versions, so ExcelJS's ZIP/XML
// dependencies retain their own license texts in the distributed application.
const runtime=[],visited=new Set();
function collect(name,parent=process.cwd()){
  let cursor=parent,folder;
  while(true){const candidate=path.join(cursor,'node_modules',name);if(fs.existsSync(path.join(candidate,'package.json'))){folder=candidate;break;}const next=path.dirname(cursor);if(next===cursor)throw Error('Runtime dependency missing: '+name);cursor=next;}
  folder=fs.realpathSync(folder);if(visited.has(folder))return;visited.add(folder);
  const pkg=JSON.parse(fs.readFileSync(path.join(folder,'package.json'),'utf8'));runtime.push({folder,pkg});
  for(const child of Object.keys(pkg.dependencies??{}))collect(child,folder);
}
for(const name of Object.keys(own.dependencies))collect(name);
let output = `# Fremdkomponenten – Sarevoc´s CCU Planer ${own.version}\n\n`;
output += '## Installationssystem – NSIS\n\nOrdnerwahl-Installer: NSIS 3.12, https://nsis.sourceforge.io/ . Lizenzhinweise des unveränderten Installationssystems:\n\n' + fs.readFileSync('installer/NSIS-LICENSE.txt','utf8') + '\n\n';
output += 'Eigene Implementierung von Sarevoc. Der Produktname Sarevoc´s CCU Planer und der Urhebervermerk bleiben erhalten. Für den eigenen Quellcode wurde noch keine öffentliche Lizenz erteilt.\n\n';
output += '## Ko-fi-Grafik\n\n`assets/kofi-logo.png` stammt aus dem [Ko-fi Creator Kit](https://more.ko-fi.com/brand-assets) und dient zur Verlinkung der öffentlichen Ko-fi-Seite. Die Rechte an der Marke und der Grafik bleiben bei Ko-fi.\n\n';
output += '## Menüsymbole – Lucide 0.468.0\n\n' + fs.readFileSync('assets/licenses/lucide-menu.txt','utf8').trim() + '\n\n';
output += '## Öffentliche Angebotsbeobachtungen – Open Hangar\n\nQuelle: Open Hangar, https://app.openhangar.space/data. Die Anwendung verwendet den öffentlichen Storefeed https://app.openhangar.space/api/store/catalog und den Messekalender https://app.openhangar.space/api/hangar/calendar. Die Datensammlung und aufgezeichnete Verkaufshistorie werden vom Anbieter unter CC BY 4.0 angeboten: https://creativecommons.org/licenses/by/4.0/.\n\nDie Anwendung wählt Felder aus, normalisiert Preise in USD-Cent und Zeitstempel und vergleicht Beobachtungen. Die Beobachtungen und berechneten Änderungen sind kein offizielles Angebot für ein RSI-Konto. Ein Ausgangsschiff und konkrete CCU-Zahlbeträge werden daraus nicht behauptet. Daten werden erst zur Laufzeit abgerufen; keine fremde Datenbank oder Abbildung ist im Installer enthalten. CIG-/RSI-Bildrechte und weitere Rechte Dritter werden durch diese Datenlizenz nicht erteilt.\n\n';
output += '## Schiffsdarstellungen\n\nZielkarten und Flottenplan verwenden neutrale, lokal dargestellte Schiffssilhouetten. Die Namen der Schiffsmodelle sind den jeweiligen Rechteinhabern zugeordnet. Ein Klick auf eine Zielkarte mit belegtem Shop-Link öffnet die offizielle Schiffseite im Standardbrowser.\n\n';
output += `## Laufzeit\n\nElectron ${own.devDependencies.electron}: MIT; Chromium und weitere gebündelte Komponenten: siehe die unveränderten Dateien LICENSE und LICENSES.chromium.html neben der EXE. SQLite ist Public Domain, sql.js steht unter MIT.\n\n`;
output += '## RSI-Loaner und enthaltene Fahrzeuge\n\nZuordnungen werden zur Laufzeit aus den öffentlichen RSI-Wissensartikeln Loaner Ship Matrix (https://support.robertsspaceindustries.com/hc/en-us/articles/360003093114-Loaner-Ship-Matrix) und Included Vessels (https://support.robertsspaceindustries.com/hc/en-us/articles/4408770370455-Included-Vessels-Snub-Fighters-and-Rovers) abgeleitet. Die Anzeige nennt den Stand der Quelle. Keine vollständigen Artikel, Tabellenbestände oder Originalbilder sind im Installer enthalten. Die Zuordnung bestätigt keine individuelle Freischaltung im Spiel. Die genannten Schiffs- und Produktnamen sowie die Rechte an den RSI-Quellen verbleiben bei ihren jeweiligen Rechteinhabern.\n\n';
output += '## Orbitron – Schriftzug\n\nUnveränderte Orbitron-Schrift, SIL Open Font License 1.1. Kursive Darstellung ausschließlich per CSS. Quelle: https://github.com/google/fonts/tree/main/ofl/orbitron\n\n' + fs.readFileSync('assets/fonts/OFL.txt','utf8').split('\n').map(line=>line.trimEnd()).join('\n') + '\n\n';
const missingLicenses=[];
for (const {folder,pkg} of runtime) {
  const licenses=fs.readdirSync(folder,{withFileTypes:true}).filter(e=>e.isFile()&&/^(?:licen[cs]e(?:[-._].*)?|copying(?:\..*)?|notice(?:\..*)?)$/i.test(e.name)).map(e=>e.name);
  const readme=fs.readdirSync(folder).find(f=>/^readme(?:\.(?:md|markdown))?$/i.test(f));
  let embedded=readme?fs.readFileSync(path.join(folder,readme),'utf8').match(/^#+ (?:License|Licence)\s*\n([\s\S]*?)(?=^#+ |$(?![\s\S]))/im)?.[1]?.trim():null;
  if(pkg.name==='saxes'&&pkg.version==='5.0.1')embedded=fs.readFileSync('assets/licenses/saxes-5.0.1-LICENSE.txt','utf8').trim();
  const supplied=path.join('assets/licenses',pkg.name.replaceAll('/','-')+'-'+pkg.version+'-LICENSE.txt');if(fs.existsSync(supplied))embedded=fs.readFileSync(supplied,'utf8').trim();
  if(['binary@0.3.0','chainsaw@0.1.0','buffers@0.1.1'].includes(pkg.name+'@'+pkg.version)){
    const declaration=fs.readFileSync(path.join(folder,readme),'utf8').match(/(?:^|\n)(?:#+\s*)?license\s*\n(?:=+\s*\n)?([\s\S]*)$/i)?.[1]?.trim()??pkg.license??(pkg.name==='buffers'?'MIT/X11 (upstream license commit 1b745ee35d33eb166e15ef1866073a07c6d7de87; https://sources.debian.org/copyright/license/node-buffers/0.1.1-2/)':null);
    if(!declaration||!/^MIT(?:\/X11)?\b/.test(declaration))throw Error('Upstream MIT declaration changed: '+pkg.name);
    const mit=fs.readFileSync('node_modules/exceljs/LICENSE','utf8');const permission=mit.slice(mit.indexOf('Permission is hereby granted'));
    if(!permission.startsWith('Permission is hereby granted'))throw Error('MIT text missing');
    embedded=`Upstream: ${pkg.repository?.url??pkg.repository}\nAuthor attribution from package.json: ${typeof pkg.author==='object'?pkg.author.name:pkg.author}\nLicense declaration (package / README / archived upstream): ${declaration}\n\nMIT/X11 permission text:\n${permission}`;
  }
  if (!licenses.length&&!embedded){missingLicenses.push(pkg.name+' '+pkg.version);continue;}
  output += `## ${pkg.name} ${pkg.version} (${pkg.license??(pkg.name==='buffers'?'MIT/X11, upstream declaration':JSON.stringify(pkg.licenses))})\n\n` + (licenses.length?licenses.map(file=>fs.readFileSync(path.join(folder,file),'utf8').trim()).join('\n\n'):embedded) + '\n\n';
}
output += '## Entwicklung, nicht in der Anwendung gebündelt\n\nElectron Forge 8.0.1 und esbuild 0.28.2: MIT. TypeScript 7.0.2, Playwright Core 1.65.1: Apache-2.0. tsx 4.23.15: MIT. @electron/fuses 2.1.3: MIT. Typdefinitionen: MIT. Vollständige Auflösung einschließlich transitiver Buildwerkzeuge in package-lock.json. Keine separaten Browserdownloads oder globale Installation.\n';
output += '\n## Windows-Installer\n\nSquirrel.Windows: Copyright (c) 2012 GitHub, Inc., MIT. Der MIT-Erlaubnistext und Haftungsausschluss oben gelten entsprechend auch fuer diese Komponente. Quelle: https://github.com/Squirrel/Squirrel.Windows/blob/develop/COPYING . electron-winstaller 5.4.4 und Forge Maker Squirrel 8.0.1: MIT. 7-Zip ist nur projektlokales Build-/Pruefwerkzeug (LGPL-2.1-or-later mit unRAR-Einschraenkung), nicht separat an Endnutzer ausgeliefert. Kein Update-Dienst oder externer Update-Server eingerichtet.\n';
if(missingLicenses.length)throw Error('Lizenztexte fehlen: '+missingLicenses.join(', '));
fs.writeFileSync('THIRD_PARTY_NOTICES.md', output);
console.log('Laufzeit-Lizenztexte dokumentiert.');
