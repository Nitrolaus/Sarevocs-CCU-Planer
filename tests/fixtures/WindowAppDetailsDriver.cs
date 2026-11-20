using System;using System.Runtime.InteropServices;
[StructLayout(LayoutKind.Sequential)]public struct CcuPropertyKey{public Guid Format;public uint Id;public CcuPropertyKey(uint id){Format=new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");Id=id;}}
[StructLayout(LayoutKind.Explicit,Size=24)]public struct CcuPropVariant{[FieldOffset(0)]public ushort Type;[FieldOffset(8)]public IntPtr Text;}
[ComImport,Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]public interface ICcuPropertyStore{
 [PreserveSig]int GetCount(out uint count);[PreserveSig]int GetAt(uint index,out CcuPropertyKey key);[PreserveSig]int GetValue(ref CcuPropertyKey key,out CcuPropVariant value);[PreserveSig]int SetValue(ref CcuPropertyKey key,ref CcuPropVariant value);[PreserveSig]int Commit();
}
public static class WindowAppDetailsDriver{
 delegate bool EnumCallback(IntPtr window,IntPtr data);
 [DllImport("user32.dll")]static extern bool EnumWindows(EnumCallback callback,IntPtr data);
 [DllImport("user32.dll")]static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);
 [DllImport("shell32.dll")]static extern int SHGetPropertyStoreForWindow(IntPtr window,ref Guid iid,[MarshalAs(UnmanagedType.Interface)]out ICcuPropertyStore store);
 [DllImport("ole32.dll")]static extern int PropVariantClear(ref CcuPropVariant value);
 static string Read(ICcuPropertyStore store,uint id){var key=new CcuPropertyKey(id);CcuPropVariant value;Marshal.ThrowExceptionForHR(store.GetValue(ref key,out value));try{return value.Type==31?Marshal.PtrToStringUni(value.Text):value.Type==8?Marshal.PtrToStringBSTR(value.Text):"";}finally{PropVariantClear(ref value);}}
 static string Json(string value){return "\""+value.Replace("\\","\\\\").Replace("\"","\\\"").Replace("\r","\\r").Replace("\n","\\n")+"\"";}
 [STAThread]public static int Main(string[] args){try{uint target=UInt32.Parse(args[0]);string output=null;EnumWindows(delegate(IntPtr window,IntPtr data){uint pid;GetWindowThreadProcessId(window,out pid);if(pid!=target)return true;var iid=new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");ICcuPropertyStore store;if(SHGetPropertyStoreForWindow(window,ref iid,out store)!=0)return true;try{string id=Read(store,5);if(id!="com.squirrel.SarevocsCCUPlaner.Sarevocs-CCU-Planer")return true;output="{\"appId\":"+Json(id)+",\"iconResource\":"+Json(Read(store,3))+",\"relaunchCommand\":"+Json(Read(store,2))+",\"displayName\":"+Json(Read(store,4))+"}";return false;}finally{Marshal.ReleaseComObject(store);}},IntPtr.Zero);if(output==null){Console.Error.WriteLine("WINDOW_METADATA_NOT_FOUND");return 1;}Console.OutputEncoding=new System.Text.UTF8Encoding(false);Console.WriteLine(output);return 0;}catch(Exception e){Console.Error.WriteLine(e.GetType().Name);return 2;}}
}
