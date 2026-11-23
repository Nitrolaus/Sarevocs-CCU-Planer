import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
const root = process.cwd(), args = process.argv.slice(2);
const match = args.length === 1 && /^--(inner|cab)=(.+)$/.exec(args[0]);
if (!match || !path.isAbsolute(match[2])) throw new Error('Expected an absolute installer payload with --inner= or --cab=');
const cab = match[1] === 'cab';
const innerSetup = path.resolve(match[2]);
const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
if (typeof version !== 'string' || !/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(version)) throw new Error('Invalid bootstrapper package version');
if (path.basename(innerSetup) !== (cab ? 'program-files.cab' : `Sarevocs-CCU-Planer-Setup-${version}.exe`)) throw new Error('Unexpected installer payload name');
const compiler = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
const folder = path.resolve('work/temp/bootstrapper-build', randomUUID()); fs.mkdirSync(folder, { recursive: true });
const payload = path.join(folder, cab ? 'program-files.cab' : 'original-installer-payload.exe');
fs.copyFileSync(innerSetup, payload, fs.constants.COPYFILE_EXCL);
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const innerSHA = sha(payload);
if (innerSHA !== sha(innerSetup)) throw new Error('Inner setup changed during copy');
const constants = path.join(folder, 'BuildPayload.cs');
const innerManifest = JSON.parse(fs.readFileSync(path.join(path.dirname(innerSetup), 'install-files.json'), 'utf8'));
const setupFiles = ['SetupGuard.exe', 'install-product.txt', 'install-files.json'];
if (cab) setupFiles.push('Uninstall.exe');
const manifestFiles = innerManifest.files.concat(setupFiles.map(file => {
  const fullPath = path.join(path.dirname(innerSetup), file);
  return { file, size: fs.statSync(fullPath).size, sha256: sha(fullPath) };
}));
const productFiles = path.join(folder, 'product-files.txt');
fs.writeFileSync(productFiles, manifestFiles.map(({ file, size, sha256 }) => `${file}\t${size}\t${sha256}`).join('\n'));
const totalFileBytes = innerManifest.files.reduce((total,entry)=>{if(!Number.isSafeInteger(entry.size)||entry.size<0)throw new Error('Invalid file size in installer manifest');return total+entry.size;},0);
fs.writeFileSync(constants, `using System.Reflection;\n[assembly: AssemblyVersion("${version}.0")]\n[assembly: AssemblyFileVersion("${version}.0")]\n[assembly: AssemblyTitle("Sarevoc´s CCU Planer Setup")]\n[assembly: AssemblyProduct("Sarevoc´s CCU Planer")]\n[assembly: System.Runtime.Versioning.TargetFramework(".NETFramework,Version=v4.8")]\npublic static class EmbeddedPayload { public const long TotalFileBytes = ${totalFileBytes}L; public const string ExpectedSha256 = "${innerSHA}"; public const string Version = "${version}"; }\n`);
const setup = path.join(folder, `Sarevocs-CCU-Planer-Setup-${version}${cab ? '-CAB-Test' : ''}.exe`);
const manifest = path.resolve('installer/setup.manifest');
const sourceEntries = [
  ['installer/SetupBootstrapper.cs', 'sourceSHA'],
  ['installer/DisplaySetup.cs', 'displaySourceSHA'],
  ['installer/InstallLocation.cs', 'locationSourceSHA'],
  ['installer/InstallTransaction.cs', 'transactionSourceSHA'],
  ['installer/SetupWindow.cs', 'windowSourceSHA'],
  ['installer/SelectableSetup.cs', 'selectableSourceSHA'],
  [constants],
];
if (cab) sourceEntries.push(['installer/CabinetPayload.cs']);
const sources = sourceEntries.map(([file, hashField]) => {
  const fullPath = path.resolve(root, file);
  return { fullPath, file: path.relative(root, fullPath).split(path.sep).join('/'), sha256: sha(fullPath), hashField };
});
const compilerArgs = ['/nologo', '/noconfig', '/langversion:5', '/optimize+', '/target:winexe', '/platform:x64', '/main:SelectableSetup',
  '/out:' + setup, ...sources.map(source => source.fullPath), '/win32manifest:' + manifest, '/win32icon:' + path.resolve('assets/app.ico'),
  '/resource:' + payload + (cab ? ',SarevocsCCUPlaner.Cabinet' : ',SarevocsCCUPlaner.InnerSetup'), '/resource:' + productFiles + ',SarevocsCCUPlaner.PayloadManifest', '/reference:System.dll', '/reference:System.Core.dll',
  '/reference:System.Security.dll', '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll'];
if (cab) compilerArgs.push('/define:CAB_PAYLOAD');
else compilerArgs.push('/reference:System.Management.dll');
await new Promise((resolve, reject) => {
  const child = spawn(compiler, compilerArgs, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
  child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error('Bootstrapper compiler failed: ' + output.trim())));
});
if (innerSHA !== sha(payload) || innerSHA !== sha(innerSetup)) throw new Error('Inner setup changed during compilation');
const sourceFiles = sources.map(({ fullPath, file, sha256 }) => {
  if (sha(fullPath) !== sha256) throw new Error('Installer source changed during compilation: ' + file);
  return { file, sha256 };
});
const metadata = { setup, setupSHA: sha(setup), kind: cab ? 'cab' : 'nsis', innerSetup, innerSHA, version, compiler, sourceFiles, manifestSHA: sha(manifest) };
for (const { hashField, sha256 } of sources) {
  if (hashField) metadata[hashField] = sha256;
}
fs.writeFileSync(path.resolve(cab ? 'work/temp/cab-bootstrapper-artifacts.json' : 'work/temp/bootstrapper-artifacts.json'), JSON.stringify(metadata, null, 2));
console.log('BOOTSTRAPPER:', setup); console.log('INNER_SHA256:', innerSHA);
