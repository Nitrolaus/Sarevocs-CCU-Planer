import fs from 'node:fs';import path from 'node:path';import{api}from'@electron-forge/core';import{spawnSync}from'node:child_process';import{createHash,randomUUID}from'node:crypto';
const version=JSON.parse(fs.readFileSync('package.json','utf8')).version;
const args=process.argv.slice(2);
const cabTest=args.length===1&&args[0]==='--cab-test';
if(args.length&&!cabTest)throw Error('Expected no arguments or --cab-test');
const compiler=process.env.CCU_NSIS_COMPILER||'C:/Codex/tools/NSIS-3.12-CCU/nsis-3.12/Bin/makensis.exe';
if(!fs.existsSync(compiler))throw Error('Portable NSIS compiler required: set CCU_NSIS_COMPILER');
const stage=path.resolve('work/temp/selectable-installer',randomUUID());fs.mkdirSync(stage,{recursive:true});
const env={...process.env,TEMP:path.resolve('work/temp/tooling'),TMP:path.resolve('work/temp/tooling')};fs.mkdirSync(env.TEMP,{recursive:true});
const run=(exe,args,cwd=process.cwd())=>{const r=spawnSync(exe,args,{cwd,env,windowsHide:true,encoding:'utf8',maxBuffer:8*1024*1024});if(r.status!==0)throw Error('Build tool failed: '+r.stdout+'\n'+r.stderr);return r.stdout;};
const sha=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const paths=await api.package({dir:process.cwd(),platform:'win32',arch:'x64',outDir:path.resolve('work/temp/installer-build'),interactive:false});const application=paths[0]?.packagedPath;if(typeof application!=='string')throw Error('Unexpected Forge package result: '+JSON.stringify(paths));
const constants=path.join(stage,'BuildPayload.cs');fs.writeFileSync(constants,`public static class EmbeddedPayload { public const string ExpectedSha256=""; public const string Version="${version}"; }`);
const guard=path.join(stage,'SetupGuard.exe');const csc='C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe';
const guardReferences = ['System','System.Core','System.Security','System.Windows.Forms','System.Drawing'];
if(!cabTest) guardReferences.push('System.Management');
run(csc,['/nologo','/noconfig','/langversion:5','/target:winexe','/platform:x64','/main:UninstallGuard','/out:'+guard,
  ...(cabTest?['/define:CAB_PAYLOAD']:[]),
  ...['SetupBootstrapper.cs','DisplaySetup.cs','InstallLocation.cs','SetupWindow.cs','UninstallGuard.cs'].map(f=>path.resolve('installer',f)),
  constants,'/win32manifest:'+path.resolve('installer/setup.manifest'),...guardReferences.map(r=>'/reference:'+r+'.dll')]);
const all=(dir,base='')=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?all(path.join(dir,e.name),base+e.name+'/'):[base+e.name]);
const files=all(application).sort();if(!files.includes('resources/app.asar'))throw Error('Packaged application missing');
const marker=path.join(stage,'install-product.txt');fs.writeFileSync(marker,'SarevocsCCUPlaner/1\r\n');
const fileManifest=path.join(stage,'install-files.json');fs.writeFileSync(fileManifest,JSON.stringify({product:'SarevocsCCUPlaner',version,files:files.map(file=>({file,sha256:sha(path.join(application,file)),size:fs.statSync(path.join(application,file)).size}))},null,2));
const esc=v=>v.replaceAll('$','$$').replaceAll('"','$\\"').replaceAll('/','\\');
const inner=path.join(stage,cabTest?'uninstaller-build-only.exe':`Sarevocs-CCU-Planer-Setup-${version}.exe`);
const uninstaller=path.join(stage,'Uninstall.exe');
const nsi=path.join(stage,'installer.nsi');
let completedBytes=0;
const totalFileBytes=files.reduce((total,file)=>total+fs.statSync(path.join(application,file)).size,0);
const copy=files.map(file=>{completedBytes+=fs.statSync(path.join(application,file)).size;return `SetOutPath "$INSTDIR${path.posix.dirname(file)==='.'?'':'\\'+esc(path.posix.dirname(file))}"
File "/oname=${esc(path.posix.basename(file))}" "${esc(path.join(application,file))}"
IfErrors installFailed
Push "${completedBytes}"
Call ReportProgress`;}).join('\n');
const uninstallFiles=[...files,'SetupGuard.exe','install-files.json','install-product.txt','Uninstall.exe'];
const dirs=[...new Set(files.map(f=>path.posix.dirname(f)).filter(f=>f!=='.').flatMap(f=>{let a=[];while(f!=='.'){a.push(f);f=path.posix.dirname(f);}return a;}))].sort((a,b)=>b.length-a.length);
// NSIS macro names deliberately survive JavaScript interpolation.
const If='${If}',EndIf='${EndIf}',IfNot='${IfNot}',GetParameters='${GetParameters}',GetOptions='${GetOptions}',Errors='${Errors}';
fs.writeFileSync(nsi,'\uFEFF'+`Unicode true
!include "LogicLib.nsh"
!include "FileFunc.nsh"
Name "Sarevoc´s CCU Planer"
OutFile "${esc(inner)}"
RequestExecutionLevel user
SilentInstall silent
SilentUnInstall normal
SetCompressor /SOLID lzma
CRCCheck force
Icon "${esc(path.resolve('assets/app.ico'))}"
UninstallIcon "${esc(path.resolve('assets/app.ico'))}"
VIProductVersion "${version}.0"
VIAddVersionKey /LANG=1031 "ProductName" "Sarevoc´s CCU Planer"
VIAddVersionKey /LANG=1031 "FileVersion" "${version}"
InstallDir "$LOCALAPPDATA\\Programs\\Sarevocs-CCU-Planer"
Var GuardStatus
Var ProgressFile
UninstPage uninstConfirm
UninstPage instfiles
${cabTest?`# The compiler exports the real uninstall program. This build-only executable is never run.
Section
  WriteUninstaller "$INSTDIR\\Uninstall.exe"
SectionEnd
!uninstfinalize 'copy /B "%1" "${esc(uninstaller)}"' = 0
`:`Function .onInit
  ReadEnvStr $ProgressFile "CCU_SETUP_PROGRESS"
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File /oname=SetupGuard.exe "${esc(guard)}"
  ExecWait '"$PLUGINSDIR\\SetupGuard.exe" --validate-stage "$INSTDIR"' $0
  ${If} $0 != 0
    SetErrorLevel 2
    Quit
  ${EndIf}
FunctionEnd
Function ReportProgress
  Exch $0
  Push $1
  StrCmp $ProgressFile "" progressDone
  ClearErrors
  FileOpen $1 "$ProgressFile" w
  IfErrors progressDone
  FileWrite $1 "$0"
  FileClose $1
 progressDone:
  ClearErrors
  Pop $1
  Pop $0
FunctionEnd
Section "Programm"
  SetShellVarContext current
  ClearErrors
  SetOutPath "$INSTDIR"
  File "${esc(guard)}"
  File "${esc(marker)}"
  File "${esc(fileManifest)}"
  WriteUninstaller "$INSTDIR\\Uninstall.exe"
  IfErrors installFailed
  ${copy}
  SetErrorLevel 0
  Goto done
 installFailed:
  SetErrorLevel 3
  Quit
 done:
SectionEnd
`}
Function un.PrepareUninstall
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File /oname=SetupGuard.exe "${esc(guard)}"
  System::Call 'kernel32::GetCurrentProcessId()i.r0'
  Exec '"$PLUGINSDIR\\SetupGuard.exe" --guard "$INSTDIR" $0 "$PLUGINSDIR\\guard-status.txt"'
  StrCpy $1 0
 loop:
  IfFileExists "$PLUGINSDIR\\guard-status.txt" ready
  Sleep 50
  IntOp $1 $1 + 1
  IntCmp $1 1200 failed loop failed
 ready:
  FileOpen $0 "$PLUGINSDIR\\guard-status.txt" r
  FileRead $0 $GuardStatus
  FileClose $0
  StrCmp $GuardStatus "READY" okay failed
 failed:
  MessageBox MB_OK|MB_ICONSTOP "Der Planer konnte nicht geordnet beendet werden. Bitte über Beenden schließen."
  Abort
 okay:
FunctionEnd
Section "Uninstall"
  SetShellVarContext current
  Call un.PrepareUninstall
  ReadRegStr $0 HKCU "Software\\Sarevoc\\SarevocsCCUPlaner" "InstallLocation"
  ${If} $0 == $INSTDIR
    ExecWait '"$PLUGINSDIR\\SetupGuard.exe" --remove-shortcuts "$INSTDIR"' $0
    ${If} $0 != 0
      SetErrorLevel 2
      Abort
    ${EndIf}
    RMDir "$SMPROGRAMS\\Sarevoc"
    DeleteRegKey HKCU "Software\\Sarevoc\\SarevocsCCUPlaner"
    DeleteRegKey HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\SarevocsCCUPlaner.Selectable"
  ${EndIf}
  ${uninstallFiles.map(f=>`Delete "$INSTDIR\\${esc(f)}"`).join('\n  ')}
  ${dirs.map(d=>`RMDir "$INSTDIR\\${esc(d)}"`).join('\n  ')}
  RMDir "$INSTDIR"
SectionEnd
`,'utf8');
run(compiler,['/NOCONFIG','/V2',nsi]);
let payload=inner;
if(cabTest){
  if(!fs.existsSync(uninstaller))throw Error('NSIS did not export the build-time uninstaller');
  const sources=files.map(file=>[path.join(application,file),file]);
  sources.push(...['SetupGuard.exe','install-files.json','install-product.txt','Uninstall.exe'].map(file=>[path.join(stage,file),file]));
  if(sources.some(([source,file])=>/["\r\n]/.test(source)||!/^[-A-Za-z0-9._/]+$/.test(file)))throw Error('Unsupported CAB path');
  const directives=[
    '.OPTION EXPLICIT','.Set Cabinet=ON','.Set Compress=ON','.Set CompressionType=MSZIP',
    '.Set MaxDiskSize=0','.Set CabinetNameTemplate=program-files.cab','.Set DiskDirectoryTemplate=.',
    ...sources.map(([source,file])=>`"${source}" "${file.replaceAll('/','\\')}"`)
  ].join('\r\n')+'\r\n';
  fs.writeFileSync(path.join(stage,'payload.ddf'),directives);
  run(path.join(process.env.SystemRoot||'C:/Windows','System32','makecab.exe'),['/F','payload.ddf'],stage);
  payload=path.join(stage,'program-files.cab');
  if(fs.readdirSync(stage).filter(file=>file.endsWith('.cab')).length!==1||!fs.existsSync(payload))throw Error('Expected one Windows cabinet');
}
run(process.execPath,['scripts/build-bootstrapper.mjs',(cabTest?'--cab=':'--inner=')+payload]);
const metadata={version,kind:cabTest?'cab-test':'nsis-selectable-directory',innerSetup:payload,innerSHA:sha(payload),application,guard,stage,compiler,compilerSHA:sha(compiler),nsiSHA:sha(nsi),files:files.length,totalFileBytes,encoding:'UTF-8-BOM',shortcutWriter:'native-only'};fs.writeFileSync(cabTest?'work/temp/cab-installer-artifacts.json':'work/temp/selectable-installer-artifacts.json',JSON.stringify(metadata,null,2));console.log(JSON.stringify(metadata,null,2));
