using System;using System.IO;using System.Reflection;using System.Windows.Forms;
public static class InstallerConsentTestDriver {
 static void Check(bool ok,string code){if(!ok)throw new Exception(code);}
 [STAThread]public static int Main(string[] args){try{
  Check(!SetupTerms.ReceiptMatches(null)&&!SetupTerms.ReceiptMatches("2026-11-18.0")&&!SetupTerms.ReceiptMatches("2026-11-18.1:aab1d7dacae8a24b9dac48dc8f84658381f6616e84f286a4c49a5eebec51f6f5")&&!SetupTerms.ReceiptMatches(SetupTerms.Receipt+"changed"),"STALE_OR_MISSING_TERMS_ACCEPTED");Check(SetupTerms.ReceiptMatches(SetupTerms.Receipt),"CURRENT_TERMS_REFUSED");
  bool saved=false;try{SetupTerms.RecordAcceptance(false,value=>{saved=true;});throw new Exception("UNACCEPTED_RECEIPT_WRITTEN");}catch(InvalidOperationException e){Check(e.Message=="TERMS_ACCEPTANCE_REQUIRED","WRONG_CONSENT_ERROR");}Check(!saved,"UNACCEPTED_RECEIPT_WRITTEN");
  string receipt=null;SetupTerms.RecordAcceptance(true,value=>receipt=value);Check(receipt==SetupTerms.Receipt,"ACCEPTED_RECEIPT_MISSING");
  var install=typeof(SelectableSetup).GetMethod("Install",BindingFlags.NonPublic|BindingFlags.Static);bool guarded=false;
  try{install.Invoke(null,new object[]{"must-not-touch-local","must-not-touch-old","must-not-touch-target",new DisplaySetup(),false,(Action<string,int>)((s,p)=>{throw new Exception("SIDE_EFFECT_BEFORE_CONSENT");})});}catch(TargetInvocationException e){guarded=e.InnerException is InvalidOperationException&&e.InnerException.Message=="TERMS_ACCEPTANCE_REQUIRED";}Check(guarded,"INSTALL_ENTRY_NOT_GUARDED");
  Check(SetupTerms.Text.Contains("erlaubt keine automatischen Käufe")&&SetupTerms.Text.Contains("Windows-Schutz")&&SetupTerms.Text.Contains("gesetzlichen Rechte")&&SetupTerms.Text.Contains("Sicherheitskonzept")&&SetupTerms.Text.Contains("intern entschlüsseln"),"TERMS_BOUNDARIES_MISSING");
  Console.WriteLine("{\"status\":\"PASS\",\"groups\":5,\"realInstallation\":false,\"registryWritten\":false,\"newRsiLogin\":false}");return 0;
 }catch(Exception e){Console.WriteLine(e.ToString());return 1;}}
}
