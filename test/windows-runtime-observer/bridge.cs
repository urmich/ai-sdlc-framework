using System;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

public sealed class ObserverNativeSample
{
    public uint WaitStatus;
    public bool? NativeExited;
    public string CreationTicks;
    public string ExitTicks;
    public string KernelTicks;
    public string UserTicks;
    public string CpuTicks;
    public uint? ExitCode;
}

public static class ObserverNative
{
    private const ulong UnixEpochFileTime = 116444736000000000UL;

    [StructLayout(LayoutKind.Sequential)]
    private struct FileTime
    {
        public uint Low;
        public uint High;
        public ulong Ticks { get { return ((ulong)High << 32) | Low; } }
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetProcessTimes(
        IntPtr process, out FileTime creation, out FileTime exit,
        out FileTime kernel, out FileTime user);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool QueryFullProcessImageNameW(
        IntPtr process, uint flags, StringBuilder image, ref uint size);

    public static ObserverNativeSample Read(IntPtr handle)
    {
        ObserverNativeSample result = new ObserverNativeSample();
        result.WaitStatus = WaitForSingleObject(handle, 0);
        if (result.WaitStatus == 0) result.NativeExited = true;
        if (result.WaitStatus == 258) result.NativeExited = false;
        FileTime creation, exit, kernel, user;
        if (GetProcessTimes(handle, out creation, out exit, out kernel, out user))
        {
            result.CreationTicks = creation.Ticks.ToString(CultureInfo.InvariantCulture);
            result.KernelTicks = kernel.Ticks.ToString(CultureInfo.InvariantCulture);
            result.UserTicks = user.Ticks.ToString(CultureInfo.InvariantCulture);
            result.CpuTicks = checked(kernel.Ticks + user.Ticks).ToString(CultureInfo.InvariantCulture);
            // Exit FILETIME is undefined for a live process. Never export it.
            if (result.NativeExited == true && exit.Ticks != 0)
                result.ExitTicks = exit.Ticks.ToString(CultureInfo.InvariantCulture);
        }
        uint code;
        if (GetExitCodeProcess(handle, out code) && result.NativeExited == true)
            result.ExitCode = code;
        return result;
    }

    public static string ClosedImage(IntPtr handle)
    {
        StringBuilder buffer = new StringBuilder(32768);
        uint length = (uint)buffer.Capacity;
        if (!QueryFullProcessImageNameW(handle, 0, buffer, ref length)) return "unavailable";
        string basename = Path.GetFileName(buffer.ToString());
        if (String.Equals(basename, "taskkill.exe", StringComparison.OrdinalIgnoreCase)) return "taskkill";
        if (String.Equals(basename, "node.exe", StringComparison.OrdinalIgnoreCase)) return "node";
        if (String.Equals(basename, "node24.exe", StringComparison.OrdinalIgnoreCase)) return "node24";
        return "other";
    }

    public static bool CreatedBefore(ObserverNativeSample sample, long unixMilliseconds)
    {
        ulong creation;
        if (unixMilliseconds <= 0 ||
            !UInt64.TryParse(sample.CreationTicks, NumberStyles.None, CultureInfo.InvariantCulture, out creation) ||
            creation < UnixEpochFileTime) return false;
        ulong bound = checked(UnixEpochFileTime + (ulong)unixMilliseconds * 10000UL);
        return creation < bound;
    }
}
