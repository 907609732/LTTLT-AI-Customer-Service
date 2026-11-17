#!/usr/bin/env python3
"""Generate the Windows taskbar/EXE icon from the existing brand artwork.

The source PNG is the shipped square brand mark with an opaque white background.
Windows taskbar icons must be transparent outside the round silhouette, otherwise
the shell paints the white square corners on both light and dark taskbars. This
tool keeps the existing rabbit/speech-bubble artwork unchanged and only composes
it into a circular canvas: the full mark is inset so its bounding box fits inside
the circle, so no part of the logo is clipped.

Requires Pillow (the mature local image tool already used for icon evidence).
Run `python scripts/generate-windows-icon.py` after changing the brand artwork;
the generated ICO is committed because CI does not install Pillow.
"""

from __future__ import annotations

import argparse
import math
import statistics
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE = ROOT / "src" / "assets" / "lingtu-ai-icon.png"
DEFAULT_OUTPUT = ROOT / "public" / "lingtu-ai.ico"

# Explorer/taskbar request these sizes; 16/24/32 are the ones that previously
# looked square in the taskbar, 256 is used by the shell and electron-builder.
ICON_SIZES = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
MASTER_SIZE = 1024
# Content darker than this is brand ink (the background is 253-255 white).
INK_THRESHOLD = 245
# Leave breathing room inside the circular mask; fitting the bbox corners at 86%
# of the radius avoids clipping the rabbit ears and speech-bubble tail.
FIT_RATIO = 0.86


def content_bbox(image: Image.Image) -> tuple[int, int, int, int]:
    """Bounding box of the brand ink, ignoring the opaque white background."""
    pixels = image.load()
    left, top, right, bottom = image.width, image.height, -1, -1
    for y in range(image.height):
        for x in range(image.width):
            red, green, blue, alpha = pixels[x, y]
            if alpha and min(red, green, blue) < INK_THRESHOLD:
                left, top = min(left, x), min(top, y)
                right, bottom = max(right, x), max(bottom, y)
    if right < left or bottom < top:
        raise SystemExit("brand artwork has no visible ink; refusing to generate an empty icon")
    return left, top, right + 1, bottom + 1


def background_colour(image: Image.Image) -> tuple[int, int, int, int]:
    """Use the artwork's own background so the inset logo blends into the disc."""
    points = [
        image.getpixel((0, 0)),
        image.getpixel((image.width - 1, 0)),
        image.getpixel((0, image.height - 1)),
        image.getpixel((image.width - 1, image.height - 1)),
    ]
    channels = [statistics.median(point[index] for point in points) for index in range(3)]
    return (int(channels[0]), int(channels[1]), int(channels[2]), 255)


def render(source: Image.Image) -> Image.Image:
    """Compose the existing mark onto a fully opaque circle with transparent corners."""
    source = source.convert("RGBA")
    logo = source.crop(content_bbox(source))
    background = background_colour(source)

    master = Image.new("RGBA", (MASTER_SIZE, MASTER_SIZE), (0, 0, 0, 0))
    disc = ImageDraw.Draw(master)
    disc.ellipse((0, 0, MASTER_SIZE - 1, MASTER_SIZE - 1), fill=background)

    # Scale by the logo's circumscribed radius, not its width, so every corner of
    # the rectangular artwork stays inside the round mask.
    fit_radius = (MASTER_SIZE / 2) * FIT_RATIO
    logo_radius = math.hypot(logo.width / 2, logo.height / 2)
    scale = fit_radius / logo_radius
    size = (max(1, round(logo.width * scale)), max(1, round(logo.height * scale)))
    scaled = logo.resize(size, Image.Resampling.LANCZOS)
    master.alpha_composite(
        scaled,
        ((MASTER_SIZE - size[0]) // 2, (MASTER_SIZE - size[1]) // 2),
    )

    # Cut the circular silhouette last; this is what makes the four corners fully
    # transparent at every embedded size instead of opaque white.
    mask = Image.new("L", (MASTER_SIZE, MASTER_SIZE), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, MASTER_SIZE - 1, MASTER_SIZE - 1), fill=255)
    master.putalpha(ImageChops.multiply(master.getchannel("A"), mask))
    return master


def save_icon(master: Image.Image, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    master.save(output, format="ICO", sizes=ICON_SIZES)


def check_icon(path: Path, preview_dir: Path | None = None) -> bool:
    """Assert all embedded sizes have transparent corners and an opaque centre."""
    icon = Image.open(path)
    expected = {size for size in ICON_SIZES}
    actual = set(icon.info.get("sizes", []))
    if actual != expected:
        print(f"FAIL {path}: sizes {sorted(actual)} != {sorted(expected)}")
        return False
    if preview_dir:
        preview_dir.mkdir(parents=True, exist_ok=True)
    ok = True
    for width, height in ICON_SIZES:
        icon.size = (width, height)
        frame = icon.convert("RGBA")
        corners = [
            frame.getpixel((0, 0))[3],
            frame.getpixel((width - 1, 0))[3],
            frame.getpixel((0, height - 1))[3],
            frame.getpixel((width - 1, height - 1))[3],
        ]
        centre = frame.getpixel((width // 2, height // 2))[3]
        alpha_bytes = frame.getchannel("A").tobytes()
        transparent = alpha_bytes.count(0) * 100 // len(alpha_bytes)
        passed = corners == [0, 0, 0, 0] and centre == 255 and transparent >= 5
        ok = ok and passed
        print(
            f"{'PASS' if passed else 'FAIL'} {width}x{height}: corners={corners} "
            f"centre_alpha={centre} transparent={transparent}%"
        )
        if preview_dir:
            frame.save(preview_dir / f"lingtu-ai-{width}.png")
    return ok


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--check", action="store_true", help="validate an existing ICO")
    parser.add_argument("--preview-dir", type=Path, help="write rendered PNG previews")
    args = parser.parse_args()

    if args.check:
        return 0 if check_icon(args.output, args.preview_dir) else 1

    source = Image.open(args.source)
    master = render(source)
    save_icon(master, args.output)
    print(f"wrote {args.output} from {args.source} ({master.width}px master)")
    return 0 if check_icon(args.output, args.preview_dir) else 1


if __name__ == "__main__":
    sys.exit(main())
