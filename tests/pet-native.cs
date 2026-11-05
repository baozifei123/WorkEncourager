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
        Console.WriteLine("Custom frame selection, aspect ratio, transparency and fallback passed.");
        return 0;
    }
}
