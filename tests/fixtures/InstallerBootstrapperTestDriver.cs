using System;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

public static class InstallerBootstrapperTestDriver {
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    private static void Print(object value) { Console.WriteLine(Json.Serialize(value)); Console.Out.Flush(); }
    private static string Hash(string file) {
        using (var stream = File.OpenRead(file)) using (var sha = SHA256.Create())
            return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
    }
    [STAThread]
    public static int Main(string[] args) {
        try {
            string mode = args[0], root = Path.GetFullPath(args[1]);
            if (mode == "close") {
                Print(new { phase = "close-entered" });
                var result = SetupBootstrapperCore.CloseOwnProcesses(root);
                Print(new { phase = "close-complete", result.Code, result.Success,
                    result.DetectedMainCount, result.DetectedProcessCount, result.ExitedCount, result.RestartManagerCode });
            } else if (mode == "lock-hold") {
                using (SetupBootstrapperCore.AcquireInstallLock(root)) {
                    File.WriteAllText(args[2], "SYNTHETIC LOCK HELD");
                    while (!File.Exists(args[3])) Thread.Sleep(25);
                }
                Print(new { released = true });
            } else if (mode == "lock-probe") {
                Print(new { held = SetupBootstrapperCore.IsInstallLockHeld(root) });
            } else if (mode == "lock-path") {
                Print(new { path = SetupBootstrapperCore.InstallLockPath(root) });
            } else if (mode == "lock-try") {
                bool acquired = false;
                try { using (SetupBootstrapperCore.AcquireInstallLock(root)) acquired = true; } catch (Exception) { }
                Print(new { acquired = acquired });
            } else if (mode == "extract") {
                string file, digest; bool writeDenied = false, deleteDenied = false;
                using (var payload = SetupBootstrapperCore.ExtractPayload(root)) {
                    file = payload.Path; digest = payload.Sha256;
                    if (Hash(file) != digest.ToLowerInvariant()) throw new Exception("Payload hash mismatch");
                    try { using (new FileStream(file, FileMode.Open, FileAccess.Write, FileShare.ReadWrite)) { } }
                    catch (IOException) { writeDenied = true; }
                    try { File.Delete(file); } catch (IOException) { deleteDenied = true; }
                    if (!File.Exists(file)) throw new Exception("Payload deleted while lease active");
                }
                bool released = !File.Exists(file);
                if (!released) { using (new FileStream(file, FileMode.Open, FileAccess.Write, FileShare.ReadWrite)) released = true; }
                Print(new { extracted = true, sha256 = digest, writeDenied = writeDenied, deleteDenied = deleteDenied, released = released });
            } else if (mode == "extract-reject") {
                bool rejected = false;
                try { using (SetupBootstrapperCore.ExtractPayload(root)) { } } catch (Exception) { rejected = true; }
                Print(new { rejected = rejected });
            } else if (mode == "dummy") {
                using (var form = new HiddenFixture(args[2], args[3])) {
                    IntPtr handle = form.Handle;
                    form.Ready(); Application.Run();
                }
            } else throw new Exception("Unknown fixture operation");
            return 0;
        } catch (Exception error) { Print(new { failed = error.GetType().Name, message = error.Message }); return 1; }
    }
    private sealed class HiddenFixture : Form {
        private readonly string journal, stopGate;
        private readonly System.Windows.Forms.Timer stopTimer;
        private int queries, ends;
        public HiddenFixture(string journal, string stopGate) {
            this.journal = journal; this.stopGate = stopGate;
            Text = "Sarevoc´s CCU Planer"; ShowInTaskbar = false;
            stopTimer = new System.Windows.Forms.Timer(); stopTimer.Interval = 25;
            stopTimer.Tick += delegate { if (File.Exists(this.stopGate)) Application.ExitThread(); };
            stopTimer.Start();
        }
        private void Write() { File.WriteAllText(journal, Json.Serialize(new { ready = true, pid = Process.GetCurrentProcess().Id, queries = queries, endSessionRequests = ends })); }
        public void Ready() { Write(); }
        protected override void SetVisibleCore(bool value) { base.SetVisibleCore(false); }
        protected override void WndProc(ref Message message) {
            if (message.Msg == 0x0011) {
                queries++; Write(); message.Result = new IntPtr(1);
                BeginInvoke((Action)delegate { Application.ExitThread(); }); return;
            }
            if (message.Msg == 0x0016) { ends++; Write(); }
            base.WndProc(ref message);
        }
        protected override void Dispose(bool disposing) { if (disposing) stopTimer.Dispose(); base.Dispose(disposing); }
    }
}
