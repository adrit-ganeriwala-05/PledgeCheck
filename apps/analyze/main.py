"""PledgeCheck image service (FastAPI on Vultr, behind Caddy).

Only GET /health is served for now; POST /analyze arrives with ticket A4.
"""

from fastapi import FastAPI

# No interactive docs or OpenAPI schema: the service is called only by the Next.js backend.
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


@app.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}
