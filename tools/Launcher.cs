using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("上班鼓励器")]
[assembly: AssemblyDescription("工时银行便携启动器")]
[assembly: AssemblyProduct("上班鼓励器 · 工时银行")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]
[assembly: AssemblyInformationalVersion(BuildInfo.BuildId)]

internal static class Launcher
{
    private const string AppFolderName = "上班鼓励器";
    private const int SW_RESTORE = 9;

    private static readonly string[,] ResourceMap = new string[,]
    {
        { "WorkEncourager.hta", "上班鼓励器.hta" },
        { "DesktopPet.cs", "DesktopPet.cs" },
        { "README.md", "README.md" },
        { "character-design.md", @"assets\character-design.md" },
        { "whale-character.png", @"assets\whale-character.png" },
        { "whale-blink.png", @"assets\whale-blink.png" },
        { "whale-wave.png", @"assets\whale-wave.png" },
        { "whale-celebrate.png", @"assets\whale-celebrate.png" },
        { "whale-working.png", @"assets\whale-working.png" },
        { "whale-sprint.png", @"assets\whale-sprint.png" },
        { "whale-fight.png", @"assets\whale-fight.png" },
        { "whale-face.png", @"assets\whale-face.png" }
    };

    private delegate bool EnumWindowsProc(IntPtr window, IntPtr extra);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr extra);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr window);

    [STAThread]
    private static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        try
        {
            return Run(args);
        }
        catch (Exception error)
        {
            MessageBox.Show("上班鼓励器启动失败：\r\n\r\n" + error.Message,
                "上班鼓励器", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    private static int Run(string[] args)
    {
        if (HasFlag(args, "--help") || HasFlag(args, "-h"))
        {
            ShowHelp();
            return 0;
        }

        string root = ResolveRoot(FlagValue(args, "--data-dir"));
        Directory.CreateDirectory(root);

        if (HasFlag(args, "--data"))
        {
            Process.Start(new ProcessStartInfo("explorer.exe", "\"" + root + "\"") { UseShellExecute = true });
            return 0;
        }

        bool prepare = HasFlag(args, "--prepare");
        string importPath = FlagValue(args, "--import");

        using (Mutex mutex = new Mutex(false, MutexName(root)))
        {
            if (!prepare)
            {
                if (!mutex.WaitOne(0, false))
                {
                    if (!ActivateExisting())
                        MessageBox.Show("上班鼓励器已经在运行，请查看任务栏。", "上班鼓励器",
                            MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return 0;
                }
            }

            try
            {
                EnsureFiles(root);
                if (importPath != null)
                    ImportLedger(root, importPath);
                else if (!prepare)
                    OfferImportFromExeFolder(root);

                if (prepare)
                    return 0;

                return Launch(root);
            }
            finally
            {
                if (!prepare)
                    mutex.ReleaseMutex();
            }
        }
    }

    private static string ResolveRoot(string configured)
    {
        if (String.IsNullOrEmpty(configured))
            configured = Environment.GetEnvironmentVariable("WORKENCOURAGER_DATA_DIR");
        if (!String.IsNullOrEmpty(configured))
        {
            string expanded = Environment.ExpandEnvironmentVariables(configured);
            if (!Path.IsPathRooted(expanded))
                expanded = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, expanded);
            return Path.GetFullPath(expanded);
        }

        string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        if (String.IsNullOrEmpty(local))
            local = AppDomain.CurrentDomain.BaseDirectory;
        return Path.Combine(local, AppFolderName);
    }

    private static string MutexName(string root)
    {
        using (SHA256 sha = SHA256.Create())
        {
            byte[] digest = sha.ComputeHash(Encoding.UTF8.GetBytes(root.TrimEnd('\\').ToLowerInvariant()));
            StringBuilder hex = new StringBuilder();
            for (int i = 0; i < 8; i++) hex.Append(digest[i].ToString("x2"));
            return "Local\\WorkEncourager_" + hex;
        }
    }

    private static void EnsureFiles(string root)
    {
        string marker = Path.Combine(root, ".build");
        bool current = false;
        if (File.Exists(marker))
        {
            try { current = File.ReadAllText(marker, Encoding.UTF8).Trim() == BuildInfo.BuildId; }
            catch (IOException) { current = false; }
            catch (UnauthorizedAccessException) { current = false; }
        }
        if (current)
        {
            for (int i = 0; i < ResourceMap.GetLength(0); i++)
            {
                if (!File.Exists(Path.Combine(root, ResourceMap[i, 1]))) { current = false; break; }
            }
        }
        if (current) return;

        string staging = Path.Combine(root, ".staging-" + Process.GetCurrentProcess().Id + "-" + DateTime.UtcNow.Ticks);
        Directory.CreateDirectory(staging);
        try
        {
            Assembly assembly = Assembly.GetExecutingAssembly();
            for (int i = 0; i < ResourceMap.GetLength(0); i++)
            {
                string resourceName = ResourceMap[i, 0], relative = ResourceMap[i, 1];
                using (Stream input = assembly.GetManifestResourceStream(resourceName))
                {
                    if (input == null) throw new InvalidOperationException("缺少内嵌资源：" + resourceName);
                    string stagedPath = Path.Combine(staging, relative);
                    Directory.CreateDirectory(Path.GetDirectoryName(stagedPath));
                    using (FileStream output = new FileStream(stagedPath, FileMode.Create, FileAccess.Write, FileShare.None))
                        input.CopyTo(output);
                }
            }
            for (int i = 0; i < ResourceMap.GetLength(0); i++)
            {
                string relative = ResourceMap[i, 1];
                string target = Path.Combine(root, relative);
                Directory.CreateDirectory(Path.GetDirectoryName(target));
                File.Copy(Path.Combine(staging, relative), target, true);
            }
            File.WriteAllText(marker, BuildInfo.BuildId, new UTF8Encoding(false));
        }
        finally
        {
            try { Directory.Delete(staging, true); }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
    }

    private static void OfferImportFromExeFolder(string root)
    {
        string source = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "workbank.json");
        string target = Path.Combine(root, "workbank.json");
        if (!File.Exists(source) || File.Exists(target)) return;
        if (String.Equals(Path.GetFullPath(source), Path.GetFullPath(target), StringComparison.OrdinalIgnoreCase)) return;

        string declined = Path.Combine(root, ".import-declined");
        try
        {
            if (File.Exists(declined) && File.ReadAllText(declined, Encoding.UTF8).Trim() == Path.GetFullPath(source)) return;
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }

        DialogResult answer = MessageBox.Show(
            "检测到 EXE 同目录存在 workbank.json。\r\n\r\n是否将它和备份导入到：\r\n" + root +
            "\r\n\r\n选择“否”会以新账本启动；之后可在 EXE 目录运行 --import 手动导入。",
            "上班鼓励器 · 导入账本", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
        if (answer == DialogResult.Yes)
            CopyLedger(source, target);
        else
            File.WriteAllText(declined, Path.GetFullPath(source), new UTF8Encoding(false));
    }

    private static void ImportLedger(string root, string source)
    {
        source = Path.GetFullPath(Environment.ExpandEnvironmentVariables(source));
        if (Directory.Exists(source)) source = Path.Combine(source, "workbank.json");
        string target = Path.Combine(root, "workbank.json");
        if (!File.Exists(source))
        {
            MessageBox.Show("找不到账本文件：\r\n" + source, "上班鼓励器", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }
        if (String.Equals(Path.GetFullPath(source), Path.GetFullPath(target), StringComparison.OrdinalIgnoreCase))
            return;
        if (File.Exists(target))
        {
            MessageBox.Show("目标目录已有 workbank.json，未覆盖。\r\n请先备份并移走现有账本后再导入。",
                "上班鼓励器", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }
        CopyLedger(source, target);
    }

    private static void CopyLedger(string source, string target)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(target));
        File.Copy(source, target, false);
        string backup = source + ".bak";
        if (File.Exists(backup)) File.Copy(backup, target + ".bak", false);
    }

    private static int Launch(string root)
    {
        string hta = Path.Combine(root, "上班鼓励器.hta");
        string mshta = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "mshta.exe");
        ProcessStartInfo info = new ProcessStartInfo(mshta, "\"" + hta + "\"");
        info.UseShellExecute = false;
        info.WorkingDirectory = root;
        DateTime started = DateTime.UtcNow;
        using (Process process = Process.Start(info))
        {
            if (process == null) throw new InvalidOperationException("无法启动 mshta.exe。请检查系统策略。");
            process.WaitForExit();
            if (process.ExitCode != 0 && (DateTime.UtcNow - started).TotalSeconds < 3)
                throw new InvalidOperationException("界面未能启动。请检查系统是否允许运行 mshta.exe。");
            return process.ExitCode;
        }
    }

    private static bool ActivateExisting()
    {
        IntPtr found = IntPtr.Zero;
        EnumWindows(delegate(IntPtr window, IntPtr extra)
        {
            if (!IsWindowVisible(window)) return true;
            StringBuilder title = new StringBuilder(512);
            GetWindowText(window, title, title.Capacity);
            if (title.ToString().IndexOf("上班鼓励器", StringComparison.Ordinal) >= 0)
            {
                found = window;
                return false;
            }
            return true;
        }, IntPtr.Zero);
        if (found == IntPtr.Zero) return false;
        ShowWindow(found, SW_RESTORE);
        SetForegroundWindow(found);
        return true;
    }

    private static bool HasFlag(string[] args, string flag)
    {
        for (int i = 0; i < args.Length; i++)
            if (String.Equals(args[i], flag, StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    private static string FlagValue(string[] args, string flag)
    {
        for (int i = 0; i + 1 < args.Length; i++)
            if (String.Equals(args[i], flag, StringComparison.OrdinalIgnoreCase)) return args[i + 1];
        return null;
    }

    private static void ShowHelp()
    {
        MessageBox.Show(
            "上班鼓励器 · 工时银行\r\n\r\n" +
            "双击 EXE：启动程序\r\n" +
            "--data：打开账本所在目录\r\n" +
            "--prepare：只释放或更新程序文件，不启动\r\n" +
            "--import <文件或目录>：导入 workbank.json 后启动\r\n" +
            "--data-dir <目录>：使用指定数据目录\r\n" +
            "也可用环境变量 WORKENCOURAGER_DATA_DIR 指定数据目录。\r\n\r\n" +
            "默认数据目录：%LOCALAPPDATA%\\上班鼓励器",
            "上班鼓励器 · 帮助", MessageBoxButtons.OK, MessageBoxIcon.Information);
    }
}
