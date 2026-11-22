import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
const root = process.cwd(), args = process.argv.slice(2);
if (args.length !== 1 || !args[0].startsWith('--inner=') || !path.isAbsolute(args[0].slice(8))) throw new Error('Expected exactly --inner=<absolute-installer-payload>');
const innerSetup = path.resolve(args[0].slice(8));
const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
if (typeof version !== 'string' || !/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(version)) throw new Error('Invalid bootstrapper package version');
if (path.basename(innerSetup) !== `Sarevocs-CCU-Planer-Setup-${version}.exe`) throw new Error('Inner setup version does not match package');
const compiler = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
const folder = path.resolve('work/temp/bootstrapper-build', randomUUID()); fs.mkdirSync(folder, { recursive: true });
const payload = path.join(folder, 'original-installer-payload.exe');
fs.copyFileSync(innerSetup, payload, fs.constants.COPYFILE_EXCL);
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const innerSHA = sha(payload);
if (innerSHA !== sha(innerSetup)) throw new Error('Inner setup changed during copy');
const constants = path.join(folder, 'BuildPayload.cs');
const innerManifest = JSON.parse(fs.readFileSync(path.join(path.dirname(innerSetup), 'install-files.json'), 'utf8'));
const manifestFiles = innerManifest.files.concat(['SetupGuard.exe', 'install-product.txt', 'install-files.json'].map(file => {
  const fullPath = path.join(path.dirname(innerSetup), file);
  return { file, size: fs.statSync(fullPath).size, sha256: sha(fullPath) };
}));
const productFiles = path.join(folder, 'product-files.txt');
fs.writeFileSync(productFiles, manifestFiles.map(({ file, size, sha256 }) => `${file}\t${size}\t${sha256}`).join('\n'));
const totalFileBytes = innerManifest.files.reduce((total,entry)=>{if(!Number.isSafeInteger(entry.size)||entry.size<0)throw new Error('Invalid file size in installer manifest');return total+entry.size;},0);
fs.writeFileSync(constants, `using System.Reflection;\n[assembly: AssemblyVersion("${version}.0")]\n[assembly: AssemblyFileVersion("${version}.0")]\n[assembly: AssemblyTitle("Sarevoc´s CCU Planer Setup")]\n[assembly: AssemblyProduct("Sarevoc´s CCU Planer")]\n[assembly: System.Runtime.Versioning.TargetFramework(".NETFramework,Version=v4.8")]\npublic static class EmbeddedPayload { public const long TotalFileBytes = ${totalFileBytes}L; public const string ExpectedSha256 = "${innerSHA}"; public const string Version = "${version}"; }\n`);
const setup = path.join(folder, `Sarevocs-CCU-Planer-Setup-${version}.exe`);
const source = path.resolve('installer/SetupBootstrapper.cs'), manifest = path.resolve('installer/setup.manifest');
const compilerArgs = ['/nologo', '/noconfig', '/langversion:5', '/optimize+', '/target:winexe', '/platform:x64', '/main:SelectableSetup',
  '/out:' + setup, source, ...['DisplaySetup.cs', 'InstallLocation.cs', 'InstallTransaction.cs', 'SetupWindow.cs', 'SelectableSetup.cs'].map(file => path.resolve('installer', file)), constants, '/win32manifest:' + manifest, '/win32icon:' + path.resolve('assets/app.ico'),
  '/resource:' + payload + ',SarevocsCCUPlaner.InnerSetup', '/resource:' + productFiles + ',SarevocsCCUPlaner.PayloadManifest', '/reference:System.dll', '/reference:System.Core.dll',
  '/reference:System.Management.dll', '/reference:System.Security.dll', '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll'];
await new Promise((resolve, reject) => {
  const child = spawn(compiler, compilerArgs, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
  child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error('Bootstrapper compiler failed: ' + output.trim())));
});
if (innerSHA !== sha(payload) || innerSHA !== sha(innerSetup)) throw new Error('Inner setup changed during compilation');
const metadata = { setup, innerSetup, innerSHA, version, compiler, sourceSHA: sha(source), displaySourceSHA:sha(path.resolve('installer/DisplaySetup.cs')), locationSourceSHA:sha(path.resolve('installer/InstallLocation.cs')), windowSourceSHA:sha(path.resolve('installer/SetupWindow.cs')), selectableSourceSHA:sha(path.resolve('installer/SelectableSetup.cs')), transactionSourceSHA:sha(path.resolve('installer/InstallTransaction.cs')), manifestSHA: sha(manifest) };
fs.writeFileSync(path.resolve('work/temp/bootstrapper-artifacts.json'), JSON.stringify(metadata, null, 2));
console.log('BOOTSTRAPPER:', setup); console.log('INNER_SHA256:', innerSHA);
