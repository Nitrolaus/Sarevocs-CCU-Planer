using System;using System.Diagnostics;using System.IO;using System.Threading;
public static class UninstallGuard {
 [STAThread]public static int Main(string[] args){try{
  if(args.Length<2)return 1;
  string local=Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
  string root=args[0]=="--guard"||args[0]=="--remove-shortcuts"
   ? InstallLocation.ValidateUninstall(args[1],local)
   : InstallLocation.Validate(args[1],local,args[0]=="--validate-stage"&&args.Length==2);
  if(args[0]=="--validate-stage"&&args.Length==2)return 0;
  if(args[0]=="--validate")return 0;
  if(args[0]=="--remove-shortcuts"&&args.Length==2){
   if(String.Equals(root,InstallLocation.RegisteredRoot(),StringComparison.OrdinalIgnoreCase))
    InstallLocation.RemoveOwnShortcuts(root,Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs),"Sarevoc"));
   return 0;
  }
  if(args[0]!="--guard"||args.Length!=4||!File.Exists(Path.Combine(root,"install-product.txt")))return 1;
  using(var parent=Process.GetProcessById(Int32.Parse(args[2]))){
   using(SetupBootstrapperCore.AcquireInstallLock(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"SarevocsCCUPlaner"))){
    bool closed=SetupBootstrapperCore.CloseOwnProcesses(root).Success;
    if(closed)InstallLocation.ValidateUninstall(root,local);
    File.WriteAllText(args[3]+".tmp",closed?"READY":"CLOSE_FAILED");File.Move(args[3]+".tmp",args[3]);if(!closed)return 1;parent.WaitForExit();
   }
  }return 0;
 }catch{return 1;}}
}
