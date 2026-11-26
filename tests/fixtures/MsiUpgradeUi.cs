using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Diagnostics;
using System.Runtime.InteropServices;

// Sandbox-only driver: the production MSI is opened without REINSTALL or source arguments.
public static class MsiUpgradeUi {
  [UnmanagedFunctionPointer(CallingConvention.Winapi,CharSet=CharSet.Unicode)] delegate int Handler(IntPtr c,uint m,string text);
  delegate bool WindowProc(IntPtr w,IntPtr c);
  [DllImport("msi.dll")] static extern uint MsiSetInternalUI(uint level,IntPtr owner);
  [DllImport("msi.dll",CharSet=CharSet.Unicode)] static extern IntPtr MsiSetExternalUIW(Handler callback,uint modes,IntPtr c);
  [DllImport("msi.dll",CharSet=CharSet.Unicode)] static extern uint MsiInstallProductW(string package,string properties);
  [DllImport("msi.dll",CharSet=CharSet.Unicode)] static extern uint MsiEnableLogW(uint modes,string log,uint flags);
  [DllImport("user32.dll")] static extern bool EnumWindows(WindowProc cb,IntPtr c);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr w,WindowProc cb,IntPtr c);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr w,out uint id);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowTextW(IntPtr w,StringBuilder b,int n);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassNameW(IntPtr w,StringBuilder b,int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr w);
  [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr w);
  [DllImport("user32.dll")] static extern bool PostMessageW(IntPtr w,uint msg,IntPtr a,IntPtr b);
  [DllImport("user32.dll")] static extern IntPtr SendMessageW(IntPtr w,uint msg,IntPtr a,IntPtr b);
  public static bool FolderPrefilled,TermsInitiallyUnchecked,TermsClicked,InstallClicked,MaintenanceClicked,UnexpectedPrompt;
  public static int SourceRequests,RiskPrompts;
  public static bool SafeRiskDefault;
  static string Text(IntPtr w){var b=new StringBuilder(1024);GetWindowTextW(w,b,b.Capacity);return b.ToString().Replace("&","").Trim();}
  static string Class(IntPtr w){var b=new StringBuilder(128);GetClassNameW(w,b,b.Capacity);return b.ToString();}
  public static uint Run(string package,string expectedFolder,string mode,string log,string evidence) {
    FolderPrefilled=false;TermsInitiallyUnchecked=false;TermsClicked=false;InstallClicked=false;MaintenanceClicked=false;UnexpectedPrompt=false;SourceRequests=0;RiskPrompts=0;SafeRiskDefault=true;
    bool done=false;uint pid=(uint)Process.GetCurrentProcess().Id;var elapsed=Stopwatch.StartNew();
    Handler callback=delegate(IntPtr c,uint msg,string text){
      uint kind=msg&0xff000000;
      if(kind==0x06000000){SourceRequests++;File.AppendAllText(evidence,"SOURCE REQUEST: "+text+Environment.NewLine);return 2;}
      if(kind==0x03000000){RiskPrompts++;SafeRiskDefault=SafeRiskDefault&&((msg&0x100)!=0);if(text.IndexOf(expectedFolder,StringComparison.OrdinalIgnoreCase)<0){UnexpectedPrompt=true;return 7;}File.AppendAllText(evidence,text+Environment.NewLine);return 6;}
      if(kind==0x01000000||kind==0x02000000){File.AppendAllText(evidence,"ERROR: "+text+Environment.NewLine);return 1;}
      return 0;
    };
    var ui=new Thread(delegate(){while(!Volatile.Read(ref done)){
      EnumWindows(delegate(IntPtr window,IntPtr c){uint owner;GetWindowThreadProcessId(window,out owner);if(owner!=pid||!IsWindowVisible(window))return true;
        EnumChildWindows(window,delegate(IntPtr control,IntPtr unused){string label=Text(control),type=Class(control);
          // MSI PathEdit is a rich-edit control on some Windows builds.
          if(!FolderPrefilled&&String.Equals(label.TrimEnd('\\'),expectedFolder.TrimEnd('\\'),StringComparison.OrdinalIgnoreCase)){FolderPrefilled=true;File.AppendAllText(evidence,"PREFILLED FOLDER: "+type+Environment.NewLine);}
          if(type!="Button")return true;
          if(label=="Fertig stellen"||label=="Fertig"||label=="Finish")PostMessageW(control,0x00f5,IntPtr.Zero,IntPtr.Zero);
          if(mode=="install"&&label=="Ich akzeptiere die Nutzungsbedingungen."&&!TermsClicked){TermsInitiallyUnchecked=SendMessageW(control,0x00f0,IntPtr.Zero,IntPtr.Zero)==IntPtr.Zero;TermsClicked=true;File.AppendAllText(evidence,"ACCEPT TERMS"+Environment.NewLine);PostMessageW(control,0x00f5,IntPtr.Zero,IntPtr.Zero);}
          if(mode=="install"&&(label=="Update installieren"||label=="Installieren")&&IsWindowEnabled(control)&&TermsClicked&&FolderPrefilled&&!InstallClicked){InstallClicked=true;File.AppendAllText(evidence,"CLICK UPDATE"+Environment.NewLine);PostMessageW(control,0x00f5,IntPtr.Zero,IntPtr.Zero);}
          if(!MaintenanceClicked&&IsWindowEnabled(control)&&((mode=="repair"&&label=="Reparieren")||(mode=="remove"&&label=="Deinstallieren"))){MaintenanceClicked=true;PostMessageW(control,0x00f5,IntPtr.Zero,IntPtr.Zero);}
          if(elapsed.Elapsed.TotalSeconds>240&&IsWindowEnabled(control)&&label=="Abbrechen"&&((mode=="install"&&!InstallClicked)||(mode!="install"&&!MaintenanceClicked)))PostMessageW(control,0x00f5,IntPtr.Zero,IntPtr.Zero);
          return true;
        },IntPtr.Zero);return true;
      },IntPtr.Zero);Thread.Sleep(100);
    }});ui.IsBackground=true;ui.Start();
    MsiSetInternalUI(5,IntPtr.Zero);MsiEnableLogW(0x3fff,log,2);MsiSetExternalUIW(callback,(1u<<1)|(1u<<2)|(1u<<3)|(1u<<6),IntPtr.Zero);
    try{return MsiInstallProductW(package,"REBOOT=ReallySuppress");}
    finally{done=true;ui.Join(1500);MsiSetExternalUIW(null,0,IntPtr.Zero);GC.KeepAlive(callback);}
  }
}
