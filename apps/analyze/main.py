"""PledgeCheck image service (FastAPI on Vultr, behind Caddy).

POST /analyze reads one test photo and returns the OpenCV line read plus a perceptual
hash. It is called only by the Next.js backend with the shared X-Service-Key; there is no
CORS, so browsers cannot call it. Contract: see CONTRACT.md.

No-disk guarantee: photos exist in memory only and nothing is written anywhere.
  * The multipart spool threshold is raised above the 12MB image limit, so Starlette keeps
    uploads in memory instead of rolling them into a temp file.
  * The handler reads the upload into bytes, closes it in a `finally`, and decodes from
    memory (PIL from BytesIO, cv2.imdecode from a numpy buffer). Nothing calls imwrite or
    save, or opens a file for writing.
  * As defense in depth the container runs with a read-only root filesystem and a
    RAM-backed tmpfs /tmp (docker-compose.yml), so even an unexpected spill stays in memory.
Request bodies and image bytes are never logged; uvicorn runs without an access log.
"""

import hmac
import logging
import os

import cv2
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.datastructures import UploadFile
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.formparsers import MultiPartException, MultiPartParser

import lines
from phash import ImageTooLargeError, compute_phash

MAX_IMAGE_BYTES = 12 * 1024 * 1024
MULTIPART_OVERHEAD_BYTES = 64 * 1024

# Keep every upload up to the limit in memory (default spools to disk above 1MB).
MultiPartParser.spool_max_size = MAX_IMAGE_BYTES + MULTIPART_OVERHEAD_BYTES

logger = logging.getLogger("analyze")

# No interactive docs or OpenAPI schema: the service is called only by the Next.js backend.
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


class ApiError(Exception):
    def __init__(self, status: int, code: str):
        self.status = status
        self.code = code


def _error(status: int, code: str) -> JSONResponse:
    return JSONResponse({"error": code}, status_code=status)


@app.exception_handler(ApiError)
async def _api_error(_: Request, exc: ApiError) -> JSONResponse:
    return _error(exc.status, exc.code)


@app.exception_handler(StarletteHTTPException)
async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
    codes = {404: "not_found", 405: "method_not_allowed"}
    return _error(exc.status_code, codes.get(exc.status_code, f"http_{exc.status_code}"))


@app.exception_handler(Exception)
async def _unexpected(_: Request, exc: Exception) -> JSONResponse:
    # Log the exception type only: messages or tracebacks could carry request data.
    logger.error("unhandled error: %s", type(exc).__name__)
    return _error(500, "internal_error")


def _require_service_key(request: Request) -> None:
    expected = os.environ.get("SERVICE_KEY", "")
    if not expected:
        # Refuse everything rather than run open.
        raise ApiError(500, "service_not_configured")
    provided = request.headers.get("x-service-key", "")
    if not hmac.compare_digest(provided.encode(), expected.encode()):
        raise ApiError(401, "unauthorized")


async def _read_image(request: Request) -> bytes:
    content_length = request.headers.get("content-length", "")
    if content_length.isdigit() and int(content_length) > MAX_IMAGE_BYTES + MULTIPART_OVERHEAD_BYTES:
        raise ApiError(413, "image_too_large")
    if not request.headers.get("content-type", "").startswith("multipart/form-data"):
        raise ApiError(415, "expected_multipart")

    try:
        form = await request.form(max_files=1, max_fields=4)
    except MultiPartException:
        raise ApiError(422, "invalid_multipart") from None

    try:
        upload = form.get("image")
        if not isinstance(upload, UploadFile):
            raise ApiError(422, "missing_image")
        try:
            data = await upload.read(MAX_IMAGE_BYTES + 1)
        finally:
            await upload.close()
    finally:
        await form.close()

    if len(data) > MAX_IMAGE_BYTES:
        raise ApiError(413, "image_too_large")
    if not data:
        raise ApiError(422, "missing_image")
    return data


@app.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}


@app.post("/analyze")
async def analyze(request: Request) -> JSONResponse:
    _require_service_key(request)
    data = await _read_image(request)

    try:
        phash = compute_phash(data)
        read = lines.read_lines(data)
    except ImageTooLargeError:
        raise ApiError(413, "image_too_large") from None
    except (OSError, ValueError, cv2.error):
        # PIL.UnidentifiedImageError is an OSError; lines.ImageDecodeError is a ValueError.
        raise ApiError(415, "unsupported_image") from None

    return JSONResponse(
        {
            "result": read.result,
            "controlLine": read.control_line,
            "testLine": read.test_line,
            "confidence": float(read.confidence),
            "phash": phash,
        }
    )
