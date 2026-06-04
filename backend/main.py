"""Wymber is local-first: the encrypted vault lives in the browser, so the server has no
accounts, no database, and no API for user data. This process only serves the static app —
and is where an optional, future, zero-knowledge sync endpoint would live.
See docs/adr/0001-local-first-encrypted-file.md.
"""
import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

app = FastAPI(title="Wymber", version="3.0.0")

# Localhost-only CORS (dev: 8000 direct, 8080 Docker host, 8089 E2E).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8080", "http://localhost:8000", "http://localhost:8089"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def revalidate_app_assets(request: Request, call_next):
    """No build/hashing step, so ask browsers to revalidate the shell + assets on each load
    (a returning user shouldn't be stuck on stale cached JS after an update — a cheap
    conditional GET that 304s when unchanged)."""
    response = await call_next(request)
    if request.url.path == "/" or request.url.path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-cache"
    return response


app.mount("/static", StaticFiles(directory="frontend"), name="static")


@app.get("/api/health")
async def health():
    """Liveness check for self-host/monitoring. No user data is ever served here."""
    return {"status": "ok"}


@app.get("/sw.js")
async def service_worker():
    """The service worker must be served from the root so it can control the whole origin
    (the PWA offline/installable layer). It caches only the static shell, never user data."""
    return FileResponse(
        "frontend/sw.js",
        media_type="application/javascript",
        headers={"Cache-Control": "no-cache", "Service-Worker-Allowed": "/"},
    )


@app.get("/manifest.webmanifest")
async def manifest():
    """PWA manifest at the root, with the correct manifest MIME type."""
    return FileResponse(
        "frontend/manifest.webmanifest",
        media_type="application/manifest+json",
        headers={"Cache-Control": "no-cache"},
    )


@app.get("/")
async def root():
    with open("frontend/index.html", encoding="utf-8") as f:
        return HTMLResponse(content=f.read())


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8000")))
