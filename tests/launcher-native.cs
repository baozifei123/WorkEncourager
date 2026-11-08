using System;
using System.Drawing;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

internal static class BuildInfo { internal const string BuildId = "test"; }

public static class LauncherNativeTests
{
    private delegate bool EnumWindowsProc(IntPtr window, IntPtr extra);
    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr extra);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr window, int command);

    [STAThread]
    public static int Main()
    {
        bool existing = false;
        EnumWindows(delegate(IntPtr window, IntPtr extra)
        {
            StringBuilder title = new StringBuilder(512);
            GetWindowText(window, title, title.Capacity);
            if (title.ToString().StartsWith("上班鼓励器 · 工时银行", StringComparison.Ordinal)) existing = true;
            return !existing;
        }, IntPtr.Zero);
        if (existing)
        {
            Console.WriteLine("SKIP: an existing work bank window must not be disturbed");
            return 0;
        }

        using (Form decoy = new Form())
        using (Form bank = new Form())
        {
            decoy.Text = "上班鼓励器 — unrelated window";
            bank.Text = "上班鼓励器 · 工时银行 [test]";
            decoy.ShowInTaskbar = false;
            bank.ShowInTaskbar = false;
            decoy.StartPosition = FormStartPosition.Manual;
            bank.StartPosition = FormStartPosition.Manual;
            decoy.Location = new Point(-10000, -10000);
            bank.Location = new Point(-10000, -10000);
            decoy.Show();
            bank.Show();
            ShowWindow(bank.Handle, 0);
            if (IsWindowVisible(bank.Handle)) throw new Exception("The test panel must begin hidden");
            MethodInfo activate = typeof(Launcher).GetMethod("ActivateExisting", BindingFlags.Static | BindingFlags.NonPublic);
            if (activate == null || !(bool)activate.Invoke(null, null)) throw new Exception("The hidden panel should be found");
            if (!IsWindowVisible(bank.Handle) || IsIconic(bank.Handle))
                throw new Exception("Relaunch must restore the hidden panel rather than the similarly named window");
        }
        Console.WriteLine("Hidden work bank activation passed.");
        return 0;
    }
}
