"""Draws the app icons (the little tree of the favicon on the green of the site) into icons/.

Run:  python tools/make-icons.py      (needs Pillow: pip install pillow)

  icon-192.png, icon-512.png     rounded square: for the home screen and the install prompt
  icon-maskable-512.png          full square with the tree inside the safe circle: Android cuts it to any shape
  apple-touch-icon.png (180)     full square: iPhone / iPad home screen (iOS rounds it itself)
"""
import os
from PIL import Image, ImageDraw

GREEN = (47, 111, 79)   # #2f6f4f, the colour of the site
WHITE = (255, 255, 255)
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'icons')
SS = 4  # draw 4 times bigger, then shrink: smooth edges


def tree(d, cx, cy, width, color):
    """The favicon tree: a stem, a bar, three drops ending in three circles. `width` = the width of the whole figure."""
    k = width / 20.0  # the figure is 20 units wide in the favicon (x from 6 to 26)
    ox, oy = cx - 16 * k, cy - 15.5 * k  # (16, 15.5) is the middle of the figure
    P = lambda x, y: (ox + x * k, oy + y * k)
    w = max(2, round(2 * k))

    def line(a, b):
        d.line([P(*a), P(*b)], fill=color, width=w)
        for pt in (a, b):  # round ends
            x, y = P(*pt)
            d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=color)

    line((16, 7), (16, 14))
    line((9, 14), (23, 14))
    for x in (9, 16, 23):
        line((x, 14), (x, 18))
        x0, y0 = P(x, 21)
        r = 3 * k
        d.ellipse([x0 - r, y0 - r, x0 + r, y0 + r], fill=color)


def make(size, name, radius_frac, figure_frac):
    big = size * SS
    img = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if radius_frac > 0:
        d.rounded_rectangle([0, 0, big - 1, big - 1], radius=int(big * radius_frac), fill=GREEN)
    else:
        d.rectangle([0, 0, big, big], fill=GREEN)
    tree(d, big / 2, big / 2, big * figure_frac, WHITE)
    img = img.resize((size, size), Image.LANCZOS)
    os.makedirs(OUT, exist_ok=True)
    img.save(os.path.join(OUT, name))
    print('wrote', name, size)


make(192, 'icon-192.png', 0.22, 0.62)
make(512, 'icon-512.png', 0.22, 0.62)
make(512, 'icon-maskable-512.png', 0, 0.50)   # inside the safe zone (a circle of 80% of the width)
make(180, 'apple-touch-icon.png', 0, 0.58)
