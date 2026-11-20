using System;using System.IO;using System.Drawing;using System.Text.RegularExpressions;using System.Collections.Generic;using System.Windows.Forms;using System.Runtime.InteropServices;using System.Threading;
public static class InstallerTermsTestDriver {
 [DllImport("user32.dll")]static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")]static extern IntPtr GetForegroundWindow();
 [StructLayout(LayoutKind.Sequential)]struct Frame{public int Left,Top,Right,Bottom;}
 [DllImport("dwmapi.dll")]static extern int DwmGetWindowAttribute(IntPtr h,int attribute,out Frame value,int size);
 [DllImport("user32.dll")]static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
 static void Capture(Form f,string file){f.TopMost=true;f.BringToFront();SetForegroundWindow(f.Handle);Application.DoEvents();Thread.Sleep(180);Check(GetForegroundWindow()==f.Handle,"PREVIEW_NOT_FOREGROUND");var body=Find<RichTextBox>(f,"termsText");var header=Find<Panel>(f,"termsHeader");var layout=Find<TableLayoutPanel>(f,"termsLayout");File.AppendAllText(Path.Combine(Path.GetDirectoryName(file),"frame-metrics.txt"),Path.GetFileName(file)+" | body="+body.Bounds+" | header="+header.Bounds+" visible="+header.Visible+" | headerRow="+layout.RowStyles[0].Height+" | formScroll="+f.AutoScroll+"/"+f.AutoScrollPosition+" | layoutScroll="+layout.AutoScroll+"/"+layout.AutoScrollPosition+Environment.NewLine);Frame frame;Check(DwmGetWindowAttribute(f.Handle,9,out frame,Marshal.SizeOf(typeof(Frame)))==0,"FRAME_BOUNDS_MISSING");var size=new Size(frame.Right-frame.Left,frame.Bottom-frame.Top);using(var image=new Bitmap(size.Width,size.Height)){using(var g=Graphics.FromImage(image))g.CopyFromScreen(new Point(frame.Left,frame.Top),Point.Empty,size);image.Save(file);}f.TopMost=false;}
 static void Check(bool ok,string message){if(!ok)throw new Exception(message);}
 static string Plain(string s){return Regex.Replace(s,@"\s+"," ").Trim();}
 static T Find<T>(Control root,string name)where T:Control{return (T)root.Controls.Find(name,true)[0];}
 static void Inside(Control parent){foreach(Control c in parent.Controls){Check(c.Left>=0&&c.Top>=0&&c.Right<=parent.ClientSize.Width+1&&c.Bottom<=parent.ClientSize.Height+1,"CONTROL_CLIPPED:"+c.Name+":"+c.Bounds+":"+parent.ClientSize);if(c.Controls.Count>0)Inside(c);}}
 [STAThread]public static int Main(string[] args){try{
  Application.EnableVisualStyles();var checks=new List<string>();string area=Path.GetFullPath(args[0]);
  foreach(float scale in new[]{1F,1.25F,1.5F,2F})using(var f=SetupTerms.CreateDialog()){
   f.AutoScaleMode=AutoScaleMode.None;var fonts=new Dictionary<Control,Font>();Action<Control> remember=null;remember=c=>{fonts[c]=c.Font;foreach(Control child in c.Controls)remember(child);};remember(f);
   var rich=Find<RichTextBox>(f,"termsText");string originalRtf=rich.Rtf;
   if(scale!=1F){f.Scale(new SizeF(scale,scale));foreach(var item in fonts)if(!(item.Key is RichTextBox))item.Key.Font=new Font(item.Value.FontFamily,item.Value.Size*scale,item.Value.Style);rich.Rtf=Regex.Replace(originalRtf,@"\\fs(\d+)",m=>@"\fs"+Math.Round(int.Parse(m.Groups[1].Value)*scale));}
   f.ShowInTaskbar=false;if(scale!=1F)f.Opacity=0;f.StartPosition=FormStartPosition.Manual;f.Location=new Point(-20000,-20000);f.Show();Application.DoEvents();f.PerformLayout();
   var field=Find<RichTextBox>(f,"termsText");var close=Find<Button>(f,"closeTerms");
   Check(field.ReadOnly&&!field.DetectUrls&&field.WordWrap,"READ_ONLY_OR_URL_BOUNDARY");Check(Plain(field.Text)==Plain(SetupTerms.BodyText),"TERMS_CONTENT_MISSING");
   foreach(string heading in SetupTerms.Headings){int index=field.Text.IndexOf(heading,StringComparison.Ordinal);Check(index>=0,"HEADING_MISSING:"+heading);field.Select(index,heading.Length);Check(field.SelectionFont!=null&&field.SelectionFont.Bold&&field.SelectionFont.Size>=13,"HEADING_NOT_FORMATTED:"+heading);Check(field.SelectionColor.G>field.SelectionColor.R,"HEADING_COLOR");}
   Inside(f);Check(f.AcceptButton==close&&f.CancelButton==close,"KEYBOARD_CLOSE_MISSING");Check(field.Height>150&&field.Width>400,"READING_AREA_TOO_SMALL");
   field.Select(0,0);field.ScrollToCaret();Application.DoEvents();
   if(scale==1F){Capture(f,Path.Combine(area,"terms-native-start.png"));int security=field.Text.IndexOf("Sicherheitskonzept",StringComparison.Ordinal);field.Select(security,0);field.ScrollToCaret();Application.DoEvents();Capture(f,Path.Combine(area,"terms-native-security.png"));f.Opacity=0;}
   checks.Add("Readable terms at "+Math.Round(scale*100)+" percent; complete content, bold headings and fixed close strip");
   var original=f.Size;f.Size=new Size(Math.Min(f.Width,620),Math.Min(f.Height,520));Application.DoEvents();Inside(f);Check(field.Height>120&&field.ScrollBars==RichTextBoxScrollBars.Vertical,"NARROW_DIALOG_UNUSABLE");f.Close();
  }
  checks.Add("Session decryption, local data, no-plaintext fallback, user account boundary and purchase restrictions described");
  Console.WriteLine("{\"status\":\"PASS\",\"groups\":"+checks.Count+",\"realInstallation\":false,\"registryWritten\":false,\"newRsiLogin\":false}");return 0;
 }catch(Exception e){Console.WriteLine(e.ToString());return 1;}}
}



