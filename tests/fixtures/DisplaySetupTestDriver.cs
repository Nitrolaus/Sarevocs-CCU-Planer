using System;using System.IO;using System.Reflection;using System.Drawing;using System.Windows.Forms;
public static class DisplaySetupTestDriver
{
    private static void Check(bool value,string code){if(!value)throw new Exception(code);}
    private static void Geometry(Form form,string root,float scale){
        var lines=new System.Collections.Generic.List<string>();var queue=new System.Collections.Generic.Queue<Control>();queue.Enqueue(form);
        while(queue.Count>0){Control p=queue.Dequeue();foreach(Control child in p.Controls){queue.Enqueue(child);lines.Add(child.Name+" | Bounds="+child.Bounds+" | Parent="+p.ClientRectangle+" | Screen="+child.RectangleToScreen(child.ClientRectangle));}}
        foreach(string name in new[]{"language","currency","taxMode","vat"}){
            Control field=form.Controls.Find(name,true)[0];Check(field.BackColor.R<40&&field.ForeColor.R>180,"LIGHT_FIELD_"+name);
            Check(field.Right<=field.Parent.ClientSize.Width&&field.Bottom<=field.Parent.ClientSize.Height,"FIELD_CLIPPED_"+name);
            var combo=field as ComboBox;if(combo!=null){Check(combo.DrawMode==DrawMode.OwnerDrawFixed,"SYSTEM_LIGHT_DROPDOWN");var needed=TextRenderer.MeasureText(combo.Text,combo.Font);Check(needed.Height<=combo.ItemHeight&&needed.Width+40*scale<=combo.Width,"COMBO_TEXT_CLIPPED_"+name);}
        }
        Button next=(Button)form.Controls.Find("next",true)[0],cancel=(Button)form.Controls.Find("cancel",true)[0];Check(next.Top==cancel.Top&&next.Height==cancel.Height,"BUTTONS_MISALIGNED");Check(cancel.BackColor.R<40&&cancel.FlatStyle==FlatStyle.Flat&&!cancel.UseVisualStyleBackColor,"LIGHT_CANCEL");
        Check(next.Parent.Bottom<=form.Controls[0].ClientSize.Height,"ACTIONS_CLIPPED");
        File.WriteAllLines(Path.Combine(root,"geometry-"+(int)(scale*100)+".txt"),lines);
    }
    [STAThread]public static int Main(string[] args)
    {
        try{
            string root=Path.GetFullPath(args[0]);Directory.CreateDirectory(root);Application.EnableVisualStyles();
            string empty=Path.Combine(root,"silent");Directory.CreateDirectory(empty);DisplaySetup.Prepare(empty,true).Commit(empty);Check(!Directory.Exists(Path.Combine(empty,"SarevocsCCUPlaner-Daten")),"SILENT_MUST_DEFER");
            foreach(string bad in new string[]{"fr","de;"}){bool refused=false;try{DisplaySetup.Serialize(bad,"EUR","net",1900);}catch(ArgumentException){refused=true;}Check(refused,"LANGUAGE_VALIDATION");}
            Check(DisplaySetup.Serialize("de","EUR","net",1900)=="{\"schemaVersion\":1,\"language\":\"de\",\"currency\":\"EUR\",\"taxMode\":\"net\",\"vatBasisPoints\":1900}","NATIVE_SCHEMA");
            string chosen;
            using(Form form=DisplaySetup.CreateForm()){
                form.Opacity=0;form.ShowInTaskbar=false;
                form.Shown+=delegate {
                    ComboBox priceMode = (ComboBox)form.Controls.Find("taxMode",true)[0];
                    Check(priceMode.SelectedIndex==1 && priceMode.Text=="inkl. 19 % MwSt.","DEFAULT_GERMAN_GROSS_PRICE");
                    priceMode.SelectedIndex=0;
                    ((ComboBox)form.Controls.Find("language",true)[0]).SelectedIndex=1;
                    Check(priceMode.SelectedIndex==0 && priceMode.Text=="Before tax (net)","MANUAL_SELECTION_PERSISTS");
                    ((ComboBox)form.Controls.Find("currency",true)[0]).SelectedIndex=1;
                    priceMode.SelectedIndex=1;
                    ((NumericUpDown)form.Controls.Find("vat",true)[0]).Value=7.5M;
                    form.PerformLayout();
                    Geometry(form,root,1F);
                    Button next=(Button)form.Controls.Find("next",true)[0];Check(next.Text=="Continue installation","NATIVE_ENGLISH");
                    Check(next.Parent.Bounds.Bottom<=form.ClientRectangle.Height,"ACTIONS_CLIPPED");
                    using(Bitmap bitmap=new Bitmap(form.Width,form.Height)){form.DrawToBitmap(bitmap,new Rectangle(0,0,bitmap.Width,bitmap.Height));bitmap.Save(Path.Combine(root,"native-setup.png"));}
                    next.PerformClick();
                };
                Check(form.ShowDialog()==DialogResult.OK,"NATIVE_ACCEPT");chosen=(string)form.Tag;
                Check(!form.Visible,"SETUP_DID_NOT_CLOSE");
            }
            Check(chosen==DisplaySetup.Serialize("en","USD","gross",750),"CONTROLS_TO_SETTINGS");
            foreach(float scale in new[]{1.25F,1.5F,2F})using(Form scaled=DisplaySetup.CreateForm()){
                scaled.AutoScaleMode=AutoScaleMode.None;var fonts=new System.Collections.Generic.Dictionary<Control,Font>();var queue=new System.Collections.Generic.Queue<Control>();queue.Enqueue(scaled);while(queue.Count>0)foreach(Control child in queue.Dequeue().Controls){fonts[child]=child.Font;queue.Enqueue(child);}
                scaled.Scale(new SizeF(scale,scale));foreach(var entry in fonts)entry.Key.Font=new Font(entry.Value.FontFamily,entry.Value.Size*scale,entry.Value.Style);
                scaled.Opacity=0;scaled.ShowInTaskbar=false;scaled.StartPosition=FormStartPosition.Manual;scaled.Location=new Point(-20000,-20000);scaled.Show();Application.DoEvents();Geometry(scaled,root,scale);scaled.Close();
            }
            DisplaySetup plan=new DisplaySetup();typeof(DisplaySetup).GetField("json",BindingFlags.Instance|BindingFlags.NonPublic).SetValue(plan,chosen);
            string local=Path.Combine(root,"selected");Directory.CreateDirectory(local);plan.Commit(local);
            string file=Path.Combine(local,@"SarevocsCCUPlaner-Daten\Daten\Anzeige\display-v1.json");Check(File.ReadAllText(file)==chosen,"PREFERENCE_COMMIT");
            DisplaySetup.Prepare(local,false).Commit(local);Check(File.ReadAllText(file)==chosen,"UPDATE_MUST_PRESERVE");
            string collision=Path.Combine(root,"collision");Directory.CreateDirectory(collision);File.WriteAllText(Path.Combine(collision,"SarevocsCCUPlaner-Daten"),"synthetic blocker");bool blocked=false;try{DisplaySetup.Prepare(collision,true);}catch(IOException){blocked=true;}Check(blocked,"INVALID_PARENT");
            Console.WriteLine("{\"status\":\"PASS\",\"checks\":12,\"scaledLayout\":[100,125,150,200],\"physicalDpiAcceptance\":false,\"userFilesRead\":false,\"newRsiLogin\":false}");return 0;
        }catch(Exception error){Console.WriteLine("FAIL: "+error.Message);return 1;}
    }
}
