using System;using System.IO;using System.Reflection;using System.Collections.Generic;
public static class InstallerProgressTestDriver {
 [STAThread]public static int Main(string[] args){try{
  string area=Path.GetFullPath(args[0]),status=Path.Combine(area,"copy-progress.txt");File.WriteAllText(status,"0");var seen=new List<int>();
  var method=typeof(SelectableSetup).GetMethod("RunChild",BindingFlags.NonPublic|BindingFlags.Static);
  int exit=(int)method.Invoke(null,new object[]{Path.Combine(area,"probe.exe"),"/S",area,status,(Action<int>)(p=>{if(!seen.Contains(p))seen.Add(p);})});
  if(exit!=0||!seen.Contains(25)||!seen.Contains(75)||!seen.Contains(100)||!File.Exists(Path.Combine(area,"Sarevoc´s probe.txt")))throw new Exception("PROGRESS_OR_UTF8_FAILED: "+String.Join(",",seen));
  Console.WriteLine("{\"status\":\"PASS\",\"nsisToNativeProgress\":true,\"unicodeFilename\":true,\"realInstallation\":false}");return 0;
 }catch(Exception error){Console.WriteLine(error.ToString());return 1;}}
}
