import fs from'node:fs';import path from'node:path';import assert from'node:assert/strict';import{spawnSync}from'node:child_process';import{randomUUID}from'node:crypto';
const meta=JSON.parse(fs.readFileSync('work/temp/selectable-installer-artifacts.json','utf8'));assert.equal(meta.version,JSON.parse(fs.readFileSync('package.json','utf8')).version);
const actual=fs.readFileSync(path.join(meta.stage,'installer.nsi'));assert.equal(actual.subarray(0,3).toString('hex'),'efbbbf');assert.equal(meta.shortcutWriter,'native-only');
const source=actual.toString('utf8');assert.equal(/\bCreateShortcut\b/.test(source),false);assert.equal(/SarevocÂ/.test(source),false);
const routine=source.match(/Function ReportProgress\r?\n[\s\S]*?FunctionEnd/)?.[0];assert.ok(routine);
const area=path.resolve('work/temp/installer-progress-tests',randomUUID());fs.mkdirSync(area,{recursive:true});const probe=path.join(area,'probe.nsi'),env={...process.env,TEMP:path.join(area,'temp'),TMP:path.join(area,'temp')};fs.mkdirSync(env.TEMP);
fs.writeFileSync(probe,'\uFEFF'+`Unicode true
Name "CCU synthetic progress probe"
OutFile "${path.join(area,'probe.exe')}"
RequestExecutionLevel user
SilentInstall silent
Var ProgressFile
${routine}
Section
ReadEnvStr $ProgressFile "CCU_SETUP_PROGRESS"
Push 25
Call ReportProgress
Sleep 250
Push 75
Call ReportProgress
Sleep 250
Push 100
Call ReportProgress
FileOpen $2 "$EXEDIR\\Sarevoc´s probe.txt" w
FileWrite $2 "SYNTHETIC PASS"
FileClose $2
Sleep 250
SectionEnd
`);
const run=(exe,args)=>{const r=spawnSync(exe,args,{env,windowsHide:true,encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stdout+'\n'+r.stderr);return r.stdout;};run(meta.compiler,['/NOCONFIG','/V2',probe]);
const constants=path.join(area,'Constants.cs');fs.writeFileSync(constants,'public static class EmbeddedPayload{public const long TotalFileBytes=100;public const string ExpectedSha256="";public const string Version="TEST";}');
const driver=path.join(area,'driver.exe');run('C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe',['/nologo','/noconfig','/langversion:5','/target:exe','/platform:x64','/main:InstallerProgressTestDriver','/out:'+driver,...['SetupBootstrapper.cs','DisplaySetup.cs','InstallLocation.cs','SetupWindow.cs','InstallTransaction.cs','SelectableSetup.cs'].map(f=>path.resolve('installer',f)),path.resolve('tests/fixtures/InstallerProgressTestDriver.cs'),constants,...['System','System.Core','System.Management','System.Security','System.Windows.Forms','System.Drawing'].map(f=>'/reference:'+f+'.dll')]);
const result=run(driver,[area]);assert.match(result,/PASS/);fs.writeFileSync(path.join(area,'results.json'),result);console.log('REPORT: '+path.join(area,'results.json'));
