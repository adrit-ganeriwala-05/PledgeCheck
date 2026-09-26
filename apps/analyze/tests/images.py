"""Programmatic test images, built in memory.

These exercise hashing, decoding and request handling only. They are NOT pregnancy-test
photos and must never be used to validate line detection.
"""

from io import BytesIO

import numpy as np
from PIL import Image, ImageDraw


def scene(width: int = 480, height: int = 320) -> Image.Image:
    """Asymmetric gradient with shapes, so rotations produce clearly different pixels."""
    x = np.linspace(0, 255, width, dtype=np.float32)
    y = np.linspace(0, 255, height, dtype=np.float32)[:, None]
    rgb = np.stack([np.broadcast_to(x, (height, width)), np.broadcast_to(y, (height, width)),
                    np.full((height, width), 90, np.float32)], axis=-1).astype(np.uint8)
    img = Image.fromarray(rgb, "RGB")
    draw = ImageDraw.Draw(img)
    draw.rectangle([40, 40, 180, 120], fill=(250, 250, 250))
    draw.ellipse([300, 180, 440, 300], fill=(20, 20, 20))
    draw.polygon([(60, 280), (160, 180), (220, 300)], fill=(200, 30, 30))
    return img


def checkerboard(width: int = 480, height: int = 320, cell: int = 20) -> Image.Image:
    yy, xx = np.mgrid[0:height, 0:width]
    board = (((xx // cell) + (yy // cell)) % 2 * 255).astype(np.uint8)
    return Image.fromarray(board, "L").convert("RGB")


def to_jpeg(img: Image.Image, exif_orientation: int | None = None, quality: int = 90) -> bytes:
    buf = BytesIO()
    kwargs: dict = {"format": "JPEG", "quality": quality}
    if exif_orientation is not None:
        exif = Image.Exif()
        exif[0x0112] = exif_orientation
        kwargs["exif"] = exif.tobytes()
    img.save(buf, **kwargs)
    return buf.getvalue()


def to_png(img: Image.Image) -> bytes:
    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()
