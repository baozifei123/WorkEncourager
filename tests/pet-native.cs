using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public static class PetNativeTests
{
    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr window, int command);

    [STAThread]
    public static int Main(string[] args)
    {
        string directory = args[0];
        string fallback = Path.Combine(directory, "whale-character.png");
        string custom = Path.Combine(directory, "custom-character.png");
        File.Copy(args[1], fallback);
        MethodInfo load = typeof(WorkBankPet).GetMethod("LoadPreferredFrame", BindingFlags.Static | BindingFlags.NonPublic);
        if (load == null) throw new Exception("Missing frame loader");
        using (Bitmap image = new Bitmap(100, 100, PixelFormat.Format32bppArgb))
        {
            using (Graphics graphics = Graphics.FromImage(image)) graphics.Clear(Color.Red);
            image.Save(custom, ImageFormat.Png);
        }
        using (Bitmap frame = (Bitmap)load.Invoke(null, new object[] { directory, "whale-character.png" }))
        {
            if (frame.Size != new Size(180, 240)) throw new Exception("Unexpected frame size");
            if (frame.GetPixel(90, 10).A != 0 || frame.GetPixel(90, 230).A != 0) throw new Exception("Square image must be letterboxed transparently");
            Color center = frame.GetPixel(90, 120);
            if (center.A != 255 || center.R < 240 || center.G > 10 || center.B > 10) throw new Exception("Custom image was not selected");
        }
        File.WriteAllText(custom, "not a PNG");
        using (Bitmap frame = (Bitmap)load.Invoke(null, new object[] { directory, "whale-character.png" }))
        {
            if (frame.GetPixel(0, 0).A != 0 || frame.GetPixel(90, 120).A == 0) throw new Exception("Invalid custom image should fall back to the transparent built-in frame");
        }
        File.Copy(args[2], Path.Combine(directory, "whale-fight.png"));
        using (Bitmap frame = (Bitmap)load.Invoke(null, new object[] { directory, "whale-fight.png" }))
        {
            if (frame.Size != new Size(180, 240) || frame.GetPixel(0, 0).A != 0 || frame.GetPixel(65, 130).A == 0)
                throw new Exception("Fighting artwork should load with the normal transparent pet dimensions");
        }
        Rectangle work = new Rectangle(0, 0, 1920, 1080);
        Rectangle pet = new Rectangle(1600, 800, 180, 240);
        Rectangle beside = MiniInfoForm.BoundsFor(pet, work, MiniInfoForm.CardWidth, MiniInfoForm.CardHeight, 8);
        if (beside.Left != pet.Left - MiniInfoForm.CardWidth - 8) throw new Exception("Mini card should sit left of the pet");
        if (beside.Bottom != pet.Bottom) throw new Exception("Mini card should align with the pet's bottom");
        Rectangle leftEdge = MiniInfoForm.BoundsFor(new Rectangle(20, 800, 180, 240), work, MiniInfoForm.CardWidth, MiniInfoForm.CardHeight, 8);
        if (leftEdge.Left != 208) throw new Exception("Mini card should move to the right at the left edge");
        Rectangle bottomEdge = MiniInfoForm.BoundsFor(new Rectangle(1600, 1000, 180, 240), work, MiniInfoForm.CardWidth, MiniInfoForm.CardHeight, 8);
        if (bottomEdge.Bottom != work.Bottom) throw new Exception("Mini card should stay inside the work area");
        Rectangle narrow = MiniInfoForm.BoundsFor(new Rectangle(10, 500, 180, 240), new Rectangle(0, 0, 300, 900), MiniInfoForm.CardWidth, MiniInfoForm.CardHeight, 8);
        if (narrow.Left != 0 || narrow.Right > 300) throw new Exception("Mini card should clamp to a narrow work area");
        if (MiniInfoForm.NextVisibleMode(1) != 2 || MiniInfoForm.NextVisibleMode(2) != 1 || MiniInfoForm.NextVisibleMode(0) != 1)
            throw new Exception("The mini mode shortcut should toggle always and hover without making a hidden card unreachable");
        if (MiniInfoForm.CompactStatus("接近计划工时") != "近目标" || MiniInfoForm.CompactStatus("加班中") != "加班中")
            throw new Exception("Compact mini status labels should fit beside the quick controls");
        if (!MiniInfoForm.IsModeArea(new Point(150, 10)) || !MiniInfoForm.IsTrackingArea(new Point(190, 10)))
            throw new Exception("The mini card mode and tracking controls should have separate click areas");
        if (MiniInfoForm.IsAmountArea(new Point(150, 10)) || MiniInfoForm.IsTrackingArea(new Point(150, 10)) ||
            MiniInfoForm.IsAmountArea(new Point(190, 10)) || MiniInfoForm.IsModeArea(new Point(190, 10)))
            throw new Exception("Header controls must not overlap the amount or each other");
        using (MiniInfoForm mini = new MiniInfoForm(false))
        {
            int opened = 0, amounts = 0, menus = 0, mode = 0, tracking = 0;
            mini.OpenRequested += delegate { opened++; };
            mini.AmountRequested += delegate { amounts++; };
            mini.ModeRequested += delegate { mode++; };
            mini.TrackingRequested += delegate { tracking++; };
            mini.MenuRequested += delegate { menus++; };
            MethodInfo click = typeof(MiniInfoForm).GetMethod("OnMouseUp", BindingFlags.Instance | BindingFlags.NonPublic);
            if (click == null) throw new Exception("Missing mini card click handler");
            click.Invoke(mini, new object[] { new MouseEventArgs(MouseButtons.Left, 1, 150, 10, 0) });
            click.Invoke(mini, new object[] { new MouseEventArgs(MouseButtons.Left, 1, 190, 10, 0) });
            click.Invoke(mini, new object[] { new MouseEventArgs(MouseButtons.Left, 1, 20, 30, 0) });
            click.Invoke(mini, new object[] { new MouseEventArgs(MouseButtons.Left, 1, 20, 70, 0) });
            click.Invoke(mini, new object[] { new MouseEventArgs(MouseButtons.Right, 1, 20, 30, 0) });
            if (amounts != 1 || opened != 1 || menus != 1 || mode != 1 || tracking != 1)
                throw new Exception("Mini card buttons, amount masking, body opening, and right-click routing should stay separate");
        }
        if (WorkBankPet.SelectFrame("active", false, 49) != "normal") throw new Exception("Before halfway the pet should rest");
        if (WorkBankPet.SelectFrame("active", false, 50) != "working") throw new Exception("Halfway should show the working pose");
        if (WorkBankPet.SelectFrame("urgent", false, 90) != "sprint") throw new Exception("Ninety percent should show the sprint pose");
        if (WorkBankPet.SelectFrame("overtime", false, 100) != "fight") throw new Exception("Early overtime should use the fighting pose");
        if (WorkBankPet.SelectFrame("overtime-steady", false, 100) != "working") throw new Exception("Later overtime should use the working pose");
        if (WorkBankPet.SelectFrame("overtime", true, 100) != "wave") throw new Exception("The open panel should take pose precedence during overtime");
        if (WorkBankPet.FightFrameRaised(true, 0) || !WorkBankPet.FightFrameRaised(true, 400) ||
            WorkBankPet.FightFrameRaised(true, 800) || !WorkBankPet.FightFrameRaised(true, 3999) ||
            WorkBankPet.FightFrameRaised(true, 4000) || WorkBankPet.FightFrameRaised(false, 400) ||
            WorkBankPet.FightFrameRaised(true, -1))
            throw new Exception("Fighting pose should alternate briefly and respect the motion setting");
        MethodInfo raise = typeof(WorkBankPet).GetMethod("CreateRaisedFrame", BindingFlags.Static | BindingFlags.NonPublic);
        if (raise == null) throw new Exception("Missing raised frame creator");
        using (Bitmap image = new Bitmap(10, 10, PixelFormat.Format32bppPArgb))
        {
            image.SetPixel(5, 6, Color.Red);
            using (Bitmap raised = (Bitmap)raise.Invoke(null, new object[] { image }))
            {
                if (raised.Size != image.Size || raised.GetPixel(5, 3).R != 255 || raised.GetPixel(5, 6).A != 0)
                    throw new Exception("Raised frame should move the artwork by three pixels without moving or resizing the window");
                if (image.GetPixel(5, 6).R != 255) throw new Exception("Raised frame must not change the original artwork");
            }
        }
        if (WorkBankPet.SelectFrame("celebrate", false, 100) != "celebrate") throw new Exception("Sign-off should celebrate");
        if (WorkBankPet.SelectFrame("celebrate", true, 100) != "wave") throw new Exception("The open panel should take pose precedence");
        if (WorkBankPet.SelectFrame("idle", false, 95) != "normal") throw new Exception("Idle should not show a working pose");
        if (WorkBankPet.SessionChangeCommand(7) != "session|locked" || WorkBankPet.SessionChangeCommand(8) != "session|unlocked" ||
            WorkBankPet.SessionChangeCommand(5) != null)
            throw new Exception("Only current-session lock and unlock events should be forwarded");
        TestTray(directory, Path.GetDirectoryName(args[1]));
        Console.WriteLine("Custom frame selection, aspect ratio, transparency, fallback, mini card controls, session events and click routing passed.");
        Console.WriteLine("Tray visibility, restore, external window changes and exit routing passed.");
        return 0;
    }

    private static void AssertEvent(string directory, string expected)
    {
        string[] events = Directory.GetFiles(directory, "*.evt");
        if (events.Length != 1 || File.ReadAllText(events[0]).Trim() != expected)
            throw new Exception("Expected exactly one pet event: " + expected);
        File.Delete(events[0]);
    }

    private static void Invoke(WorkBankPet pet, string method, params object[] arguments)
    {
        MethodInfo found = typeof(WorkBankPet).GetMethod(method, BindingFlags.Instance | BindingFlags.NonPublic);
        if (found == null) throw new Exception("Missing pet method: " + method);
        found.Invoke(pet, arguments);
    }

    private static void TestTray(string directory, string assets)
    {
        string images = Path.Combine(directory, "tray-images");
        string events = Path.Combine(directory, "events");
        Directory.CreateDirectory(images);
        Directory.CreateDirectory(events);
        string[] names = { "whale-character.png", "whale-blink.png", "whale-wave.png", "whale-celebrate.png",
            "whale-working.png", "whale-sprint.png", "whale-fight.png", "whale-face.png" };
        foreach (string name in names) File.Copy(Path.Combine(assets, name), Path.Combine(images, name));
        string alive = Path.Combine(directory, "tray.alive"), state = Path.Combine(directory, "tray.state");
        string beat = Path.Combine(directory, "tray.beat"), ready = Path.Combine(directory, "tray.ready");
        string control = Path.Combine(directory, "tray.control"), notice = Path.Combine(directory, "tray.notice");
        string position = Path.Combine(directory, "tray.pos");
        File.WriteAllText(alive, "alive");
        using (Form parent = new Form())
        {
            parent.StartPosition = FormStartPosition.Manual;
            parent.Location = new Point(-10000, -10000);
            parent.ShowInTaskbar = false;
            parent.Show();
            object[] arguments = { parent.Handle, images, alive, state, beat, ready, control, notice, events, position, false, 0, 0 };
            using (WorkBankPet pet = (WorkBankPet)Activator.CreateInstance(typeof(WorkBankPet),
                BindingFlags.Instance | BindingFlags.NonPublic, null, arguments, null))
            {
                pet.Location = new Point(-10000, -10000);
                pet.Show();
                Application.DoEvents();
                NotifyIcon tray = (NotifyIcon)typeof(WorkBankPet).GetField("trayIcon", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(pet);
                ContextMenuStrip menu = tray.ContextMenuStrip;
                if (!tray.Visible || tray.Icon == null || menu.Items.Count != 2) throw new Exception("The pet must provide a tray icon and menu");
                if (!IsWindowVisible(parent.Handle)) throw new Exception("The panel must stay visible until the pet is ready to receive commands");

                Invoke(pet, "TogglePanel");
                AssertEvent(events, "hide");
                if (IsWindowVisible(parent.Handle) || !pet.Visible || !tray.Visible)
                    throw new Exception("Hiding the panel must leave the pet and tray visible");

                MethodInfo doubleClick = typeof(NotifyIcon).GetMethod("OnDoubleClick", BindingFlags.Instance | BindingFlags.NonPublic);
                if (doubleClick == null) throw new Exception("Missing tray double-click handler");
                doubleClick.Invoke(tray, new object[] { EventArgs.Empty });
                AssertEvent(events, "show");
                menu.Items[0].PerformClick();
                AssertEvent(events, "show");
                File.WriteAllText(control, "show|-10000|-10000");
                Invoke(pet, "OnTick", null, EventArgs.Empty);
                if (!IsWindowVisible(parent.Handle) || IsIconic(parent.Handle) || !pet.Visible)
                    throw new Exception("The tray show request must restore the panel without hiding the pet");

                ShowWindow(parent.Handle, 6);
                Invoke(pet, "OnTick", null, EventArgs.Empty);
                AssertEvent(events, "hide");
                if (IsWindowVisible(parent.Handle) || !pet.Visible)
                    throw new Exception("An external minimize must hide only the panel");
                ShowWindow(parent.Handle, 9);
                Invoke(pet, "OnTick", null, EventArgs.Empty);
                AssertEvent(events, "show");
                if (!IsWindowVisible(parent.Handle) || !pet.Visible)
                    throw new Exception("An externally restored panel must synchronize with the pet");

                Invoke(pet, "TogglePanel");
                AssertEvent(events, "hide");
                menu.Items[0].PerformClick();
                AssertEvent(events, "show");
                File.WriteAllText(control, "hide");
                Invoke(pet, "OnTick", null, EventArgs.Empty);
                DateTime pending = (DateTime)typeof(WorkBankPet).GetField("pendingShow", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(pet);
                if (pending != DateTime.MinValue) throw new Exception("A later hide must cancel a pending restore");

                bool exitRequested = false;
                FormClosingEventHandler closing = delegate(object sender, FormClosingEventArgs e) { exitRequested = true; e.Cancel = true; };
                parent.FormClosing += closing;
                menu.Items[1].PerformClick();
                Application.DoEvents();
                parent.FormClosing -= closing;
                if (!exitRequested) throw new Exception("The tray exit item must request the normal application close");
            }
        }
    }
}
