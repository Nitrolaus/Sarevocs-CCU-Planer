using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;

public static class SelectableSetup {
 public static bool HasLegacyInstallation(string root){
  if(!File.Exists(Path.Combine(root,"Update.exe")))return false;
  SetupBootstrapperCore.ValidateProgramTree(root);
  foreach(string directory in Directory.GetDirectories(root)){
   if(System.Text.RegularExpressions.Regex.IsMatch(Path.GetFileName(directory),@"^app-\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$")&&File.Exists(Path.Combine(directory,SetupBootstrapperCore.ExecutableName)))return true;
  }
  return false;
 }
 static void RemoveEmptyDirectory(string folder){
  if(Directory.Exists(folder)&&Directory.GetFileSystemEntries(folder).Length==0)Directory.Delete(folder,false);
 }
 static void RemoveProductFiles(string root,IEnumerable<string> fileNames){
  root=SetupBootstrapperCore.CanonicalRoot(root);
  SetupBootstrapperCore.ValidateProgramTree(root);
  var directories=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
  foreach(string name in fileNames){
   string file=Path.GetFullPath(Path.Combine(root,name));
   if(!file.StartsWith(root+"\\",StringComparison.OrdinalIgnoreCase))throw new IOException("INVALID_PRODUCT_FILE");
   SetupBootstrapperCore.RejectReparseParents(file);
   if(File.Exists(file))File.Delete(file);
   for(string dir=Path.GetDirectoryName(file);!dir.Equals(root,StringComparison.OrdinalIgnoreCase);dir=Path.GetDirectoryName(dir))directories.Add(dir);
  }
  foreach(string dir in directories.OrderByDescending(d=>d.Length))RemoveEmptyDirectory(dir);
  RemoveEmptyDirectory(root);
 }
 public static void CheckMove(string previous,string target){
  if(String.IsNullOrEmpty(previous))return;
  previous=SetupBootstrapperCore.PhysicalDirectoryPath(previous);
  target=SetupBootstrapperCore.PhysicalDirectoryPath(target);
  if(previous.Equals(target,StringComparison.OrdinalIgnoreCase))return;
  if(previous.StartsWith(target+"\\",StringComparison.OrdinalIgnoreCase)||target.StartsWith(previous+"\\",StringComparison.OrdinalIgnoreCase)||
     IsPhysicalAncestor(previous,target)||IsPhysicalAncestor(target,previous))throw new IOException("OVERLAPPING_INSTALL_LOCATIONS");
 }
 static bool IsPhysicalAncestor(string candidate,string child){
  if(!Directory.Exists(candidate))return false;
  for(string parent=Path.GetDirectoryName(child);!String.IsNullOrEmpty(parent);parent=Path.GetDirectoryName(parent))
   if(Directory.Exists(parent)&&SetupBootstrapperCore.SameDirectory(candidate,parent))return true;
  return false;
 }
 public static bool CleanPrevious(string previous,string local,string target,string[] packagedFiles){
  if(String.IsNullOrEmpty(previous)||!Directory.Exists(previous))return true;
  previous=InstallLocation.Validate(previous,local);
  CheckMove(previous,target);
  if(SetupBootstrapperCore.SameDirectory(previous,target))return true;
  // Only names from the new installer's embedded file list can select old files.
  RemoveProductFiles(previous,packagedFiles.Concat(new[]{"SetupGuard.exe","Uninstall.exe","install-files.json","install-product.txt"}));
  return true;
 }
 public static void CleanLegacyFiles(string root,string[] packagedFiles){
  if(!HasLegacyInstallation(root))return;
  foreach(string directory in Directory.GetDirectories(root)){
   if(!System.Text.RegularExpressions.Regex.IsMatch(Path.GetFileName(directory),@"^app-\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$")||!File.Exists(Path.Combine(directory,SetupBootstrapperCore.ExecutableName)))continue;
   RemoveProductFiles(directory,packagedFiles.Concat(new[]{"Squirrel.exe"}));
  }
  var extras=new List<string>{SetupBootstrapperCore.ExecutableName,"Update.exe","packages\\RELEASES"};
  string packages=Path.Combine(root,"packages");
  if(Directory.Exists(packages))foreach(string file in Directory.GetFiles(packages,"*.nupkg")){
   string name=Path.GetFileName(file);
   if(System.Text.RegularExpressions.Regex.IsMatch(name,@"^SarevocsCCUPlaner-\d+\.\d+\.\d+-(full|delta)\.nupkg$",System.Text.RegularExpressions.RegexOptions.IgnoreCase))extras.Add(Path.Combine("packages",name));
  }
  RemoveProductFiles(root,extras);
 }
 static void RemoveLegacyRegistration(string root){
  const string key=@"Software\Microsoft\Windows\CurrentVersion\Uninstall\SarevocsCCUPlaner";
  using(var entry=Registry.CurrentUser.OpenSubKey(key)){
   string command=entry==null?null:entry.GetValue("UninstallString") as string;
   string expected=Path.Combine(root,"Update.exe");
   if(!String.Equals(command,"\""+expected+"\" --uninstall",StringComparison.OrdinalIgnoreCase)&&!String.Equals(command,expected+" --uninstall",StringComparison.OrdinalIgnoreCase))return;
  }
  Registry.CurrentUser.DeleteSubKey(key,false);
 }
 static int RunChild(string executable,string arguments,string workingDirectory,string progressFile=null,Action<int> progress=null){
  var start=new ProcessStartInfo(executable,arguments){UseShellExecute=false,CreateNoWindow=true,WorkingDirectory=workingDirectory};
  if(progressFile!=null)start.EnvironmentVariables["CCU_SETUP_PROGRESS"]=progressFile;
  using(var process=Process.Start(start)){
   if(process==null)throw new IOException("INSTALLER_START_FAILED");
   do{
    if(progressFile!=null&&progress!=null)try{long bytes;if(Int64.TryParse(File.ReadAllText(progressFile).Trim(),out bytes)&&bytes>=0&&EmbeddedPayload.TotalFileBytes>0)progress((int)Math.Min(100,bytes*100/EmbeddedPayload.TotalFileBytes));}catch(IOException){}
   }while(!process.WaitForExit(100));
   return process.ExitCode;
  }
 }
 static object GetLink(Type shellType,object shell,string file){return shellType.InvokeMember("CreateShortcut",BindingFlags.InvokeMethod,null,shell,new object[]{file});}
 static string LinkTarget(object link){return link.GetType().InvokeMember("TargetPath",BindingFlags.GetProperty,null,link,null) as string;}
 static bool OwnTarget(string target,IEnumerable<string> roots){
  if(String.IsNullOrEmpty(target)||!Path.IsPathRooted(target))return false;
  string full=Path.GetFullPath(target);if(!Path.GetFileName(full).Equals(SetupBootstrapperCore.ExecutableName,StringComparison.OrdinalIgnoreCase))return false;
  foreach(string root in roots){if(full.Equals(Path.Combine(root,SetupBootstrapperCore.ExecutableName),StringComparison.OrdinalIgnoreCase))return true;string parent=Path.GetDirectoryName(full);if(String.Equals(Path.GetDirectoryName(parent),root,StringComparison.OrdinalIgnoreCase)&&System.Text.RegularExpressions.Regex.IsMatch(Path.GetFileName(parent),@"^app-\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$"))return true;}
  return false;
 }
 static readonly string ShortcutName="Sarevoc´s CCU Planer.lnk";
 static string[] InspectShortcuts(string directory,IEnumerable<string> roots,Type shellType,object shell){
  string desired=Path.Combine(directory,ShortcutName);
  SetupBootstrapperCore.RejectReparseParents(desired);
  if(File.Exists(directory)||Directory.Exists(desired))throw new IOException("SHORTCUT_NAME_IN_USE");
  if(!Directory.Exists(directory))return new string[0];
  var owned=new List<string>();
  foreach(string file in Directory.GetFiles(directory,"*CCU*Planer*.lnk")){
   if(!Path.GetFileName(file).StartsWith("Sarevoc",StringComparison.OrdinalIgnoreCase))continue;
   bool own=(File.GetAttributes(file)&FileAttributes.ReparsePoint)==0&&OwnTarget(LinkTarget(GetLink(shellType,shell,file)),roots);
   if(!own&&file.Equals(desired,StringComparison.OrdinalIgnoreCase))throw new IOException("SHORTCUT_NAME_IN_USE");
   if(own){SetupBootstrapperCore.FileSha256(file);owned.Add(file);}
  }
  return owned.ToArray();
 }
 static void SaveShortcutForRollback(string file,Action<Action> undo){
  if(undo==null)return;
  byte[] previous=File.Exists(file)?File.ReadAllBytes(file):null;
  undo(delegate{
   SetupBootstrapperCore.RejectReparseParents(file);
   if(previous==null){File.Delete(file);return;}
   if(File.Exists(file))SetupBootstrapperCore.FileSha256(file);
   if(!File.Exists(file)||!File.ReadAllBytes(file).SequenceEqual(previous))File.WriteAllBytes(file,previous);
  });
 }
 // Only links naming this product and pointing to a known product root may be removed.
 public static void CreateShortcuts(string root,string desktop,string menu,IEnumerable<string> previousRoots=null,Action<Action> undo=null){
  Type shellType=Type.GetTypeFromProgID("WScript.Shell");object shell=Activator.CreateInstance(shellType);
  var roots=new HashSet<string>(StringComparer.OrdinalIgnoreCase){root};if(previousRoots!=null)foreach(string previous in previousRoots)roots.Add(previous);
  foreach(string directory in new[]{desktop,menu}){
   string[] owned=InspectShortcuts(directory,roots,shellType,shell);
   Directory.CreateDirectory(directory);string desired=Path.Combine(directory,ShortcutName);
   foreach(string file in owned){
    if(file.Equals(desired,StringComparison.OrdinalIgnoreCase))continue;
    SaveShortcutForRollback(file,undo);
    File.Delete(file);
   }
   SetupBootstrapperCore.RejectReparseParents(desired);
   SaveShortcutForRollback(desired,undo);
   object link=GetLink(shellType,shell,desired);Type type=link.GetType();
   foreach(var value in new Dictionary<string,string>{{"TargetPath",Path.Combine(root,SetupBootstrapperCore.ExecutableName)},{"Arguments",""},{"WorkingDirectory",root},{"IconLocation",Path.Combine(root,SetupBootstrapperCore.ExecutableName)+",0"}})type.InvokeMember(value.Key,BindingFlags.SetProperty,null,link,new object[]{value.Value});
   type.InvokeMember("Save",BindingFlags.InvokeMethod,null,link,null);
  }
 }
 static bool Install(string local,string previous,string target,DisplaySetup display,bool acceptedTerms,Action<string,int> report){
  SetupTerms.Require(acceptedTerms);
  target=InstallLocation.Validate(target,local);
  string previousLocation=InstallLocation.FindPrevious(previous,local);
  CheckMove(previousLocation,target);
  string legacy=Path.Combine(local,"SarevocsCCUPlaner");
  using(SetupBootstrapperCore.AcquireInstallLock(legacy)){
    var roots=new HashSet<string>(StringComparer.OrdinalIgnoreCase){legacy,target};
    if(previousLocation!=null){roots.Add(previous);roots.Add(previousLocation);}
    string desktop=Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
    string menu=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs),"Sarevoc");
    report("Installationsziel und Verknüpfungen prüfen …",-1);
    Type shellType=Type.GetTypeFromProgID("WScript.Shell");object shell=Activator.CreateInstance(shellType);
    InspectShortcuts(desktop,roots,shellType,shell);InspectShortcuts(menu,roots,shellType,shell);

    var manifest=InstallTransaction.ReadEmbeddedManifest();
    var managedNames=manifest.Select(entry=>entry.Name).Concat(new[]{InstallTransaction.UninstallerName}).ToArray();
    string parent=Path.GetDirectoryName(target);
    SetupBootstrapperCore.RejectReparseParents(parent);
    Directory.CreateDirectory(parent);
    InstallLocation.Validate(target,local);
    string work=Path.Combine(parent,".ccu-setup-"+Guid.NewGuid().ToString("N").Substring(0,12));
    string staging=Path.Combine(work,"new"),backup=Path.Combine(work,"old");
    string temporary=Path.Combine(Path.GetTempPath(),"SarevocsCCUPlaner-Setup-"+Guid.NewGuid().ToString("N"));
    string extracted=null,progressFile=null;
    bool ownWork=false,retainBackup=false;
    try{
     using(SetupBootstrapperCore.CreatePayloadDirectory(work)){
      ownWork=true;
      Directory.CreateDirectory(staging);
      report("Installationsdateien vorbereiten …",0);
      using(var payload=SetupBootstrapperCore.ExtractPayload(temporary)){
       extracted=payload.Path;
#if CAB_PAYLOAD
       CabinetPayload.Extract(payload.Path,staging,manifest,p=>report("Programmdateien vorbereiten · "+p+" %",p));
#else
       progressFile=Path.Combine(temporary,"copy-progress.txt");File.WriteAllText(progressFile,"0");
       if(RunChild(payload.Path,"/S /D="+staging,temporary,progressFile,p=>report("Programmdateien vorbereiten · "+p+" %",p))!=0)throw new IOException("INNER_SETUP_FAILED");
#endif
      }
      var entries=InstallTransaction.CheckStaging(staging,manifest);
      InspectShortcuts(desktop,roots,shellType,shell);InspectShortcuts(menu,roots,shellType,shell);
      InstallLocation.Validate(target,local);
      report("Laufende Vorversion geordnet beenden …",-1);
      foreach(string root in roots){var result=SetupBootstrapperCore.CloseOwnProcesses(root);if(!result.Success)throw new IOException("CLOSE_"+result.Code);}
      string inventory=Path.Combine(local,@"SarevocsCCUPlaner-Daten\Daten\inventory.sqlite");
      string before=File.Exists(inventory)?SetupBootstrapperCore.FileSha256(inventory):null;
      foreach(string root in roots)if(SetupBootstrapperCore.VerifyStopped(root)!="SUCCESS")throw new IOException("PROCESS_RESTARTED");
      report("Programmdateien prüfen und austauschen …",-1);
      InstallTransaction.PublishVerified(entries,staging,backup,target,undo=>{
       report("Desktop und Startmenü aktualisieren …",-1);
       CreateShortcuts(target,desktop,menu,roots,undo);
       report("Installation abschließen …",-1);
       string after=File.Exists(inventory)?SetupBootstrapperCore.FileSha256(inventory):null;
       if(before!=after)throw new IOException("INVENTORY_CHANGED");
       InstallTransaction.Register(target,acceptedTerms,undo);
       display.Commit(local);
      },ref retainBackup);
     }
    }finally{
     if(ownWork){
      InstallTransaction.RemoveStaging(staging,managedNames);
      if(!retainBackup)InstallTransaction.RemoveStaging(backup,managedNames);
      try{SetupBootstrapperCore.RejectReparseParents(work);Directory.Delete(work,false);}catch(IOException){}catch(UnauthorizedAccessException){}
     }
     foreach(string file in new[]{progressFile,extracted})if(file!=null)try{File.Delete(file);}catch(IOException){}catch(UnauthorizedAccessException){}
     try{Directory.Delete(temporary,false);}catch(IOException){}catch(UnauthorizedAccessException){}
    }
    // Only retire old locations after the new registration, files and settings have all succeeded.
    report("Bisherige Programmversion bereinigen …",-1);
    try{
     var programNames=manifest.Select(entry=>entry.Name).Where(name=>!InstallTransaction.IsSetupFile(name)).ToArray();
     if(HasLegacyInstallation(legacy)){InstallLocation.ValidateTargetAccess(legacy);CleanLegacyFiles(legacy,programNames);RemoveLegacyRegistration(legacy);}
     return String.IsNullOrEmpty(previous)||previousLocation!=null&&CleanPrevious(previousLocation,local,target,programNames);
    }catch(IOException){return false;}catch(UnauthorizedAccessException){return false;}catch(System.Security.SecurityException){return false;}
  }
 }
 static void Success(bool cleaned){Console.WriteLine("{\"code\":\"SUCCESS\",\"installedVersion\":\""+EmbeddedPayload.Version+"\",\"cleanupComplete\":"+(cleaned?"true":"false")+",\"newRsiLogin\":false}");}
 static string Failure(Exception error){if(error is IOException&&error.Message.StartsWith("CLOSE_",StringComparison.Ordinal))return "Bitte Planer über „Beenden“ schließen und erneut versuchen.";if(error.Message=="INSTALL_ROLLBACK_INCOMPLETE")return "Die Rücksicherung konnte nicht vollständig abgeschlossen werden. Die gesicherten Dateien liegen neben dem Installationsordner.";return error is IOException&&error.Message=="SHORTCUT_NAME_IN_USE"?"Ein anderes Programm verwendet den Namen der Verknüpfung.":FolderFailure(error);}
 static string FolderFailure(Exception error){
  switch(error.Message){
   case InstallLocation.FolderRequired:return "Bitte wähle den Programmordner.";
   case InstallLocation.UnsafePermissions:return "Die Rechte an diesem Pfad schützen die Programmdateien nicht ausreichend.";
   case "DIRECTORY_NOT_EMPTY":return "Der Ordner enthält bereits andere Dateien. Wähle einen leeren Ordner oder die bestehende Planer-Installation.";
   case "PROTECTED_DIRECTORY":return "Dieser Ordner ist für Windows oder Planer-Daten reserviert. Wähle einen separaten Programmordner.";
   default:return "Bitte prüfe den Pfad und deine Schreibrechte für diesen Programmordner.";
  }
 }
 static void ShowFolderFailure(SetupWindow window,Exception error,string local){
  string alternative=error.Message==InstallLocation.UnsafePermissions
   ?InstallLocation.SuggestAlternative(window.Folder.Text,local,Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)):null;
  window.ShowPathError(FolderFailure(error),alternative);
 }
 static void ReportFailure(Exception error){string code=error.Message=="INSTALL_ROLLBACK_INCOMPLETE"||error.Message=="SHORTCUT_NAME_IN_USE"||error.Message=="PAYLOAD_HASH_MISMATCH"||error.Message==InstallLocation.UnsafePermissions||error.Message==InstallLocation.FolderRequired?error.Message:"INSTALLATION_ABORTED";Console.WriteLine("{\"code\":\""+code+"\"}");}
 [STAThread]public static int Main(string[] args){
  if(args.Length==1&&args[0].StartsWith("--extract-payload=",StringComparison.Ordinal))return SetupBootstrapper.Main(args);
  bool silent=args.Length==1&&args[0]=="--silent";if(args.Length>0&&!silent)return 1;
  if(silent&&!SetupTerms.IsAccepted()){Console.WriteLine("{\"code\":\"TERMS_ACCEPTANCE_REQUIRED\"}");return 2;}
  bool owns=false;Mutex mutex=null;
  try{
   Application.EnableVisualStyles();string local=Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
   string sid=System.Security.Principal.WindowsIdentity.GetCurrent().User.Value;
   var security=new System.Security.AccessControl.MutexSecurity();security.SetAccessRuleProtection(true,false);
   security.AddAccessRule(new System.Security.AccessControl.MutexAccessRule(new System.Security.Principal.SecurityIdentifier(sid),System.Security.AccessControl.MutexRights.FullControl,System.Security.AccessControl.AccessControlType.Allow));
   security.AddAccessRule(new System.Security.AccessControl.MutexAccessRule(new System.Security.Principal.SecurityIdentifier(System.Security.Principal.WellKnownSidType.LocalSystemSid,null),System.Security.AccessControl.MutexRights.FullControl,System.Security.AccessControl.AccessControlType.Allow));
   bool created;mutex=new Mutex(false,@"Local\SarevocsCCUPlaner.Install."+sid,out created,security);try{owns=mutex.WaitOne(0);}catch(AbandonedMutexException){owns=true;}if(!owns)throw new IOException("INSTALLER_ALREADY_RUNNING");
   string previous=InstallLocation.ExistingRoot(local),initial=InstallLocation.InitialRoot(previous),installed=InstallLocation.InstalledVersion(previous);
   if(silent){string target=InstallLocation.Validate(initial,local);Success(Install(local,previous,target,DisplaySetup.Prepare(local,true),true,(s,p)=>{}));return 0;}
   int result=0;
   using(var window=new SetupWindow(initial,installed,EmbeddedPayload.Version)){
    if(initial.Length!=0){
     try{InstallLocation.Validate(initial,local);}
     catch(IOException error){ShowFolderFailure(window,error,local);}
     catch(UnauthorizedAccessException error){ShowFolderFailure(window,error,local);}
     catch(System.Security.SecurityException error){ShowFolderFailure(window,error,local);}
     catch(ArgumentException error){ShowFolderFailure(window,error,local);}
    }
    window.InstallRequested+=delegate{
     if(!window.AcceptTerms.Checked)return;
     string target;try{target=InstallLocation.Validate(window.Folder.Text,local);}catch(Exception error){ShowFolderFailure(window,error,local);return;}
     DisplaySetup display=DisplaySetup.Prepare(local,false);if(display.Cancelled)return;
     window.SetBusy("Installation vorbereiten …",-1);
     Action<Action> post=action=>{if(!window.IsDisposed)try{window.BeginInvoke(action);}catch(InvalidOperationException){}};
     Task.Run(delegate{
      try{bool cleaned=Install(local,previous,target,display,true,(phase,percent)=>post(()=>window.SetBusy(phase,percent)));result=0;post(()=>window.SetFinished(true,cleaned?"":"Der bisherige Programmordner konnte nicht sicher bereinigt werden."));Success(cleaned);}
      catch(Exception error){result=1;post(()=>window.SetFinished(false,Failure(error)));ReportFailure(error);}
     });
    };
    Application.Run(window);
   }return result;
  }catch(Exception error){ReportFailure(error);if(!silent){using(var window=new SetupWindow("",null,EmbeddedPayload.Version)){window.SetFinished(false,Failure(error));Application.Run(window);}}return 1;}
  finally{if(owns)mutex.ReleaseMutex();if(mutex!=null)mutex.Dispose();}
 }
}
