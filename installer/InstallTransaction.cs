using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using Microsoft.Win32;

internal static class InstallTransaction
{
    private const string ManifestResource = "SarevocsCCUPlaner.PayloadManifest";
    internal const string UninstallerName = "Uninstall.exe";
    internal static bool IsSetupFile(string name)
    {
        return name == "SetupGuard.exe" || name == "install-product.txt" || name == "install-files.json";
    }
    private const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\SarevocsCCUPlaner.Selectable";
    private static readonly Regex NamePattern = new Regex(@"\A[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*\z");
    private static readonly Regex HashPattern = new Regex(@"\A[a-f0-9]{64}\z");

    internal sealed class ProgramFile
    {
        internal readonly string Name;
        internal readonly long Size;
        internal readonly string Sha256;

        internal ProgramFile(string name, long size, string sha256)
        {
            Name = name;
            Size = size;
            Sha256 = sha256;
        }
    }

    internal static ProgramFile[] ReadManifest(TextReader input)
    {
        var entries = new Dictionary<string, ProgramFile>(StringComparer.OrdinalIgnoreCase);
        for (string line = input.ReadLine(); line != null; line = input.ReadLine())
        {
            string[] fields = line.Split('\t');
            long size;
            if (fields.Length != 3 || !NamePattern.IsMatch(fields[0]) || fields[0].Split('/').Any(part => part.EndsWith(".", StringComparison.Ordinal)) ||
                !Int64.TryParse(fields[1], NumberStyles.None, CultureInfo.InvariantCulture, out size) ||
                size < 0 || !HashPattern.IsMatch(fields[2]) || entries.ContainsKey(fields[0]))
                throw new IOException("INVALID_PAYLOAD_MANIFEST");
            entries.Add(fields[0], new ProgramFile(fields[0], size, fields[2]));
        }
        if (entries.Count == 0) throw new IOException("EMPTY_PAYLOAD_MANIFEST");
        return entries.Values.OrderBy(entry => entry.Name, StringComparer.Ordinal).ToArray();
    }

    internal static string FilePath(string root, string name)
    {
        string file = Path.GetFullPath(Path.Combine(root, name.Replace('/', '\\')));
        if (!file.StartsWith(root + "\\", StringComparison.OrdinalIgnoreCase)) throw new IOException("INVALID_PAYLOAD_PATH");
        return file;
    }

    private static void CheckFile(string file, ProgramFile entry)
    {
        if (new FileInfo(file).Length != entry.Size || SetupBootstrapperCore.FileSha256(file) != entry.Sha256)
            throw new IOException("PROGRAM_FILE_HASH_MISMATCH");
    }

    private sealed class Replacement
    {
        internal readonly ProgramFile Original, Update;
        internal Replacement(string destination, ProgramFile update)
        {
            Original = new ProgramFile(update.Name, new FileInfo(destination).Length, SetupBootstrapperCore.FileSha256(destination));
            Update = update;
        }
    }

    [DllImport("kernel32.dll", EntryPoint = "MoveFileExW", ExactSpelling = true, CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool MoveFileEx(string source, string destination, uint flags);

    private static void RestoreOriginal(Replacement change, string target, string backup)
    {
        string destination = FilePath(target, change.Original.Name), saved = FilePath(backup, change.Original.Name);
        SetupBootstrapperCore.RejectReparseParents(destination);
        SetupBootstrapperCore.RejectReparseParents(saved);
        if (!File.Exists(saved))
        {
            // ReplaceFile can fail before moving the original at all.
            CheckFile(destination, change.Original);
            return;
        }
        CheckFile(saved, change.Original);
        if (File.Exists(destination))
        {
            string hash = SetupBootstrapperCore.FileSha256(destination);
            if (hash != change.Update.Sha256 && hash != change.Original.Sha256)
                throw new IOException("PROGRAM_CHANGED_DURING_ROLLBACK");
        }
        // Return the original NTFS file, including its security descriptor. Another
        // ReplaceFile would attempt to merge the new ACL into an admin-owned original.
        // COPY_ALLOWED is deliberately absent: both paths must remain on one volume.
        const uint replaceExisting = 1, writeThrough = 8;
        if (!MoveFileEx(saved, destination, replaceExisting | writeThrough))
            throw new IOException("RESTORE_RENAME_FAILED", new Win32Exception(Marshal.GetLastWin32Error()));
        CheckFile(destination, change.Original);
    }

    internal static ProgramFile[] ReadEmbeddedManifest()
    {
        using (Stream resource = Assembly.GetExecutingAssembly().GetManifestResourceStream(ManifestResource))
        {
            if (resource == null) throw new IOException("PAYLOAD_MANIFEST_MISSING");
            using (var reader = new StreamReader(resource)) return ReadManifest(reader);
        }
    }

    internal static ProgramFile[] CheckStaging(string staging, ProgramFile[] manifest)
    {
        SetupBootstrapperCore.ValidateProgramTree(staging);
        var expected = new HashSet<string>(manifest.Select(entry => FilePath(staging, entry.Name)), StringComparer.OrdinalIgnoreCase);
#if CAB_PAYLOAD
        if (!expected.Contains(FilePath(staging, UninstallerName)) || !expected.SetEquals(Directory.GetFiles(staging, "*", SearchOption.AllDirectories)))
            throw new IOException("UNEXPECTED_PAYLOAD_FILES");
        foreach (var entry in manifest) CheckFile(FilePath(staging, entry.Name), entry);
        return manifest;
#else
        string uninstaller = FilePath(staging, UninstallerName);
        if (!expected.Add(uninstaller) || !expected.SetEquals(Directory.GetFiles(staging, "*", SearchOption.AllDirectories)))
            throw new IOException("UNEXPECTED_PAYLOAD_FILES");

        // The uninstaller is generated by the verified inner setup. Capture its digest while still in private staging.
        var uninstallerEntry = new ProgramFile(UninstallerName, new FileInfo(uninstaller).Length, SetupBootstrapperCore.FileSha256(uninstaller));
        return manifest.Concat(new[] { uninstallerEntry }).ToArray();
#endif
    }

    internal static void PublishVerified(ProgramFile[] entries, string staging, string backup, string target,
        Action<Action<Action>> complete, ref bool retainBackup)
    {
        var installed = new List<ProgramFile>();
        var replaced = new List<Replacement>();
        var createdDirectories = new List<string>();
        var undoCompletion = new Stack<Action>();
        try
        {
            // Verify everything again before any existing program file can change.
            foreach (var entry in entries) CheckFile(FilePath(staging, entry.Name), entry);
            SetupBootstrapperCore.ValidateProgramTree(target);
            InstallLocation.ValidateTargetAccess(target);
            foreach (var entry in entries)
            {
                string destination = FilePath(target, entry.Name);
                if (Directory.Exists(destination)) throw new IOException("PROGRAM_PATH_CONFLICT");
                for (string folder = Path.GetDirectoryName(destination); folder.Length >= target.Length; folder = Path.GetDirectoryName(folder))
                    if (File.Exists(folder)) throw new IOException("PROGRAM_PATH_CONFLICT");
            }
            foreach (var entry in entries)
            {
                string source = FilePath(staging, entry.Name);
                string destination = FilePath(target, entry.Name);
                string directory = Path.GetDirectoryName(destination);
                SetupBootstrapperCore.RejectReparseParents(destination);
                var missing = new Stack<string>();
                for (string folder = directory; !Directory.Exists(folder); folder = Path.GetDirectoryName(folder))
                {
                    if (!folder.Equals(target, StringComparison.OrdinalIgnoreCase) &&
                        !folder.StartsWith(target + "\\", StringComparison.OrdinalIgnoreCase))
                        throw new IOException("PROGRAM_PARENT_MISSING");
                    missing.Push(folder);
                }
                foreach (string folder in missing)
                {
                    using (SetupBootstrapperCore.CreatePayloadDirectory(folder)) createdDirectories.Add(folder);
                    InstallLocation.ValidateTargetAccess(folder);
                }
                if (File.Exists(destination))
                {
                    string saved = FilePath(backup, entry.Name);
                    Directory.CreateDirectory(Path.GetDirectoryName(saved));
                    // Capture the preimage before ReplaceFile: on certain Windows
                    // errors it can already have moved the original to the backup.
                    replaced.Add(new Replacement(destination, entry));
                    File.Replace(source, destination, saved, false);
                }
                else
                {
                    File.Move(source, destination);
                    installed.Add(entry);
                }
                CheckFile(destination, entry);
            }
            complete(undoCompletion.Push);
        }
        catch (Exception error)
        {
            while (undoCompletion.Count != 0)
            {
                try { undoCompletion.Pop()(); }
                catch { retainBackup = true; }
            }
            foreach (var entry in installed.AsEnumerable().Reverse())
            {
                try
                {
                    string destination = FilePath(target, entry.Name);
                    SetupBootstrapperCore.RejectReparseParents(destination);
                    CheckFile(destination, entry);
                    File.Delete(destination);
                }
                catch { retainBackup = true; }
            }
            foreach (var change in replaced.AsEnumerable().Reverse())
            {
                try { RestoreOriginal(change, target, backup); }
                catch { retainBackup = true; }
            }
            foreach (string folder in createdDirectories.AsEnumerable().Reverse())
            {
                // A retry should be able to reuse a formerly empty target.
                try { SetupBootstrapperCore.RejectReparseParents(folder); Directory.Delete(folder, false); }
                catch (IOException) { } catch (UnauthorizedAccessException) { }
            }
            if (retainBackup) throw new IOException("INSTALL_ROLLBACK_INCOMPLETE", error);
            throw;
        }
    }

    internal static void RemoveStaging(string root, IEnumerable<string> names)
    {
        var directories = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { root };
        foreach (string name in names)
        {
            string file = FilePath(root, name);
            try { SetupBootstrapperCore.RejectReparseParents(file); File.Delete(file); } catch (IOException) { } catch (UnauthorizedAccessException) { }
            for (string folder = Path.GetDirectoryName(file); folder.Length > root.Length; folder = Path.GetDirectoryName(folder))
                directories.Add(folder);
        }
        foreach (string directory in directories.OrderByDescending(folder => folder.Length))
        {
            try { SetupBootstrapperCore.RejectReparseParents(directory); Directory.Delete(directory, false); }
            catch (IOException) { } catch (UnauthorizedAccessException) { }
        }
    }

    private static void SetValues(string path, Dictionary<string, object> values, Action<Action> undo)
    {
        bool existed;
        using (var existing = Registry.CurrentUser.OpenSubKey(path)) existed = existing != null;
        using (var key = Registry.CurrentUser.CreateSubKey(path))
        {
            if (!existed) undo(() => {
                using (var created = Registry.CurrentUser.OpenSubKey(path))
                    if (created == null || created.ValueCount != 0 || created.SubKeyCount != 0) return;
                Registry.CurrentUser.DeleteSubKey(path, false);
            });
            foreach (var value in values)
            {
                string name = value.Key;
                object prior = key.GetValue(name, null, RegistryValueOptions.DoNotExpandEnvironmentNames);
                var kind = prior == null ? RegistryValueKind.Unknown : key.GetValueKind(name);
                key.SetValue(name, value.Value);
                undo(() => {
                    using (var restore = Registry.CurrentUser.OpenSubKey(path, true))
                    {
                        if (prior == null) restore.DeleteValue(name, false);
                        else restore.SetValue(name, prior, kind);
                    }
                });
            }
        }
    }

    internal static void Register(string target, bool acceptedTerms, Action<Action> undo)
    {
        string uninstall = "\"" + Path.Combine(target, "Uninstall.exe") + "\"";
        SetupTerms.RecordAcceptance(acceptedTerms, receipt => SetValues(InstallLocation.Registration,
            new Dictionary<string, object> { { "InstallLocation", target }, { "TermsAcceptance", receipt } }, undo));
        SetValues(UninstallKey, new Dictionary<string, object> {
            { "DisplayName", "Sarevoc´s CCU Planer" }, { "DisplayVersion", EmbeddedPayload.Version }, { "Publisher", "Sarevoc" },
            { "InstallLocation", target }, { "DisplayIcon", Path.Combine(target, SetupBootstrapperCore.ExecutableName) + ",0" },
            { "UninstallString", uninstall }, { "QuietUninstallString", uninstall + " /S" }, { "NoModify", 1 }, { "NoRepair", 1 }
        }, undo);
    }
}
