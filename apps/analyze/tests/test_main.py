import builtins
import logging
import re
import tempfile

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

import main
from tests.images import scene, to_jpeg, to_png

KEY = "k" * 64
URL = "/analyze"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("SERVICE_KEY", KEY)
    return TestClient(main.app, raise_server_exceptions=False)


def post(client, data: bytes | None = None, key: str | None = KEY, field: str = "image", **kwargs):
    headers = {"X-Service-Key": key} if key is not None else {}
    files = {field: ("photo.jpg", data, "image/jpeg")} if data is not None else None
    return client.post(URL, headers=headers, files=files, **kwargs)


# --- health -------------------------------------------------------------------

def test_health_is_open_and_reveals_nothing(client):
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"ok": True}


def test_health_works_without_service_key_configured(monkeypatch):
    monkeypatch.delenv("SERVICE_KEY", raising=False)
    assert TestClient(main.app).get("/health").json() == {"ok": True}


def test_no_docs_or_schema(client):
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert client.get(path).status_code == 404


# --- auth -------------------------------------------------------------------

def test_missing_key_is_401(client):
    res = post(client, to_jpeg(scene()), key=None)
    assert res.status_code == 401
    assert res.json() == {"error": "unauthorized"}


def test_wrong_key_is_401(client):
    res = post(client, to_jpeg(scene()), key="k" * 63 + "x")
    assert res.status_code == 401
    assert res.json() == {"error": "unauthorized"}


def test_correct_key_is_200(client):
    assert post(client, to_jpeg(scene())).status_code == 200


def test_unset_service_key_refuses_everything(monkeypatch):
    monkeypatch.delenv("SERVICE_KEY", raising=False)
    res = post(TestClient(main.app), to_jpeg(scene()), key="")
    assert res.status_code == 500
    assert res.json() == {"error": "service_not_configured"}


def test_empty_service_key_refuses_everything(monkeypatch):
    monkeypatch.setenv("SERVICE_KEY", "")
    res = post(TestClient(main.app), to_jpeg(scene()), key="")
    assert res.status_code == 500


# --- response contract --------------------------------------------------------

@pytest.mark.parametrize("data", [to_jpeg(scene()), to_png(scene()), to_jpeg(Image.new("RGB", (64, 64), "white"))])
def test_response_has_exactly_the_contract_shape(client, data):
    res = post(client, data)
    assert res.status_code == 200
    body = res.json()
    assert set(body) == {"result", "controlLine", "testLine", "confidence", "phash"}
    assert body["result"] in {"positive", "negative", "invalid"}
    assert isinstance(body["controlLine"], bool)
    assert isinstance(body["testLine"], bool)
    assert isinstance(body["confidence"], float)
    assert 0.0 <= body["confidence"] <= 1.0
    assert body["confidence"] == round(body["confidence"], 2)
    assert re.fullmatch(r"[0-9a-f]{16}", body["phash"])


def test_uncalibrated_confidence_is_capped_through_the_api(client):
    assert main.lines.CALIBRATED is False
    for data in (to_jpeg(scene()), to_png(scene(1200, 800)), to_jpeg(Image.new("RGB", (300, 200), "white"))):
        assert post(client, data).json()["confidence"] <= 0.50


def test_no_cors_headers(client):
    res = client.options(URL, headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
    assert "access-control-allow-origin" not in {k.lower() for k in res.headers}
    res = client.post(
        URL,
        headers={"X-Service-Key": KEY, "Origin": "https://evil.example"},
        files={"image": ("p.jpg", to_jpeg(scene()), "image/jpeg")},
    )
    assert "access-control-allow-origin" not in {k.lower() for k in res.headers}


# --- input errors -------------------------------------------------------------

def test_oversize_file_is_413(client):
    data = b"\xff" * (main.MAX_IMAGE_BYTES + 1)
    res = post(client, data)
    assert res.status_code == 413
    assert res.json() == {"error": "image_too_large"}


def test_oversize_body_is_rejected_before_parsing(client):
    data = b"\xff" * (main.MAX_IMAGE_BYTES + 2 * main.MULTIPART_OVERHEAD_BYTES)
    res = post(client, data)
    assert res.status_code == 413


def test_image_at_the_limit_is_accepted_by_size_check(client):
    # Exactly the limit passes the size check (then fails decoding: not an image).
    res = post(client, b"\x00" * main.MAX_IMAGE_BYTES)
    assert res.status_code == 415


def test_huge_dimensions_are_413(client):
    res = post(client, to_png(Image.new("L", (8000, 8000))))
    assert res.status_code == 413


@pytest.mark.parametrize("data", [b"hello world", b"%PDF-1.7 not an image", b"\x89PNG\r\n\x1a\n truncated"])
def test_non_image_bytes_are_415(client, data):
    res = post(client, data)
    assert res.status_code == 415
    assert res.json() == {"error": "unsupported_image"}


def test_missing_image_field_is_422(client):
    res = post(client, to_jpeg(scene()), field="photo")
    assert res.status_code == 422
    assert res.json() == {"error": "missing_image"}


def test_empty_image_is_422(client):
    assert post(client, b"").status_code == 422


def test_non_multipart_is_415(client):
    res = client.post(URL, headers={"X-Service-Key": KEY}, content=to_jpeg(scene()))
    assert res.status_code == 415


def test_unknown_route_is_json_404(client):
    res = client.get("/nope")
    assert res.status_code == 404
    assert res.json() == {"error": "not_found"}


def test_errors_never_echo_the_payload(client):
    marker = b"SECRET-PAYLOAD-MARKER-123"
    res = post(client, marker)
    assert marker.decode() not in res.text
    assert set(res.json()) == {"error"}


# --- no disk, no payload logging ---------------------------------------------

def test_request_writes_nothing_to_disk(client, monkeypatch):
    # ~3MB PNG of noise: larger than Starlette's default 1MB spool threshold.
    rng = np.random.default_rng(7)
    big = to_png(Image.fromarray(rng.integers(0, 256, (1000, 1000, 3), dtype=np.uint8), "RGB"))
    assert len(big) > 1024 * 1024
    small = to_jpeg(scene())

    writes: list[str] = []
    real_open = builtins.open

    def guarded_open(file, mode="r", *args, **kwargs):
        if any(flag in mode for flag in "wax+"):
            writes.append(f"open({file!r}, {mode!r})")
            raise AssertionError("file opened for writing during a request")
        return real_open(file, mode, *args, **kwargs)

    def forbid(name):
        def _fail(*args, **kwargs):
            writes.append(name)
            raise AssertionError(f"{name} called during a request")
        return _fail

    monkeypatch.setattr(builtins, "open", guarded_open)
    monkeypatch.setattr(cv2, "imwrite", forbid("cv2.imwrite"))
    monkeypatch.setattr(Image.Image, "save", forbid("PIL.Image.save"))
    monkeypatch.setattr(tempfile.SpooledTemporaryFile, "rollover", forbid("SpooledTemporaryFile.rollover"))
    monkeypatch.setattr(tempfile, "TemporaryFile", forbid("tempfile.TemporaryFile"))
    monkeypatch.setattr(tempfile, "NamedTemporaryFile", forbid("tempfile.NamedTemporaryFile"))
    monkeypatch.setattr(tempfile, "mkstemp", forbid("tempfile.mkstemp"))

    for payload in (small, big):
        res = post(client, payload)
        assert res.status_code == 200, res.text
    assert writes == []


def test_payload_is_not_logged(client, caplog):
    marker = b"LOGGED-PAYLOAD-MARKER-456"
    with caplog.at_level(logging.DEBUG):
        post(client, marker)
        post(client, to_jpeg(scene()))
    assert marker.decode() not in caplog.text
