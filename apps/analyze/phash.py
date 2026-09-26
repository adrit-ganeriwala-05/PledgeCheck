"""Perceptual hash of a photo, used by the web app to detect reused photos.

The hash is computed from bytes held in memory; nothing is written to disk.
Comparison (Hamming distance < 8 counts as a match) lives in the web app's fraud
module (Nihalika), not here.
"""

import warnings
from io import BytesIO

import imagehash
from PIL import Image, ImageOps

# Refuse absurdly large decoded images (decompression bombs). A 12MB phone photo is
# well under this; Pillow raises DecompressionBombError above 2x this value and warns
# above 1x, which we also treat as an error.
MAX_IMAGE_PIXELS = 50_000_000
Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS


class ImageTooLargeError(ValueError):
    """Decoded pixel count exceeds MAX_IMAGE_PIXELS."""


def compute_phash(data: bytes) -> str:
    """Return the 64-bit pHash as 16 lowercase hex characters.

    EXIF orientation is applied first so the same photo hashes the same whether the
    phone stored it rotated or not. Raises PIL.UnidentifiedImageError for non-images.
    """
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        try:
            img = Image.open(BytesIO(data))
        except (Image.DecompressionBombWarning, Image.DecompressionBombError) as exc:
            raise ImageTooLargeError(str(exc)) from None
    with img:
        upright = ImageOps.exif_transpose(img)
        return str(imagehash.phash(upright.convert("RGB")))
