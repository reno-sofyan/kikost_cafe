#!/usr/bin/env python3
"""Generate every Kione POS brand asset from one source of truth.

Run from the repo root:

    python3 -m pip install --user pillow fonttools brotli
    python3 scripts/brand/generate-assets.py

Writes: public/favicon*, public/apple-touch-icon.png, public/brand/*,
public/icons/*, and the Android launcher icons + splash screens.

The Kione mark is a rounded indigo tile carrying a geometric "K" whose lower
leg is a translucent white so the glyph reads with depth even at 32px. All
geometry lives in normalised (0..1) coordinates in MARK_* below, so the PNGs
and public/favicon.svg stay in sync.
"""
from __future__ import annotations

import io
import math
import os
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "public"
ANDROID_RES = ROOT / "android" / "app" / "src" / "main" / "res"

# --- brand constants (keep in sync with tailwind.config.ts) --------------------
INDIGO_LIGHT = (99, 102, 241)   # brand-400  #6366F1
INDIGO_DEEP = (67, 56, 202)     # brand-600  #4338CA
CANVAS = (241, 245, 249)        # ink-950    #F1F5F9
TEXT = (15, 23, 42)             # ink-50     #0F172A
WORDMARK_ACCENT = INDIGO_DEEP

# --- mark geometry, normalised to the tile ------------------------------------
MARK_RADIUS = 0.235             # corner radius of the tile
STEM = (0.290, 0.245, 0.400, 0.755)   # x0, y0, x1, y1
ARM_WIDTH = 0.108
ARM_JOINT = (0.452, 0.500)
ARM_UP_END = (0.730, 0.248)
ARM_DOWN_END = (0.730, 0.752)
LEG_ALPHA = 184                 # lower leg opacity (0-255)

SS = 6                          # supersampling factor


def _lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def _diagonal_gradient(size: int, top_left, bottom_right) -> Image.Image:
    """Cheap 45-degree linear gradient, drawn row-of-diagonals style."""
    grad = Image.new("RGB", (size, size))
    px = grad.load()
    denom = max(1, (size - 1) * 2)
    for y in range(size):
        for x in range(size):
            t = (x + y) / denom
            px[x, y] = (
                round(_lerp(top_left[0], bottom_right[0], t)),
                round(_lerp(top_left[1], bottom_right[1], t)),
                round(_lerp(top_left[2], bottom_right[2], t)),
            )
    return grad


def _thick_segment(draw: ImageDraw.ImageDraw, p0, p1, width: float, fill) -> None:
    """A stroke with round caps — PIL has no round-cap line primitive."""
    (x0, y0), (x1, y1) = p0, p1
    dx, dy = x1 - x0, y1 - y0
    length = math.hypot(dx, dy) or 1.0
    nx, ny = -dy / length * width / 2, dx / length * width / 2
    draw.polygon(
        [(x0 + nx, y0 + ny), (x1 + nx, y1 + ny), (x1 - nx, y1 - ny), (x0 - nx, y0 - ny)],
        fill=fill,
    )
    for cx, cy in (p0, p1):
        r = width / 2
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fill)


def draw_glyph(size: int, scale: float = 1.0, offset=(0.0, 0.0), white=(255, 255, 255)) -> Image.Image:
    """The white "K", on a transparent canvas of `size`x`size`.

    `scale` shrinks the glyph about the tile centre (used for the maskable icon
    and the Android adaptive foreground, which both need a safe zone).
    """
    s = size * SS
    layer = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)

    def pt(nx: float, ny: float):
        return (
            (0.5 + (nx - 0.5) * scale + offset[0]) * s,
            (0.5 + (ny - 0.5) * scale + offset[1]) * s,
        )

    # stem, with rounded ends
    x0, y0 = pt(STEM[0], STEM[1])
    x1, y1 = pt(STEM[2], STEM[3])
    draw.rounded_rectangle([x0, y0, x1, y1], radius=(x1 - x0) / 2, fill=white + (255,))

    # upper arm — solid; lower leg — translucent, for depth
    w = ARM_WIDTH * scale * s
    _thick_segment(draw, pt(*ARM_JOINT), pt(*ARM_UP_END), w, white + (255,))
    leg = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    _thick_segment(ImageDraw.Draw(leg), pt(*ARM_JOINT), pt(*ARM_DOWN_END), w, white + (LEG_ALPHA,))
    layer = Image.alpha_composite(layer, leg)

    return layer.resize((size, size), Image.LANCZOS)


def make_mark(size: int, *, rounded: bool = True, circle: bool = False, glyph_scale: float = 1.0) -> Image.Image:
    """The full mark: gradient tile (or circle) + glyph."""
    s = size * SS
    grad = _diagonal_gradient(s, INDIGO_LIGHT, INDIGO_DEEP).convert("RGBA")

    mask = Image.new("L", (s, s), 0)
    md = ImageDraw.Draw(mask)
    if circle:
        md.ellipse([0, 0, s - 1, s - 1], fill=255)
    elif rounded:
        md.rounded_rectangle([0, 0, s - 1, s - 1], radius=MARK_RADIUS * s, fill=255)
    else:
        md.rectangle([0, 0, s - 1, s - 1], fill=255)

    tile = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    tile.paste(grad, (0, 0), mask)
    tile = tile.resize((size, size), Image.LANCZOS)

    return Image.alpha_composite(tile, draw_glyph(size, scale=glyph_scale))


# --- typography ---------------------------------------------------------------
def load_inter(weight: int) -> io.BytesIO | None:
    """Turn the self-hosted variable woff2 into a static TTF we can rasterise.

    Falls back to a system sans if fonttools/brotli are unavailable, so the
    script still produces usable assets on a bare machine.
    """
    woff2 = PUBLIC / "fonts" / "inter.woff2"
    try:
        from fontTools.ttLib import TTFont
        from fontTools.ttLib.woff2 import decompress
        from fontTools.varLib import instancer

        buf = io.BytesIO()
        decompress(str(woff2), buf)
        buf.seek(0)
        font = TTFont(buf)
        if "fvar" in font:
            instancer.instantiateVariableFont(font, {"wght": weight}, inplace=True)
        out = io.BytesIO()
        font.save(out)
        out.seek(0)
        return out
    except Exception as exc:  # pragma: no cover - best effort
        print(f"  ! Inter unavailable ({exc}); falling back to Helvetica Neue", file=sys.stderr)
        return None


def wordmark_font(px: int, weight: int = 700) -> ImageFont.FreeTypeFont:
    blob = load_inter(weight)
    if blob is not None:
        return ImageFont.truetype(blob, px)
    for candidate in ("/System/Library/Fonts/HelveticaNeue.ttc", "/System/Library/Fonts/Supplemental/Arial Bold.ttf"):
        if os.path.exists(candidate):
            return ImageFont.truetype(candidate, px, index=1 if candidate.endswith(".ttc") else 0)
    return ImageFont.load_default()


def make_wordmark(height: int, *, on_dark: bool = False, pad: int = 0) -> Image.Image:
    """`[mark] Kione POS` lockup, trimmed tight, transparent background."""
    mark_size = round(height * 0.86)
    text_px = round(height * 0.60)
    font = wordmark_font(text_px)
    gap = round(height * 0.26)

    name, suffix = "Kione", " POS"
    probe = Image.new("RGBA", (10, 10))
    pd = ImageDraw.Draw(probe)
    w_name = pd.textlength(name, font=font)
    w_suffix = pd.textlength(suffix, font=font)

    width = mark_size + gap + round(w_name + w_suffix) + pad * 2
    img = Image.new("RGBA", (width, height + pad * 2), (0, 0, 0, 0))
    img.alpha_composite(make_mark(mark_size), (pad, pad + (height - mark_size) // 2))

    draw = ImageDraw.Draw(img)
    baseline = pad + height / 2
    tx = pad + mark_size + gap
    name_fill = (255, 255, 255) if on_dark else TEXT
    draw.text((tx, baseline), name, font=font, fill=name_fill, anchor="lm")
    draw.text((tx + w_name, baseline), suffix, font=font, fill=WORDMARK_ACCENT, anchor="lm")
    return img


def make_splash(width: int, height: int) -> Image.Image:
    img = Image.new("RGB", (width, height), CANVAS)
    logo_h = max(28, round(min(width, height) * 0.13))
    logo = make_wordmark(logo_h)
    if logo.width > width * 0.7:
        ratio = (width * 0.7) / logo.width
        logo = logo.resize((round(logo.width * ratio), max(1, round(logo.height * ratio))), Image.LANCZOS)
    img.paste(logo, ((width - logo.width) // 2, (height - logo.height) // 2), logo)
    return img


# --- favicon.svg --------------------------------------------------------------
def favicon_svg() -> str:
    def n(v: float) -> str:
        return f"{v * 64:.2f}".rstrip("0").rstrip(".")

    def cap_path(p0, p1, w) -> str:
        return (
            f'<line x1="{n(p0[0])}" y1="{n(p0[1])}" x2="{n(p1[0])}" y2="{n(p1[1])}" '
            f'stroke-width="{n(w)}" stroke-linecap="round" />'
        )

    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Kione POS">
  <defs>
    <linearGradient id="k" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6366F1" />
      <stop offset="1" stop-color="#4338CA" />
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="{n(MARK_RADIUS)}" fill="url(#k)" />
  <g fill="none" stroke="#FFFFFF">
    <line x1="{n((STEM[0] + STEM[2]) / 2)}" y1="{n(STEM[1] + (STEM[2] - STEM[0]) / 2)}"
          x2="{n((STEM[0] + STEM[2]) / 2)}" y2="{n(STEM[3] - (STEM[2] - STEM[0]) / 2)}"
          stroke-width="{n(STEM[2] - STEM[0])}" stroke-linecap="round" />
    {cap_path(ARM_JOINT, ARM_UP_END, ARM_WIDTH)}
  </g>
  <g fill="none" stroke="#FFFFFF" stroke-opacity="{LEG_ALPHA / 255:.2f}">
    {cap_path(ARM_JOINT, ARM_DOWN_END, ARM_WIDTH)}
  </g>
</svg>
"""


# --- orchestration ------------------------------------------------------------
def save(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path)
    print(f"  ✓ {path.relative_to(ROOT)}  {img.size[0]}x{img.size[1]}")


def main() -> None:
    print("Kione POS brand assets")

    print("web icons")
    (PUBLIC / "favicon.svg").write_text(favicon_svg(), encoding="utf-8")
    print(f"  ✓ {(PUBLIC / 'favicon.svg').relative_to(ROOT)}")
    for px in (32, 48, 64):
        save(make_mark(px), PUBLIC / f"favicon-{px}.png")
    save(make_mark(180), PUBLIC / "apple-touch-icon.png")
    save(make_mark(192), PUBLIC / "icons" / "icon-192.png")
    save(make_mark(512), PUBLIC / "icons" / "icon-512.png")
    # maskable: full bleed, glyph pulled inside the 80% safe circle
    save(make_mark(512, rounded=False, glyph_scale=0.62), PUBLIC / "icons" / "icon-512-maskable.png")

    print("product wordmark")
    save(make_mark(512), PUBLIC / "brand" / "mark.png")
    save(make_wordmark(256), PUBLIC / "brand" / "logo-full.png")
    save(make_wordmark(256, on_dark=True), PUBLIC / "brand" / "logo-full-inverse.png")

    print("android launcher")
    for bucket, px in (("mdpi", 48), ("hdpi", 72), ("xhdpi", 96), ("xxhdpi", 144), ("xxxhdpi", 192)):
        save(make_mark(px), ANDROID_RES / f"mipmap-{bucket}" / "ic_launcher.png")
        save(make_mark(px, circle=True), ANDROID_RES / f"mipmap-{bucket}" / "ic_launcher_round.png")
    for bucket, px in (("mdpi", 108), ("hdpi", 162), ("xhdpi", 216), ("xxhdpi", 324), ("xxxhdpi", 432)):
        # adaptive foreground: transparent, glyph inside the 72/108 safe zone
        save(draw_glyph(px, scale=0.60), ANDROID_RES / f"mipmap-{bucket}" / "ic_launcher_foreground.png")

    print("android splash")
    save(make_splash(480, 320), ANDROID_RES / "drawable" / "splash.png")
    for bucket, (w, h) in (
        ("mdpi", (320, 480)), ("hdpi", (480, 800)), ("xhdpi", (720, 1280)),
        ("xxhdpi", (960, 1600)), ("xxxhdpi", (1280, 1920)),
    ):
        save(make_splash(w, h), ANDROID_RES / f"drawable-port-{bucket}" / "splash.png")
    for bucket, (w, h) in (
        ("mdpi", (480, 320)), ("hdpi", (800, 480)), ("xhdpi", (1280, 720)),
        ("xxhdpi", (1600, 960)), ("xxxhdpi", (1920, 1280)),
    ):
        save(make_splash(w, h), ANDROID_RES / f"drawable-land-{bucket}" / "splash.png")

    print("done")


if __name__ == "__main__":
    main()
