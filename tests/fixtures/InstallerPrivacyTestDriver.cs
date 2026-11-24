using System;using System.IO;using System.Drawing;using System.Collections.Generic;using System.Runtime.InteropServices;using System.Windows.Forms;
public static class InstallerPrivacyTestDriver {
 [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
 static extern IntPtr CreateDesktop(string name, string device, IntPtr mode, uint flags, uint access, IntPtr attributes);
 [DllImport("user32.dll",SetLastError=true)]
 static extern bool SetThreadDesktop(IntPtr desktop);
 static void Check(bool ok,string code){if(!ok)throw new Exception(code);}
 public static int Main(string[] args){try{
  // The preview has its own temporary desktop so the test cannot take focus from the user's applications.
  IntPtr desktop=CreateDesktop("CCU_Preview_"+Guid.NewGuid().ToString("N"),null,IntPtr.Zero,0,0x0087,IntPtr.Zero);
  Check(desktop!=IntPtr.Zero&&SetThreadDesktop(desktop),"PREVIEW_DESKTOP_UNAVAILABLE_"+Marshal.GetLastWin32Error());
  string area=Path.GetFullPath(args[0]),version=args[1];Application.EnableVisualStyles();
  var checks=new List<string>();var geometry=new List<string>();
  foreach(float scale in new[]{1F,1.25F,1.5F,2F})using(var window=new SetupWindow(@"C:\SYNTHETISCH\Planer","0.3.81",version)){
   window.AutoScaleMode=AutoScaleMode.None;var fonts=new Dictionary<Control,Font>();foreach(Control c in window.Controls)fonts[c]=c.Font;
   if(scale!=1F){window.Scale(new SizeF(scale,scale));foreach(var entry in fonts)entry.Key.Font=new Font(entry.Value.FontFamily,entry.Value.Size*scale,entry.Value.Style);}
   window.Opacity=0;window.ShowInTaskbar=false;window.StartPosition=FormStartPosition.Manual;window.Location=new Point(-20000,-20000);window.Show();Application.DoEvents();window.PerformLayout();
   foreach(Control c in window.Controls){Check(c.Right<=window.ClientSize.Width&&c.Bottom<=window.ClientSize.Height,"CONTROL_CLIPPED");geometry.Add(scale+" | "+c.Name+" | Bounds="+c.Bounds+" | Parent="+c.Parent.ClientRectangle+" | Screen="+c.RectangleToScreen(c.ClientRectangle));}
   var flags=TextFormatFlags.WordBreak|TextFormatFlags.TextBoxControl|TextFormatFlags.NoPrefix;
   Size needed=TextRenderer.MeasureText(window.DataInfo.Text,window.DataInfo.Font,new Size(window.DataInfo.Width,10000),flags);
   Check(needed.Height<=window.DataInfo.Height,"PRIVACY_TEXT_CLIPPED_"+scale+"_"+needed.Height+"_"+window.DataInfo.Height);geometry.Add(scale+" | Privacy text required="+needed.Height+" | Available="+window.DataInfo.Height);
   Check(window.Next.Top==window.CancelAction.Top&&window.Next.Height==window.CancelAction.Height,"BUTTON_STRIP_MISALIGNED");
   Check(window.DataInfo.Bottom<window.TermsLink.Top&&window.TermsLink.Bottom<window.AcceptTerms.Top&&window.AcceptTerms.Bottom<window.Next.Top&&window.DataHeading.Bottom<window.DataInfo.Top,"OVERLAPPING_CONTROLS");
   var consent=window.AcceptTerms;
   Check(consent.Appearance==Appearance.Normal&&consent.AutoCheck&&consent.Height==window.Next.Height&&consent.Font.Bold,"CONSENT_TARGET_SIZE");
   Check(consent.ForeColor.R>120&&consent.Text=="Nutzungsbedingungen akzeptieren","CONSENT_TARGET_STYLE");
   var labelSize=TextRenderer.MeasureText(consent.Text,consent.Font);
   Check(labelSize.Width+32*scale<consent.Width&&labelSize.Height<consent.Height,"CONSENT_LABEL_CLIPPED_"+scale);
   using(var mark=new Bitmap(consent.Width,consent.Height)){
    consent.DrawToBitmap(mark,new Rectangle(Point.Empty,mark.Size));
    int side=(int)Math.Round(22*scale),top=(mark.Height-side)/2;
    Check(mark.GetPixel(0,top+2).ToArgb()==consent.ForeColor.ToArgb()&&
     mark.GetPixel(side-1,top+2).ToArgb()==consent.ForeColor.ToArgb(),"CHECKBOX_MARK_TOO_SMALL_"+scale);
   }
   Check(window.BackColor.R<40&&window.DataInfo.ForeColor.R>180,"DARK_READABLE_PRIVACY");
   string text=window.DataInfo.Text;Check(text.Contains("Bestand")&&text.Contains("Planungen")&&text.Contains("Einstellungen")&&SetupTerms.Text.Contains("Preis-/Guthabenstände"),"LOCAL_DATA_MISSING");
   Check(text.Contains("Passwort und MFA")&&text.Contains("direkt bei RSI")&&text.Contains("speichert diese Eingaben nicht"),"PASSWORD_DESCRIPTION");
   Check(text.Contains("Windows-verschlüsselt")&&text.Contains("Planer sie zum Lesen wiederverwenden"),"SESSION_ACCESS_MISREPRESENTED");
   Check(text.Contains("Käufe")&&text.Contains("Upgrades")&&text.Contains("Geschenke")&&text.Contains("Einschmelzen")&&text.Contains("gesperrt"),"READ_ONLY_ACTIONS_MISSING");
   int requests=0;window.InstallRequested+=delegate{requests++;};Check(!window.AcceptTerms.Checked&&!window.Next.Enabled&&window.Next.BackColor.R<50,"CONSENT_PRESELECTED");window.Next.PerformClick();Check(requests==0,"CONSENT_BYPASSED");
   Check(window.Folder.Text==@"C:\SYNTHETISCH\Planer","PREVIEW_PATH_ALTERED");
   using(var terms=SetupTerms.CreateDialog()){var field=(RichTextBox)terms.Controls.Find("termsText",true)[0];Check(field.ReadOnly&&!field.DetectUrls&&field.Text.Contains("Sicherheitskonzept")&&!window.AcceptTerms.Checked,"OPENING_TERMS_ACCEPTED");}
   window.AcceptTerms.Checked=true;Check(window.Next.Enabled&&window.Next.BackColor.R>120&&consent.CheckState==CheckState.Checked,"CONSENT_NOT_ENABLED");
   if(scale==1F){using(var picture=new Bitmap(window.Width,window.Height)){window.DrawToBitmap(picture,new Rectangle(Point.Empty,picture.Size));picture.Save(Path.Combine(area,"installer-accepted.png"));}}
   window.Next.PerformClick();Check(requests==1,"CONSENT_EVENT");window.AcceptTerms.Checked=false;Check(!window.Next.Enabled,"WITHDRAWN_CONSENT_IGNORED");
   if(scale==1F){using(var picture=new Bitmap(window.Width,window.Height)){window.DrawToBitmap(picture,new Rectangle(Point.Empty,picture.Size));picture.Save(Path.Combine(area,"installer-privacy.png"));}}
   window.SetBusy("Synthetische Fortschrittsprüfung",50);Application.DoEvents();Check(window.DataInfo.Visible&&!window.Next.Enabled,"INFO_DURING_PROGRESS");
   window.SetFinished(true,"");Application.DoEvents();Check(window.DataInfo.Visible&&window.DataInfo.Text==text&&window.Next.Enabled&&window.Next.Text=="Schließen","INFO_DURING_FINISH");
   if(scale==1F){using(var picture=new Bitmap(window.Width,window.Height)){window.DrawToBitmap(picture,new Rectangle(Point.Empty,picture.Size));picture.Save(Path.Combine(area,"installer-privacy-finished.png"));}}
   checks.Add("Scaled installer layout "+Math.Round(scale*100)+" percent fits all text without overlap");window.Close();
  }
  checks.Add("Local data, password/MFA boundary and decryptable Windows-protected session described honestly");
  checks.Add("Read-only purchase, apply, gift and reclaim restrictions visible throughout installation");
  string parent=Path.Combine(area,"Meine Programme"),suggested=Path.Combine(parent,"CCU_Planer");
  using(var fresh=new SetupWindow("",null,version)){
   Check(fresh.Folder.Text==""&&!fresh.Next.Enabled,"FRESH_PATH_NOT_EMPTY");
   fresh.ApplyBrowsedFolder(parent);
   Check(fresh.Folder.Text==suggested&&!Directory.Exists(suggested)&&!fresh.Next.Enabled,"FRESH_FOLDER_NOT_SUGGESTED");
   fresh.ApplyBrowsedFolder(suggested);
   Check(fresh.Folder.Text==suggested,"FRESH_FOLDER_DOUBLED");
   string existingName=Path.Combine(parent,"ccu_planer")+Path.DirectorySeparatorChar;
   fresh.ApplyBrowsedFolder(existingName);
   Check(fresh.Folder.Text==existingName,"FRESH_FOLDER_CASE_OR_SEPARATOR");
   string edited=Path.Combine(parent,"Eigener Programmordner");
   fresh.Folder.Text=edited;
   Check(fresh.Folder.Text==edited&&!Directory.Exists(edited),"FRESH_FOLDER_EDIT_NOT_PRESERVED");
   checks.Add("Fresh install suggests CCU_Planer only after browsing, with an editable path and no doubled suffix");
  }
  using(var installed=new SetupWindow(suggested,"0.3.82",version)){
   Check(installed.Folder.Text==suggested,"UPDATE_LOST_INSTALLED_FOLDER");
   installed.ApplyBrowsedFolder(parent);
   Check(installed.Folder.Text==parent,"UPDATE_APPENDED_FRESH_SUFFIX");
   Directory.CreateDirectory(suggested);
   installed.ApplyBrowsedFolder(parent);
   Check(installed.Folder.Text==suggested,"BROWSING_REGISTERED_PARENT_LOST_INSTALLATION");
   string safeSibling=Path.Combine(parent,"CCU_Planer-2");
   installed.ShowPathError("Ordnerrechte",safeSibling,true);
   installed.ApplyBrowsedFolder(parent);
   Check(installed.Folder.Text==safeSibling,"BROWSING_PARENT_RESELECTED_REJECTED_FOLDER");
   installed.ApplyBrowsedFolder(@"R:\");
   Check(installed.Folder.Text==@"R:\CCU_Planer","DRIVE_ROOT_MUST_SUGGEST_FOLDER_ON_SAME_DRIVE");
   checks.Add("Updates preserve the registered path and respect explicitly selected alternatives");
  }
  File.WriteAllLines(Path.Combine(area,"geometry.txt"),geometry);Console.WriteLine("{\"status\":\"PASS\",\"groups\":"+checks.Count+",\"checks\":[\""+String.Join("\",\"",checks)+"\"],\"realInstallation\":false,\"realUserDataRead\":false,\"newRsiLogin\":false}");return 0;
 }catch(Exception e){Console.WriteLine(e.ToString());return 1;}}
}
