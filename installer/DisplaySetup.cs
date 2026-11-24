using System;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

// Display preferences only. This class never opens RSI, inventory or authentication files.
public sealed class DisplaySetup
{
    [DllImport("dwmapi.dll")]private static extern int DwmSetWindowAttribute(IntPtr h,int a,ref int v,int n);
    private static readonly Color InputBack=Color.FromArgb(16,29,38),InputFore=Color.FromArgb(237,242,245),Border=Color.FromArgb(76,107,124);
    public bool Cancelled;
    private string json;
    private static string Preferences(string local) { return Path.Combine(local, @"SarevocsCCUPlaner-Daten\Daten\Anzeige\display-v1.json"); }
    private static void CheckPath(string local, bool create)
    {
        string current = Path.GetFullPath(local);
        foreach (string segment in new string[] { "SarevocsCCUPlaner-Daten", "Daten", "Anzeige" })
        {
            current = Path.Combine(current, segment);
            if (Directory.Exists(current)) { if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) throw new IOException("DISPLAY_REPARSE"); }
            else if (File.Exists(current)) throw new IOException("DISPLAY_PATH");
            else if (create) Directory.CreateDirectory(current);
        }
        string file = Preferences(local);
        if (File.Exists(file) && ((File.GetAttributes(file) & (FileAttributes.ReparsePoint | FileAttributes.Directory)) != 0)) throw new IOException("DISPLAY_FILE");
    }
    public static string Serialize(string language, string currency, string mode, int vatBasisPoints)
    {
        if ((language != "de" && language != "en") || (currency != "EUR" && currency != "USD") || (mode != "net" && mode != "gross") || vatBasisPoints < 0 || vatBasisPoints > 10000) throw new ArgumentException("DISPLAY_VALUES");
        return "{\"schemaVersion\":1,\"language\":\"" + language + "\",\"currency\":\"" + currency + "\",\"taxMode\":\"" + mode + "\",\"vatBasisPoints\":" + vatBasisPoints.ToString(CultureInfo.InvariantCulture) + "}";
    }
    public static DisplaySetup Prepare(string local, bool silent) { return Prepare(local, silent, null); }
    internal static DisplaySetup Prepare(string local, bool silent, IWin32Window owner)
    {
        CheckPath(local, false);
        DisplaySetup result = new DisplaySetup();
        if (File.Exists(Preferences(local)) || silent) return result;
        using (Form form = CreateForm())
        {
            if (owner != null) form.StartPosition = FormStartPosition.CenterParent;
            if (form.ShowDialog(owner) != DialogResult.OK) { result.Cancelled = true; return result; }
            result.json = (string)form.Tag;
        }
        return result;
    }
    public void Commit(string local)
    {
        if (json == null) return;
        CheckPath(local, true); string file = Preferences(local);
        if (File.Exists(file)) return; // A concurrent explicit application save always wins.
        string temporary = file + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            using (FileStream stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            using (StreamWriter writer = new StreamWriter(stream, new System.Text.UTF8Encoding(false))) writer.Write(json);
            if (!File.Exists(file)) File.Move(temporary, file);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
    public static Form CreateForm()
    {
        Form form = new Form(); form.Text = "Sarevoc´s CCU Planer – Einrichtung"; form.Name = "displaySetup";
        form.StartPosition = FormStartPosition.CenterScreen; form.FormBorderStyle = FormBorderStyle.FixedDialog;
        form.MaximizeBox = false; form.MinimizeBox = false; form.AutoScaleMode = AutoScaleMode.Dpi;
        form.ClientSize = new Size(470, 620); form.Font = new Font("Segoe UI", 10F);
        form.BackColor = Color.FromArgb(23, 37, 47); form.ForeColor = Color.FromArgb(237, 242, 245);
        TableLayoutPanel table = new TableLayoutPanel(); table.Dock = DockStyle.Fill; table.Padding = new Padding(25); table.ColumnCount = 1; table.RowCount = 12; table.AutoScroll = true;table.BackColor=form.BackColor;table.ForeColor=form.ForeColor;
        Label heading = new Label(); heading.AutoSize = true; heading.Font = new Font("Segoe UI", 15F, FontStyle.Bold); heading.Margin = new Padding(0, 0, 0, 8); table.Controls.Add(heading);
        Label intro = new Label(); intro.AutoSize = true; intro.MaximumSize = new Size(410, 0); intro.Margin = new Padding(0, 0, 0, 16); table.Controls.Add(intro);
        Label languageLabel = AddLabel(table), currencyLabel, modeLabel, vatLabel;
        ComboBox language = AddCombo(table, "language", new string[] { "Deutsch", "English" });
        currencyLabel = AddLabel(table); ComboBox currency = AddCombo(table, "currency", new string[] { "Euro (EUR)", "US-Dollar (USD)" });
        modeLabel = AddLabel(table); ComboBox mode = AddCombo(table, "taxMode", new string[] { "Vor Steuer (netto)", "Mit eingestellter Mehrwertsteuer" });
        mode.SelectedIndex = 1;
        vatLabel = AddLabel(table); NumericUpDown vat = new DarkNumber(); vat.Name = "vat"; vat.Minimum = 0; vat.Maximum = 100; vat.DecimalPlaces = 2; vat.Value = 19; vat.Dock = DockStyle.Top; vat.Margin = new Padding(0, 5, 0, 15); table.Controls.Add(vat);
        Label note = new Label(); note.AutoSize = true; note.MaximumSize = new Size(410, 0); note.Margin = new Padding(0, 5, 0, 17); table.Controls.Add(note);
        FlowLayoutPanel actions = new FlowLayoutPanel(); actions.AutoSize = true; actions.Dock = DockStyle.Top; actions.FlowDirection = FlowDirection.RightToLeft;
        Button next = new Button(); next.Name = "next"; next.AutoSize = true; next.Padding = new Padding(9, 6, 9, 6); next.BackColor = Color.FromArgb(132, 217, 197); next.ForeColor = Color.FromArgb(15, 41, 39); next.FlatStyle = FlatStyle.Flat;
        Button cancel = new Button(); cancel.Name = "cancel"; cancel.AutoSize = true; cancel.Padding = new Padding(9, 6, 9, 6); cancel.DialogResult = DialogResult.Cancel;cancel.FlatStyle=FlatStyle.Flat;cancel.BackColor=Color.FromArgb(31,49,62);cancel.ForeColor=form.ForeColor;cancel.UseVisualStyleBackColor=false;cancel.FlatAppearance.BorderColor=Border;next.FlatAppearance.BorderColor=Border;next.UseVisualStyleBackColor=false;
        actions.Controls.Add(next); actions.Controls.Add(cancel); table.Controls.Add(actions); form.Controls.Add(table);
        Action translate = delegate {
            bool english = language.SelectedIndex == 1;
            form.Text = "Sarevoc´s CCU Planer – " + (english ? "Setup" : "Einrichtung");
            heading.Text = english ? "Choose your price display" : "So möchtest du Preise sehen";
            intro.Text = english ? "You can change these later under Data & settings." : "Später unter Daten & Einstellungen änderbar.";
            languageLabel.Text = english ? "Language" : "Sprache"; currencyLabel.Text = english ? "Display currency" : "Anzeigewährung";
            int currencySelected = currency.SelectedIndex; currency.Items[1] = english ? "US dollar (USD)" : "US-Dollar (USD)"; currency.SelectedIndex = currencySelected;
            modeLabel.Text = english ? "Price display" : "Preisanzeige"; vatLabel.Text = english ? "VAT rate (%)" : "Mehrwertsteuersatz (%)";
            string percent = vat.Value.ToString("0.##", CultureInfo.GetCultureInfo(english ? "en-US" : "de-DE"));
            int selected = mode.SelectedIndex; mode.Items[0] = english ? "Before tax (net)" : "Vor Steuer (netto)"; mode.Items[1] = (english ? "incl. " : "inkl. ") + percent + (english ? " % VAT" : " % MwSt."); mode.SelectedIndex = selected;
            note.Text = english ? "Euro values are estimates. Net display adds no VAT. Original dollar values remain before tax." : "Euro ist ein Richtwert. Bei netto wird keine MwSt. aufgeschlagen. Original-Dollarwerte bleiben vor Steuer.";
            next.Text = english ? "Continue installation" : "Weiter zur Installation"; cancel.Text = english ? "Cancel" : "Abbrechen";
        };
        language.SelectedIndexChanged += delegate { translate(); };
        vat.ValueChanged += delegate { translate(); };
        next.Click += delegate { form.Tag = Serialize(language.SelectedIndex == 1 ? "en" : "de", currency.SelectedIndex == 1 ? "USD" : "EUR", mode.SelectedIndex == 1 ? "gross" : "net", Decimal.ToInt32(vat.Value * 100)); form.DialogResult = DialogResult.OK; form.Close(); };
        form.Shown+=delegate{int dark=1;try{DwmSetWindowAttribute(form.Handle,20,ref dark,4);}catch{}};
        form.AcceptButton = next; form.CancelButton = cancel; translate(); return form;
    }
    private static Label AddLabel(TableLayoutPanel table) { Label label = new Label(); label.AutoSize = true; label.Margin = new Padding(0, 4, 0, 0); table.Controls.Add(label); return label; }
    private static ComboBox AddCombo(TableLayoutPanel table, string name, string[] values) { ComboBox combo = new DarkCombo(); combo.Name = name; combo.DropDownStyle = ComboBoxStyle.DropDownList;combo.FlatStyle=FlatStyle.Flat;combo.BackColor=InputBack;combo.ForeColor=InputFore;combo.DrawMode=DrawMode.OwnerDrawFixed;combo.ItemHeight=25;
        combo.DrawItem+=delegate(object sender,DrawItemEventArgs e){bool selected=(e.State&DrawItemState.Selected)!=0;using(var brush=new SolidBrush(selected?Color.FromArgb(31,70,73):InputBack))e.Graphics.FillRectangle(brush,e.Bounds);if(e.Index>=0)TextRenderer.DrawText(e.Graphics,combo.GetItemText(combo.Items[e.Index]),combo.Font,new Rectangle(e.Bounds.X+5,e.Bounds.Y,e.Bounds.Width-10,e.Bounds.Height),InputFore,TextFormatFlags.VerticalCenter|TextFormatFlags.NoPrefix|TextFormatFlags.EndEllipsis);};
        combo.Dock = DockStyle.Top; combo.Margin = new Padding(0, 5, 0, 12); combo.Items.AddRange(values); combo.SelectedIndex = 0; table.Controls.Add(combo); return combo; }
    sealed class DarkCombo:ComboBox {
        protected override void OnFontChanged(EventArgs e){base.OnFontChanged(e);ItemHeight=Math.Max(25,Font.Height+8);}
        protected override void WndProc(ref Message message){base.WndProc(ref message);if(message.Msg==0xF||message.Msg==0x85||message.Msg==0x317||message.Msg==0x318){using(var g=(message.Msg==0x317||message.Msg==0x318)&&message.WParam!=IntPtr.Zero?Graphics.FromHdc(message.WParam):Graphics.FromHwnd(Handle)){int width=SystemInformation.VerticalScrollBarWidth+3,x=Width-width;using(var brush=new SolidBrush(InputBack))g.FillRectangle(brush,x,0,width,Height);using(var pen=new Pen(Border)){g.DrawRectangle(pen,0,0,Width-1,Height-1);g.DrawLine(pen,x,0,x,Height);}using(var brush=new SolidBrush(InputFore)){int cx=x+width/2,cy=Height/2;g.FillPolygon(brush,new[]{new Point(cx-4,cy-2),new Point(cx+4,cy-2),new Point(cx,cy+2)});}}}}
    }
    sealed class DarkNumber:NumericUpDown {
        public DarkNumber(){BackColor=InputBack;ForeColor=InputFore;BorderStyle=BorderStyle.FixedSingle;foreach(Control child in Controls){child.BackColor=InputBack;child.ForeColor=InputFore;if(!(child is TextBox))child.Paint+=PaintButtons;}}
        void PaintButtons(object sender,PaintEventArgs e){var c=(Control)sender;e.Graphics.Clear(InputBack);int middle=c.Height/2;using(var pen=new Pen(Border)){e.Graphics.DrawRectangle(pen,0,0,c.Width-1,c.Height-1);e.Graphics.DrawLine(pen,0,middle,c.Width,middle);}using(var brush=new SolidBrush(InputFore)){int x=c.Width/2,y=middle/2;e.Graphics.FillPolygon(brush,new[]{new Point(x-3,y+2),new Point(x+3,y+2),new Point(x,y-2)});y=middle+(c.Height-middle)/2;e.Graphics.FillPolygon(brush,new[]{new Point(x-3,y-2),new Point(x+3,y-2),new Point(x,y+2)});}}
    }
}
