using System;using System.IO;using System.Drawing;using System.Windows.Forms;using System.Reflection;
public static class InstallLocationTestDriver {
 static void Check(bool value,string code){if(!value)throw new Exception(code);}
 static void Refuses(string value,string local){bool refused=false;try{InstallLocation.Validate(value,local);}catch{refused=true;}Check(refused,"ACCEPTED_UNSAFE_PATH: "+value);}
 [STAThread]public static int Main(string[] args){try{
  string area=Path.GetFullPath(args[0]),local=Path.Combine(area,"Local"),target=Path.Combine(area,"Meine Programme","Planer Test");Directory.CreateDirectory(local);
  Check(InstallLocation.InitialRoot(null)==""&&InstallLocation.InitialRoot("")=="","FRESH_FOLDER_REQUIRES_SELECTION");
  Check(InstallLocation.InitialRoot(target)==target,"UPDATE_USES_REGISTERED_PATH");
  Refuses("",local);
  Check(InstallLocation.Validate(target,local)==target,"CUSTOM_PATH_WITH_SPACES");Check(!Directory.Exists(target),"VALIDATION_CREATED_FOLDER");
  foreach(string bad in new[]{@"C:\",@"\\server\share\Planer","relative\\Planer",Path.Combine(local,"SarevocsCCUPlaner-Daten"),Path.Combine(local,"SarevocsCCUPlaner-Daten","Anmeldung"),local,Path.Combine(local,"SarevocsCCUPlaner"),Environment.GetFolderPath(Environment.SpecialFolder.Windows),target+".",target+" ",target+"\nmore",target+":stream"})Refuses(bad,local);
  string foreign=Path.Combine(area,"foreign");Directory.CreateDirectory(foreign);File.WriteAllText(Path.Combine(foreign,"keep.txt"),"SYNTHETIC_KEEP");Refuses(foreign,local);Check(File.ReadAllText(Path.Combine(foreign,"keep.txt"))=="SYNTHETIC_KEEP","FOREIGN_CHANGED");
  Directory.CreateDirectory(target);File.WriteAllText(Path.Combine(target,"install-product.txt"),InstallLocation.ProductMarker);File.WriteAllText(Path.Combine(target,SetupBootstrapperCore.ExecutableName),"SYNTHETIC");Check(InstallLocation.Validate(target,local)==target,"OWN_UPDATE_ROOT");
  foreach(string bad in new[]{args[1],args[2],args[3]})Refuses(bad,local);
  string legacy=Path.Combine(area,"SyntheticLegacy");Directory.CreateDirectory(legacy);
  Check(!SelectableSetup.HasLegacyInstallation(legacy),"NO_LEGACY_UPDATER");
  File.WriteAllText(Path.Combine(legacy,"Update.exe"),"SYNTHETIC_ORPHAN_DO_NOT_EXECUTE");
  Check(!SelectableSetup.HasLegacyInstallation(legacy),"ORPHAN_UPDATER_IS_NOT_AN_INSTALLATION");
  string oldApp=Path.Combine(legacy,"app-0.3.34");Directory.CreateDirectory(oldApp);
  Check(!SelectableSetup.HasLegacyInstallation(legacy),"EMPTY_APP_FOLDER_IS_NOT_AN_INSTALLATION");
  File.WriteAllText(Path.Combine(oldApp,SetupBootstrapperCore.ExecutableName),"SYNTHETIC_APPLICATION");
  Check(SelectableSetup.HasLegacyInstallation(legacy),"REAL_LEGACY_PAYLOAD_MUST_BE_CLEANED");
  Check(File.ReadAllText(Path.Combine(legacy,"Update.exe"))=="SYNTHETIC_ORPHAN_DO_NOT_EXECUTE","LEGACY_PROBE_CHANGED_FILE");
  File.WriteAllText(Path.Combine(oldApp,"keep.txt"),"KEEP");
  SelectableSetup.CleanLegacyFiles(legacy,new[]{SetupBootstrapperCore.ExecutableName});
  Check(!File.Exists(Path.Combine(legacy,"Update.exe"))&&!File.Exists(Path.Combine(oldApp,SetupBootstrapperCore.ExecutableName)),"LEGACY_PROGRAM_REMAINS");
  Check(File.ReadAllText(Path.Combine(oldApp,"keep.txt"))=="KEEP","FOREIGN_LEGACY_FILE_CHANGED");
  string moved=Path.Combine(area,"old selectable");Directory.CreateDirectory(moved);
  File.WriteAllText(Path.Combine(moved,"install-product.txt"),InstallLocation.ProductMarker);
  File.WriteAllText(Path.Combine(moved,SetupBootstrapperCore.ExecutableName),"SYNTHETIC");
  File.WriteAllText(Path.Combine(moved,"Uninstall.exe"),"SYNTHETIC_DO_NOT_RUN");
  File.WriteAllText(Path.Combine(moved,"install-files.json"),"{\"files\":[{\"file\":\"keep.txt\"}]}");
  File.WriteAllText(Path.Combine(moved,"keep.txt"),"KEEP");
  bool overlapRejected=false;try{SelectableSetup.CleanPrevious(moved,local,Path.Combine(moved,"nested"),new[]{SetupBootstrapperCore.ExecutableName});}catch(IOException){overlapRejected=true;}Check(overlapRejected&&File.Exists(Path.Combine(moved,"Uninstall.exe")),"MOVE_OVERLAP");
  SelectableSetup.CleanPrevious(moved,local,target,new[]{SetupBootstrapperCore.ExecutableName});
  Check(!File.Exists(Path.Combine(moved,"Uninstall.exe"))&&!File.Exists(Path.Combine(moved,SetupBootstrapperCore.ExecutableName))&&File.ReadAllText(Path.Combine(moved,"keep.txt"))=="KEEP","SCOPED_MOVE_CLEANUP");
  Application.EnableVisualStyles();using(Form f=InstallLocation.CreateForm(target)){
   f.Opacity=0;f.ShowInTaskbar=false;f.Shown+=delegate{
    foreach(float scale in new[]{1F,1.25F}){if(scale!=1F)f.Scale(new SizeF(scale,scale));f.PerformLayout();foreach(Control c in f.Controls)Check(c.Right<=f.ClientSize.Width&&c.Bottom<=f.ClientSize.Height,"CLIPPED_CONTROL");var field=(TextBox)f.Controls.Find("folder",true)[0];Check(field.BackColor.R<40&&field.ForeColor.R>200,"DARK_FIELD");foreach(string name in new[]{"browse","cancel"}){var b=(Button)f.Controls.Find(name,true)[0];Check(b.FlatStyle==FlatStyle.Flat&&b.BackColor.R<50,"DARK_BUTTON");}using(var image=new Bitmap(f.Width,f.Height)){f.DrawToBitmap(image,new Rectangle(Point.Empty,image.Size));image.Save(Path.Combine(area,scale==1F?"folder-100.png":"folder-125.png"));}}
    f.Close();};Application.Run(f);
  }
  using(var window=new SetupWindow("",null,"0.3.37")){Check(window.Folder.Text==""&&!window.Next.Enabled,"FRESH_INSTALL_BUTTON");}
  using(var window=new SetupWindow(target,"0.3.36","0.3.37")){
   window.Opacity=0;window.ShowInTaskbar=false;window.Shown+=delegate{
    Check(window.Hint.Text.Contains("0.3.36")&&window.Hint.Text.Contains("0.3.37"),"UPDATE_VERSION_HINT");
    window.ShowPathError("Ordner prüfen");
    Check(window.Folder.Text==target&&window.Note.Text=="Ordner prüfen"&&window.Hint.Text.Contains("0.3.36"),"PATH_ERROR_KEEPS_UPDATE_CONTEXT");
    window.Folder.Text=target+" neu";
    Check(!window.Note.Text.Contains("Ordner prüfen"),"PATH_ERROR_CLEARS_ON_EDIT");
    window.SetBusy("Programmdateien kopieren · 61 %",61);Application.DoEvents();Check(!window.Next.Enabled&&!window.CancelAction.Enabled,"BUSY_ACTIONS");
    var bar=window.Controls.Find("progress",true)[0];using(var picture=new Bitmap(bar.Width,bar.Height)){bar.DrawToBitmap(picture,new Rectangle(Point.Empty,picture.Size));int filled=0;for(int x=1;x<bar.Width-1;x++){var c=picture.GetPixel(x,bar.Height/2);if(c.R==132&&c.G==217&&c.B==197)filled++;}Check(filled>bar.Width*0.59&&filled<bar.Width*0.63,"REAL_BAR_FILL");}
    window.Close();Check(!window.IsDisposed,"BUSY_CLOSE_BLOCKED");window.SetFinished(true,"");Check(window.Next.Enabled&&window.Next.Text=="Schließen"&&window.Heading.Text=="Update abgeschlossen","DARK_COMPLETION");Check(window.BackColor.R<40,"DARK_COMPLETION_COLOR");window.Next.PerformClick();
   };Application.Run(window);
  }
  string desktop=Path.Combine(area,"SyntheticDesktop"),menu=Path.Combine(area,"SyntheticMenu");Directory.CreateDirectory(desktop);Directory.CreateDirectory(menu);
  Type seedType=Type.GetTypeFromProgID("WScript.Shell");object seedShell=Activator.CreateInstance(seedType);
  string foreignFile=Path.Combine(desktop,"Sarevoc fremd CCU Planer.lnk");
  foreach(string folder in new[]{desktop,menu})WriteLink(seedType,seedShell,Path.Combine(folder,"SarevocÂ´s CCU Planer.lnk"),Path.Combine(target,SetupBootstrapperCore.ExecutableName));
  WriteLink(seedType,seedShell,foreignFile,Path.Combine(area,"ForeignProgram",SetupBootstrapperCore.ExecutableName));string foreignBytes=Convert.ToBase64String(File.ReadAllBytes(foreignFile));
  SelectableSetup.CreateShortcuts(target,desktop,menu);
  Check(Convert.ToBase64String(File.ReadAllBytes(foreignFile))==foreignBytes,"FOREIGN_SHORTCUT_CHANGED");foreach(string folder in new[]{desktop,menu})Check(!File.Exists(Path.Combine(folder,"SarevocÂ´s CCU Planer.lnk")),"MOJIBAKE_DUPLICATE_REMAINS");
  Type t=Type.GetTypeFromProgID("WScript.Shell");object shell=Activator.CreateInstance(t);foreach(string folder in new[]{desktop,menu}){string file=Path.Combine(folder,"Sarevoc´s CCU Planer.lnk");Check(File.Exists(file),"SHORTCUT_MISSING");object link=t.InvokeMember("CreateShortcut",BindingFlags.InvokeMethod,null,shell,new object[]{file});string linkTarget=(string)link.GetType().InvokeMember("TargetPath",BindingFlags.GetProperty,null,link,null);Check(linkTarget.Equals(Path.Combine(target,SetupBootstrapperCore.ExecutableName),StringComparison.OrdinalIgnoreCase),"SHORTCUT_TARGET");}
  string sameName=Path.Combine(menu,"Sarevoc´s CCU Planer.lnk");
  WriteLink(seedType,seedShell,sameName,Path.Combine(foreign,SetupBootstrapperCore.ExecutableName));
  string foreignSameName=Convert.ToBase64String(File.ReadAllBytes(sameName));
  InstallLocation.RemoveOwnShortcuts(target,desktop,menu);
  Check(!File.Exists(Path.Combine(desktop,"Sarevoc´s CCU Planer.lnk"))&&Convert.ToBase64String(File.ReadAllBytes(sameName))==foreignSameName,"UNINSTALL_SHORTCUT_OWNERSHIP");
  Console.WriteLine("{\"status\":\"PASS\",\"groups\":17,\"realInstallation\":false,\"realUserDataRead\":false}");return 0;
 }catch(Exception e){Console.WriteLine(e.ToString());return 1;}}
 static void WriteLink(Type shellType,object shell,string file,string target){object link=shellType.InvokeMember("CreateShortcut",BindingFlags.InvokeMethod,null,shell,new object[]{file});link.GetType().InvokeMember("TargetPath",BindingFlags.SetProperty,null,link,new object[]{target});link.GetType().InvokeMember("Save",BindingFlags.InvokeMethod,null,link,null);}
}
