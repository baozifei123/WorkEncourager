using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

// 本机桌宠只接收状态和操作命令，不读取或传递工资数据。
public sealed class WorkBankPet : Form
{
    private const int GWL_EXSTYLE = -20;
    private const int WS_EX_LAYERED = 0x00080000;
    private const int WS_EX_TOOLWINDOW = 0x00000080;
    private const int SW_MINIMIZE = 6;
    private const int SW_RESTORE = 9;
    private const int WM_CLOSE = 0x0010;
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
    private readonly Timer timer;
    private readonly ToolTip tooltip;
    private readonly ContextMenuStrip menu;
    private readonly ToolStripMenuItem trackingItem;
    private readonly ToolStripMenuItem pinItem;
    private string currentState = "unconfigured";
    private string currentTip = "";
    private bool panelVisible = true;
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
        ShowWindow(parentWindow, SW_MINIMIZE);
        timer.Start();
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
            if ((DateTime.UtcNow - lastHeartbeat).TotalMilliseconds >= 1000)
            {
                WriteHeartbeat();
                ReadState();
            }
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
                    SetForegroundWindow(parentWindow);
                    pendingShow = DateTime.MinValue;
                }
            }
            if (pendingShow != DateTime.MinValue && (DateTime.UtcNow - pendingShow).TotalMilliseconds > 1500)
            {
                pendingShow = DateTime.MinValue;
                ShowWindow(parentWindow, SW_RESTORE);
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
            string wanted;
            if (currentState == "celebrate") wanted = "celebrate";
            else if (currentState == "overtime") wanted = "tired";
            else if (panelVisible) wanted = "wave";
            else wanted = "normal";
            if (motion && wanted == "normal" && tickCount % (currentState == "urgent" ? 16 : 25) == 0) wanted = "blink";
            if (wanted != shownFrame)
            {
                Bitmap frame = wanted == "celebrate" ? celebrateFrame :
                    (wanted == "tired" ? tiredFrame : (wanted == "wave" ? waveFrame : (wanted == "blink" ? blinkFrame : normalFrame)));
                DrawFrame(frame);
                shownFrame = wanted;
            }
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
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
        currentTip = values.Length >= 5 ? String.Join("|", values, 4, values.Length - 4) : "";
        bool active = values.Length >= 3 ? values[2] == "1" :
            currentState == "active" || currentState == "urgent" || currentState == "idle" || currentState == "overtime" || currentState == "waiting";
        trackingItem.Text = currentState == "unconfigured" ? "设置并开始记录" : (active ? "暂停记录" : "开始记录");
        UpdateTooltip();
    }

    private void UpdateTooltip()
    {
        string label = currentState == "error" ? "请查看卡片提示" : currentState == "unconfigured" ? "未设置" : currentState == "paused" ? "未开工" :
            currentState == "idle" ? "键鼠空闲" : currentState == "overtime" ? "加班中" :
            currentState == "urgent" ? "接近计划工时" : currentState == "celebrate" ? "收工快乐" :
            currentState == "waiting" ? "采样未就绪" : "上班中";
        string text = String.IsNullOrEmpty(currentTip) ? "小鲸 · " + label : currentTip;
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
            timer.Stop();
            timer.Dispose();
            tooltip.Dispose();
            menu.Dispose();
            normalFrame.Dispose();
            blinkFrame.Dispose();
            tiredFrame.Dispose();
            waveFrame.Dispose();
            celebrateFrame.Dispose();
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
