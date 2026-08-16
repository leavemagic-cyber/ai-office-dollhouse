using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

internal static class AIOfficeClickThrough
{
    private const int GwlExStyle = -20;
    private const long WsExTransparent = 0x20L;
    private const int ChromeBar = 15;
    private const int ChromeApproach = 20;
    private const int ResizeEdge = 12;

    [StructLayout(LayoutKind.Sequential)]
    private struct Point { public int X; public int Y; }

    [StructLayout(LayoutKind.Sequential)]
    private struct Rect { public int Left; public int Top; public int Right; public int Bottom; }

    [DllImport("user32.dll")] private static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] private static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] private static extern uint GetDpiForWindow(IntPtr window);
    [DllImport("user32.dll", EntryPoint = "GetWindowLong")] private static extern int GetWindowLong32(IntPtr window, int index);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtr")] private static extern IntPtr GetWindowLongPtr64(IntPtr window, int index);
    [DllImport("user32.dll", EntryPoint = "SetWindowLong")] private static extern int SetWindowLong32(IntPtr window, int index, int value);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtr")] private static extern IntPtr SetWindowLongPtr64(IntPtr window, int index, IntPtr value);

    private static long GetExtendedStyle(IntPtr window)
    {
        return IntPtr.Size == 8 ? GetWindowLongPtr64(window, GwlExStyle).ToInt64() : GetWindowLong32(window, GwlExStyle);
    }

    private static void SetExtendedStyle(IntPtr window, long value)
    {
        if (IntPtr.Size == 8) SetWindowLongPtr64(window, GwlExStyle, new IntPtr(value));
        else SetWindowLong32(window, GwlExStyle, unchecked((int)value));
    }

    private static void Apply(IntPtr window, bool clickThrough)
    {
        if (window == IntPtr.Zero) return;
        long current = GetExtendedStyle(window);
        long next = clickThrough ? current | WsExTransparent : current & ~WsExTransparent;
        if (next != current) SetExtendedStyle(window, next);
    }

    private static int ParseProcessId(string[] args)
    {
        for (int index = 0; index + 1 < args.Length; index++)
        {
            if (!String.Equals(args[index], "--pid", StringComparison.OrdinalIgnoreCase)) continue;
            int value;
            return Int32.TryParse(args[index + 1], out value) && value > 0 ? value : 0;
        }
        return 0;
    }

    private static bool WantsClickThrough(IntPtr window)
    {
        if (window == IntPtr.Zero || !IsWindowVisible(window) || IsIconic(window)) return false;
        Rect rect;
        Point cursor;
        if (!GetWindowRect(window, out rect) || !GetCursorPos(out cursor)) return false;
        if (cursor.X < rect.Left || cursor.X >= rect.Right || cursor.Y < rect.Top || cursor.Y >= rect.Bottom) return false;
        uint dpi = GetDpiForWindow(window);
        double scale = dpi >= 48 && dpi <= 384 ? dpi / 96.0 : 1.0;
        double topBand = (ChromeBar + ChromeApproach) * scale;
        double edgeBand = ResizeEdge * scale;
        bool onChrome = cursor.Y < rect.Top + topBand || cursor.X < rect.Left + edgeBand ||
                        cursor.X >= rect.Right - edgeBand || cursor.Y >= rect.Bottom - edgeBand;
        return !onChrome;
    }

    private static int Main(string[] args)
    {
        int processId = ParseProcessId(args);
        if (processId <= 0) return 2;
        SetProcessDPIAware();
        try { Process.GetCurrentProcess().PriorityClass = ProcessPriorityClass.BelowNormal; } catch { }

        Process target;
        try { target = Process.GetProcessById(processId); }
        catch { return 3; }

        IntPtr lastWindow = IntPtr.Zero;
        try
        {
            while (true)
            {
                try
                {
                    if (target.HasExited) break;
                    target.Refresh();
                    IntPtr window = target.MainWindowHandle;
                    if (lastWindow != IntPtr.Zero && lastWindow != window) Apply(lastWindow, false);
                    lastWindow = window;
                    Apply(window, WantsClickThrough(window));
                }
                catch (InvalidOperationException) { break; }
                catch { if (lastWindow != IntPtr.Zero) Apply(lastWindow, false); }
                Thread.Sleep(40);
            }
        }
        finally
        {
            if (lastWindow != IntPtr.Zero) Apply(lastWindow, false);
            target.Dispose();
        }
        return 0;
    }
}
