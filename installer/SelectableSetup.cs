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
 static string[] PackagedFileNames(){
  using(var stream=Assembly.GetExecutingAssembly().GetManifestResourceStream("SarevocsCCUPlaner.ProductFiles")){
   if(stream==null)throw new IOException("PRODUCT_FILES_MISSING");
   using(var reader=new StreamReader(stream))return reader.ReadToEnd().Split(new[]{'\n','\r'},StringSplitOptions.RemoveEmptyEntries);
  }
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
  if(String.IsNullOrEmpty(previous)||previous.Equals(target,StringComparison.OrdinalIgnoreCase))return;
  if(previous.StartsWith(target+"\\",StringComparison.OrdinalIgnoreCase)||target.StartsWith(previous+"\\",StringComparison.OrdinalIgnoreCase))throw new IOException("OVERLAPPING_INSTALL_LOCATIONS");
 }
 public static void CleanPrevious(string previous,string local,string target,string[] packagedFiles){
  if(String.IsNullOrEmpty(previous)||previous.Equals(target,StringComparison.OrdinalIgnoreCase)||!Directory.Exists(previous))return;
  previous=InstallLocation.Validate(previous,local);
  CheckMove(previous,target);
  // Only names from the new installer's embedded file list can select old files.
  RemoveProductFiles(previous,packagedFiles.Concat(new[]{"SetupGuard.exe","Uninstall.exe","install-files.json","install-product.txt"}));
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
 // Only links naming this product and pointing to a known product root may be removed.
 public static void CreateShortcuts(string root,string desktop,string menu,IEnumerable<string> previousRoots=null){
  Type shellType=Type.GetTypeFromProgID("WScript.Shell");object shell=Activator.CreateInstance(shellType);
  var roots=new HashSet<string>(StringComparer.OrdinalIgnoreCase){root};if(previousRoots!=null)foreach(string previous in previousRoots)roots.Add(previous);
  foreach(string directory in new[]{desktop,menu}){
   Directory.CreateDirectory(directory);string desired=Path.Combine(directory,"Sarevoc´s CCU Planer.lnk");
   foreach(string file in Directory.GetFiles(directory,"*CCU*Planer*.lnk")){
    if(!Path.GetFileName(file).StartsWith("Sarevoc",StringComparison.OrdinalIgnoreCase)||(File.GetAttributes(file)&FileAttributes.ReparsePoint)!=0)continue;
    bool own=OwnTarget(LinkTarget(GetLink(shellType,shell,file)),roots);
    if(file.Equals(desired,StringComparison.OrdinalIgnoreCase)){if(!own)throw new IOException("SHORTCUT_NAME_IN_USE");}
    else if(own)File.Delete(file);
   }
   object link=GetLink(shellType,shell,desired);Type type=link.GetType();
   foreach(var value in new Dictionary<string,string>{{"TargetPath",Path.Combine(root,SetupBootstrapperCore.ExecutableName)},{"Arguments",""},{"WorkingDirectory",root},{"IconLocation",Path.Combine(root,SetupBootstrapperCore.ExecutableName)+",0"}})type.InvokeMember(value.Key,BindingFlags.SetProperty,null,link,new object[]{value.Value});
   type.InvokeMember("Save",BindingFlags.InvokeMethod,null,link,null);
  }
 }
 static void Install(string local,string previous,string target,DisplaySetup display,bool acceptedTerms,Action<string,int> report){
  SetupTerms.Require(acceptedTerms);
  CheckMove(previous,target);
  string legacy=Path.Combine(local,"SarevocsCCUPlaner"),temporary=null,extracted=null,progressFile=null;
  try{
   using(SetupBootstrapperCore.AcquireInstallLock(legacy)){
    var roots=new HashSet<string>(StringComparer.OrdinalIgnoreCase){legacy,target};if(!String.IsNullOrEmpty(previous))roots.Add(InstallLocation.Validate(previous,local));
    report("Laufende Vorversion geordnet beenden …",-1);
    foreach(string root in roots){var result=SetupBootstrapperCore.CloseOwnProcesses(root);if(!result.Success)throw new IOException("CLOSE_"+result.Code);}
    string inventory=Path.Combine(local,@"SarevocsCCUPlaner-Daten\Daten\inventory.sqlite"),before=File.Exists(inventory)?SetupBootstrapperCore.FileSha256(inventory):null;
    report("Installationsdateien prüfen …",-1);temporary=Path.Combine(Path.GetTempPath(),"SarevocsCCUPlaner-Setup-"+Guid.NewGuid().ToString("N"));
    using(var payload=SetupBootstrapperCore.ExtractPayload(temporary)){
     extracted=payload.Path;foreach(string root in roots)if(SetupBootstrapperCore.VerifyStopped(root)!="SUCCESS")throw new IOException("PROCESS_RESTARTED");
     progressFile=Path.Combine(temporary,"copy-progress.txt");File.WriteAllText(progressFile,"0");report("Programmdateien kopieren …",0);
     if(RunChild(payload.Path,"/S /D="+target,temporary,progressFile,p=>report("Programmdateien kopieren · "+p+" %",p))!=0)throw new IOException("INNER_SETUP_FAILED");
     report("Desktop und Startmenü aktualisieren …",-1);CreateShortcuts(target,Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs),"Sarevoc"),roots);
     report("Bisherige Programmversion bereinigen …",-1);
     var packagedFiles=PackagedFileNames();
     if(HasLegacyInstallation(legacy)){CleanLegacyFiles(legacy,packagedFiles);RemoveLegacyRegistration(legacy);}
     CleanPrevious(previous,local,target,packagedFiles);
    }
    report("Installation abschließen …",-1);string after=File.Exists(inventory)?SetupBootstrapperCore.FileSha256(inventory):null;if(before!=after)throw new IOException("INVENTORY_CHANGED");display.Commit(local);SetupTerms.Commit(acceptedTerms);
   }
  }finally{
   // Delete only this invocation's known temporary files, never user data.
   foreach(string file in new[]{progressFile,extracted})if(file!=null)try{File.Delete(file);}catch{}
   if(temporary!=null)try{Directory.Delete(temporary,false);}catch{}
  }
 }
 static void Success(){Console.WriteLine("{\"code\":\"SUCCESS\",\"installedVersion\":\""+EmbeddedPayload.Version+"\",\"newRsiLogin\":false}");}
 static string Failure(Exception error){if(error is IOException&&error.Message.StartsWith("CLOSE_",StringComparison.Ordinal))return "Bitte Planer über „Beenden“ schließen und erneut versuchen.";return error is IOException&&error.Message=="SHORTCUT_NAME_IN_USE"?"Ein anderes Programm verwendet den Namen der Verknüpfung.":"Bitte Programmordner und Schreibrechte prüfen und erneut versuchen.";}
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
   string previous=InstallLocation.RegisteredRoot(),initial=InstallLocation.DefaultRoot(local),installed=InstallLocation.InstalledVersion(local,previous);
   if(silent){string target=InstallLocation.Validate(initial,local);Install(local,previous,target,DisplaySetup.Prepare(local,true),true,(s,p)=>{});Success();return 0;}
   int result=0;
   using(var window=new SetupWindow(initial,installed,EmbeddedPayload.Version)){
    window.InstallRequested+=delegate{
     if(!window.AcceptTerms.Checked)return;
     string target;try{target=InstallLocation.Validate(window.Folder.Text,local);}catch{window.ShowPathError();return;}
     DisplaySetup display=DisplaySetup.Prepare(local,false);if(display.Cancelled)return;
     window.SetBusy("Installation vorbereiten …",-1);
     Action<Action> post=action=>{if(!window.IsDisposed)try{window.BeginInvoke(action);}catch(InvalidOperationException){}};
     Task.Run(delegate{
      try{Install(local,previous,target,display,true,(phase,percent)=>post(()=>window.SetBusy(phase,percent)));result=0;post(()=>window.SetFinished(true,""));Success();}
      catch(Exception error){result=1;post(()=>window.SetFinished(false,Failure(error)));Console.WriteLine("{\"code\":\"INSTALLATION_ABORTED\"}");}
     });
    };
    Application.Run(window);
   }return result;
  }catch(Exception error){Console.WriteLine("{\"code\":\"INSTALLATION_ABORTED\"}");if(!silent){using(var window=new SetupWindow("",null,EmbeddedPayload.Version)){window.SetFinished(false,Failure(error));Application.Run(window);}}return 1;}
  finally{if(owns)mutex.ReleaseMutex();if(mutex!=null)mutex.Dispose();}
 }
}
