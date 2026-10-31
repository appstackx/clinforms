# sheets.py <frames dir> <out prefix> <step s> [from] [to] – 4x4 sheets of rendered frames with timestamps
import sys, os
from PIL import Image, ImageDraw
d, pre, step = sys.argv[1], sys.argv[2], float(sys.argv[3])
a = float(sys.argv[4]) if len(sys.argv) > 4 else 0; z = float(sys.argv[5]) if len(sys.argv) > 5 else 1e9
ts = []; t = a
while t < z:
    f = os.path.join(d, f"{int(round(t*30)):05d}.jpg")
    if not os.path.exists(f): break
    ts.append((t, f)); t += step
for si in range(0, len(ts), 16):
    sh = Image.new("RGB", (1920, 1080), "white")
    for i, (t, f) in enumerate(ts[si:si+16]):
        im = Image.open(f); im.thumbnail((480, 270))
        ImageDraw.Draw(im).text((6, 4), f"{int(t//60)}:{t%60:05.2f}", fill=(255, 0, 0))
        sh.paste(im, ((i % 4) * 480, (i // 4) * 270))
    sh.save(f"{pre}-{si//16:02d}.png"); print(f"{pre}-{si//16:02d}.png")
