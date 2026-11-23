using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;

internal static class CabinetPayload
{
    private const uint FileInCabinet = 0x11;
    private const uint NeedNewCabinet = 0x12;
    private const uint FileExtracted = 0x13;
    private const uint ExtractFile = 1;
    private const uint AbortCabinet = 0;
    private const uint InvalidData = 13;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct CabinetFile
    {
        internal IntPtr Name;
        internal uint Size, Error;
        internal ushort Date, Time, Attributes;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        internal string Destination;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ExtractedFile
    {
        internal IntPtr Target, Source;
        internal uint Error, Flags;
    }

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    private delegate uint CabinetCallback(IntPtr context, uint notification, IntPtr first, IntPtr second);

    [DllImport("setupapi.dll", EntryPoint = "SetupIterateCabinetW", CharSet = CharSet.Unicode,
        ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IterateCabinet(string path, uint reserved, CabinetCallback callback, IntPtr context);

    internal static void Extract(string cabinet, string staging, InstallTransaction.ProgramFile[] manifest, Action<int> progress)
    {
        InstallLocation.Validate(staging, Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), true);
        var remaining = manifest.ToDictionary(entry => entry.Name, StringComparer.OrdinalIgnoreCase);
        long total = manifest.Sum(entry => entry.Size), prepared = 0;
        long activeSize = 0;
        Exception failure = null;
        CabinetCallback callback = delegate(IntPtr context, uint notification, IntPtr first, IntPtr second)
        {
            if (failure != null) return notification == FileInCabinet ? AbortCabinet : InvalidData;
            try
            {
                if (notification == NeedNewCabinet) throw new IOException("MULTIPART_PAYLOAD");
                if (notification == FileInCabinet)
                {
                    var file = (CabinetFile)Marshal.PtrToStructure(first, typeof(CabinetFile));
                    string name = Marshal.PtrToStringUni(file.Name).Replace('\\', '/');
                    InstallTransaction.ProgramFile expected;
                    if (!remaining.TryGetValue(name, out expected) || expected.Size != file.Size)
                        throw new IOException("UNEXPECTED_CABINET_ENTRY");
                    string destination = InstallTransaction.FilePath(staging, expected.Name);
                    if (destination.Length >= 260 || File.Exists(destination) || Directory.Exists(destination))
                        throw new IOException("INVALID_CABINET_DESTINATION");
                    SetupBootstrapperCore.RejectReparseParents(destination);
                    Directory.CreateDirectory(Path.GetDirectoryName(destination));
                    SetupBootstrapperCore.RejectReparseParents(destination);
                    file.Destination = destination;
                    Marshal.StructureToPtr(file, first, false);
                    remaining.Remove(name);
                    activeSize = expected.Size;
                    return ExtractFile;
                }
                if (notification == FileExtracted)
                {
                    var file = (ExtractedFile)Marshal.PtrToStructure(first, typeof(ExtractedFile));
                    if (file.Error != 0) throw new Win32Exception(unchecked((int)file.Error));
                    prepared += activeSize;
                    if (total > 0) progress((int)(100 * prepared / total));
                }
                return 0;
            }
            catch (Exception error)
            {
                // Never let a managed exception cross the Windows callback boundary.
                failure = error;
                return notification == FileInCabinet ? AbortCabinet : InvalidData;
            }
        };
        bool success = IterateCabinet(cabinet, 0, callback, IntPtr.Zero);
        if (failure != null) throw new IOException("CABINET_EXTRACTION_FAILED", failure);
        if (!success) throw new IOException("CABINET_EXTRACTION_FAILED", new Win32Exception(Marshal.GetLastWin32Error()));
        if (remaining.Count != 0) throw new IOException("MISSING_CABINET_FILES");
    }
}
