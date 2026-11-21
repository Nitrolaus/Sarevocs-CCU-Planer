using System;using System.Drawing;using System.IO;using System.Runtime.InteropServices;using System.Windows.Forms;
public sealed class SetupWindow:Form {
 public readonly TextBox Folder;public readonly Button Next,CancelAction;public readonly Label Heading,Hint,Note,Destination,DataHeading,DataInfo;
 readonly Button browse;readonly Label folderLabel;readonly SetupBar bar;bool busy,finished;readonly string targetVersion;readonly bool update;
 public readonly CheckBox AcceptTerms;public readonly LinkLabel TermsLink;
 public event Action InstallRequested;
 [DllImport("dwmapi.dll")]static extern int DwmSetWindowAttribute(IntPtr h,int a,ref int v,int n);
 public SetupWindow(string initial,string installed,string target){
  targetVersion=target;update=!String.IsNullOrEmpty(installed);Text="Sarevoc´s CCU Planer – Installation";Name="locationSetup";ClientSize=new Size(620,520);StartPosition=FormStartPosition.CenterScreen;FormBorderStyle=FormBorderStyle.FixedDialog;MaximizeBox=false;MinimizeBox=false;AutoScaleMode=AutoScaleMode.Dpi;Font=new Font("Segoe UI",10F);BackColor=Color.FromArgb(23,37,47);ForeColor=Color.FromArgb(237,242,245);
  Heading=new Label{Name="heading",Text=update?"Update installieren":"Installationsordner wählen",AutoSize=true,Location=new Point(25,23),Font=new Font("Segoe UI",16F,FontStyle.Bold)};
  Hint=new Label{Name="hint",Text=update?"Version "+installed+" vorhanden → "+target:"Bitte einen Programmordner auswählen.",AutoSize=true,Location=new Point(26,62),ForeColor=Color.FromArgb(157,180,193)};
  folderLabel=new Label{Text="Programmordner",AutoSize=true,Location=new Point(26,94)};
  Folder=new TextBox{Name="folder",Text=initial??"",Location=new Point(26,124),Size=new Size(438,27),BackColor=Color.FromArgb(16,29,38),ForeColor=ForeColor,BorderStyle=BorderStyle.FixedSingle};
  browse=Button("browse","Durchsuchen …",new Rectangle(476,121,118,34),false);
  Note=new Label{Name="note",Text="Bestand und geschützte Sitzung bleiben erhalten.",AutoSize=true,Location=new Point(26,173),ForeColor=Color.FromArgb(157,180,193)};
  Destination=new Label{Name="destination",Text=initial??"",Location=new Point(26,151),Size=new Size(568,22),AutoEllipsis=true,Visible=false};
  bar=new SetupBar{Name="progress",Location=new Point(26,116),Size=new Size(568,16),Visible=false};
  DataHeading=new Label{Name="dataHeading",Text="Dein Hangar bleibt in deiner Hand",UseMnemonic=false,AutoSize=true,Location=new Point(26,207),Font=new Font("Segoe UI",10F,FontStyle.Bold),ForeColor=Color.FromArgb(132,217,197)};
  DataInfo=new Label{Name="dataInfo",Location=new Point(26,236),Size=new Size(568,144),Text="• Der Planer liest deinen Hangar. Käufe, Upgrades, Geschenke und Einschmelzen sind hier gesperrt.\n• Passwort und MFA gibst du direkt bei RSI ein; der Planer speichert diese Eingaben nicht.\n• Auf Wunsch bleibt deine RSI-Sitzung Windows-verschlüsselt auf diesem PC gespeichert, damit der Planer sie zum Lesen wiederverwenden kann.\n• Bestand, Planungen und Einstellungen bleiben lokal in deinem Windows-Benutzerkonto.",ForeColor=Color.FromArgb(197,214,223)};
  CancelAction=Button("cancel","Abbrechen",new Rectangle(330,458,116,38),false);Next=Button("next",update?"Update installieren":"Installieren",new Rectangle(458,458,136,38),true);
  TermsLink=new LinkLabel{Name="termsLink",Text="Nutzungsbedingungen lesen",AutoSize=true,Location=new Point(26,389),LinkColor=Color.FromArgb(132,217,197),ActiveLinkColor=Color.White,VisitedLinkColor=Color.FromArgb(132,217,197)};
  AcceptTerms=new ConsentCheckBox {
   Name="acceptTerms",Text="Nutzungsbedingungen akzeptieren",AccessibleName="Nutzungsbedingungen akzeptieren",
   Bounds=new Rectangle(26,416,282,38),
   Font=new Font("Segoe UI",10F,FontStyle.Bold),ForeColor=Color.FromArgb(132,217,197),BackColor=BackColor,
   UseVisualStyleBackColor=false,FlatStyle=FlatStyle.Flat
  };
  TermsLink.LinkClicked+=delegate{using(var dialog=SetupTerms.CreateDialog())dialog.ShowDialog(this);};
  AcceptTerms.CheckedChanged+=delegate{if(!busy&&!finished)Next.Enabled=AcceptTerms.Checked&&!String.IsNullOrWhiteSpace(Folder.Text);};
  CancelAction.Click+=delegate{Close();};Next.Click+=delegate{if(finished)Close();else if(!busy&&AcceptTerms.Checked&&InstallRequested!=null)InstallRequested();};Folder.TextChanged+=delegate{Next.Enabled=AcceptTerms.Checked&&!String.IsNullOrWhiteSpace(Folder.Text);};
  Next.EnabledChanged+=delegate{
   Next.BackColor=Next.Enabled?Color.FromArgb(132,217,197):Color.FromArgb(38,53,63);
  };
  Next.Enabled=false;
  browse.Click+=delegate{using(var d=new FolderBrowserDialog()){d.Description="Programmordner für Sarevoc´s CCU Planer";d.SelectedPath=Folder.Text;if(d.ShowDialog(this)==DialogResult.OK)Folder.Text=d.SelectedPath;}};
  Controls.AddRange(new Control[]{Heading,Hint,folderLabel,Folder,browse,bar,Destination,Note,DataHeading,DataInfo,TermsLink,AcceptTerms,CancelAction,Next});AcceptButton=Next;CancelButton=CancelAction;
  Shown+=delegate{int dark=1;try{DwmSetWindowAttribute(Handle,20,ref dark,4);}catch{}Next.Focus();};FormClosing+=delegate(object s,FormClosingEventArgs e){if(busy&&e.CloseReason==CloseReason.UserClosing)e.Cancel=true;};
 }
 Button Button(string name,string text,Rectangle bounds,bool primary){var b=new Button{Name=name,Text=text,Bounds=bounds,BackColor=primary?Color.FromArgb(132,217,197):Color.FromArgb(31,49,62),ForeColor=primary?Color.FromArgb(15,41,39):ForeColor,FlatStyle=FlatStyle.Flat};b.FlatAppearance.BorderColor=Color.FromArgb(76,107,124);return b;}
 public void ShowPathError(){Hint.Text="Bitte einen eigenen, leeren Programmordner wählen.";}
 public void SetBusy(string phase,int percent){busy=true;AcceptTerms.Enabled=false;Heading.Text=update?"Update wird installiert":"Installation läuft";Hint.Text=phase;Folder.Visible=browse.Visible=folderLabel.Visible=false;bar.Visible=Destination.Visible=true;Destination.Text=Folder.Text;bar.Value=percent;Next.Text="Bitte warten …";Next.Enabled=false;CancelAction.Enabled=false;}
 public void SetFinished(bool success,string detail){busy=false;finished=true;Heading.Text=success?(update?"Update abgeschlossen":"Installation abgeschlossen"):"Installation nicht abgeschlossen";Hint.Text=success?"Version "+targetVersion+" ist installiert.":detail;Folder.Visible=browse.Visible=folderLabel.Visible=false;bar.Visible=Destination.Visible=true;Destination.Text=Folder.Text;bar.Value=success?100:0;CancelAction.Visible=false;Next.Text="Schließen";Next.Enabled=true;}
 protected override void Dispose(bool d){if(d)bar.Dispose();base.Dispose(d);}
 // Keep CheckBox input and accessibility semantics while drawing a larger, DPI-scaled mark.
 sealed class ConsentCheckBox : CheckBox {
  protected override void OnPaint(PaintEventArgs e){
   int size=(int)Math.Round(Height*22.0/38),top=(Height-size)/2;
   Color accent=Enabled?ForeColor:Color.FromArgb(106,130,142);
   Color fill=Checked?accent:Color.FromArgb(16,29,38);
   var box=new Rectangle(0,top,size,size);
   e.Graphics.Clear(BackColor);
   using(var brush=new SolidBrush(fill))e.Graphics.FillRectangle(brush,box);
   using(var border=new Pen(accent))e.Graphics.DrawRectangle(border,box.X,box.Y,box.Width-1,box.Height-1);
   if(Checked){
    using(var check=new Pen(Color.FromArgb(15,41,39),Math.Max(2F,size/9F))){
     e.Graphics.SmoothingMode=System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
     e.Graphics.DrawLines(check,new[]{new PointF(size*.23F,top+size*.51F),
      new PointF(size*.43F,top+size*.70F),new PointF(size*.78F,top+size*.30F)});
    }
   }
   int textStart=size+Math.Max(6,size/3);
   var label=new Rectangle(textStart,0,Width-textStart,Height);
   TextRenderer.DrawText(e.Graphics,Text,Font,label,accent,TextFormatFlags.VerticalCenter|TextFormatFlags.SingleLine);
   if(Focused&&ShowFocusCues)ControlPaint.DrawFocusRectangle(e.Graphics,new Rectangle(0,0,Width-1,Height-1),accent,BackColor);
  }
 }
 sealed class SetupBar:Control {int value=-1,phase;readonly Timer timer=new Timer();public int Value{get{return value;}set{this.value=value;timer.Enabled=value<0;Invalidate();}}public SetupBar(){DoubleBuffered=true;timer.Interval=35;timer.Tick+=delegate{phase=(phase+7)%Math.Max(1,Width+100);Invalidate();};}protected override void OnPaint(PaintEventArgs e){e.Graphics.Clear(Color.FromArgb(16,29,38));using(var b=new SolidBrush(Color.FromArgb(132,217,197))){if(value<0)e.Graphics.FillRectangle(b,phase-100,0,100,Height);else e.Graphics.FillRectangle(b,0,0,Width*Math.Max(0,Math.Min(100,value))/100,Height);}using(var p=new Pen(Color.FromArgb(76,107,124)))e.Graphics.DrawRectangle(p,0,0,Width-1,Height-1);}protected override void Dispose(bool d){if(d)timer.Dispose();base.Dispose(d);}}
}

public static class SetupTerms {
 [DllImport("dwmapi.dll")]static extern int DwmSetWindowAttribute(IntPtr h,int a,ref int v,int n);
 public const string Receipt="2026-11-18.2:5438e49d354058b32007d2ed20e189391af6a96150bd9fa7ced6b3823c0e2e73";
 public const string Text="Sarevoc´s CCU Planer\nNutzungsbedingungen der kostenlosen Fan-Testversion\nStand: 18.11.2026 · Fassung 2\n\nWillkommen\nSchön, dass du den Planer ausprobierst. Du darfst diese Testversion kostenlos für deine eigene Hangar- und CCU-Planung nutzen und den unveränderten Installer kostenlos weitergeben.\n\nProgrammname und Urhebervermerk bleiben erhalten. Eine Open-Source-Lizenz für den Quellcode wird durch diese Bedingungen nicht erteilt.\n\nDein Hangar bleibt in deiner Hand\nDer Planer liest deinen Bestand und zeigt lokale Planungsvorschläge. Kaufen, CCUs anwenden, Verschenken und Einschmelzen sind im Planer gesperrt.\n\nÖffnest du eine RSI-Seite im Standardbrowser, entscheidest du dort selbst über jede Aktion. Deine Zustimmung hier erlaubt keine automatischen Käufe oder Hangaränderungen.\n\nDeine Anmeldung\nPasswort und MFA gibst du direkt bei RSI ein. Der Planer speichert diese Eingaben nicht.\n\nMit „Angemeldet bleiben“ darf eine wiederverwendbare RSI-Sitzung lokal gespeichert werden. Der Planer kann diese Sitzung zum Lesen verwenden. Wie lange sie gültig bleibt, bestimmt RSI. Du kannst die gespeicherte Sitzung im Planer gezielt löschen.\n\nDeine lokalen Daten\nBestand, Planungen, Einstellungen und gelesene Preis-/Guthabenstände bleiben im lokalen Windows-Benutzerprofil. Der Planer lädt deinen Hangar nicht beim Entwickler hoch.\n\nWenn du eine Excel- oder PDF-Datei exportierst, enthält sie die ausgewählten Daten und deinen Profilnamen. Ob und mit wem du sie teilst, bestimmst du selbst.\n\nSicherheitskonzept\nGespeicherte Sitzungen werden mit Windows-Schutz verschlüsselt und getrennt vom Inventar aufbewahrt. Die vorgesehenen Ordnerrechte begrenzen den Zugriff. Ist dieser Schutz nicht verfügbar, wird keine neue Sitzung gespeichert.\n\nDamit die Wiederanmeldung funktioniert, kann der Planer die geschützte Sitzung intern entschlüsseln. Dieser Schutz ersetzt keinen sicheren Windows-Zugang und bietet keine vollständige Sicherheit gegen Schadsoftware, die unter deinem Benutzerkonto läuft.\n\nKauf- und Änderungssperren bleiben aktiv. Der Planer fordert für seine normale Nutzung selbst keine Administratorrechte an. Virenschutz wird weder abgeschaltet noch um Ausnahmen ergänzt.\n\nVorschläge vor einem Kauf prüfen\nDie Software ist eine Testversion. Quellen, Preise, Rabatte und Verfügbarkeit können sich ändern. Vollständigkeit und eine bestimmte Ersparnis werden nicht zugesichert.\n\nPrüfe vor eigenen Käufen oder Reclaims bei RSI den tatsächlichen Betrag, alle betroffenen Inhalte und den endgültigen Warenkorb. Geschützte oder ungeklärte Pledges sind keine Einschmelzempfehlung.\n\nUnabhängiges Fan-Programm\nDer Planer wird nicht von Cloud Imperium Games oder RSI herausgegeben. Deren Namen, Marken und Inhalte bleiben den jeweiligen Rechteinhabern zugeordnet. Die Nutzungsregeln dieser Dienste gelten weiterhin.\n\nDeine gesetzlichen Rechte\nDeine gesetzlichen Rechte und Ansprüche bleiben unberührt. Diese Bedingungen enthalten keinen pauschalen Haftungsausschluss.\n";
 public static readonly string[] Headings={"Willkommen","Dein Hangar bleibt in deiner Hand","Deine Anmeldung","Deine lokalen Daten","Sicherheitskonzept","Vorschläge vor einem Kauf prüfen","Unabhängiges Fan-Programm","Deine gesetzlichen Rechte"};
 public static string BodyText{get{return Text.Substring(Text.IndexOf("\n\n",StringComparison.Ordinal)+2);}}
 public static bool ReceiptMatches(string value){return String.Equals(value,Receipt,StringComparison.Ordinal);}
 public static bool IsAccepted(){using(var key=Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"Software\Sarevoc\SarevocsCCUPlaner")){return key!=null&&ReceiptMatches(key.GetValue("TermsAcceptance") as string);}}
 public static void Require(bool accepted){if(!accepted)throw new InvalidOperationException("TERMS_ACCEPTANCE_REQUIRED");}
 public static void RecordAcceptance(bool accepted,Action<string> save){Require(accepted);save(Receipt);}
 public static void Commit(bool accepted){RecordAcceptance(accepted,receipt=>{using(var key=Microsoft.Win32.Registry.CurrentUser.CreateSubKey(@"Software\Sarevoc\SarevocsCCUPlaner")){key.SetValue("TermsAcceptance",receipt,Microsoft.Win32.RegistryValueKind.String);}});}
 static string RtfText(string value){var b=new System.Text.StringBuilder();foreach(char c in value){if(c=='\\'||c=='{'||c=='}')b.Append('\\').Append(c);else if(c=='\n')b.Append(@"\par ");else if(c>127)b.Append(@"\u").Append((short)c).Append('?');else if(c!='\r')b.Append(c);}return b.ToString();}
 static string FormattedBody(){
  var b=new System.Text.StringBuilder(@"{\rtf1\ansi\deff0{\fonttbl{\f0 Segoe UI;}}{\colortbl ;\red220\green232\blue238;\red132\green217\blue197;}\viewkind4\uc1\pard\f0\fs23\cf1\sl340\slmult1 ");
  foreach(string block in BodyText.Split(new[]{"\n\n"},StringSplitOptions.None)){
   string value=block;int newline=value.IndexOf('\n');string first=newline<0?value:value.Substring(0,newline);
   if(Array.IndexOf(Headings,first)>=0){b.Append(@"\b\cf2\fs27 ").Append(RtfText(first)).Append(@"\b0\cf1\fs23\par ");value=newline<0?"":value.Substring(newline+1);}
   if(value.Length>0)b.Append(RtfText(value));b.Append(@"\par\par ");
  }return b.Append('}').ToString();
 }
 public static Form CreateDialog(){
  var f=new Form{Text="Nutzungsbedingungen",Name="termsDialog",ClientSize=new Size(700,680),MinimumSize=new Size(560,460),StartPosition=FormStartPosition.CenterParent,BackColor=Color.FromArgb(23,37,47),ForeColor=Color.FromArgb(237,242,245),Font=new Font("Segoe UI",11.5F),AutoScaleDimensions=new SizeF(96F,96F),AutoScaleMode=AutoScaleMode.Dpi,FormBorderStyle=FormBorderStyle.Sizable,MaximizeBox=false,MinimizeBox=false};
  var layout=new TableLayoutPanel{Name="termsLayout",Dock=DockStyle.Fill,ColumnCount=1,RowCount=3,Padding=new Padding(20,18,20,12),BackColor=f.BackColor};layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));layout.RowStyles.Add(new RowStyle(SizeType.Absolute,78));layout.RowStyles.Add(new RowStyle(SizeType.Percent,100));layout.RowStyles.Add(new RowStyle(SizeType.Absolute,64));
  var header=new Panel{Name="termsHeader",Size=new Size(660,78),Dock=DockStyle.Fill,Margin=Padding.Empty};
  var title=new Label{Name="termsHeading",Text="Dein Hangar bleibt in deiner Hand",AutoSize=false,Bounds=new Rectangle(4,0,652,32),Anchor=AnchorStyles.Left|AnchorStyles.Right|AnchorStyles.Top,Font=new Font("Segoe UI",16F,FontStyle.Bold),ForeColor=f.ForeColor};
  var subtitle=new Label{Name="termsVersion",Text="Sarevoc´s CCU Planer · Fassung 2 · 18.11.2026",AutoSize=false,Bounds=new Rectangle(4,40,652,23),Anchor=AnchorStyles.Left|AnchorStyles.Right|AnchorStyles.Top,Font=new Font("Segoe UI",10F),ForeColor=Color.FromArgb(169,192,203)};header.Controls.AddRange(new Control[]{title,subtitle});
  var field=new RichTextBox{Name="termsText",ReadOnly=true,DetectUrls=false,WordWrap=true,ScrollBars=RichTextBoxScrollBars.Vertical,Dock=DockStyle.Fill,Margin=Padding.Empty,BackColor=Color.FromArgb(16,29,38),ForeColor=Color.FromArgb(220,232,238),BorderStyle=BorderStyle.FixedSingle,Font=new Font("Segoe UI",11.5F),HideSelection=true,ShortcutsEnabled=true,AccessibleName="Nutzungsbedingungen mit Sicherheitskonzept"};
  field.Rtf=FormattedBody();field.Select(0,0);field.ScrollToCaret();
  var footer=new FlowLayoutPanel{Name="termsFooter",Dock=DockStyle.Fill,FlowDirection=FlowDirection.RightToLeft,WrapContents=false,Margin=Padding.Empty,Padding=new Padding(0,14,4,0)};
  var close=new Button{Name="closeTerms",Text="Schließen",Size=new Size(125,40),Margin=Padding.Empty,DialogResult=DialogResult.OK,BackColor=Color.FromArgb(132,217,197),ForeColor=Color.FromArgb(15,41,39),FlatStyle=FlatStyle.Flat,Font=new Font("Segoe UI",10.5F,FontStyle.Bold)};footer.Controls.Add(close);
  layout.Controls.Add(header,0,0);layout.Controls.Add(field,0,1);layout.Controls.Add(footer,0,2);f.Controls.Add(layout);f.AcceptButton=close;f.CancelButton=close;
  f.Shown+=delegate{
   int dark=1;try{DwmSetWindowAttribute(f.Handle,20,ref dark,4);}catch{}
   var area=Screen.FromControl(f).WorkingArea;var maximum=new Size(Math.Max(320,area.Width-32),Math.Max(300,area.Height-32));
   f.MinimumSize=new Size(Math.Min(f.MinimumSize.Width,maximum.Width),Math.Min(f.MinimumSize.Height,maximum.Height));
   f.Size=new Size(Math.Min(f.Width,maximum.Width),Math.Min(f.Height,maximum.Height));
   f.Location=new Point(Math.Max(area.Left+16,Math.Min(f.Left,area.Right-f.Width-16)),Math.Max(area.Top+16,Math.Min(f.Top,area.Bottom-f.Height-16)));
   field.Select(0,0);field.ScrollToCaret();
  };return f;
 }
}
