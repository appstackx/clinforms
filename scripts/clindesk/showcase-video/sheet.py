# sheet.py <seq dir or video frames dir> <out.png> t1 t2 ...   (times in s at 30 fps; 3 columns, 640 px wide tiles)
import sys, os
from PIL import Image, ImageDraw
d, out, ts = sys.argv[1], sys.argv[2], [float(x) for x in sys.argv[3:]]
tiles = []
for t in ts:
    f = os.path.join(d, f"{int(round(t*30)):05d}.jpg")
    if not os.path.exists(f): continue
    im = Image.open(f).convert("RGB"); im.thumbnail((640, 360))
    ImageDraw.Draw(im).text((8, 8), f"{t:.1f}s", fill=(255, 0, 0))
    tiles.append(im)
cols = 3; rows = (len(tiles) + cols - 1) // cols
sheet = Image.new("RGB", (cols * 640, rows * 360), "white")
for i, im in enumerate(tiles): sheet.paste(im, ((i % cols) * 640, (i // cols) * 360))
sheet.save(out)
