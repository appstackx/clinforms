# grid.py <take> <t> [out]  – a take frame at CSS scale (half size) with a 50/100 px grid in CSS px, to read coordinates
import sys
from PIL import Image, ImageDraw
take, t = sys.argv[1], float(sys.argv[2])
out = sys.argv[3] if len(sys.argv) > 3 else f"/tmp/claude-501/grid-{take}-{t}.png"
im = Image.open(f"work/takes/{take}/seq/{int(round(t*30)):05d}.jpg").convert("RGB")
sc = 2 if im.width > 2000 else 3
im = im.resize((im.width // sc, im.height // sc))
d = ImageDraw.Draw(im)
for x in range(0, im.width, 50):
    d.line([(x, 0), (x, im.height)], fill=(255, 0, 0) if x % 100 == 0 else (255, 170, 170), width=1)
    if x % 100 == 0: d.text((x + 2, 2), str(x), fill=(255, 0, 0))
for y in range(0, im.height, 50):
    d.line([(0, y), (im.width, y)], fill=(0, 0, 255) if y % 100 == 0 else (170, 170, 255), width=1)
    if y % 100 == 0: d.text((2, y + 2), str(y), fill=(0, 0, 255))
im.save(out); print(out)
