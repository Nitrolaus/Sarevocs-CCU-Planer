import { _electron } from 'playwright-core';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url), root = process.cwd();
const folder = path.resolve('work/temp/key-directory', randomUUID()); fs.mkdirSync(folder, { recursive: true });
// Simulate an upgrade: key metadata already exists with the directory's old inherited rights.
fs.mkdirSync(path.join(folder, 'data/FluechtigeSitzungen'), { recursive: true });
fs.writeFileSync(path.join(folder, 'data/FluechtigeSitzungen/Local State'), '{}');
const env = { ...process.env, TEMP: path.resolve('work/temp/tooling'), TMP: path.resolve('work/temp/tooling') };
delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
let app;
try {
  app = await _electron.launch({ executablePath: require('electron'), args: ['.', '--data-dir=' + path.join(folder, 'data'), '--disable-gpu'], cwd: root, env, timeout: 30000 });
  const page = await app.firstWindow(); await page.getByRole('heading', { name: 'Bestand', exact: true }).waitFor();
  const result = await page.evaluate(async () => {
    const a = (await window.ccu.request({ action: 'account.create', name: 'SYNTHETIC ACL ONLY', mode: 'real' })).data;
    return window.ccu.request({ action: 'rsi.settings', accountId: a.id });
  });
  assert.equal(result.ok, true); assert.equal(result.data.available, true);
  const sessionData = await app.evaluate(({ app }) => app.getPath('sessionData'));
  assert.equal(sessionData, path.join(folder, 'data/FluechtigeSitzungen'));
  await app.close(); app = undefined;
  const literal = "'" + sessionData.replaceAll("'", "''") + "'";
  const script = `$ProgressPreference='SilentlyContinue'
$d=${literal}
$u=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$s='S-1-5-18'
function OnlyExpected($acl) {
 $r=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
 if($r.Count -ne 2){return $false}
 foreach($x in $r){if(($x.IdentityReference.Value -ne $u -and $x.IdentityReference.Value -ne $s) -or $x.AccessControlType -ne 'Allow' -or $x.FileSystemRights -ne 'FullControl'){return $false}}
 return $true
}
$a=[IO.Directory]::GetAccessControl($d)
$f=Join-Path $d 'Local State'
[pscustomobject]@{DirectoryProtected=$a.AreAccessRulesProtected;DirectoryOnlyUserSystem=(OnlyExpected $a);KeyFileExists=[IO.File]::Exists($f);KeyFileOnlyUserSystem=([IO.File]::Exists($f) -and (OnlyExpected ([IO.File]::GetAccessControl($f))))}|ConvertTo-Json -Compress`;
  const powershell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const actual = JSON.parse(execFileSync(powershell, ['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')], { env, windowsHide: true, encoding: 'utf8', timeout: 12000 }));
  assert.deepEqual(actual, { DirectoryProtected: true, DirectoryOnlyUserSystem: true, KeyFileExists: true, KeyFileOnlyUserSystem: true });
  fs.writeFileSync(path.join(folder, 'results.json'), JSON.stringify({ status: 'PASS', data: 'synthetic-only', actual }, null, 2));
  console.log('PASS: Tatsächlicher Schluesselordner und Local State nur fuer Benutzer/SYSTEM abgesichert.'); console.log('REPORT:', path.join(folder, 'results.json'));
} catch(error) {
  fs.writeFileSync(path.join(folder, 'results.json'), JSON.stringify({ status: 'FAIL', data: 'synthetic-only', error: error.message }, null, 2));
  console.error(error.message); console.log('REPORT:', path.join(folder, 'results.json')); process.exitCode = 1;
} finally { if (app) await app.close(); }
