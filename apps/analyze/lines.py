"""Control/test line reader for lateral-flow pregnancy tests. UNCALIBRATED BASELINE.

Status: this is a baseline, not a validated detector. The physical test model, region of
interest, thresholds and confidence formula are not yet defined, and it has not been
measured on real photos. While CALIBRATED is False, confidence is capped at
UNCALIBRATED_CONFIDENCE_CAP (0.50), below the 0.85 fast-path threshold, so every
submission it reads goes to needs_review. Calibrate on the team's real test photos in
tests/fixtures/photos/ before setting CALIBRATED = True.

Method:
  1. Decode from memory (EXIF orientation applied by OpenCV) and downscale.
  2. Find the brightest large rectangular region: the strip or result window.
  3. Warp it upright with the long axis horizontal and take a saturation profile along
     the long axis (lines are coloured; the strip background is white/grey).
  4. Detect bands as peaks that rise above the profile's noise.

Result semantics (fixed lateral-flow rules):
  no control line          -> "invalid"
  control line + test line -> "positive"
  control line only        -> "negative"
Which physical band is the control is not known without a test model, so the baseline
treats the strongest band as the control and a second band as the test line.

Nothing is written to disk: bytes are decoded with cv2.imdecode and never saved.
"""

from dataclasses import dataclass

import cv2
import numpy as np

# ---------------------------------------------------------------------------
# Tunable constants (uncalibrated starting values)
# ---------------------------------------------------------------------------
CALIBRATED = False
UNCALIBRATED_CONFIDENCE_CAP = 0.50

MAX_SIDE_PX = 1024                # downscale longest side to this before analysis
BLUR_KSIZE = 5                    # Gaussian blur before thresholding (odd)

STRIP_MIN_AREA_FRAC = 0.02        # strip must cover at least this share of the image
STRIP_MIN_ASPECT = 2.0            # long side / short side of the strip or window
STRIP_MIN_RECT_FILL = 0.6         # contour area / min-area-rect area (rectangularity)
STRIP_MIN_MEAN_GRAY = 140         # strip region must be bright (0-255)

PROFILE_BAND_FRAC = 0.6           # central share of the short axis averaged into the profile
PROFILE_EDGE_MARGIN_FRAC = 0.05   # ignore this share at each end of the long axis
PROFILE_SMOOTH_FRAC = 0.01        # Gaussian sigma as a share of profile length
NOISE_FLOOR = 1.0                 # minimum noise estimate (saturation units)

PEAK_MIN_SNR = 4.0                # band must rise this many noise units above baseline
PEAK_MIN_SEPARATION_FRAC = 0.05   # bands closer than this share of the length merge
CONFIDENCE_FULL_SNR = 12.0        # SNR at which a band counts as fully clear
EXTRA_BAND_PENALTY = 0.7          # confidence multiplier when more than two bands appear

NO_STRIP_CONFIDENCE = 0.10


class ImageDecodeError(ValueError):
    """The bytes are not an image OpenCV can decode."""


@dataclass(frozen=True)
class LineRead:
    result: str          # "positive" | "negative" | "invalid"
    control_line: bool
    test_line: bool
    confidence: float    # [0, 1], rounded to 2 decimals


def classify(control_line: bool, test_line: bool) -> str:
    if not control_line:
        return "invalid"
    return "positive" if test_line else "negative"


def finalize_confidence(value: float) -> float:
    value = float(np.clip(value, 0.0, 1.0))
    if not CALIBRATED:
        value = min(value, UNCALIBRATED_CONFIDENCE_CAP)
    return round(value, 2)


def decode(data: bytes) -> np.ndarray:
    img = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is None or img.size == 0:
        raise ImageDecodeError("not a decodable image")
    return img


def _downscale(img: np.ndarray) -> np.ndarray:
    h, w = img.shape[:2]
    scale = MAX_SIDE_PX / max(h, w)
    if scale >= 1:
        return img
    return cv2.resize(img, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)


def find_strip(img: np.ndarray) -> np.ndarray | None:
    """Return the strip region warped upright (long axis horizontal), or None."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (BLUR_KSIZE, BLUR_KSIZE), 0)
    _, mask = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    image_area = img.shape[0] * img.shape[1]
    best: tuple[float, tuple] | None = None
    for contour in contours:
        area = cv2.contourArea(contour)
        if area < STRIP_MIN_AREA_FRAC * image_area:
            continue
        rect = cv2.minAreaRect(contour)
        (rw, rh) = rect[1]
        if min(rw, rh) < 1:
            continue
        if max(rw, rh) / min(rw, rh) < STRIP_MIN_ASPECT:
            continue
        if area / (rw * rh) < STRIP_MIN_RECT_FILL:
            continue
        region = np.zeros_like(gray)
        cv2.drawContours(region, [contour], -1, 255, thickness=cv2.FILLED)
        if cv2.mean(gray, mask=region)[0] < STRIP_MIN_MEAN_GRAY:
            continue
        if best is None or area > best[0]:
            best = (area, rect)

    if best is None:
        return None

    rect = best[1]
    (rw, rh) = rect[1]
    long_side, short_side = int(round(max(rw, rh))), int(round(min(rw, rh)))
    # boxPoints returns the corners in consecutive order; start at a corner whose next
    # edge is a long edge so it maps to the output width (a mirrored result is fine).
    box = cv2.boxPoints(rect).astype(np.float32)
    if np.linalg.norm(box[1] - box[0]) >= np.linalg.norm(box[2] - box[1]):
        src = box
    else:
        src = box[[1, 2, 3, 0]]
    dst = np.array(
        [[0, 0], [long_side - 1, 0], [long_side - 1, short_side - 1], [0, short_side - 1]],
        dtype=np.float32,
    )
    matrix = cv2.getPerspectiveTransform(src, dst)
    return cv2.warpPerspective(img, matrix, (long_side, short_side))


def saturation_profile(strip: np.ndarray) -> np.ndarray:
    hsv = cv2.cvtColor(strip, cv2.COLOR_BGR2HSV)
    saturation = hsv[:, :, 1].astype(np.float32)
    h, w = saturation.shape
    band = max(1, int(h * PROFILE_BAND_FRAC))
    top = (h - band) // 2
    profile = saturation[top : top + band].mean(axis=0)
    margin = int(w * PROFILE_EDGE_MARGIN_FRAC)
    if margin and w - 2 * margin > 10:
        profile = profile[margin : w - margin]
    sigma = max(1.0, len(profile) * PROFILE_SMOOTH_FRAC)
    return cv2.GaussianBlur(profile.reshape(1, -1), (0, 0), sigmaX=sigma).ravel()


def find_bands(profile: np.ndarray) -> list[float]:
    """Return the SNR of each detected band, strongest first."""
    if profile.size < 3:
        return []
    baseline = float(np.median(profile))
    noise = max(NOISE_FLOOR, 1.4826 * float(np.median(np.abs(profile - baseline))))
    snr = (profile - baseline) / noise

    separation = max(1, int(len(profile) * PEAK_MIN_SEPARATION_FRAC))
    candidates = [
        i
        for i in range(1, len(profile) - 1)
        if snr[i] >= PEAK_MIN_SNR and snr[i] >= snr[i - 1] and snr[i] > snr[i + 1]
    ]
    candidates.sort(key=lambda i: snr[i], reverse=True)

    kept: list[int] = []
    for i in candidates:
        if all(abs(i - j) >= separation for j in kept):
            kept.append(i)
    return [float(snr[i]) for i in kept]


def read_lines(data: bytes) -> LineRead:
    img = _downscale(decode(data))
    strip = find_strip(img)
    if strip is None:
        return LineRead("invalid", False, False, finalize_confidence(NO_STRIP_CONFIDENCE))

    bands = find_bands(saturation_profile(strip))
    control_line = len(bands) >= 1
    test_line = len(bands) >= 2
    result = classify(control_line, test_line)

    full = CONFIDENCE_FULL_SNR
    if result == "invalid":
        confidence = 0.5
    elif result == "negative":
        confidence = min(1.0, bands[0] / full)
    else:
        confidence = min(1.0, min(bands[0], bands[1]) / full)
        if len(bands) > 2:
            confidence *= EXTRA_BAND_PENALTY

    return LineRead(result, control_line, test_line, finalize_confidence(confidence))
