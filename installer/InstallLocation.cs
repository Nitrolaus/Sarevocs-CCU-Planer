using System;using System.IO;using System.Drawing;using System.Runtime.InteropServices;using System.Windows.Forms;using Microsoft.Win32;
using System.Security.AccessControl;
using System.Security.Principal;
public static class InstallLocation {
 public const string ProductMarker="SarevocsCCUPlaner/1";
 public const string Registration=@"Software\Sarevoc\SarevocsCCUPlaner";
 [DllImport("dwmapi.dll")]static extern int DwmSetWindowAttribute(IntPtr h,int a,ref int v,int n);
 public static string RegisteredRoot(){using(var key=Registry.CurrentUser.OpenSubKey(Registration)){return key==null?null:key.GetValue("InstallLocation") as string;}}
 internal const string UnsafePermissions="UNSAFE_TARGET_PERMISSIONS";
 internal const string TargetNotWritable="TARGET_NOT_WRITABLE";
 internal const string FolderRequired="INSTALLATION_FOLDER_REQUIRED";
 public static string InitialRoot(string registered){return String.IsNullOrWhiteSpace(registered)?"":registered;}
 internal static string ExistingRoot(string local){
  string registered=RegisteredRoot();
  if(!String.IsNullOrWhiteSpace(registered))return registered;
  // The normal Windows uninstall entry also records the location of a selectable install.
  // Only recover that location when it still contains the installed product.
  string candidate;
  using(var entry=Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\SarevocsCCUPlaner.Selectable"))
   candidate=entry==null?null:entry.GetValue("InstallLocation") as string;
  string previous=FindPrevious(candidate,local);
  return previous!=null&&File.Exists(Path.Combine(previous,"install-product.txt"))&&
   File.Exists(Path.Combine(previous,SetupBootstrapperCore.ExecutableName))?previous:null;
 }
 public static string InstalledVersion(string registered){
  string key=String.IsNullOrEmpty(registered)?@"Software\Microsoft\Windows\CurrentVersion\Uninstall\SarevocsCCUPlaner":@"Software\Microsoft\Windows\CurrentVersion\Uninstall\SarevocsCCUPlaner.Selectable";
  using(var entry=Registry.CurrentUser.OpenSubKey(key)){string value=entry==null?null:entry.GetValue("DisplayVersion") as string;Version version;if(Version.TryParse(value,out version)&&version.Build>=0)return new Version(version.Major,version.Minor,version.Build).ToString();}return null;
 }
 static bool Within(string value,string parent){return value.Equals(parent,StringComparison.OrdinalIgnoreCase)||value.StartsWith(parent+"\\",StringComparison.OrdinalIgnoreCase);}
 public static string Validate(string value,string local,bool staging=false){return ValidateLocation(value,local,staging,true,false);}
 internal static string ValidateForInstall(string value,string local){
  string target=Validate(value,local);
  TransactionParent(target);
  return target;
 }
 internal static string TransactionParent(string target){
  bool existing=Directory.Exists(target);
  if(existing&&!SetupBootstrapperCore.CanCreateEntries(target,true))throw WriteDenied(target);
  string parent=Path.GetDirectoryName(target);
  string ancestor=parent;
  while(ancestor!=null&&!Directory.Exists(ancestor))ancestor=Path.GetDirectoryName(ancestor);
  if(ancestor!=null&&SetupBootstrapperCore.CanCreateEntries(ancestor,false))return parent;
  // A private working directory inside the verified target keeps File.Replace on its own volume.
  if(existing)return target;
  throw WriteDenied(ancestor??parent);
 }
 static IOException WriteDenied(string path){
  var error=new IOException(TargetNotWritable);
  error.Data["folder"]=path;
  return error;
 }
 internal static string SuggestAlternative(string rejected,string local,string profile){
  string drive=null,neighbor=null;
  if(!String.IsNullOrWhiteSpace(rejected)){
   try{
    drive=Path.GetPathRoot(rejected);
    if(drive==null||drive.Length!=3||drive[1]!=':'||drive[2]!='\\')return null;
    neighbor=Path.GetDirectoryName(Path.GetFullPath(rejected).TrimEnd('\\'));
   }catch(ArgumentException){return null;}catch(NotSupportedException){return null;}catch(IOException){return null;}
  }
  foreach(string parent in new[]{neighbor,drive,profile}){
   if(String.IsNullOrEmpty(parent)||!Directory.Exists(parent))continue;
   try{
    if(drive!=null&&!String.Equals(Path.GetPathRoot(parent),drive,StringComparison.OrdinalIgnoreCase))continue;
    string suggested=Path.Combine(parent,"CCU_Planer");
    if(String.Equals(suggested,rejected,StringComparison.OrdinalIgnoreCase))suggested=Path.Combine(parent,"CCU_Planer-2");
    if(Directory.Exists(suggested)||File.Exists(suggested))continue;
    string candidate=ValidateForInstall(suggested,local);
    if(drive!=null&&!String.Equals(Path.GetPathRoot(candidate),drive,StringComparison.OrdinalIgnoreCase))continue;
    if(String.Equals(candidate,rejected,StringComparison.OrdinalIgnoreCase)||Within(candidate,local)||Directory.Exists(candidate))continue;
    return candidate;
   }catch(IOException){}catch(UnauthorizedAccessException){}catch(System.Security.SecurityException){}catch(ArgumentException){}
  }
  return null;
 }
 internal static string ValidateUninstall(string value,string local){return ValidateLocation(value,local,false,true,true);}
 internal static string FindPrevious(string value,string local){
  if(String.IsNullOrEmpty(value))return null;
  try{return ValidateLocation(value,local,false,false,false);}
  catch(IOException){return null;}
  catch(UnauthorizedAccessException){return null;}
  catch(System.Security.SecurityException){return null;}
 catch(ArgumentException){return null;}
 }
 internal static string ValidateDuringInstall(string target,string local,string work){
  return ValidateLocation(target,local,false,true,false,work);
 }
 static string ValidateLocation(string value,string local,bool staging,bool checkPermissions,bool uninstall,string activeWork=null){
  if(String.IsNullOrWhiteSpace(value))throw new IOException(FolderRequired);
  if(value!=null)foreach(string part in value.Split('\\','/'))if(part.EndsWith(".")||part.EndsWith(" "))throw new IOException("INVALID_PATH");
  string root=SetupBootstrapperCore.CanonicalRoot(value);if(!staging&&root.Length>180)throw new IOException("PATH_TOO_LONG");
  foreach(char c in root)if(Char.IsControl(c)||c=='"'||c=='*'||c=='?'||c=='<'||c=='>'||c=='|')throw new IOException("INVALID_PATH");
  foreach(string part in root.Substring(3).Split('\\')){if(part.Length==0||part.EndsWith(".")||part.EndsWith(" ")||part.Contains(":"))throw new IOException("INVALID_PATH");}
  root=SetupBootstrapperCore.CanonicalRoot(SetupBootstrapperCore.PhysicalDirectoryPath(root));
  if(!staging&&root.Length>180)throw new IOException("PATH_TOO_LONG");
  local=SetupBootstrapperCore.PhysicalDirectoryPath(local);
  string data=Path.GetFullPath(Path.Combine(local,"SarevocsCCUPlaner-Daten"));
  string legacy=Path.GetFullPath(Path.Combine(local,"SarevocsCCUPlaner"));
  if(Within(root,Environment.GetFolderPath(Environment.SpecialFolder.Windows))||Within(root,data)||Within(data,root)||Within(root,legacy)||Within(legacy,root))throw new IOException("PROTECTED_DIRECTORY");
  SetupBootstrapperCore.ValidateProgramTree(root);if(File.Exists(root))throw new IOException("TARGET_IS_FILE");
  if(staging&&(!Directory.Exists(root)||Directory.GetFileSystemEntries(root).Length!=0))throw new IOException("STAGING_NOT_EMPTY");
  string[] contents=Directory.Exists(root)?Directory.GetFileSystemEntries(root):new string[0];
  // The active workspace is created and held by Install. It is still covered by
  // tree and ACL checks. Ignore only its exact path when recognizing an empty target.
  if(contents.Length!=0&&!(contents.Length==1&&String.Equals(contents[0],activeWork,StringComparison.OrdinalIgnoreCase))){
   string marker=Path.Combine(root,"install-product.txt");
   SetupBootstrapperCore.RejectReparseParents(marker);
   // After a partial removal, the retained uninstaller can retry with the same product marker.
   bool productExecutable=File.Exists(Path.Combine(root,SetupBootstrapperCore.ExecutableName))||
    File.Exists(Path.Combine(root,"SetupGuard.exe"))||(uninstall&&File.Exists(Path.Combine(root,"Uninstall.exe")));
   if(!File.Exists(marker)||new FileInfo(marker).Length>100||File.ReadAllText(marker).Trim()!=ProductMarker||!productExecutable)
    throw new IOException("DIRECTORY_NOT_EMPTY");
  }
  if(checkPermissions)ValidateTargetAccess(root);
  return root;
 }

 const FileSystemRights ReplaceDirectory = FileSystemRights.Delete | FileSystemRights.DeleteSubdirectoriesAndFiles |
  FileSystemRights.ChangePermissions | FileSystemRights.TakeOwnership | FileSystemRights.WriteAttributes |
  FileSystemRights.WriteExtendedAttributes;
 const FileSystemRights ChangeContents = ReplaceDirectory | FileSystemRights.WriteData | FileSystemRights.AppendData;
 const AccessControlSections AccessAndOwner = AccessControlSections.Access | AccessControlSections.Owner;

 internal static void ValidateTargetAccess(string root){
  SecurityIdentifier user;
  using(var identity=WindowsIdentity.GetCurrent())user=identity.User;
  string checkedPath=root;
  try{
   bool childMissing=!Directory.Exists(root);
   if(!childMissing)CheckTreeAccess(root,user);
   for(string parent=Path.GetDirectoryName(root);!String.IsNullOrEmpty(parent);parent=Path.GetDirectoryName(parent)){
    if(!Directory.Exists(parent)){childMissing=true;continue;}
    checkedPath=parent;
    // The drive root cannot be replaced as a directory. Rights to delete its
    // children or change its ACL can still undermine every install below it.
    FileSystemRights parentMask=Path.GetDirectoryName(parent)==null
     ? FileSystemRights.DeleteSubdirectoriesAndFiles | FileSystemRights.ChangePermissions | FileSystemRights.TakeOwnership
     : ReplaceDirectory;
    CheckAccess(Directory.GetAccessControl(parent,AccessAndOwner),user,parentMask,childMissing);
    childMissing=false;
   }
  }catch(UnauthorizedAccessException){throw UnverifiableAccess(checkedPath);}
  catch(System.Security.SecurityException){throw UnverifiableAccess(checkedPath);}
  catch(IOException error){
   if(error.Message==UnsafePermissions&&!error.Data.Contains("folder"))error.Data["folder"]=checkedPath;
   throw;
  }
 }
 static IOException UnverifiableAccess(string path){
  var error=new IOException(UnsafePermissions);
  error.Data["folder"]=path;
  error.Data["unverifiable"]=true;
  return error;
 }

 static void CheckTreeAccess(string directory,SecurityIdentifier user){
  string current=directory;
  try{
   CheckAccess(Directory.GetAccessControl(directory,AccessAndOwner),user,ChangeContents,true);
   foreach(string entry in Directory.GetFileSystemEntries(directory)){
    current=entry;
    SetupBootstrapperCore.RejectReparseParents(entry);
    if(Directory.Exists(entry))CheckTreeAccess(entry,user);
    else CheckAccess(File.GetAccessControl(entry,AccessAndOwner),user,ChangeContents,false);
   }
  }catch(UnauthorizedAccessException){throw UnverifiableAccess(current);}
  catch(System.Security.SecurityException){throw UnverifiableAccess(current);}
  catch(IOException error){
   if(error.Message==UnsafePermissions&&!error.Data.Contains("folder"))error.Data["folder"]=current;
   throw;
  }
 }

 static bool Trusted(SecurityIdentifier sid,SecurityIdentifier user){
  if(sid==null)return false;
  return sid.Equals(user)||sid.IsWellKnown(WellKnownSidType.LocalSystemSid)||sid.IsWellKnown(WellKnownSidType.BuiltinAdministratorsSid)||
   sid.Value=="S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464";
 }

 static void CheckAccess(FileSystemSecurity security,SecurityIdentifier user,FileSystemRights directMask,bool checkInheritance){
  var descriptor=new RawSecurityDescriptor(security.GetSecurityDescriptorBinaryForm(),0);
  if(descriptor.DiscretionaryAcl==null||!Trusted(descriptor.Owner,user))throw new IOException(UnsafePermissions);
  foreach(GenericAce entry in descriptor.DiscretionaryAcl){
   var rule=entry as QualifiedAce;
   if(rule==null)throw new IOException(UnsafePermissions);
   var sid=rule.SecurityIdentifier;
   if(rule.AceQualifier!=AceQualifier.AccessAllowed||Trusted(sid,user)||sid.Value=="S-1-3-4")continue;
   uint rights=unchecked((uint)rule.AccessMask);
   if((rights&0x10000000)!=0)rights|=(uint)FileSystemRights.FullControl;
   if((rights&0x40000000)!=0)rights|=(uint)FileSystemRights.Write;
   bool direct=(rule.AceFlags&AceFlags.InheritOnly)==0&&(rights&(uint)directMask)!=0;
   bool inherited=checkInheritance&&(rule.AceFlags&(AceFlags.ContainerInherit|AceFlags.ObjectInherit))!=0&&
    (rights&(uint)ChangeContents)!=0&&sid.Value!="S-1-3-0";
   if(direct||inherited)throw new IOException(UnsafePermissions);
  }
 }
 public static Form CreateForm(string initial){return new SetupWindow(initial,null,EmbeddedPayload.Version);}
 public static void RemoveOwnShortcuts(string root,string desktop,string menu){
  var shellType=Type.GetTypeFromProgID("WScript.Shell");
  object shell=Activator.CreateInstance(shellType);
  string expected=Path.Combine(SetupBootstrapperCore.CanonicalRoot(root),SetupBootstrapperCore.ExecutableName);
  foreach(string directory in new[]{desktop,menu}){
   string file=Path.Combine(directory,"Sarevoc´s CCU Planer.lnk");
   if(!File.Exists(file)||(File.GetAttributes(file)&FileAttributes.ReparsePoint)!=0)continue;
   SetupBootstrapperCore.RejectReparseParents(directory);
   object shortcut=shellType.InvokeMember("CreateShortcut",System.Reflection.BindingFlags.InvokeMethod,null,shell,new object[]{file});
   string target=shortcut.GetType().InvokeMember("TargetPath",System.Reflection.BindingFlags.GetProperty,null,shortcut,null) as string;
   if(String.Equals(target,expected,StringComparison.OrdinalIgnoreCase))File.Delete(file);
  }
 }
}
