using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Reflection;

public static class PetNativeTests
{
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
        Console.WriteLine("Custom frame selection, aspect ratio, transparency, fallback and mini card bounds passed.");
        return 0;
    }
}
