using System;using System.IO;using System.Drawing;using System.Runtime.InteropServices;using System.Windows.Forms;using Microsoft.Win32;
public static class InstallLocation {
 public const string ProductMarker="SarevocsCCUPlaner/1";
 public const string Registration=@"Software\Sarevoc\SarevocsCCUPlaner";
 [DllImport("dwmapi.dll")]static extern int DwmSetWindowAttribute(IntPtr h,int a,ref int v,int n);
 public static string RegisteredRoot(){using(var key=Registry.CurrentUser.OpenSubKey(Registration)){return key==null?null:key.GetValue("InstallLocation") as string;}}
 public static string InitialRoot(string registered){return registered??"";}
 public static string DefaultRoot(string local){string current=RegisteredRoot();if(!String.IsNullOrEmpty(current))Validate(current,local);return InitialRoot(current);}
 public static string InstalledVersion(string local,string registered){
  string key=String.IsNullOrEmpty(registered)?@"Software\Microsoft\Windows\CurrentVersion\Uninstall\SarevocsCCUPlaner":@"Software\Microsoft\Windows\CurrentVersion\Uninstall\SarevocsCCUPlaner.Selectable";
  using(var entry=Registry.CurrentUser.OpenSubKey(key)){string value=entry==null?null:entry.GetValue("DisplayVersion") as string;Version version;if(Version.TryParse(value,out version)&&version.Build>=0)return new Version(version.Major,version.Minor,version.Build).ToString();}return null;
 }
 static bool Within(string value,string parent){return value.Equals(parent,StringComparison.OrdinalIgnoreCase)||value.StartsWith(parent+"\\",StringComparison.OrdinalIgnoreCase);}
 public static string Validate(string value,string local,bool staging=false){
  if(value!=null)foreach(string part in value.Split('\\','/'))if(part.EndsWith(".")||part.EndsWith(" "))throw new IOException("INVALID_PATH");
  string root=SetupBootstrapperCore.CanonicalRoot(value);if(!staging&&root.Length>180)throw new IOException("PATH_TOO_LONG");
  foreach(char c in root)if(Char.IsControl(c)||c=='"'||c=='*'||c=='?'||c=='<'||c=='>'||c=='|')throw new IOException("INVALID_PATH");
  foreach(string part in root.Substring(3).Split('\\')){if(part.Length==0||part.EndsWith(".")||part.EndsWith(" ")||part.Contains(":"))throw new IOException("INVALID_PATH");}
  string data=Path.GetFullPath(Path.Combine(local,"SarevocsCCUPlaner-Daten"));
  string legacy=Path.GetFullPath(Path.Combine(local,"SarevocsCCUPlaner"));
  if(Within(root,Environment.GetFolderPath(Environment.SpecialFolder.Windows))||Within(root,data)||Within(data,root)||Within(root,legacy)||Within(legacy,root))throw new IOException("PROTECTED_DIRECTORY");
  SetupBootstrapperCore.ValidateProgramTree(root);if(File.Exists(root))throw new IOException("TARGET_IS_FILE");
  if(staging&&(!Directory.Exists(root)||Directory.GetFileSystemEntries(root).Length!=0))throw new IOException("STAGING_NOT_EMPTY");
  if(Directory.Exists(root)&&Directory.GetFileSystemEntries(root).Length!=0){string marker=Path.Combine(root,"install-product.txt");SetupBootstrapperCore.RejectReparseParents(marker);if(!File.Exists(marker)||new FileInfo(marker).Length>100||File.ReadAllText(marker).Trim()!=ProductMarker||(!File.Exists(Path.Combine(root,SetupBootstrapperCore.ExecutableName))&&!File.Exists(Path.Combine(root,"SetupGuard.exe"))))throw new IOException("DIRECTORY_NOT_EMPTY");}
  return root;
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
