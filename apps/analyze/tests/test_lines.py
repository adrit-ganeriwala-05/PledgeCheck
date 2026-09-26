"""Tests for the uncalibrated baseline's logic and safety cap.

None of these images are pregnancy-test photos, and none of these tests validate
detection accuracy. Accuracy is measured only on real photos (test_real_photos.py).
"""

import numpy as np
import pytest
from PIL import Image

import lines
from tests.images import checkerboard, scene, to_jpeg, to_png

RESULTS = {"positive", "negative", "invalid"}


# --- fixed lateral-flow semantics -------------------------------------------

@pytest.mark.parametrize(
    ("control", "test", "expected"),
    [(False, False, "invalid"), (False, True, "invalid"), (True, False, "negative"), (True, True, "positive")],
)
def test_classify(control, test, expected):
    assert lines.classify(control, test) == expected


# --- confidence cap -----------------------------------------------------------

def test_module_is_marked_uncalibrated():
    assert lines.CALIBRATED is False
    assert lines.UNCALIBRATED_CONFIDENCE_CAP == 0.50


@pytest.mark.parametrize("raw", [0.0, 0.3, 0.5, 0.51, 0.85, 0.99, 1.0, 7.0])
def test_cap_applies_while_uncalibrated(raw):
    assert lines.finalize_confidence(raw) <= 0.50


def test_cap_lifts_only_when_calibrated(monkeypatch):
    monkeypatch.setattr(lines, "CALIBRATED", True)
    assert lines.finalize_confidence(0.93) == 0.93
    assert lines.finalize_confidence(1.7) == 1.0


def _generic_inputs() -> list[bytes]:
    rng = np.random.default_rng(0)
    noise = Image.fromarray(rng.integers(0, 256, (300, 400, 3), dtype=np.uint8), "RGB")
    bright_bar = Image.new("RGB", (600, 400), (30, 30, 30))
    bright_bar.paste((245, 245, 245), (80, 170, 520, 230))  # plain bright rectangle, no bands
    return [
        to_jpeg(Image.new("RGB", (320, 240), (255, 255, 255))),
        to_jpeg(Image.new("RGB", (320, 240), (0, 0, 0))),
        to_jpeg(noise),
        to_png(checkerboard()),
        to_jpeg(scene()),
        to_png(bright_bar),
        to_jpeg(scene(3000, 2000)),  # exercises downscaling
    ]


@pytest.mark.parametrize("data", _generic_inputs())
def test_any_input_stays_under_cap_with_valid_shape(data):
    read = lines.read_lines(data)
    assert read.result in RESULTS
    assert isinstance(read.control_line, bool) and isinstance(read.test_line, bool)
    assert 0.0 <= read.confidence <= 0.50
    assert read.result == lines.classify(read.control_line, read.test_line)


def test_plain_bright_rectangle_is_found_and_has_no_bands():
    img = Image.new("RGB", (600, 400), (30, 30, 30))
    img.paste((245, 245, 245), (80, 170, 520, 230))
    strip = lines.find_strip(lines.decode(to_png(img)))
    assert strip is not None
    assert strip.shape[1] > strip.shape[0]  # long axis horizontal
    assert lines.find_bands(lines.saturation_profile(strip)) == []


def test_no_strip_reads_invalid():
    read = lines.read_lines(to_jpeg(Image.new("RGB", (320, 240), (0, 0, 0))))
    assert read == lines.LineRead("invalid", False, False, lines.NO_STRIP_CONFIDENCE)


def test_undecodable_bytes_raise():
    with pytest.raises(lines.ImageDecodeError):
        lines.read_lines(b"not an image at all")


# --- band detection on 1-D profiles (algorithm unit tests, not photos) --------

def _profile(*centers: int, height: float = 60.0, length: int = 400) -> np.ndarray:
    x = np.arange(length, dtype=np.float32)
    rng = np.random.default_rng(1)
    base = 10 + rng.normal(0, 1.0, length).astype(np.float32)
    for c in centers:
        base += height * np.exp(-((x - c) ** 2) / (2 * 3.0**2))
    return base


@pytest.mark.parametrize(("centers", "count"), [((), 0), ((120,),1), ((120, 260), 2)])
def test_find_bands_counts(centers, count):
    assert len(lines.find_bands(_profile(*centers))) == count


def test_find_bands_merges_close_peaks():
    assert len(lines.find_bands(_profile(200, 205))) == 1


def test_find_bands_orders_strongest_first():
    x = np.arange(400, dtype=np.float32)
    profile = 10 + 80 * np.exp(-((x - 100) ** 2) / 18) + 30 * np.exp(-((x - 300) ** 2) / 18)
    snrs = lines.find_bands(profile.astype(np.float32))
    assert len(snrs) == 2 and snrs[0] > snrs[1]
