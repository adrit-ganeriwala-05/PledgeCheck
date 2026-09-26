import re

import imagehash
import pytest
from PIL import Image, UnidentifiedImageError

from phash import ImageTooLargeError, compute_phash
from tests.images import checkerboard, scene, to_jpeg, to_png


def distance(a: str, b: str) -> int:
    return imagehash.hex_to_hash(a) - imagehash.hex_to_hash(b)


def test_format_is_16_lowercase_hex():
    assert re.fullmatch(r"[0-9a-f]{16}", compute_phash(to_jpeg(scene())))


def test_deterministic():
    data = to_jpeg(scene())
    assert compute_phash(data) == compute_phash(data)


def test_exif_rotated_copy_matches():
    original = scene()
    # EXIF orientation 6 means "rotate 90 degrees clockwise to display", so the stored
    # pixels are the upright image rotated 90 degrees counter-clockwise.
    stored = original.transpose(Image.Transpose.ROTATE_90)
    upright_hash = compute_phash(to_jpeg(original))
    rotated_hash = compute_phash(to_jpeg(stored, exif_orientation=6))
    assert distance(upright_hash, rotated_hash) < 8


def test_orientation_is_what_makes_them_match():
    # Same stored pixels without the EXIF tag must NOT match: proves exif_transpose runs.
    original = scene()
    stored = original.transpose(Image.Transpose.ROTATE_90)
    assert distance(compute_phash(to_jpeg(original)), compute_phash(to_jpeg(stored))) >= 8


def test_recompressed_copy_matches():
    img = scene()
    assert distance(compute_phash(to_jpeg(img, quality=95)), compute_phash(to_jpeg(img, quality=60))) < 8


def test_unrelated_images_are_far_apart():
    assert distance(compute_phash(to_png(scene())), compute_phash(to_png(checkerboard()))) >= 20


def test_non_image_bytes_raise():
    with pytest.raises(UnidentifiedImageError):
        compute_phash(b"definitely not an image")


def test_oversized_dimensions_raise():
    huge = Image.new("L", (8000, 8000))  # 64M pixels > limit; PNG of a blank image is small
    with pytest.raises(ImageTooLargeError):
        compute_phash(to_png(huge))
