import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const source = path.dirname(fileURLToPath(import.meta.url));
const [application, buildDir] = process.argv.slice(2);
function readManifest(file) {
  const rows = fs.readFileSync(path.join(source,file),'utf8').trim().split(/\r?\n/);
  return new Map(rows.map(row => {
    const [name, size, hash] = row.split('\t');
    if (!/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(name) || name.split('/').includes('..') || !/^[a-f0-9]{64}$/.test(hash)) throw Error('Invalid manifest record');
    return [name,{size:Number(size), hash}];
  }));
}
function digest(value) { return createHash('sha256').update(value).digest('hex'); }
function identifier(type, name) { return type + digest(name.toLowerCase()).slice(0,24); }
function guid(name) {
  if(name === 'install-product.txt') return '{A9E970CA-6C7E-44D7-A98E-075C4903CC27}';
  const h = digest('SarevocsCCUPlaner|file|' + name.toLowerCase());
  return `{${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}}`;
}
const manifest = readManifest('msi118.tsv'), legacy = readManifest('cab117.tsv');
const header = [
  '#pragma once',
  'struct KnownFile { const wchar_t* path; long long size; const char* sha; };',
];
for(const [id,entries] of [['cab117',legacy],['msi118',manifest]]) {
  header.push('constexpr KnownFile '+id+'[] = {');
  for(const [name,item] of entries) {
    header.push('    { L"'+name.replaceAll('/','\\\\')+'", '+item.size+'LL, "'+item.hash+'" },');
  }
  header.push('};');
}
fs.writeFileSync(path.join(buildDir,'FileManifest.h'),header.join('\n')+'\n');
const directories = new Map([['','CcuRoot']]);
const components = [], definitions = [], migration = [], relocation = [];
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
for(const [name, old] of legacy) {
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
  const row = `<RemoveFile Id="${identifier('R',name)}" Name="${path.posix.basename(name)}" Directory="${legacyDirectories.get(relative)}" On="install"/>`;
  if (manifest.get(name)?.hash === old.hash) relocation.push(row);
  else migration.push(row);
}
const ns='xmlns="http://schemas.microsoft.com/wix/2006/wi"';
fs.writeFileSync(path.join(buildDir,'Payload.wxs'), `<Wix ${ns}><Fragment>\n${definitions.join('\n')}\n<ComponentGroup Id="Payload">\n${components.map(id=>`<ComponentRef Id="${id}"/>`).join('\n')}\n</ComponentGroup>\n</Fragment></Wix>\n`);
fs.writeFileSync(path.join(buildDir,'Migration.wxi'), `<Include ${ns}>\n${migration.join('\n')}\n</Include>\n`);
fs.writeFileSync(path.join(buildDir,'Relocation.wxi'), `<Include ${ns}>\n${relocation.join('\n')}\n</Include>\n`);
console.log(`${manifest.size} verified payload files; ${migration.length} exact legacy rows and ${relocation.length} relocation rows`);
