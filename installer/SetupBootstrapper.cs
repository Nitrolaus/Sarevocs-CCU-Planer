using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
#if !CAB_PAYLOAD
using System.Management;
#endif
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
#if !CAB_PAYLOAD
using System.Threading.Tasks;
#endif
using System.Windows.Forms;
using Microsoft.Win32.SafeHandles;

[assembly: DefaultDllImportSearchPaths(DllImportSearchPath.System32)]

public sealed class CloseResult
{
    public string Code { get; internal set; }
    public int DetectedMainCount { get; internal set; }
    public int DetectedProcessCount { get; internal set; }
    public int ExitedCount { get; internal set; }
    public int RestartManagerCode { get; internal set; }
    public bool Success { get { return Code == "SUCCESS"; } }
}

public sealed class PayloadLease : IDisposable
{
    private readonly FileStream file;
    private readonly SafeFileHandle directory;
    public string Path { get; private set; }
    public string Sha256 { get; private set; }
    internal PayloadLease(string path, FileStream file, SafeFileHandle directory, string sha)
    { Path = path; this.file = file; this.directory = directory; Sha256 = sha; }
    public void Dispose() { file.Dispose(); if (directory != null) directory.Dispose(); }
}

public static class SetupBootstrapperCore
{
#if CAB_PAYLOAD
    public const string PayloadResourceName = "SarevocsCCUPlaner.Cabinet";
    private const string PayloadFileName = "program-files.cab";
#else
    public const string PayloadResourceName = "SarevocsCCUPlaner.InnerSetup";
    private const string PayloadFileName = "SquirrelSetup.exe";
#endif
    public const string ExecutableName = "Sarevocs-CCU-Planer.exe";
    public const string ApplicationTitle = "Sarevoc\u00b4s CCU Planer";
    private const int CloseTimeoutMilliseconds = 45000;
    private const uint ReparsePoint = 0x400;
    private const uint InvalidAttributes = 0xffffffff;
    private const uint WaitTimeout = 258;
    private static readonly Regex AppDirectory = new Regex(@"^app-(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$", RegexOptions.CultureInvariant);

    private sealed class LockLease : IDisposable
    {
        private readonly SafeFileHandle handle;
        public LockLease(SafeFileHandle handle) { this.handle = handle; }
        public void Dispose() { handle.Dispose(); }
    }
    private sealed class Target : IDisposable
    {
        public uint Id;
        public SafeFileHandle Handle;
        public NativeFileTime Start;
        public bool Main;
        public bool LegacyClose;
        public string Key { get { return Id + ":" + Start.High + ":" + Start.Low; } }
        public void Dispose() { Handle.Dispose(); }
    }
    private sealed class Blocker : IOException
    { public readonly string Code; public Blocker(string code) : base(code) { Code = code; } }
#if !CAB_PAYLOAD
    private sealed class RmRequest
    { public volatile bool Cancelled; public volatile bool HasSession; public uint Session; public readonly object Sync = new object(); }
#endif

    public static string InstallLockPath(string root) { return CanonicalRoot(root) + ".install.lock"; }

    public static IDisposable AcquireInstallLock(string root)
    {
        string marker = InstallLockPath(root);
        RejectReparseParents(System.IO.Path.GetDirectoryName(marker));
        RejectReparse(marker);
        SafeFileHandle handle = OpenMarker(marker, true);
        if (handle.IsInvalid) { handle.Dispose(); throw new IOException("INSTALL_LOCK_UNAVAILABLE"); }
        try { CheckRegularHandle(handle); return new LockLease(handle); }
        catch { handle.Dispose(); throw; }
    }

    public static bool IsInstallLockHeld(string root)
    {
        string marker = InstallLockPath(root);
        RejectReparseParents(System.IO.Path.GetDirectoryName(marker)); RejectReparse(marker);
        SafeFileHandle handle = OpenMarker(marker, false);
        if (handle.IsInvalid)
        {
            int error = Marshal.GetLastWin32Error(); handle.Dispose();
            if (error == 2 || error == 3) return false;
            if (error == 32 || error == 33 || error == 5) return true;
            throw new IOException("INSTALL_LOCK_UNREADABLE");
        }
        try { CheckRegularHandle(handle); return false; }
        finally { handle.Dispose(); }
    }

    private static SafeFileHandle OpenMarker(string path, bool create)
    {
        // OPEN_REPARSE_POINT avoids following a final-component link even in a race.
        return CreateFile(path, 0xc0000000, 0, IntPtr.Zero, create ? 4u : 3u, 0x00200000, IntPtr.Zero);
    }
    private static void CheckRegularHandle(SafeFileHandle handle)
    {
        ByHandleFileInformation info;
        if (!GetFileInformationByHandle(handle, out info) || (info.Attributes & (ReparsePoint | 0x10)) != 0 || info.NumberOfLinks != 1)
            throw new IOException("INSTALL_LOCK_INVALID");
    }

    public static CloseResult CloseOwnProcesses(string root)
    {
        var result = new CloseResult { Code = "DETECTION_FAILED", RestartManagerCode = -1 };
        string canonical;
        try { canonical = CanonicalRoot(root); RejectReparseParents(canonical); }
        catch { result.Code = "INVALID_ROOT"; return result; }
        var targets = new List<Target>();
        var known = new HashSet<string>(StringComparer.Ordinal);
        var elapsed = Stopwatch.StartNew();
        try
        {
            while (elapsed.ElapsedMilliseconds < CloseTimeoutMilliseconds)
            {
                var added = Discover(canonical);
                var fresh = new List<Target>();
                foreach (Target target in added)
                {
                    if (known.Add(target.Key)) { targets.Add(target); fresh.Add(target); }
                    else target.Dispose();
                }
                UpdateCounts(result, targets);
                if (fresh.Count == 0 && AllExited(targets)) { result.Code = "SUCCESS"; return result; }
                if (fresh.Count > 0)
                {
#if !CAB_PAYLOAD
                    result.RestartManagerCode = RequestRestartManager(fresh, targets, elapsed);
#endif
                    RequestOwnWindows(fresh, elapsed);
                }
                while (!AllExited(targets) && elapsed.ElapsedMilliseconds < CloseTimeoutMilliseconds) Thread.Sleep(50);
                // Re-enumerate after exit; a newly launched own version must not reach Squirrel.
            }
            result.Code = "TIMEOUT";
        }
        catch (Blocker blocker) { result.Code = blocker.Code; }
        catch { result.Code = "DETECTION_FAILED"; }
        finally { UpdateCounts(result, targets); foreach (Target target in targets) target.Dispose(); }
        return result;
    }

    private static List<Target> Discover(string root)
    {
        var found = new List<Target>();
        string sid = WindowsIdentity.GetCurrent().User.Value;
        uint session;
        if (!ProcessIdToSessionId((uint)Process.GetCurrentProcess().Id, out session)) throw new IOException("SESSION_UNAVAILABLE");
        try
        {
            RejectConcurrentUpdater(root);
            foreach (Process process in Process.GetProcessesByName(System.IO.Path.GetFileNameWithoutExtension(ExecutableName)))
            {
                using (process)
                {
                    SafeFileHandle handle = OpenProcess(0x101000, false, (uint)process.Id);
                    if (handle.IsInvalid)
                    { int error = Marshal.GetLastWin32Error(); handle.Dispose(); if (error == 87 || error == 1168) continue; throw new IOException("PROCESS_UNREADABLE"); }
                    bool keep = false;
                    try
                    {
                        if (!Alive(handle)) continue;
                        var image = new StringBuilder(32768); uint length = (uint)image.Capacity;
                        if (!QueryFullProcessImageName(handle, 0, image, ref length)) throw new IOException("PROCESS_PATH_UNREADABLE");
                        string relative;
                        if (!OwnImage(root, image.ToString(), out relative)) continue;
                        uint targetSession;
                        if (!ProcessIdToSessionId((uint)process.Id, out targetSession)) { if (!Alive(handle)) continue; throw new IOException("PROCESS_SESSION_UNREADABLE"); }
                        if (targetSession != session) { if (!Alive(handle)) continue; throw new Blocker("BLOCKED_OWNER_OR_SESSION"); }
                        SafeFileHandle token;
                        if (!OpenProcessToken(handle, 8, out token)) { if (!Alive(handle)) continue; throw new IOException("PROCESS_OWNER_UNREADABLE"); }
                        using (token) using (var identity = new WindowsIdentity(token.DangerousGetHandle()))
                            if (identity.User == null || identity.User.Value != sid) { if (!Alive(handle)) continue; throw new Blocker("BLOCKED_OWNER_OR_SESSION"); }
                        NativeFileTime created, exit, kernel, user;
                        if (!GetProcessTimes(handle, out created, out exit, out kernel, out user)) throw new IOException("PROCESS_START_UNREADABLE");
                        bool main = false;
#if !CAB_PAYLOAD
                        bool child;
                        try { child = HasTypeArgument((uint)process.Id); } catch { if (!Alive(handle)) continue; throw; }
                        main = !child;
#endif
                        if (!Alive(handle)) continue;
                        found.Add(new Target { Id = (uint)process.Id, Handle = handle, Start = created, Main = main, LegacyClose = IsLegacy(relative, image.ToString()) });
                        keep = true;
                    }
                    finally { if (!keep) handle.Dispose(); }
                }
            }
            return found;
        }
        catch { foreach (Target target in found) target.Dispose(); throw; }
    }

    private static void RejectConcurrentUpdater(string root)
    {
        foreach (Process process in Process.GetProcessesByName("Update"))
        using (process)
        using (SafeFileHandle handle = OpenProcess(0x101000, false, (uint)process.Id))
        {
            if (handle.IsInvalid) { int error = Marshal.GetLastWin32Error(); if (error == 87 || error == 1168) continue; throw new IOException("UPDATER_PATH_UNREADABLE"); }
            if (!Alive(handle)) continue;
            var image = new StringBuilder(32768); uint length = (uint)image.Capacity;
            if (!QueryFullProcessImageName(handle, 0, image, ref length)) { if (!Alive(handle)) continue; throw new IOException("UPDATER_PATH_UNREADABLE"); }
            if (String.Equals(System.IO.Path.GetFullPath(image.ToString()), System.IO.Path.Combine(root, "Update.exe"), StringComparison.OrdinalIgnoreCase) && Alive(handle)) throw new Blocker("UPDATER_RUNNING");
        }
    }

    internal static string VerifyStopped(string root)
    {
        List<Target> targets = null;
        try { string canonical = CanonicalRoot(root); RejectReparseParents(canonical); targets = Discover(canonical); return targets.Count == 0 ? "SUCCESS" : "PROCESS_RESTARTED"; }
        catch (Blocker blocker) { return blocker.Code; }
        catch { return "DETECTION_FAILED"; }
        finally { if (targets != null) foreach (Target target in targets) target.Dispose(); }
    }

    private static bool OwnImage(string root, string image, out string relative)
    {
        relative = null;
        string full = System.IO.Path.GetFullPath(image);
        if (!full.StartsWith(root + "\\", StringComparison.OrdinalIgnoreCase)) return false;
        string rest = full.Substring(root.Length + 1);
        if (String.Equals(rest, ExecutableName, StringComparison.OrdinalIgnoreCase)) { RejectReparse(full); relative = rest; return true; }
        int separator = rest.IndexOf('\\');
        if (separator < 0 || !String.Equals(rest.Substring(separator + 1), ExecutableName, StringComparison.OrdinalIgnoreCase) || !AppDirectory.IsMatch(rest.Substring(0, separator))) return false;
        RejectReparse(System.IO.Path.GetDirectoryName(full)); RejectReparse(full); relative = rest; return true;
    }

    private static bool IsLegacy(string relative, string image)
    {
        string folder = System.IO.Path.GetDirectoryName(relative);
        Match match = AppDirectory.Match(folder ?? "");
        Version version;
        if (match.Success && Version.TryParse(match.Groups[1].Value + "." + match.Groups[2].Value + "." + match.Groups[3].Value, out version)) return version < new Version(0, 3, 8);
        try { return Version.TryParse(FileVersionInfo.GetVersionInfo(image).FileVersion, out version) && version < new Version(0, 3, 8); }
        catch { return false; }
    }

#if !CAB_PAYLOAD
    private static bool HasTypeArgument(uint id)
    {
        // Only the boolean switch classification survives. Never retain or log command lines.
        using (var search = new ManagementObjectSearcher("SELECT CommandLine FROM Win32_Process WHERE ProcessId=" + id))
        using (ManagementObjectCollection rows = search.Get())
        {
            foreach (ManagementObject row in rows)
            using (row)
            {
                string command = row["CommandLine"] as string;
                if (command == null) throw new IOException("PROCESS_ARGUMENT_CLASSIFICATION_FAILED");
                int count; IntPtr arguments = CommandLineToArgv(command, out count);
                if (arguments == IntPtr.Zero) throw new IOException("PROCESS_ARGUMENT_CLASSIFICATION_FAILED");
                try
                {
                    for (int index = 1; index < count; index++)
                    {
                        string argument = Marshal.PtrToStringUni(Marshal.ReadIntPtr(arguments, index * IntPtr.Size));
                        if (argument == "--type" || argument.StartsWith("--type=", StringComparison.Ordinal)) return true;
                    }
                    return false;
                }
                finally { LocalFree(arguments); }
            }
        }
        throw new IOException("PROCESS_ARGUMENT_CLASSIFICATION_FAILED");
    }

    private static int RequestRestartManager(List<Target> fresh, List<Target> all, Stopwatch elapsed)
    {
        var applications = new List<RmUniqueProcess>();
        foreach (Target target in fresh) if (target.Main && Alive(target.Handle)) applications.Add(new RmUniqueProcess { Id = target.Id, Start = target.Start });
        if (applications.Count == 0) return -1;
        var allowed = new HashSet<string>(StringComparer.Ordinal);
        foreach (Target target in all) allowed.Add(target.Key);
        var request = new RmRequest();
        // All potentially blocking RM calls share the overall 45-second budget.
        Task<int> task = Task.Factory.StartNew(delegate { try { return RunRestartManager(applications, allowed, request); } catch { return 160; } });
        int remaining = (int)Math.Max(0, CloseTimeoutMilliseconds - elapsed.ElapsedMilliseconds);
        if (task.Wait(remaining)) return task.Result;
        request.Cancelled = true;
        if (request.HasSession) ThreadPool.QueueUserWorkItem(delegate { lock (request.Sync) { if (request.HasSession) { try { RmCancelCurrentTask(request.Session); } catch { } } } });
        return 1223;
    }
    private static int RunRestartManager(List<RmUniqueProcess> applications, HashSet<string> allowed, RmRequest request)
    {
        if (request.Cancelled) return 1223;
        uint session; var key = new StringBuilder(33);
        int code = RmStartSession(out session, 0, key);
        if (code != 0) return code;
        request.Session = session; request.HasSession = true;
        try
        {
            if (request.Cancelled) return 1223;
            code = RmRegisterResources(session, 0, null, (uint)applications.Count, applications.ToArray(), 0, null);
            if (code != 0) return code;
            if (request.Cancelled) return 1223;
            uint needed, count = 0, reboot;
            code = RmGetList(session, out needed, ref count, null, out reboot);
            if (code != 0 && code != 234) return code;
            if (needed > 10000) return 160;
            if (needed > 0)
            {
                var list = new RmProcessInfo[needed]; count = needed;
                code = RmGetList(session, out needed, ref count, list, out reboot);
                if (code != 0) return code;
                for (int index = 0; index < count; index++)
                    if (!allowed.Contains(list[index].Process.Id + ":" + list[index].Process.Start.High + ":" + list[index].Process.Start.Low)) return 5;
            }
            if (request.Cancelled) return 1223;
            return RmShutdown(session, 0, IntPtr.Zero); // Never RmForceShutdown or WM_ENDSESSION.
        }
        finally { lock (request.Sync) { request.HasSession = false; RmEndSession(session); } }
    }
#endif

    private static void RequestOwnWindows(List<Target> targets, Stopwatch elapsed)
    {
        var byId = new Dictionary<uint, Target>();
        foreach (Target target in targets)
        {
#if !CAB_PAYLOAD
            if (!target.Main) continue;
#endif
            if (Alive(target.Handle)) byId[target.Id] = target;
        }
        EnumWindows(delegate(IntPtr window, IntPtr unused)
        {
            if (elapsed.ElapsedMilliseconds >= CloseTimeoutMilliseconds) return false;
            uint id; GetWindowThreadProcessId(window, out id);
            Target target;
            if (!byId.TryGetValue(id, out target) || !Alive(target.Handle)) return true;
            var title = new StringBuilder(256); GetWindowText(window, title, title.Capacity);
            if (!String.Equals(title.ToString(), ApplicationTitle, StringComparison.Ordinal)) return true;
            uint currentOwner;
            GetWindowThreadProcessId(window, out currentOwner);
            if (currentOwner != id || !Alive(target.Handle)) return true;
            // All processes in the verified tree must exit, including ones without windows.
            target.Main = true;
            IntPtr result;
            uint remaining = (uint)Math.Max(1, CloseTimeoutMilliseconds - elapsed.ElapsedMilliseconds);
            SendMessageTimeout(window, 0x0011, IntPtr.Zero, new IntPtr(1), 0x0003, Math.Min(2000u, remaining), out result);
            if (target.LegacyClose && Alive(target.Handle))
            {
                uint owner; GetWindowThreadProcessId(window, out owner);
                if (owner == target.Id) PostMessage(window, 0x0010, IntPtr.Zero, IntPtr.Zero);
            }
            return true;
        }, IntPtr.Zero);
    }

    private static bool Alive(SafeFileHandle handle)
    {
        uint state = WaitForSingleObject(handle, 0);
        if (state == 0xffffffff) throw new IOException("PROCESS_WAIT_FAILED");
        return state == WaitTimeout;
    }
    private static bool AllExited(List<Target> targets) { foreach (Target target in targets) if (Alive(target.Handle)) return false; return true; }
    private static void UpdateCounts(CloseResult result, List<Target> targets)
    {
        result.DetectedProcessCount = targets.Count; result.DetectedMainCount = 0; result.ExitedCount = 0;
        foreach (Target target in targets) { if (target.Main) result.DetectedMainCount++; if (!Alive(target.Handle)) result.ExitedCount++; }
    }

    public static PayloadLease ExtractPayload(string destinationDirectory)
    {
        string directory = AbsolutePath(destinationDirectory);
        SafeFileHandle directoryHandle = CreatePayloadDirectory(directory);
        try
        {
            PayloadLease lease = ExtractPayloadFile(System.IO.Path.Combine(directory, PayloadFileName), directoryHandle);
            directoryHandle = null;
            return lease;
        }
        finally { if (directoryHandle != null) directoryHandle.Dispose(); }
    }

    internal static bool CanCreateEntries(string directory, bool includeFiles)
    {
        RejectReparseParents(directory);
        const uint addFile = 0x00000002;
        const uint addSubdirectory = 0x00000004;
        const uint shareReadWriteDelete = 7;
        const uint openExisting = 3;
        const uint openDirectoryWithoutFollowingLinks = 0x02000000 | 0x00200000;
        uint required = includeFiles ? addFile | addSubdirectory : addSubdirectory;
        using (var handle = CreateFile(directory, required, shareReadWriteDelete, IntPtr.Zero, openExisting, openDirectoryWithoutFollowingLinks, IntPtr.Zero))
            return !handle.IsInvalid;
    }

    internal static SafeFileHandle CreatePayloadDirectory(string directory)
    {
        RejectReparseParents(System.IO.Path.GetDirectoryName(directory));
        IntPtr descriptor = IntPtr.Zero;
        try
        {
            string sid = WindowsIdentity.GetCurrent().User.Value;
            uint size;
            if (!ConvertStringSecurityDescriptorToSecurityDescriptor("D:P(A;OICI;FA;;;" + sid + ")(A;OICI;FA;;;SY)", 1, out descriptor, out size)) throw new IOException("PAYLOAD_DIRECTORY_SECURITY_FAILED");
            var security = new SecurityAttributes { Length = Marshal.SizeOf(typeof(SecurityAttributes)), Descriptor = descriptor, Inherit = false };
            if (!CreateDirectory(directory, ref security)) throw new IOException("PAYLOAD_DIRECTORY_NOT_NEW");
            // Listing the directory makes Windows enforce the no-delete sharing
            // reservation. A handle opened for attributes alone permits a rename.
            const uint listDirectoryAndReadAttributes = 0x0001 | 0x0080;
            SafeFileHandle directoryHandle = CreateFile(directory, listDirectoryAndReadAttributes, 3, IntPtr.Zero, 3, 0x02000000 | 0x00200000, IntPtr.Zero);
            if (!directoryHandle.IsInvalid) return directoryHandle;
            directoryHandle.Dispose();
            throw new IOException("PAYLOAD_DIRECTORY_LOCK_FAILED");
        }
        finally { if (descriptor != IntPtr.Zero) LocalFree(descriptor); }
    }

    public static PayloadLease ExtractPayloadFile(string outputFile) { return ExtractPayloadFile(outputFile, null); }
    private static PayloadLease ExtractPayloadFile(string outputFile, SafeFileHandle directoryHandle)
    {
        string output = AbsolutePath(outputFile);
        RejectReparseParents(System.IO.Path.GetDirectoryName(output)); RejectReparse(output);
        bool created = false;
        try
        {
            using (Stream input = Assembly.GetExecutingAssembly().GetManifestResourceStream(PayloadResourceName))
            {
                if (input == null) throw new IOException("PAYLOAD_RESOURCE_MISSING");
                using (var file = new FileStream(output, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                { created = true; input.CopyTo(file); file.Flush(true); }
            }
            // Reopen and rehash under a lease that denies modification and deletion through setup exit.
            var held = new FileStream(output, FileMode.Open, FileAccess.Read, FileShare.Read);
            try
            {
                string sha = StreamSha256(held);
                if (!String.Equals(sha, EmbeddedPayload.ExpectedSha256, StringComparison.Ordinal)) throw new IOException("PAYLOAD_HASH_MISMATCH");
                held.Position = 0; return new PayloadLease(output, held, directoryHandle, sha);
            }
            catch { held.Dispose(); throw; }
        }
        catch { if (created) { try { File.Delete(output); } catch { } } throw; }
    }

    public static string FileSha256(string file)
    {
        RejectReparseParents(System.IO.Path.GetDirectoryName(file)); RejectReparse(file);
        using (SafeFileHandle handle = CreateFile(file, 0x80000000, 1, IntPtr.Zero, 3, 0x00200000, IntPtr.Zero))
        {
            if (handle.IsInvalid) throw new IOException("HASH_FILE_UNREADABLE"); CheckRegularHandle(handle);
            using (var stream = new FileStream(handle, FileAccess.Read)) return StreamSha256(stream);
        }
    }
    private static string StreamSha256(Stream stream)
    { using (var hash = SHA256.Create()) return BitConverter.ToString(hash.ComputeHash(stream)).Replace("-", "").ToLowerInvariant(); }
    public static string CanonicalRoot(string root)
    {
        string full = AbsolutePath(root).TrimEnd('\\');
        if (full.Length < 4 || full.StartsWith(@"\\", StringComparison.Ordinal)) throw new IOException("INVALID_ROOT");
        return full;
    }

    private static SafeFileHandle OpenDirectory(string directory)
    {
        SafeFileHandle handle = CreateFile(directory, 0x80, 7, IntPtr.Zero, 3, 0x02000000 | 0x00200000, IntPtr.Zero);
        ByHandleFileInformation info;
        if (!handle.IsInvalid && GetFileInformationByHandle(handle, out info) &&
            (info.Attributes & (ReparsePoint | 0x10)) == 0x10) return handle;
        handle.Dispose();
        throw new IOException("DIRECTORY_IDENTITY_UNAVAILABLE");
    }

    internal static string PhysicalDirectoryPath(string path)
    {
        path = AbsolutePath(path);
        RejectReparseParents(path);
        var missing = new Stack<string>();
        string current = path;
        while (!Directory.Exists(current))
        {
            if (File.Exists(current) || System.IO.Path.GetDirectoryName(current) == null)
                throw new IOException("DIRECTORY_IDENTITY_UNAVAILABLE");
            missing.Push(System.IO.Path.GetFileName(current));
            current = System.IO.Path.GetDirectoryName(current);
        }
        using (SafeFileHandle handle = OpenDirectory(current))
        {
            var name = new StringBuilder(32768);
            uint length = GetFinalPathNameByHandle(handle, name, (uint)name.Capacity, 0);
            string physical = name.ToString();
            if (length == 0 || length >= name.Capacity ||
                !Regex.IsMatch(physical, @"^\\\\\?\\[A-Za-z]:\\"))
                throw new IOException("DIRECTORY_IDENTITY_UNAVAILABLE");
            physical = physical.Substring(4);
            foreach (string part in missing) physical = System.IO.Path.Combine(physical, part);
            return AbsolutePath(physical);
        }
    }

    internal static bool SameDirectory(string first, string second)
    {
        using (SafeFileHandle a = OpenDirectory(first))
        using (SafeFileHandle b = OpenDirectory(second))
        {
            ByHandleFileInformation x, y;
            if (!GetFileInformationByHandle(a, out x) || !GetFileInformationByHandle(b, out y))
                throw new IOException("DIRECTORY_IDENTITY_UNAVAILABLE");
            return x.Volume == y.Volume && x.IndexHigh == y.IndexHigh && x.IndexLow == y.IndexLow;
        }
    }
    private static string AbsolutePath(string path)
    {
        if (String.IsNullOrWhiteSpace(path) || !Regex.IsMatch(path, @"^[A-Za-z]:[\\/]")) throw new IOException("ABSOLUTE_LOCAL_PATH_REQUIRED");
        return System.IO.Path.GetFullPath(path);
    }
    public static void RejectReparseParents(string path)
    { for (string next = path; !String.IsNullOrEmpty(next); next = System.IO.Path.GetDirectoryName(next)) RejectReparse(next); }
    public static void ValidateProgramTree(string root)
    {
        RejectReparseParents(root);
        if (!Directory.Exists(root)) return;
        foreach (string entry in Directory.GetFileSystemEntries(root))
        {
            RejectReparse(entry);
            if (Directory.Exists(entry)) ValidateProgramTree(entry);
            else using (SafeFileHandle handle = CreateFile(entry, 0x80000000, 7, IntPtr.Zero, 3, 0x00200000, IntPtr.Zero))
            { if (handle.IsInvalid) throw new IOException("PROGRAM_FILE_UNREADABLE"); CheckRegularHandle(handle); }
        }
    }
    private static void RejectReparse(string path)
    {
        uint attributes = GetFileAttributes(path);
        if (attributes == InvalidAttributes)
        { int error = Marshal.GetLastWin32Error(); if (error != 2 && error != 3) throw new IOException("PATH_UNREADABLE"); }
        else if ((attributes & ReparsePoint) != 0) throw new IOException("REPARSE_POINT_REJECTED");
    }

    [StructLayout(LayoutKind.Sequential)] private struct NativeFileTime { public uint Low; public uint High; }
#if !CAB_PAYLOAD
    [StructLayout(LayoutKind.Sequential)] private struct RmUniqueProcess { public uint Id; public NativeFileTime Start; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct RmProcessInfo
    {
        public RmUniqueProcess Process;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string Name;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string Service;
        public uint Type; public uint Status; public uint Session;
        [MarshalAs(UnmanagedType.Bool)] public bool Restartable;
    }
#endif
    [StructLayout(LayoutKind.Sequential)] private struct SecurityAttributes { public int Length; public IntPtr Descriptor; [MarshalAs(UnmanagedType.Bool)] public bool Inherit; }
    [StructLayout(LayoutKind.Sequential)] private struct ByHandleFileInformation
    { public uint Attributes; public NativeFileTime Creation, Access, Write; public uint Volume, SizeHigh, SizeLow, NumberOfLinks, IndexHigh, IndexLow; }
    private delegate bool EnumWindowsCallback(IntPtr window, IntPtr parameter);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern SafeFileHandle OpenProcess(uint access, bool inherit, uint id);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetProcessTimes(SafeFileHandle process, out NativeFileTime creation, out NativeFileTime exit, out NativeFileTime kernel, out NativeFileTime user);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool QueryFullProcessImageName(SafeFileHandle process, uint flags, StringBuilder path, ref uint size);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool ProcessIdToSessionId(uint id, out uint session);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool OpenProcessToken(SafeFileHandle process, uint access, out SafeFileHandle token);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint WaitForSingleObject(SafeFileHandle handle, uint milliseconds);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr parameter);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint id);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
#if !CAB_PAYLOAD
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr CommandLineToArgv(string command, out int count);
#endif
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr memory);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern uint GetFileAttributes(string path);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern SafeFileHandle CreateFile(string path, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetFileInformationByHandle(SafeFileHandle file, out ByHandleFileInformation info);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern uint GetFinalPathNameByHandle(SafeFileHandle file, StringBuilder path, uint size, uint flags);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool CreateDirectory(string path, ref SecurityAttributes security);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(string descriptor, uint revision, out IntPtr security, out uint size);
#if !CAB_PAYLOAD
    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)] private static extern int RmStartSession(out uint session, uint flags, StringBuilder key);
    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)] private static extern int RmRegisterResources(uint session, uint files, string[] names, uint applications, RmUniqueProcess[] processes, uint services, string[] serviceNames);
    [DllImport("rstrtmgr.dll")] private static extern int RmShutdown(uint session, uint flags, IntPtr callback);
    [DllImport("rstrtmgr.dll")] private static extern int RmEndSession(uint session);
    [DllImport("rstrtmgr.dll")] private static extern int RmCancelCurrentTask(uint session);
    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)] private static extern int RmGetList(uint session, out uint needed, ref uint count, [In, Out] RmProcessInfo[] processes, out uint rebootReasons);
#endif
}

public static class SetupBootstrapper
{
    [STAThread]
    public static int Main(string[] args)
    {
        bool silent = args.Length == 1 && args[0] == "--silent";
        bool extract = args.Length == 1 && args[0].StartsWith("--extract-payload=", StringComparison.Ordinal);
        if (args.Length > 1 || args.Length == 1 && !silent && !extract) return Report("INVALID_ARGUMENTS", null, null, null, null, true);
        if (extract)
        {
            try { using (SetupBootstrapperCore.ExtractPayloadFile(args[0].Substring("--extract-payload=".Length))) { } return Report("EXTRACTED", null, null, null, null, true); }
            catch { return Report("EXTRACTION_FAILED", null, null, null, null, true); }
        }
        CloseResult closed = null;
        string before = null, after = null, directory = null, extractedFile = null;
        int? innerExit = null;
        bool payloadStarted = false;
        bool ownsMutex = false;
        Mutex mutex = null;
        try
        {
            string sid = WindowsIdentity.GetCurrent().User.Value;
            var security = new MutexSecurity(); security.SetAccessRuleProtection(true, false);
            security.AddAccessRule(new MutexAccessRule(new SecurityIdentifier(sid), MutexRights.FullControl, AccessControlType.Allow));
            security.AddAccessRule(new MutexAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null), MutexRights.FullControl, AccessControlType.Allow));
            bool created;
            mutex = new Mutex(false, @"Local\SarevocsCCUPlaner.Install." + sid, out created, security);
            try { ownsMutex = mutex.WaitOne(0); } catch (AbandonedMutexException) { ownsMutex = true; }
            if (!ownsMutex) return Report("INSTALLER_ALREADY_RUNNING", null, null, null, null, silent, payloadStarted);
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string root = System.IO.Path.Combine(local, "SarevocsCCUPlaner");
            using (SetupBootstrapperCore.AcquireInstallLock(root))
            {
                closed = SetupBootstrapperCore.CloseOwnProcesses(root);
                if (!closed.Success) return Report("CLOSE_" + closed.Code, closed, null, null, null, silent, payloadStarted);
                DisplaySetup display = DisplaySetup.Prepare(local, silent);
                if (display.Cancelled) return Report("SETUP_CANCELLED", closed, null, null, null, true, payloadStarted);
                string inventory = System.IO.Path.Combine(local, @"SarevocsCCUPlaner-Daten\Daten\inventory.sqlite");
                before = File.Exists(inventory) ? SetupBootstrapperCore.FileSha256(inventory) : null;
                directory = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "SarevocsCCUPlaner-Setup-" + Guid.NewGuid().ToString("N"));
                using (PayloadLease payload = SetupBootstrapperCore.ExtractPayload(directory))
                {
                    extractedFile = payload.Path;
                    string stopped = SetupBootstrapperCore.VerifyStopped(root);
                    if (stopped != "SUCCESS") return Report("PRESTART_" + stopped, closed, null, before, null, silent, payloadStarted);
                    var start = new ProcessStartInfo(payload.Path, silent ? "--silent" : "") { UseShellExecute = false, WorkingDirectory = directory, CreateNoWindow = silent, RedirectStandardOutput = true, RedirectStandardError = true };
                    using (Process process = Process.Start(start))
                    {
                        if (process == null) throw new IOException("INNER_SETUP_START_FAILED");
                        payloadStarted = true;
                        process.OutputDataReceived += delegate { }; process.ErrorDataReceived += delegate { };
                        process.BeginOutputReadLine(); process.BeginErrorReadLine(); process.WaitForExit(); innerExit = process.ExitCode;
                    }
                }
                after = File.Exists(inventory) ? SetupBootstrapperCore.FileSha256(inventory) : null;
                if (innerExit != 0) return Report("INNER_SETUP_FAILED", closed, innerExit, before, after, silent, payloadStarted);
                if (!String.Equals(before, after, StringComparison.Ordinal)) return Report("INVENTORY_CHANGED", closed, innerExit, before, after, silent, payloadStarted);
                display.Commit(local);
                return Report("SUCCESS", closed, innerExit, before, after, silent, payloadStarted);
            }
        }
        catch { return Report("INSTALLATION_ABORTED", closed, innerExit, before, after, silent, payloadStarted); }
        finally
        {
            if (ownsMutex) mutex.ReleaseMutex(); if (mutex != null) mutex.Dispose();
            // Delete only this invocation's known payload and its now-empty private directory.
            if (extractedFile != null) { try { File.Delete(extractedFile); } catch { } }
            if (directory != null) { try { Directory.Delete(directory, false); } catch { } }
        }
    }
    private static int Report(string code, CloseResult result, int? innerExit, string before, string after, bool silent, bool payloadStarted = false)
    {
        Console.WriteLine("{\"code\":\"" + code + "\",\"detectedMainCount\":" + (result == null ? 0 : result.DetectedMainCount) + ",\"detectedProcessCount\":" + (result == null ? 0 : result.DetectedProcessCount) + ",\"exitedCount\":" + (result == null ? 0 : result.ExitedCount) + ",\"restartManagerCode\":" + (result == null ? -1 : result.RestartManagerCode) + ",\"innerExitCode\":" + (innerExit.HasValue ? innerExit.Value.ToString() : "null") + ",\"payloadStarted\":" + (payloadStarted ? "true" : "false") + ",\"inventoryShaBefore\":" + JsonHash(before) + ",\"inventoryShaAfter\":" + JsonHash(after) + "}");
        bool success = code == "SUCCESS" || code == "EXTRACTED";
        if (!success && !silent) MessageBox.Show("Installation nicht abgeschlossen (" + code + "). Bitte den Planer über Beenden schließen und erneut versuchen. Es wurde kein Programm zwangsweise beendet.", SetupBootstrapperCore.ApplicationTitle, MessageBoxButtons.OK, MessageBoxIcon.Error);
        return success ? 0 : 1;
    }
    private static string JsonHash(string value) { return value == null ? "null" : "\"" + value + "\""; }
}
