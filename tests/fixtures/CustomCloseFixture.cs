using System;using System.IO;using System.Drawing;using System.Windows.Forms;
public static class CustomCloseFixture {
 [STAThread]public static void Main(string[] args){AppDomain.CurrentDomain.ProcessExit+=delegate{File.WriteAllText(args[0],"{\"ready\":true,\"managedExit\":true}");};Application.EnableVisualStyles();using(var f=new Fixture(args[0],args[1]))Application.Run(f);}
 sealed class Fixture:Form{
  readonly string journal,stop;readonly Timer timer=new Timer();int queries;
  public Fixture(string journal,string stop){this.journal=journal;this.stop=stop;Text="Sarevoc´s CCU Planer";Opacity=0;ShowInTaskbar=false;Size=new Size(100,100);timer.Interval=25;timer.Tick+=delegate{if(File.Exists(stop))Close();};Shown+=delegate{File.WriteAllText(journal,"{\"ready\":true,\"queries\":0}");timer.Start();};FormClosing+=delegate{File.WriteAllText(journal,"{\"ready\":true,\"queries\":"+queries+",\"gracefulClose\":true}");};}
  protected override void WndProc(ref Message m){if(m.Msg==0x0011){queries++;File.WriteAllText(journal,"{\"ready\":true,\"queries\":"+queries+"}");m.Result=new IntPtr(1);BeginInvoke((Action)delegate{Close();});return;}base.WndProc(ref m);}
  protected override void Dispose(bool disposing){if(disposing)timer.Dispose();base.Dispose(disposing);}
 }
}
