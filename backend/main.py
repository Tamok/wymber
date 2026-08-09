"""Wymber is local-first: the encrypted vault lives in the browser, so the server has no
accounts, no database, and no API for user data. This process only serves the static app —
and is where an optional, future, zero-knowledge sync endpoint would live.
See docs/adr/0001-local-first-encrypted-file.md.
"""
import base64
import hashlib
import os
import re

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

app = FastAPI(title="Wymber", version="3.0.0")

# --- ADR-0003 Layer 1: a strict Content-Security-Policy ------------------------------------
#
# `script-src` is 'self' plus one 'sha256-<base64>' hash per inline <script> block actually
# present in frontend/index.html (today: just the pre-paint theme guard in <head>). The hash is
# DERIVED from the file at import time, never hardcoded: a hardcoded hash goes stale the moment
# anyone edits the inline script, and a stale script-src hash silently breaks it (the theme guard
# would just stop running, no visible error). Reading the actual bytes makes staleness
# structurally impossible, same reasoning as the SRI injection in scripts/build-pages.mjs.
#
# scripts/csp.mjs implements the identical rule in Node for the Cloudflare Pages build
# (dist/_headers). That duplication is intentional: two different runtimes serve this app (this
# process for self-hosting/E2E, Cloudflare Pages for web.wymber.app), there is no shared runtime
# to share code through, and each side hashes the HTML *it* actually serves.
#
# `style-src` keeps 'unsafe-inline': frontend/index.html's <body> uses inline `style="..."`
# attributes, which aren't practical to hash individually. Script injection, not style injection,
# is the threat this policy targets, so that is an accepted, narrow trade-off.
_INLINE_SCRIPT_RE = re.compile(r"<script\b([^>]*)>(.*?)</script>", re.IGNORECASE | re.DOTALL)


def _normalize_newlines(text: str) -> str:
    """Match the WHATWG HTML spec's "preprocessing the input stream" step, which turns every
    \\r\\n and lone \\r into \\n BEFORE tokenizing: a browser computes a script's CSP hash from
    LF-only text, even if the bytes on disk use CRLF. This repo's blobs are LF, but git's
    core.autocrlf rewrites them to CRLF on a Windows checkout, so hashing without this would
    compute a hash the browser never produces there, silently blocking the theme guard on exactly
    the platform most people self-host from. Explicit here rather than relying on the incidental
    universal-newlines behaviour of Python's text-mode file read (open(..., encoding="utf-8")
    already does this on read today, but that's easy to lose if the read path ever changes).
    scripts/csp.mjs normalizes the same way, independently, for the same reason."""
    return text.replace("\r\n", "\n").replace("\r", "\n")


# A <script> whose type is none of these is a "data block": HTML never executes it, so CSP never
# gates it and it needs no hash (e.g. application/ld+json structured data). Kept in lockstep with
# EXECUTABLE_TYPES in scripts/csp.mjs, so the two runtimes never derive different policies.
_EXECUTABLE_TYPES = {"", "module", "importmap", "text/javascript", "application/javascript"}


def _inline_script_hashes(html: str) -> list[str]:
    """'sha256-<base64>' for every inline (no src=), executable <script> block, in document order."""
    hashes = []
    for attrs, body in _INLINE_SCRIPT_RE.findall(html):
        if re.search(r"\bsrc\s*=", attrs, re.IGNORECASE):
            continue  # external script: no inline body to hash, already covered by 'self'
        type_match = re.search(r"\btype\s*=\s*[\"']?([^\"'\s>]*)", attrs, re.IGNORECASE)
        if (type_match.group(1).lower() if type_match else "") not in _EXECUTABLE_TYPES:
            continue  # data block, never executed
        digest = hashlib.sha256(_normalize_newlines(body).encode("utf-8")).digest()
        hashes.append("sha256-" + base64.b64encode(digest).decode("ascii"))
    return hashes


def _build_app_csp() -> str:
    try:
        with open("frontend/index.html", encoding="utf-8") as f:
            html = f.read()
    except OSError:
        html = ""  # missing file: still ship a CSP, just with no inline-script hash to add
    script_src = " ".join(["'self'"] + [f"'{h}'" for h in _inline_script_hashes(html)])
    return "; ".join([
        "default-src 'self'",
        "base-uri 'none'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "form-action 'none'",
        f"script-src {script_src}",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        "connect-src 'self'",
        "manifest-src 'self'",
        "worker-src 'self'",
    ])


# Computed once at import so every request reuses the same string; frontend/index.html doesn't
# change between requests in a running process.
APP_CSP = _build_app_csp()

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
    conditional GET that 304s when unchanged). Also where the strict CSP (ADR-0003 Layer 1) is
    attached to the document response: CSP is a document-context header, so it's set only on
    "/" (the HTML shell), not on every static asset response."""
    response = await call_next(request)
    if request.url.path == "/" or request.url.path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-cache"
    if request.url.path == "/":
        response.headers["Content-Security-Policy"] = APP_CSP
        # Report-only, not enforced: frontend/js/mindmap.js still loads Cytoscape via a classic
        # <script> element with no `integrity` attribute (out of bounds for this change), so
        # enforcing this would block that load and break the map. It would become safe to
        # enforce once mindmap.js sets `s.integrity` on that element, e.g. via
        # frontend/js/build-info.js's integrityFor() helper (ADR-0003 Layer 1).
        response.headers["Integrity-Policy-Report-Only"] = "blocked-destinations=(script)"
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


@app.get("/robots.txt")
async def robots():
    """Crawl posture, same as the hosted app: citation welcome, no AI training (Content
    Signals + per-bot Disallows). Self-hosters keep the same default."""
    return FileResponse("frontend/robots.txt", media_type="text/plain")


@app.get("/.well-known/security.txt")
async def security_txt():
    """RFC 9116 security contact, so vulnerability reports have a standard front door."""
    return FileResponse("frontend/.well-known/security.txt", media_type="text/plain")


@app.get("/")
async def root():
    with open("frontend/index.html", encoding="utf-8") as f:
        return HTMLResponse(content=f.read())


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8000")))
