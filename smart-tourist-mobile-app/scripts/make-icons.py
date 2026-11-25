"""
Generates the app icon set (shield + heartbeat) into assets/images/.
Run from smart-tourist-mobile-app:  python scripts/make-icons.py
"""
import os

from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "images")
SS = 4  # supersampling for smooth edges
BLUE_TOP, BLUE_BOTTOM = (36, 116, 224), (19, 74, 160)
WHITE = (255, 255, 255, 255)
RED = (214, 52, 52, 255)
INK_BLUE = (30, 102, 208, 255)


def bezier(p0, p1, p2, n=40):
    return [((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t ** 2 * p2[0],
             (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t ** 2 * p2[1]) for t in (i / n for i in range(n + 1))]


def shield(scale=1.0):
    """Shield outline in unit coordinates, centred on (0.5, 0.52)."""
    pts = []
    pts += bezier((0.25, 0.27), (0.5, 0.15), (0.75, 0.27))      # top edge
    pts += [(0.75, 0.50)]                                        # right side
    pts += bezier((0.75, 0.50), (0.74, 0.74), (0.5, 0.87))      # right curve to the tip
    pts += bezier((0.5, 0.87), (0.26, 0.74), (0.25, 0.50))      # left curve back up
    cx, cy = 0.5, 0.52
    return [(cx + (x - cx) * scale, cy + (y - cy) * scale) for x, y in pts]


def pulse(scale=1.0):
    pts = [(0.31, 0.545), (0.41, 0.545), (0.445, 0.47), (0.49, 0.665), (0.545, 0.39), (0.585, 0.545), (0.69, 0.545)]
    cx, cy = 0.5, 0.52
    return [(cx + (x - cx) * scale, cy + (y - cy) * scale) for x, y in pts]


def px(points, size):
    return [(x * size * SS, y * size * SS) for x, y in points]


def gradient(size):
    img = Image.new("RGBA", (size * SS, size * SS))
    d = ImageDraw.Draw(img)
    h = size * SS
    for y in range(h):
        t = y / (h - 1)
        c = tuple(round(a + (b - a) * t) for a, b in zip(BLUE_TOP, BLUE_BOTTOM))
        d.line([(0, y), (h, y)], fill=c + (255,))
    return img


def draw_mark(img, size, scale, shield_fill, line_fill, line_w=0.045):
    d = ImageDraw.Draw(img)
    d.polygon(px(shield(scale), size), fill=shield_fill)
    w = int(line_w * scale * size * SS)
    pts = px(pulse(scale), size)
    d.line(pts, fill=line_fill, width=w, joint="curve")
    r = w / 2
    for x, y in (pts[0], pts[-1]):  # round line caps
        d.ellipse([x - r, y - r, x + r, y + r], fill=line_fill)


def save(img, name, size):
    img.resize((size, size), Image.LANCZOS).save(os.path.join(OUT, name))
    print("wrote", name, size)


def main():
    # Full icon (also the legacy Android icon): gradient square + mark.
    icon = gradient(1024)
    draw_mark(icon, 1024, 1.0, WHITE, RED)
    save(icon.convert("RGB"), "icon.png", 1024)

    # Adaptive icon: background layer + foreground kept inside the 66 % safe zone.
    save(gradient(512), "android-icon-background.png", 512)
    fg = Image.new("RGBA", (512 * SS, 512 * SS), (0, 0, 0, 0))
    draw_mark(fg, 512, 0.86, WHITE, RED)
    save(fg, "android-icon-foreground.png", 512)

    # Monochrome (Android 13 themed icons): white shield with the pulse cut out.
    mono = Image.new("RGBA", (432 * SS, 432 * SS), (0, 0, 0, 0))
    draw_mark(mono, 432, 0.86, WHITE, (0, 0, 0, 0))
    save(mono, "android-icon-monochrome.png", 432)

    # Splash: blue shield, white pulse, transparent background (works on light and dark).
    splash = Image.new("RGBA", (1024 * SS, 1024 * SS), (0, 0, 0, 0))
    draw_mark(splash, 1024, 1.0, INK_BLUE, WHITE)
    save(splash, "splash-icon.png", 1024)

    fav = gradient(256)
    draw_mark(fav, 256, 1.05, WHITE, RED, line_w=0.06)
    save(fav, "favicon.png", 48)


if __name__ == "__main__":
    main()
