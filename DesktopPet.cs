using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

// 桌宠只读取工时窗口写入的展示状态，不直接读取本地账本文件。
public sealed class WorkBankPet : Form
{
    private const int GWL_EXSTYLE = -20;
    private const int WS_EX_LAYERED = 0x00080000;
    private const int WS_EX_TOOLWINDOW = 0x00000080;
    private const int SW_MINIMIZE = 6;
    private const int SW_RESTORE = 9;
    private const int WM_CLOSE = 0x0010;
    private const int GWL_STYLE = -16;
    private const int WS_SYSMENU = 0x00080000;
    private const int WS_MINIMIZEBOX = 0x00020000;
    private const int ULW_ALPHA = 2;
    private const byte AC_SRC_ALPHA = 1;

    [StructLayout(LayoutKind.Sequential)]
    private struct NativePoint { public int X; public int Y; public NativePoint(int x, int y) { X = x; Y = y; } }
    [StructLayout(LayoutKind.Sequential)]
    private struct NativeSize { public int Width; public int Height; public NativeSize(int w, int h) { Width = w; Height = h; } }
    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    private struct BlendFunction { public byte Operation; public byte Flags; public byte Alpha; public byte Format; }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr FindWindow(string className, string title);
    [DllImport("user32.dll")]
    private static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")]
    private static extern bool AttachThreadInput(uint attach, uint attachTo, bool enabled);
    [DllImport("user32.dll")]
    private static extern bool BringWindowToTop(IntPtr window);
    [DllImport("user32.dll")]
    private static extern bool FlashWindow(IntPtr window, bool invert);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")]
    private static extern int GetWindowLong(IntPtr window, int index);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongW")]
    private static extern int SetWindowLong(IntPtr window, int index, int value);
    [DllImport("user32.dll")]
    private static extern bool PostMessage(IntPtr window, int message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")]
    private static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")]
    private static extern IntPtr GetDC(IntPtr window);
    [DllImport("user32.dll")]
    private static extern int ReleaseDC(IntPtr window, IntPtr dc);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UpdateLayeredWindow(IntPtr window, IntPtr screen, ref NativePoint destination,
        ref NativeSize size, IntPtr source, ref NativePoint sourcePoint, int colorKey, ref BlendFunction blend, int flags);
    [DllImport("gdi32.dll")]
    private static extern IntPtr CreateCompatibleDC(IntPtr dc);
    [DllImport("gdi32.dll")]
    private static extern bool DeleteDC(IntPtr dc);
    [DllImport("gdi32.dll")]
    private static extern IntPtr SelectObject(IntPtr dc, IntPtr item);
    [DllImport("gdi32.dll")]
    private static extern bool DeleteObject(IntPtr item);

    private readonly IntPtr parentWindow;
    private readonly string alivePath;
    private readonly string statePath;
    private readonly string beatPath;
    private readonly string readyPath;
    private readonly string controlPath;
    private readonly string noticePath;
    private readonly string positionPath;
    private readonly string eventDirectory;
    private readonly Bitmap normalFrame;
    private readonly Bitmap blinkFrame;
    private readonly Bitmap tiredFrame;
    private readonly Bitmap waveFrame;
    private readonly Bitmap celebrateFrame;
    private readonly Bitmap workingFrame;
    private readonly Bitmap sprintFrame;
    private readonly Timer timer;
    private readonly ToolTip tooltip;
    private readonly ContextMenuStrip menu;
    private readonly ToolStripMenuItem trackingItem;
    private readonly ToolStripMenuItem pinItem;
    private readonly MiniInfoForm mini;
    private string currentState = "unconfigured";
    private string currentTip = "";
    private string lastTooltip = "";
    private bool panelVisible = true;
    private int miniMode;
    private DateTime lastMiniHover = DateTime.MinValue;
    private int parentOriginalStyle;
    private bool parentControlsChanged;
    private string miniTheme = "deep";
    private string miniAmount = "¥ ****";
    private string miniDetail = "";
    private int miniPercent;
    private string shownFrame = "";
    private bool motion = true;
    private bool dragging;
    private bool moved;
    private Point dragCursor;
    private Point dragWindow;
    private DateTime lastHeartbeat = DateTime.MinValue;
    private DateTime pendingShow = DateTime.MinValue;
    private string lastBounds = "";
    private int tickCount;

    private WorkBankPet(IntPtr parent, string imageDirectory, string alive, string state, string beat,
        string ready, string control, string notice, string events, string positions, bool onTop, int initialX, int initialY)
    {
        parentWindow = parent;
        alivePath = alive;
        statePath = state;
        beatPath = beat;
        readyPath = ready;
        controlPath = control;
        noticePath = notice;
        positionPath = positions;
        eventDirectory = events;
        normalFrame = LoadPreferredFrame(imageDirectory, "whale-character.png");
        blinkFrame = LoadPreferredFrame(imageDirectory, "whale-blink.png");
        tiredFrame = LoadPreferredFrame(imageDirectory, "whale-tired.png");
        waveFrame = LoadPreferredFrame(imageDirectory, "whale-wave.png");
        celebrateFrame = LoadPreferredFrame(imageDirectory, "whale-celebrate.png");
        workingFrame = LoadPreferredFrame(imageDirectory, "whale-working.png");
        sprintFrame = LoadPreferredFrame(imageDirectory, "whale-sprint.png");

        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        Size = new Size(180, 240);
        Location = InitialLocation(initialX, initialY);
        TopMost = onTop;
        Text = "小鲸工时桌宠";
        AccessibleName = Text;

        menu = new ContextMenuStrip();
        menu.Items.Add("打开 / 收起工时卡片", null, delegate { TogglePanel(); });
        trackingItem = new ToolStripMenuItem("开始记录", null, delegate { ToggleTracking(); });
        menu.Items.Add(trackingItem);
        menu.Items.Add(new ToolStripSeparator());
        pinItem = new ToolStripMenuItem("小鲸窗口置顶", null, delegate { TogglePin(); });
        pinItem.Checked = onTop;
        menu.Items.Add(pinItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("退出工时银行", null, delegate { PostMessage(parentWindow, WM_CLOSE, IntPtr.Zero, IntPtr.Zero); });

        tooltip = new ToolTip();
        tooltip.ShowAlways = true;
        UpdateTooltip();
        mini = new MiniInfoForm(onTop);
        mini.OpenRequested += delegate
        {
            mini.HideCard();
            QueueEvent("show");
            pendingShow = DateTime.UtcNow;
        };
        mini.AmountRequested += delegate { QueueEvent("privacy"); };
        mini.MenuRequested += delegate { menu.Show(Cursor.Position); };
        timer = new Timer();
        timer.Interval = 200;
        timer.Tick += OnTick;
    }

    protected override CreateParams CreateParams
    {
        get
        {
            CreateParams parameters = base.CreateParams;
            parameters.ExStyle |= WS_EX_LAYERED | WS_EX_TOOLWINDOW;
            return parameters;
        }
    }

    private static Bitmap LoadPreferredFrame(string imageDirectory, string fallback)
    {
        string custom = Path.Combine(imageDirectory, "custom-character.png");
        if (File.Exists(custom))
        {
            try { return LoadFrame(custom); }
            catch (ArgumentException) { }
            catch (OutOfMemoryException) { }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
        return LoadFrame(Path.Combine(imageDirectory, fallback));
    }

    private static Bitmap LoadFrame(string path)
    {
        using (Image image = Image.FromFile(path))
        {
            Bitmap frame = new Bitmap(180, 240, PixelFormat.Format32bppPArgb);
            using (Graphics graphics = Graphics.FromImage(frame))
            {
                graphics.Clear(Color.Transparent);
                graphics.SmoothingMode = SmoothingMode.AntiAlias;
                graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                graphics.CompositingQuality = CompositingQuality.HighQuality;
                graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
                float scale = Math.Min((float)frame.Width / image.Width, (float)frame.Height / image.Height);
                int width = Math.Max(1, (int)Math.Round(image.Width * scale));
                int height = Math.Max(1, (int)Math.Round(image.Height * scale));
                graphics.DrawImage(image, new Rectangle((frame.Width - width) / 2, (frame.Height - height) / 2, width, height));
            }
            return frame;
        }
    }

    private static Point InitialLocation(int x, int y)
    {
        if (x != Int32.MinValue && y != Int32.MinValue)
        {
            Rectangle area = new Rectangle(x, y, 180, 240);
            foreach (Screen screen in Screen.AllScreens)
            {
                Rectangle intersection = Rectangle.Intersect(area, screen.WorkingArea);
                if (intersection.Width >= 35 && intersection.Height >= 35) return new Point(x, y);
            }
        }
        Rectangle work = Screen.PrimaryScreen.WorkingArea;
        return new Point(Math.Max(work.Left, work.Right - 196), Math.Max(work.Top, work.Bottom - 256));
    }

    protected override void OnShown(EventArgs e)
    {
        base.OnShown(e);
        DrawFrame(normalFrame);
        shownFrame = "normal";
        WriteFile(readyPath, "ready|" + parentWindow.ToInt64().ToString(CultureInfo.InvariantCulture));
        WriteHeartbeat();
        WritePosition(true);
        SetParentControls(false);
        ShowWindow(parentWindow, SW_MINIMIZE);
        timer.Start();
    }

    private void SetParentControls(bool restore)
    {
        if (!IsWindow(parentWindow)) return;
        int style = GetWindowLong(parentWindow, GWL_STYLE);
        if (restore)
        {
            if (!parentControlsChanged) return;
            style |= parentOriginalStyle & (WS_SYSMENU | WS_MINIMIZEBOX);
            parentControlsChanged = false;
        }
        else
        {
            parentOriginalStyle = style;
            style &= ~(WS_SYSMENU | WS_MINIMIZEBOX);
            parentControlsChanged = true;
        }
        SetWindowLong(parentWindow, GWL_STYLE, style);
        SetWindowPos(parentWindow, IntPtr.Zero, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0004 | 0x0010 | 0x0020);
    }

    private static void FocusParent(IntPtr window)
    {
        bool originallyTopmost = (GetWindowLong(window, GWL_EXSTYLE) & 8) != 0;
        if (!originallyTopmost) SetWindowPos(window, new IntPtr(-1), 0, 0, 0, 0, 0x0013);
        try
        {
            if (!SetForegroundWindow(window))
            {
                uint process;
                uint foregroundThread = GetWindowThreadProcessId(GetForegroundWindow(), out process);
                uint currentThread = GetCurrentThreadId();
                bool attached = foregroundThread != 0 && foregroundThread != currentThread && AttachThreadInput(currentThread, foregroundThread, true);
                try { BringWindowToTop(window); SetForegroundWindow(window); }
                finally { if (attached) AttachThreadInput(currentThread, foregroundThread, false); }
            }
        }
        finally
        {
            if (!originallyTopmost) SetWindowPos(window, new IntPtr(-2), 0, 0, 0, 0, 0x0013);
        }
        if (GetForegroundWindow() != window) FlashWindow(window, true);
    }

    private void DrawFrame(Bitmap frame)
    {
        IntPtr screen = GetDC(IntPtr.Zero);
        IntPtr memory = CreateCompatibleDC(screen);
        IntPtr bitmap = IntPtr.Zero;
        IntPtr previous = IntPtr.Zero;
        try
        {
            bitmap = frame.GetHbitmap(Color.FromArgb(0));
            previous = SelectObject(memory, bitmap);
            NativePoint destination = new NativePoint(Left, Top);
            NativePoint source = new NativePoint(0, 0);
            NativeSize size = new NativeSize(frame.Width, frame.Height);
            BlendFunction blend = new BlendFunction();
            blend.Alpha = 255;
            blend.Format = AC_SRC_ALPHA;
            if (!UpdateLayeredWindow(Handle, screen, ref destination, ref size, memory, ref source, 0, ref blend, ULW_ALPHA))
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        }
        finally
        {
            if (previous != IntPtr.Zero) SelectObject(memory, previous);
            if (bitmap != IntPtr.Zero) DeleteObject(bitmap);
            if (memory != IntPtr.Zero) DeleteDC(memory);
            if (screen != IntPtr.Zero) ReleaseDC(IntPtr.Zero, screen);
        }
    }

    private void OnTick(object sender, EventArgs e)
    {
        if (!IsWindow(parentWindow) || !File.Exists(alivePath)) { Close(); return; }
        try
        {
            if ((DateTime.UtcNow - File.GetLastWriteTimeUtc(alivePath)).TotalSeconds > 30) { Close(); return; }
            if ((DateTime.UtcNow - lastHeartbeat).TotalMilliseconds >= 1000) WriteHeartbeat();
            ReadState();
            if (File.Exists(controlPath))
            {
                string command = File.ReadAllText(controlPath, Encoding.ASCII).Trim();
                File.Delete(controlPath);
                string[] parts = command.Split('|');
                if (parts[0] == "hide") ShowWindow(parentWindow, SW_MINIMIZE);
                else if (parts[0] == "show")
                {
                    int x = 0, y = 0;
                    bool hasPoint = parts.Length >= 3 && Int32.TryParse(parts[1], out x) && Int32.TryParse(parts[2], out y);
                    ShowWindow(parentWindow, SW_RESTORE);
                    if (hasPoint) SetWindowPos(parentWindow, IntPtr.Zero, x, y, 0, 0, 0x0001 | 0x0004 | 0x0010);
                    FocusParent(parentWindow);
                    pendingShow = DateTime.MinValue;
                }
            }
            if (pendingShow != DateTime.MinValue && (DateTime.UtcNow - pendingShow).TotalMilliseconds > 1500)
            {
                pendingShow = DateTime.MinValue;
                ShowWindow(parentWindow, SW_RESTORE);
                FocusParent(parentWindow);
            }
            if (File.Exists(noticePath))
            {
                string notice = File.ReadAllText(noticePath, Encoding.ASCII).Trim();
                File.Delete(noticePath);
                string message = notice == "hour" ? "又走过一个整点，活跃工时已记账。" : "请打开工时卡片查看提示。";
                tooltip.Show(message, this, new Point(Width / 2, 12), 5000);
            }
            WritePosition(false);
            tickCount++;
            string wanted = SelectFrame(currentState, panelVisible, miniPercent);
            if (motion && wanted == "normal" && tickCount % 25 == 0) wanted = "blink";
            if (wanted != shownFrame)
            {
                Bitmap frame = wanted == "celebrate" ? celebrateFrame :
                    (wanted == "tired" ? tiredFrame : (wanted == "wave" ? waveFrame :
                    (wanted == "working" ? workingFrame : (wanted == "sprint" ? sprintFrame : (wanted == "blink" ? blinkFrame : normalFrame)))));
                DrawFrame(frame);
                shownFrame = wanted;
            }
            UpdateMini();
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    public static string SelectFrame(string state, bool panelOpen, int percent)
    {
        if (panelOpen) return "wave";
        if (state == "celebrate") return "celebrate";
        if (state == "overtime") return "tired";
        if ((state == "active" || state == "urgent") && percent >= 90) return "sprint";
        if ((state == "active" || state == "urgent") && percent >= 50) return "working";
        return "normal";
    }

    private void UpdateMini()
    {
        if (miniMode == 0) { mini.HideCard(); lastMiniHover = DateTime.MinValue; return; }
        bool show = miniMode == 1;
        if (miniMode == 2)
        {
            Point cursor = Cursor.Position;
            if (Bounds.Contains(cursor) || (mini.Visible && mini.Bounds.Contains(cursor))) lastMiniHover = DateTime.UtcNow;
            show = lastMiniHover != DateTime.MinValue && (DateTime.UtcNow - lastMiniHover).TotalMilliseconds < 700;
        }
        Rectangle work = Screen.FromPoint(new Point(Left + Width / 2, Top + Height / 2)).WorkingArea;
        mini.Present(miniTheme, miniAmount, miniDetail, StateLabel(), miniPercent, show,
            new Rectangle(Left, Top, Width, Height), work);
    }

    private void WritePosition(bool force)
    {
        if (String.IsNullOrEmpty(positionPath)) return;
        Rectangle work = Screen.FromPoint(new Point(Left + Width / 2, Top + Height / 2)).WorkingArea;
        string value = Left + "|" + Top + "|" + Width + "|" + Height + "|" +
            work.Left + "|" + work.Top + "|" + work.Right + "|" + work.Bottom;
        if (!force && value == lastBounds) return;
        try
        {
            File.WriteAllText(positionPath, value, Encoding.ASCII);
            lastBounds = value;
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    private void WriteHeartbeat()
    {
        long timestamp = (DateTime.UtcNow.Ticks - 621355968000000000L) / TimeSpan.TicksPerMillisecond;
        WriteFile(beatPath, timestamp.ToString(CultureInfo.InvariantCulture));
        lastHeartbeat = DateTime.UtcNow;
    }

    private void ReadState()
    {
        if (!File.Exists(statePath)) return;
        string[] values = File.ReadAllText(statePath).Trim().Split('|');
        if (values.Length < 2) return;
        currentState = values[0];
        motion = values[1] != "0";
        panelVisible = values.Length >= 4 ? values[3] == "1" : true;
        if (values.Length >= 10)
        {
            miniMode = values[4] == "2" ? 2 : (values[4] == "1" ? 1 : 0);
            miniTheme = values[5] == "cream" ? "cream" : (values[5] == "glass" ? "glass" : "deep");
            int parsed;
            miniPercent = Int32.TryParse(values[6], out parsed) ? Math.Max(0, Math.Min(100, parsed)) : 0;
            miniAmount = values[7];
            miniDetail = values[8];
            currentTip = String.Join("|", values, 9, values.Length - 9);
        }
        else
        {
            miniMode = 0;
            currentTip = values.Length >= 5 ? String.Join("|", values, 4, values.Length - 4) : "";
        }
        bool active = values.Length >= 3 ? values[2] == "1" :
            currentState == "active" || currentState == "urgent" || currentState == "idle" || currentState == "overtime" || currentState == "waiting";
        trackingItem.Text = currentState == "unconfigured" ? "设置并开始记录" : (active ? "暂停记录" : "开始记录");
        UpdateTooltip();
    }

    private string StateLabel()
    {
        return currentState == "error" ? "请查看卡片提示" : currentState == "unconfigured" ? "未设置" : currentState == "paused" ? "未开工" :
            currentState == "idle" ? "键鼠空闲" : currentState == "overtime" ? "加班中" :
            currentState == "urgent" ? "接近计划工时" : currentState == "celebrate" ? "收工快乐" :
            currentState == "waiting" ? "采样未就绪" : "上班中";
    }

    private void UpdateTooltip()
    {
        string label = StateLabel();
        string text = String.IsNullOrEmpty(currentTip) ? "小鲸 · " + label : currentTip;
        if (text == lastTooltip) return;
        lastTooltip = text;
        tooltip.SetToolTip(this, text + "\n单击打开或收起 · 拖动移动 · 右键菜单");
        AccessibleName = text;
    }

    private void TogglePanel()
    {
        if (!IsWindow(parentWindow)) return;
        if (IsWindowVisible(parentWindow) && !IsIconic(parentWindow))
        {
            QueueEvent("hide");
            ShowWindow(parentWindow, SW_MINIMIZE);
        }
        else
        {
            // 由工时窗口算出贴边位置后再展开，避免先闪在旧位置。
            QueueEvent("show");
            pendingShow = DateTime.UtcNow;
        }
    }

    private void ToggleTracking()
    {
        if (currentState == "unconfigured")
        {
            ShowWindow(parentWindow, SW_RESTORE);
            SetForegroundWindow(parentWindow);
        }
        QueueEvent("toggle");
    }

    private void TogglePin()
    {
        TopMost = !TopMost;
        mini.TopMost = TopMost;
        pinItem.Checked = TopMost;
        QueueEvent(TopMost ? "pin|1" : "pin|0");
    }

    private void QueueEvent(string command)
    {
        try
        {
            string name = DateTime.UtcNow.Ticks.ToString("D19", CultureInfo.InvariantCulture) + "-" + Guid.NewGuid().ToString("N") + ".evt";
            string path = Path.Combine(eventDirectory, name);
            File.WriteAllText(path + ".tmp", command, Encoding.ASCII);
            File.Move(path + ".tmp", path);
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        if (e.Button != MouseButtons.Left) return;
        dragging = true;
        moved = false;
        dragCursor = Cursor.Position;
        dragWindow = Location;
        Capture = true;
    }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e);
        if (!dragging) return;
        Point cursor = Cursor.Position;
        int dx = cursor.X - dragCursor.X, dy = cursor.Y - dragCursor.Y;
        if (Math.Abs(dx) > 4 || Math.Abs(dy) > 4) moved = true;
        if (!moved) return;
        Rectangle work = Screen.FromPoint(cursor).WorkingArea;
        int x = Math.Max(work.Left - Width + 40, Math.Min(dragWindow.X + dx, work.Right - 40));
        int y = Math.Max(work.Top, Math.Min(dragWindow.Y + dy, work.Bottom - 40));
        Location = new Point(x, y);
        UpdateMini();
    }

    protected override void OnMouseUp(MouseEventArgs e)
    {
        base.OnMouseUp(e);
        if (e.Button == MouseButtons.Right) { menu.Show(this, e.Location); return; }
        if (e.Button != MouseButtons.Left || !dragging) return;
        dragging = false;
        Capture = false;
        if (moved) QueueEvent("position|" + Left.ToString(CultureInfo.InvariantCulture) + "|" + Top.ToString(CultureInfo.InvariantCulture));
        else TogglePanel();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            SetParentControls(true);
            timer.Stop();
            timer.Dispose();
            tooltip.Dispose();
            menu.Dispose();
            normalFrame.Dispose();
            blinkFrame.Dispose();
            tiredFrame.Dispose();
            waveFrame.Dispose();
            celebrateFrame.Dispose();
            workingFrame.Dispose();
            sprintFrame.Dispose();
            mini.Dispose();
        }
        base.Dispose(disposing);
    }

    private static void WriteFile(string path, string value)
    {
        File.WriteAllText(path, value, Encoding.ASCII);
    }

    private static void DeleteFile(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }

    public static void Run(string parentTitle, string imageDirectory, string alive, string state, string beat,
        string ready, string control, string notice, string events, string positions, bool onTop, int initialX, int initialY)
    {
        IntPtr parent = FindWindow(null, parentTitle);
        if (parent == IntPtr.Zero)
        {
            try { WriteFile(ready, "error"); } catch (Exception) { }
            return;
        }
        try
        {
            SetProcessDPIAware();
            Application.EnableVisualStyles();
            using (WorkBankPet pet = new WorkBankPet(parent, imageDirectory, alive, state, beat, ready, control, notice, events, positions, onTop, initialX, initialY))
                Application.Run(pet);
        }
        catch (Exception)
        {
            try { WriteFile(ready, "error"); } catch (Exception) { }
        }
        finally
        {
            if (IsWindow(parent) && IsIconic(parent)) ShowWindow(parent, SW_RESTORE);
            DeleteFile(alive);
            DeleteFile(state);
            DeleteFile(beat);
            DeleteFile(control);
            DeleteFile(notice);
            DeleteFile(positions);
            try { if (Directory.Exists(events)) Directory.Delete(events, true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
        }
    }
}

// 桌宠旁的小卡片：只显示今日投入和进度，点击可展开完整工时卡片。
public sealed class MiniInfoForm : Form
{
    private const int GWL_EXSTYLE = -20;
    private const int WS_EX_LAYERED = 0x00080000;
    private const int WS_EX_TOOLWINDOW = 0x00000080;
    private const int WS_EX_NOACTIVATE = 0x08000000;
    private const int ULW_ALPHA = 2;
    private const byte AC_SRC_ALPHA = 1;
    public const int CardWidth = 224;
    public const int CardHeight = 88;
    private const int Gap = 8;

    [StructLayout(LayoutKind.Sequential)]
    private struct NativePoint { public int X; public int Y; public NativePoint(int x, int y) { X = x; Y = y; } }
    [StructLayout(LayoutKind.Sequential)]
    private struct NativeSize { public int Width; public int Height; public NativeSize(int w, int h) { Width = w; Height = h; } }
    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    private struct BlendFunction { public byte Operation; public byte Flags; public byte Alpha; public byte Format; }

    [DllImport("user32.dll")]
    private static extern IntPtr GetDC(IntPtr window);
    [DllImport("user32.dll")]
    private static extern int ReleaseDC(IntPtr window, IntPtr dc);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UpdateLayeredWindow(IntPtr window, IntPtr screen, ref NativePoint destination,
        ref NativeSize size, IntPtr source, ref NativePoint sourcePoint, int colorKey, ref BlendFunction blend, int flags);
    [DllImport("gdi32.dll")]
    private static extern IntPtr CreateCompatibleDC(IntPtr dc);
    [DllImport("gdi32.dll")]
    private static extern bool DeleteDC(IntPtr dc);
    [DllImport("gdi32.dll")]
    private static extern IntPtr SelectObject(IntPtr dc, IntPtr item);
    [DllImport("gdi32.dll")]
    private static extern bool DeleteObject(IntPtr item);

    private readonly Font labelFont = new Font("Microsoft YaHei", 8.5f, FontStyle.Regular, GraphicsUnit.Point);
    private readonly Font amountFont = new Font("Consolas", 14f, FontStyle.Bold, GraphicsUnit.Point);
    private readonly Font detailFont = new Font("Microsoft YaHei", 7.5f, FontStyle.Regular, GraphicsUnit.Point);
    private string themeName = "deep";
    private string amount = "¥ ****";
    private string detail = "";
    private string status = "未设置";
    private int percent;
    private bool painted;

    public event EventHandler OpenRequested;
    public event EventHandler AmountRequested;
    public event EventHandler MenuRequested;

    public static bool IsAmountArea(Point point)
    {
        return new Rectangle(4, 17, CardWidth - 12, 34).Contains(point);
    }

    public MiniInfoForm(bool onTop)
    {
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        Size = new Size(CardWidth, CardHeight);
        Location = new Point(-32000, -32000);
        TopMost = onTop;
        Text = "小鲸简要信息";
        Cursor = Cursors.Hand;
        AccessibleName = "小鲸工时进度";
    }

    protected override CreateParams CreateParams
    {
        get
        {
            CreateParams parameters = base.CreateParams;
            parameters.ExStyle |= WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
            return parameters;
        }
    }

    public static Rectangle BoundsFor(Rectangle pet, Rectangle work, int width, int height, int gap)
    {
        int left = pet.Left - width - gap;
        if (left < work.Left)
        {
            int right = pet.Right + gap;
            left = right + width <= work.Right ? right : work.Left;
        }
        if (left + width > work.Right) left = work.Right - width;
        if (left < work.Left) left = work.Left;
        int top = pet.Bottom - height;
        if (top + height > work.Bottom) top = work.Bottom - height;
        if (top < work.Top) top = work.Top;
        return new Rectangle(left, top, width, height);
    }

    public void Present(string newTheme, string newAmount, string newDetail, string newStatus, int newPercent,
        bool show, Rectangle pet, Rectangle work)
    {
        bool changed = newTheme != themeName || newAmount != amount || newDetail != detail ||
            newStatus != status || newPercent != percent;
        themeName = newTheme == "cream" ? "cream" : (newTheme == "glass" ? "glass" : "deep");
        amount = newAmount;
        detail = newDetail;
        status = newStatus;
        percent = Math.Max(0, Math.Min(100, newPercent));
        Rectangle target = BoundsFor(pet, work, CardWidth, CardHeight, Gap);
        if (Location != target.Location) Location = target.Location;
        if (changed || !painted) Redraw();
        if (show)
        {
            if (!Visible) Visible = true;
        }
        else if (Visible)
        {
            Visible = false;
        }
    }

    public void HideCard()
    {
        if (Visible) Visible = false;
    }

    protected override void OnMouseUp(MouseEventArgs e)
    {
        base.OnMouseUp(e);
        if (e.Button == MouseButtons.Right)
        {
            if (MenuRequested != null) MenuRequested(this, EventArgs.Empty);
            return;
        }
        if (e.Button != MouseButtons.Left) return;
        if (IsAmountArea(e.Location))
        {
            if (AmountRequested != null) AmountRequested(this, EventArgs.Empty);
            return;
        }
        if (OpenRequested != null) OpenRequested(this, EventArgs.Empty);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            labelFont.Dispose();
            amountFont.Dispose();
            detailFont.Dispose();
        }
        base.Dispose(disposing);
    }

    private void Redraw()
    {
        IntPtr window = Handle;
        bool cream = themeName == "cream", glass = themeName == "glass";
        Color fill = glass ? Color.FromArgb(210, 38, 70, 80) : Hex(cream ? "#FFFDF6" : "#12233C");
        Color border = Hex(glass ? "#85B5BB" : (cream ? "#D9C9A8" : "#2B4A6E"));
        Color label = Hex(glass ? "#D3EAE9" : (cream ? "#8A8273" : "#8FB1D1"));
        Color ink = Hex(glass ? "#F0FFFF" : (cream ? "#204B73" : "#D9EFFF"));
        Color muted = Hex(glass ? "#D3EAE9" : (cream ? "#7D786B" : "#9FBCD8"));
        Color barBackground = Hex(glass ? "#152D34" : (cream ? "#E9E1CF" : "#0A1626"));
        Color accent = Hex(glass ? "#B9EDED" : (cream ? "#2C6FA8" : "#7FC4FF"));

        using (Bitmap bitmap = new Bitmap(CardWidth, CardHeight, PixelFormat.Format32bppPArgb))
        using (Graphics graphics = Graphics.FromImage(bitmap))
        {
            graphics.Clear(Color.Transparent);
            graphics.SmoothingMode = SmoothingMode.AntiAlias;
            graphics.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
            Rectangle card = new Rectangle(0, 0, CardWidth - 2, CardHeight - 4);
            using (GraphicsPath shadowPath = RoundedRectangle(new Rectangle(2, 4, card.Width, card.Height), 12))
            using (SolidBrush shadow = new SolidBrush(Color.FromArgb(34, 0, 8, 20)))
                graphics.FillPath(shadow, shadowPath);
            using (GraphicsPath path = RoundedRectangle(card, 12))
            {
                using (SolidBrush brush = new SolidBrush(fill)) graphics.FillPath(brush, path);
                using (Pen pen = new Pen(border, 1f)) graphics.DrawPath(pen, path);
            }
            using (SolidBrush brush = new SolidBrush(label))
            {
                graphics.DrawString("今日投入", labelFont, brush, 12, 7);
                SizeF statusSize = graphics.MeasureString(status, labelFont);
                graphics.DrawString(status, labelFont, brush, card.Right - 12 - statusSize.Width, 7);
            }
            using (SolidBrush brush = new SolidBrush(ink))
                graphics.DrawString(amount, amountFont, brush, 10, 22);
            int barWidth = card.Width - 24;
            using (GraphicsPath trackPath = RoundedRectangle(new Rectangle(12, 56, barWidth, 6), 3))
            using (SolidBrush track = new SolidBrush(barBackground))
                graphics.FillPath(track, trackPath);
            int fillWidth = (int)Math.Round(barWidth * percent / 100.0);
            if (fillWidth >= 4)
            {
                using (GraphicsPath fillPath = RoundedRectangle(new Rectangle(12, 56, fillWidth, 6), 3))
                using (SolidBrush brush = new SolidBrush(accent))
                    graphics.FillPath(brush, fillPath);
            }
            using (SolidBrush brush = new SolidBrush(muted))
                graphics.DrawString(detail + (String.IsNullOrEmpty(detail) ? "" : " · ") + percent + "%", detailFont, brush, 12, 65);

            IntPtr screen = GetDC(IntPtr.Zero);
            IntPtr memory = CreateCompatibleDC(screen);
            IntPtr handle = IntPtr.Zero;
            IntPtr previous = IntPtr.Zero;
            try
            {
                handle = bitmap.GetHbitmap(Color.FromArgb(0));
                previous = SelectObject(memory, handle);
                NativePoint destination = new NativePoint(Left, Top);
                NativePoint source = new NativePoint(0, 0);
                NativeSize size = new NativeSize(bitmap.Width, bitmap.Height);
                BlendFunction blend = new BlendFunction();
                blend.Alpha = 255;
                blend.Format = AC_SRC_ALPHA;
                UpdateLayeredWindow(window, screen, ref destination, ref size, memory, ref source, 0, ref blend, ULW_ALPHA);
            }
            finally
            {
                if (previous != IntPtr.Zero) SelectObject(memory, previous);
                if (handle != IntPtr.Zero) DeleteObject(handle);
                DeleteDC(memory);
                ReleaseDC(IntPtr.Zero, screen);
            }
        }
        painted = true;
    }

    private static Color Hex(string value)
    {
        return Color.FromArgb(
            Convert.ToInt32(value.Substring(1, 2), 16),
            Convert.ToInt32(value.Substring(3, 2), 16),
            Convert.ToInt32(value.Substring(5, 2), 16));
    }

    private static GraphicsPath RoundedRectangle(Rectangle rect, int radius)
    {
        GraphicsPath path = new GraphicsPath();
        int diameter = radius * 2;
        path.AddArc(rect.Left, rect.Top, diameter, diameter, 180, 90);
        path.AddArc(rect.Right - diameter, rect.Top, diameter, diameter, 270, 90);
        path.AddArc(rect.Right - diameter, rect.Bottom - diameter, diameter, diameter, 0, 90);
        path.AddArc(rect.Left, rect.Bottom - diameter, diameter, diameter, 90, 90);
        path.CloseFigure();
        return path;
    }
}
