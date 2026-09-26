# Image service contract (`apps/analyze`)

Owner: Adrit. Consumer: the submissions pipeline (Labib, L4). Change only with both owners' OK.

Base URL: `ANALYZE_URL` (production `https://api.pledgecheck.tech`). Server-to-server only:
there is no CORS, so the browser must never call this service.

## `POST /analyze`

**Request**

- `Content-Type: multipart/form-data` with one file field named **`image`** (JPEG, PNG or
  WebP; HEIC is not decodable, so send the camera capture as JPEG).
- Header **`X-Service-Key: <ANALYZE_SERVICE_KEY>`**, the same value as `SERVICE_KEY` on the server.
- Maximum image size: **12 MiB** (12 × 1024 × 1024 bytes).

```ts
const form = new FormData();
form.append("image", new Blob([bytes], { type: "image/jpeg" }), "capture.jpg");
const res = await fetch(`${serverEnv.ANALYZE_URL}/analyze`, {
  method: "POST",
  headers: { "X-Service-Key": serverEnv.ANALYZE_SERVICE_KEY },
  body: form,
});
```

**Response 200**: exactly these five keys, never more or fewer:

```json
{ "result": "negative", "controlLine": true, "testLine": false, "confidence": 0.5, "phash": "c3a1f09e5b7d2e44" }
```

| Key | Type | Meaning |
|---|---|---|
| `result` | `"positive" \| "negative" \| "invalid"` | Same vocabulary as Grok's read. No control line → `invalid`; control + test → `positive`; control only → `negative`. |
| `controlLine` | boolean | A control band was detected. |
| `testLine` | boolean | A test band was detected. |
| `confidence` | number in [0, 1], 2 decimals | **Capped at 0.50 while the reader is uncalibrated** (`lines.CALIBRATED = False`), so it is always below the 0.85 fast-path threshold and every submission goes to `needs_review`. |
| `phash` | string, 16 lowercase hex chars | 64-bit perceptual hash after EXIF orientation. Reuse check (Hamming distance < 8) is done in the web app (`lib/fraud`, Nihalika). |

**Errors**: always JSON `{ "error": "<code>" }`; no image data is echoed.

| Status | `error` | When |
|---|---|---|
| 401 | `unauthorized` | `X-Service-Key` missing or wrong |
| 413 | `image_too_large` | Image over 12 MiB, or decoded dimensions over 50M pixels |
| 415 | `unsupported_image` | Bytes are not a decodable image |
| 415 | `expected_multipart` | Body is not `multipart/form-data` |
| 422 | `missing_image` | No (or empty) `image` field |
| 422 | `invalid_multipart` | Malformed multipart body, or more than one file |
| 500 | `service_not_configured` | `SERVICE_KEY` unset on the server; every request is refused |
| 500 | `internal_error` | Unexpected failure, including a read that would violate this contract (the response is validated before every 200) |

Caddy rejects bodies over 12 MiB before they reach the app; that 413 may not be JSON.
The pipeline should treat any non-200 as "OpenCV read unavailable" and let the rules
engine route the submission to `needs_review`; never treat it as a negative.

## `GET /health`

No auth. Returns `200 {"ok": true}` and nothing about configuration.

## Guarantees

- The photo is held in memory only; nothing is written to disk (see the top of `main.py`).
- Request bodies and image bytes are never logged.

## Running the tests

Needs Python 3.12+ (numpy 2.5 has no 3.11 wheels). Either:

```sh
cd apps/analyze
python3.12 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/pytest -q
```

or, with Docker only:

```sh
cd apps/analyze
docker run --rm -e PYTHONDONTWRITEBYTECODE=1 -v "$PWD":/src:ro -w /src python:3.12-slim sh -c \
  "apt-get update -qq && apt-get install -y -qq libglib2.0-0 >/dev/null && pip install -q -r requirements-dev.txt && pytest -q"
```

Real-photo accuracy (after adding labelled photos to `tests/fixtures/photos/`):
`pytest -q -s tests/test_real_photos.py`.
