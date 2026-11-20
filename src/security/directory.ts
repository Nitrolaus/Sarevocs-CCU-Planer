import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
export async function protectSessionDirectory(directory: string, protectKeyState = false): Promise<void> {
  if (process.platform !== 'win32' || !path.isAbsolute(directory)) throw new Error('Windows-Verzeichnisschutz nicht verfügbar.');
  fs.mkdirSync(directory, { recursive: true });
  if (fs.lstatSync(directory).isSymbolicLink()) throw new Error('Anmeldeordner darf keine Verknüpfung sein.');
  const literal = "'" + directory.replace(/'/g, "''") + "'";
  // Fixed script, one correctly quoted local path; no credentials, imported values or renderer scripts.
  const script = `$vaultDirectory = ${literal}
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if (([IO.File]::GetAttributes($vaultDirectory) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse point' }
$userSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$systemSid = New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
$acl = New-Object Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true, $false)
$inherit = [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
$propagate = [Security.AccessControl.PropagationFlags]::None
$allow = [Security.AccessControl.AccessControlType]::Allow
foreach ($sid in @($userSid, $systemSid)) {
  $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', $inherit, $propagate, $allow)
  $acl.AddAccessRule($rule)
}
[IO.Directory]::SetAccessControl($vaultDirectory, $acl)
$actual = [IO.Directory]::GetAccessControl($vaultDirectory)
if (!$actual.AreAccessRulesProtected) { throw 'Inheritance remains enabled' }
$rules = $actual.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])
if ($rules.Count -ne 2) { throw 'Unexpected principals' }
foreach ($rule in $rules) {
  if (($rule.IdentityReference.Value -ne $userSid.Value -and $rule.IdentityReference.Value -ne $systemSid.Value) -or $rule.IsInherited -or $rule.AccessControlType -ne $allow -or $rule.FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl) { throw 'Unexpected ACL' }
}
${protectKeyState ? `
$keyState = Join-Path $vaultDirectory 'Local State'
if ([IO.File]::Exists($keyState)) {
  if (([IO.File]::GetAttributes($keyState) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Key reparse point' }
  $fileAcl = New-Object Security.AccessControl.FileSecurity
  $fileAcl.SetAccessRuleProtection($true, $false)
  foreach ($sid in @($userSid, $systemSid)) {
    $fileAcl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', $allow)))
  }
  [IO.File]::SetAccessControl($keyState, $fileAcl)
  $actualFile = [IO.File]::GetAccessControl($keyState)
  $fileRules = $actualFile.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])
  if (!$actualFile.AreAccessRulesProtected -or $fileRules.Count -ne 2) { throw 'Unexpected key ACL' }
  foreach ($rule in $fileRules) {
    if (($rule.IdentityReference.Value -ne $userSid.Value -and $rule.IdentityReference.Value -ne $systemSid.Value) -or $rule.IsInherited -or $rule.AccessControlType -ne $allow -or $rule.FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl) { throw 'Unexpected key principal' }
  }
}` : ''}
`;
  const powershell = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  await execute(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { windowsHide: true, timeout: 12000, maxBuffer: 16384 });
}
