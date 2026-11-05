using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

public static class PetNativeTests
{
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
        if (!MiniInfoForm.IsAmountArea(new Point(20, 30))) throw new Exception("The mini amount row should be clickable");
        if (MiniInfoForm.IsAmountArea(new Point(20, 8))) throw new Exception("The mini label row should open the panel");
        if (MiniInfoForm.IsAmountArea(new Point(20, 70))) throw new Exception("The mini progress row should open the panel");
        if (MiniInfoForm.IsAmountArea(new Point(MiniInfoForm.CardWidth - 1, 30))) throw new Exception("The card border should not mask the amount");
        using (MiniInfoForm mini = new MiniInfoForm(false))
        {
            int opened = 0, amounts = 0, menus = 0;
            mini.OpenRequested += delegate { opened++; };
            mini.AmountRequested += delegate { amounts++; };
            mini.MenuRequested += delegate { menus++; };
            MethodInfo click = typeof(MiniInfoForm).GetMethod("OnMouseUp", BindingFlags.Instance | BindingFlags.NonPublic);
            if (click == null) throw new Exception("Missing mini card click handler");
            click.Invoke(mini, new object[] { new MouseEventArgs(MouseButtons.Left, 1, 20, 30, 0) });
            click.Invoke(mini, new object[] { new MouseEventArgs(MouseButtons.Left, 1, 20, 70, 0) });
            click.Invoke(mini, new object[] { new MouseEventArgs(MouseButtons.Right, 1, 20, 30, 0) });
            if (amounts != 1 || opened != 1 || menus != 1)
                throw new Exception("Mini card should mask on the amount, open elsewhere, and show its menu on right click");
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
        Console.WriteLine("Custom frame selection, aspect ratio, transparency, fallback, mini card bounds and click routing passed.");
        return 0;
    }
}
