# small test images with planted metadata: a JPEG with EXIF (camera, GPS, owner) and a PNG with text chunks
import sys, io
from PIL import Image
from PIL.PngImagePlugin import PngInfo
from PIL.TiffImagePlugin import IFDRational
out = sys.argv[1]
img = Image.new("RGB", (160, 120))
px = img.load()
for y in range(120):
    for x in range(160):
        px[x, y] = ((x * 255) // 160, (y * 255) // 120, ((x ^ y) * 4) & 255)
exif = Image.Exif()
exif[0x010F] = "FakeCam"
exif[0x0110] = "Model 0"
exif[0x013B] = "Ada Example"        # Artist
exif[0x8298] = "Copyright Ada Example"
gps = exif.get_ifd(0x8825)
gps[1] = "N"; gps[2] = (IFDRational(48), IFDRational(51), IFDRational(29)); gps[3] = "E"; gps[4] = (IFDRational(2), IFDRational(17), IFDRational(40))
img.save(out + "/photo.jpg", "JPEG", quality=90, exif=exif.tobytes())
pi = PngInfo(); pi.add_text("Author", "Ada Example"); pi.add_text("Software", "plotter at Acme Lab")
img.save(out + "/diagram.png", "PNG", pnginfo=pi)
