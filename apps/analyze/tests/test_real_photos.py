"""Line detection on the team's real test photos.

Put photos in tests/fixtures/photos/ and label them either with labels.json
({"IMG_0001.jpg": "negative", ...}) or with a filename prefix (negative_01.jpg,
positive_02.jpg, invalid_03.jpg). Labels must come from reading the physical test.
Never add synthetic or generated test images here.

While lines.CALIBRATED is False these tests only check the contract and print accuracy;
once calibrated, each photo must read correctly.
"""

import json
from pathlib import Path

import pytest

import lines

PHOTO_DIR = Path(__file__).parent / "fixtures" / "photos"
LABELS = {"positive", "negative", "invalid"}
EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}  # what OpenCV can decode; convert HEIC first


def _labelled_photos() -> list[tuple[Path, str]]:
    if not PHOTO_DIR.is_dir():
        return []
    labels_file = PHOTO_DIR / "labels.json"
    labels = json.loads(labels_file.read_text()) if labels_file.exists() else {}
    photos = []
    for path in sorted(PHOTO_DIR.iterdir()):
        if path.suffix.lower() not in EXTENSIONS:
            continue
        label = labels.get(path.name) or path.stem.split("_")[0].lower()
        if label in LABELS:
            photos.append((path, label))
    return photos


PHOTOS = _labelled_photos()
SKIP_REASON = (
    "No labelled real test photos in tests/fixtures/photos/. Real team photos are required "
    "to measure or calibrate line detection."
)


@pytest.mark.skipif(not PHOTOS, reason=SKIP_REASON)
@pytest.mark.parametrize(("path", "label"), PHOTOS, ids=[p.name for p, _ in PHOTOS])
def test_real_photo(path: Path, label: str):
    read = lines.read_lines(path.read_bytes())
    assert read.result in LABELS
    assert 0.0 <= read.confidence <= 1.0
    if lines.CALIBRATED:
        assert read.result == label
    else:
        assert read.confidence <= lines.UNCALIBRATED_CONFIDENCE_CAP


@pytest.mark.skipif(not PHOTOS, reason=SKIP_REASON)
def test_report_accuracy(capsys):
    correct = sum(lines.read_lines(p.read_bytes()).result == label for p, label in PHOTOS)
    with capsys.disabled():
        print(f"\nlines.py accuracy on {len(PHOTOS)} real photos: {correct}/{len(PHOTOS)}")
