import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const source = path.dirname(fileURLToPath(import.meta.url));
const [application, buildDir] = process.argv.slice(2);
function readManifest(file, expectedDigest) {
  const bytes = fs.readFileSync(path.join(source,file));
  if (expectedDigest && digest(bytes) !== expectedDigest) throw Error('Manifest pin mismatch: ' + file);
  const rows = bytes.toString('utf8').trim().split(/\r?\n/);
  const entries = new Map(), names = new Set();
  for (const row of rows) {
    const [name, size, hash] = row.split('\t');
    if (!/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(name) ||
        name.split('/').some(segment => segment === '.' || segment === '..') ||
        !/^\d+$/.test(size) || !Number.isSafeInteger(Number(size)) ||
        !/^[a-f0-9]{64}$/.test(hash) || names.has(name.toLowerCase())) throw Error('Invalid manifest record: ' + file);
    names.add(name.toLowerCase());
    entries.set(name,{size:Number(size), hash});
  }
  return entries;
}
function digest(value) { return createHash('sha256').update(value).digest('hex'); }
function identifier(type, name) { return type + digest(name.toLowerCase()).slice(0,24); }
function guid(name) {
  if(name === 'install-product.txt') return '{1BC71A73-24CC-4AC1-BFE9-CCB7B4F36C63}';
  const h = digest('SarevocsCCUPlanerMSI|file|' + name.toLowerCase());
  return `{${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}}`;
}
const manifest = readManifest('msi125.tsv');
const previous = readManifest('msi124.tsv','b1ee0adc29ef1e3d8caa8a50045e70517d002f88bbecc7fb273b0c962808094f');
if (manifest.size !== previous.size || [...previous.keys()].some(name => !manifest.has(name))) {
  throw Error('The in-place MSI update must keep the existing file components.');
}
const pins = JSON.parse(fs.readFileSync(path.join(source, 'cab-manifests.json'), 'utf8'));
const legacy = new Map(Object.entries(pins).map(([build, expectedDigest]) => {
  if (!/^[1-9]\d{1,2}$/.test(build) || !/^[a-f0-9]{64}$/.test(expectedDigest)) throw Error('Invalid legacy manifest pin');
  return [build, readManifest(`cab${build}.tsv`, expectedDigest)];
}));
const header = [
  '#pragma once',
  'struct KnownFile { const wchar_t* path; long long size; const char* sha; };',
  'struct KnownCabBuild { const wchar_t* version; std::span<const KnownFile> files; };',
];
for(const [id,entries] of [['msi125',manifest], ['msi124',previous],
  ['msi123',readManifest('msi123.tsv','9740a11756d36605fc48f100bcbe312f4cb5e2a44b73e8151cff71d7ab65d977')],
  ['msi122',readManifest('msi122.tsv','a7b8799abb9b488b70a5632c48623e043765453e0a8000a4850050af8e3a1031')],
  ['msi121',readManifest('msi121.tsv','b69d8831b06345be07b5ff1e83b6e04fefe5c2c577211e2b118eb53b941111ca')],
  ['msi118',readManifest('msi118.tsv','d2f936592648bde945d10051e75e0cfb49ae234c5c1c51b22339cfda23c4716d')],
  ['msi119',readManifest('msi119.tsv','b82f41034b0d1f12bdcb4c5b8f480396b86e3c60c4695d4755d42b483b1ad126')],
  ['msi120',readManifest('msi120.tsv','2e873e14f8daf1eee209e7f1f10a9255da55cec4e8522f4b838bdecd11e213fd')],
  ...Array.from(legacy, ([build,files]) => [`cab${build}`,files])]) {
  header.push('constexpr KnownFile '+id+'[] = {');
  for(const [name,item] of entries) {
    header.push('    { L"'+name.replaceAll('/','\\\\')+'", '+item.size+'LL, "'+item.hash+'" },');
  }
  header.push('};');
}
header.push('constexpr KnownCabBuild knownCabBuilds[] = {');
for (const build of legacy.keys()) header.push(`    { L"0.3.${build}", cab${build} },`);
header.push('};');
fs.writeFileSync(path.join(buildDir,'FileManifest.h'),header.join('\n')+'\n');
const directories = new Map([['','CcuRoot']]);
const components = [], definitions = [], legacyComponents = [];
for (const [name, file] of manifest) {
  const marker = name === 'install-product.txt';
  const diskFile = path.join(marker ? source : application,name);
  if(fs.statSync(diskFile).size !== file.size || digest(fs.readFileSync(diskFile)) !== file.hash) throw Error('Build payload mismatch: ' + name);
  const parts = name.split('/');
  let parent = '';
  for(const segment of parts.slice(0,-1)) {
    const child = parent ? parent + '/' + segment : segment;
    if(!directories.has(child)) {
      const id = identifier('D',child);
      definitions.push(`<DirectoryRef Id="${directories.get(parent)}"><Directory Id="${id}" Name="${segment}"/></DirectoryRef>`);
      directories.set(child,id);
    }
    parent = child;
  }
  const component = identifier('C',name);
  components.push(component);
  const wixSource = (marker ? '$(var.MsiSources)' : '$(var.AppDir)') + '\\' + name.replaceAll('/','\\');
  definitions.push(`<DirectoryRef Id="${directories.get(parent)}"><Component Id="${component}" Guid="${guid(name)}" Win64="yes"><File Id="${identifier('F',name)}" Source="${wixSource}" KeyPath="yes"/></Component></DirectoryRef>`);
}
const legacyDirectories = new Map([['', 'CcuLegacyRoot']]);
function removalDirectory(name) {
  const parent=path.posix.dirname(name);
  let relative = '';
  for (const segment of parent === '.' ? [] : parent.split('/')) {
    const child = relative ? relative + '/' + segment : segment;
    if (!legacyDirectories.has(child)) {
      const id = identifier('OldD', child);
      definitions.push(`<DirectoryRef Id="${legacyDirectories.get(relative)}"><Directory Id="${id}" Name="${segment}"/></DirectoryRef>`);
      legacyDirectories.set(child, id);
    }
    relative = child;
  }
  return legacyDirectories.get(relative);
}
for(const [build, files] of legacy) {
  const migration = [], relocation = [];
  for(const [name, oldFile] of files) {
    const row = `<RemoveFile Id="${identifier('R',`${build}:${name}`)}" Name="${path.posix.basename(name)}" Directory="${removalDirectory(name)}" On="install"/>`;
    const unchanged = manifest.get(name)?.hash === oldFile.hash;
    if (unchanged !== (previous.get(name)?.hash === oldFile.hash)) {
      throw Error('The in-place MSI update must keep existing migration components: ' + name);
    }
    (unchanged ? relocation : migration).push(row);
  }
  for (const [phase, rows, onlyOnMove] of [['Migration',migration,false],['Relocation',relocation,true]]) {
    if (!rows.length) continue;
    const id = `Cab${build}${phase}Files`;
    const when = `CcuLegacyVersion = "0.3.${build}" AND NOT CcuLegacyKeepFiles` + (onlyOnMove ? ' AND CcuLegacyMoved = "1"' : '');
    definitions.push(`<DirectoryRef Id="CcuRoot"><Component Id="${id}" Guid="${guid(id)}" Win64="yes"><Condition>${when}</Condition><RegistryValue Root="HKCU" Key="Software\\Sarevoc\\SarevocsCCUPlanerMSI" Name="${id}" Type="integer" Value="1" KeyPath="yes"/>\n${rows.join('\n')}\n</Component></DirectoryRef>`);
    legacyComponents.push(id);
  }
}
const ns='xmlns="http://schemas.microsoft.com/wix/2006/wi"';
const reference = ids => ids.map(id => `<ComponentRef Id="${id}"/>`).join('\n');
fs.writeFileSync(path.join(buildDir,'Payload.wxs'), `<Wix ${ns}><Fragment>\n${definitions.join('\n')}\n<ComponentGroup Id="Payload">\n${reference(components)}\n</ComponentGroup>\n<ComponentGroup Id="LegacyFiles">\n${reference(legacyComponents)}\n</ComponentGroup>\n</Fragment></Wix>\n`);
console.log(`${manifest.size} verified payload files; verified legacy manifests for ${[...legacy.keys()].map(build => '0.3.' + build).join(', ')}`);
