using System;using System.IO;using System.Drawing;using System.Collections.Generic;using System.Windows.Forms;
public static class InstallerPrivacyTestDriver {
 static void Check(bool ok,string code){if(!ok)throw new Exception(code);}
 [STAThread]public static int Main(string[] args){try{
  string area=Path.GetFullPath(args[0]),version=args[1];Application.EnableVisualStyles();
  var checks=new List<string>();var geometry=new List<string>();
  foreach(float scale in new[]{1F,1.25F,1.5F,2F})using(var window=new SetupWindow(@"C:\SYNTHETISCH\Planer","0.3.42",version)){
   window.AutoScaleMode=AutoScaleMode.None;var fonts=new Dictionary<Control,Font>();foreach(Control c in window.Controls)fonts[c]=c.Font;
   if(scale!=1F){window.Scale(new SizeF(scale,scale));foreach(var entry in fonts)entry.Key.Font=new Font(entry.Value.FontFamily,entry.Value.Size*scale,entry.Value.Style);}
   window.Opacity=0;window.ShowInTaskbar=false;window.StartPosition=FormStartPosition.Manual;window.Location=new Point(-20000,-20000);window.Show();Application.DoEvents();window.PerformLayout();
   foreach(Control c in window.Controls){Check(c.Right<=window.ClientSize.Width&&c.Bottom<=window.ClientSize.Height,"CONTROL_CLIPPED");geometry.Add(scale+" | "+c.Name+" | Bounds="+c.Bounds+" | Parent="+c.Parent.ClientRectangle+" | Screen="+c.RectangleToScreen(c.ClientRectangle));}
   var flags=TextFormatFlags.WordBreak|TextFormatFlags.TextBoxControl|TextFormatFlags.NoPrefix;
   Size needed=TextRenderer.MeasureText(window.DataInfo.Text,window.DataInfo.Font,new Size(window.DataInfo.Width,10000),flags);
   Check(needed.Height<=window.DataInfo.Height,"PRIVACY_TEXT_CLIPPED_"+scale+"_"+needed.Height+"_"+window.DataInfo.Height);geometry.Add(scale+" | Privacy text required="+needed.Height+" | Available="+window.DataInfo.Height);
   Check(window.Next.Top==window.CancelAction.Top&&window.Next.Height==window.CancelAction.Height,"BUTTON_STRIP_MISALIGNED");
   Check(window.DataInfo.Bottom<window.TermsLink.Top&&window.TermsLink.Bottom<window.AcceptTerms.Top&&window.AcceptTerms.Bottom<window.Next.Top&&window.DataHeading.Bottom<window.DataInfo.Top,"OVERLAPPING_CONTROLS");
   Check(window.BackColor.R<40&&window.DataInfo.ForeColor.R>180,"DARK_READABLE_PRIVACY");
   string text=window.DataInfo.Text;Check(text.Contains("Bestand")&&text.Contains("Planungen")&&text.Contains("Einstellungen")&&SetupTerms.Text.Contains("Preis-/Guthabenstände"),"LOCAL_DATA_MISSING");
   Check(text.Contains("Passwort und MFA")&&text.Contains("direkt bei RSI")&&text.Contains("speichert diese Eingaben nicht"),"PASSWORD_DESCRIPTION");
   Check(text.Contains("Windows-verschlüsselt")&&text.Contains("Planer sie zum Lesen wiederverwenden"),"SESSION_ACCESS_MISREPRESENTED");
   Check(text.Contains("Käufe")&&text.Contains("Upgrades")&&text.Contains("Geschenke")&&text.Contains("Einschmelzen")&&text.Contains("gesperrt"),"READ_ONLY_ACTIONS_MISSING");
   int requests=0;window.InstallRequested+=delegate{requests++;};Check(!window.AcceptTerms.Checked&&!window.Next.Enabled,"CONSENT_PRESELECTED");window.Next.PerformClick();Check(requests==0,"CONSENT_BYPASSED");
   using(var terms=SetupTerms.CreateDialog()){var field=(RichTextBox)terms.Controls.Find("termsText",true)[0];Check(field.ReadOnly&&!field.DetectUrls&&field.Text.Contains("Sicherheitskonzept")&&!window.AcceptTerms.Checked,"OPENING_TERMS_ACCEPTED");}
   window.AcceptTerms.Checked=true;Check(window.Next.Enabled,"CONSENT_NOT_ENABLED");window.Next.PerformClick();Check(requests==1,"CONSENT_EVENT");window.AcceptTerms.Checked=false;Check(!window.Next.Enabled,"WITHDRAWN_CONSENT_IGNORED");
   if(scale==1F){using(var picture=new Bitmap(window.Width,window.Height)){window.DrawToBitmap(picture,new Rectangle(Point.Empty,picture.Size));picture.Save(Path.Combine(area,"installer-privacy.png"));}}
   window.SetBusy("Synthetische Fortschrittsprüfung",50);Application.DoEvents();Check(window.DataInfo.Visible&&!window.Next.Enabled,"INFO_DURING_PROGRESS");
   window.SetFinished(true,"");Application.DoEvents();Check(window.DataInfo.Visible&&window.DataInfo.Text==text&&window.Next.Enabled&&window.Next.Text=="Schließen","INFO_DURING_FINISH");
   if(scale==1F){using(var picture=new Bitmap(window.Width,window.Height)){window.DrawToBitmap(picture,new Rectangle(Point.Empty,picture.Size));picture.Save(Path.Combine(area,"installer-privacy-finished.png"));}}
   checks.Add("Scaled installer layout "+Math.Round(scale*100)+" percent fits all text without overlap");window.Close();
  }
  checks.Add("Local data, password/MFA boundary and decryptable Windows-protected session described honestly");
  checks.Add("Read-only purchase, apply, gift and reclaim restrictions visible throughout installation");
  using(var fresh=new SetupWindow("",null,version)){Check(fresh.Folder.Text==""&&!fresh.Next.Enabled,"FRESH_PATH_NOT_EMPTY");checks.Add("Fresh install keeps empty path and requires user folder selection");}
  File.WriteAllLines(Path.Combine(area,"geometry.txt"),geometry);Console.WriteLine("{\"status\":\"PASS\",\"groups\":"+checks.Count+",\"checks\":[\""+String.Join("\",\"",checks)+"\"],\"realInstallation\":false,\"realUserDataRead\":false,\"newRsiLogin\":false}");return 0;
 }catch(Exception e){Console.WriteLine(e.ToString());return 1;}}
}
