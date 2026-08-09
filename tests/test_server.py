"""The local-first server only serves the static app — no accounts, no DB, no user API.
The app's real logic is tested by Vitest (frontend units) and Playwright (E2E vault flow)."""
import base64
import hashlib
import re

from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


def _independent_inline_script_hashes() -> list[str]:
    """Recompute the expected script-src hash(es) straight from frontend/index.html, without
    calling any of backend.main's own hashing code — a test that just re-invokes the app's own
    function proves nothing about whether that function is correct.

    Read in binary and normalize \\r\\n/\\r to \\n by hand (rather than relying on text-mode's
    universal-newlines translation) to independently exercise the same newline rule a browser
    applies when it tokenizes HTML (WHATWG "preprocessing the input stream"): on a Windows
    checkout with core.autocrlf, the file on disk is CRLF even though the git blob is LF, and a
    hash of the raw CRLF bytes would never match what the browser actually executes.
    """
    with open("frontend/index.html", "rb") as f:
        raw = f.read().decode("utf-8")
    html = raw.replace("\r\n", "\n").replace("\r", "\n")
    hashes = []
    for attrs, body in re.findall(r"<script\b([^>]*)>(.*?)</script>", html, re.IGNORECASE | re.DOTALL):
        if re.search(r"\bsrc\s*=", attrs, re.IGNORECASE):
            continue
        digest = hashlib.sha256(body.encode("utf-8")).digest()
        hashes.append("sha256-" + base64.b64encode(digest).decode("ascii"))
    return hashes


def test_root_serves_the_app_shell():
    r = client.get("/")
    assert r.status_code == 200
    assert "Wymber" in r.text


def test_health_ok():
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_legacy_server_api_is_gone():
    # The old server-auth/data API must not exist in the local-first model.
    assert client.post("/api/login").status_code == 404
    assert client.get("/api/mindmap").status_code == 404
    assert client.post("/api/node").status_code == 404


def test_service_worker_served_at_root_scope():
    # The SW must be at the root with the right MIME + a scope header, or it can't control the origin.
    r = client.get("/sw.js")
    assert r.status_code == 200
    assert "javascript" in r.headers["content-type"]
    assert r.headers.get("service-worker-allowed") == "/"
    assert "wymber-shell" in r.text  # it's actually our service worker


def test_pwa_manifest_served():
    r = client.get("/manifest.webmanifest")
    assert r.status_code == 200
    assert "manifest" in r.headers["content-type"]
    body = r.json()
    assert body["name"] == "Wymber"
    assert body["start_url"] == "/"
    assert any(icon["sizes"] == "512x512" for icon in body["icons"])


def test_pwa_icons_served():
    for size in ("192", "512"):
        r = client.get(f"/static/icons/icon-{size}.png")
        assert r.status_code == 200
        assert r.headers["content-type"] == "image/png"


def test_robots_txt_states_the_crawl_posture():
    # Citation welcome, no AI training: the Content Signals line + a real text/plain file.
    r = client.get("/robots.txt")
    assert r.status_code == 200
    assert "text/plain" in r.headers["content-type"]
    assert "Content-Signal: search=yes, ai-input=yes, ai-train=no" in r.text
    assert "User-agent: GPTBot" in r.text  # training crawlers stay opted out


def test_security_txt_served():
    r = client.get("/.well-known/security.txt")
    assert r.status_code == 200
    assert "Contact:" in r.text


def test_app_shell_is_noindex_with_correct_share_card():
    # The landing (wymber.app) is the indexed surface; the app shell asks not to be indexed
    # and its share card must point at its own origin (a wrong-origin og:image serves HTML).
    r = client.get("/")
    assert '<meta name="robots" content="noindex">' in r.text
    assert 'content="https://web.wymber.app/static/og-image.png"' in r.text
    assert 'property="og:url" content="https://web.wymber.app/"' in r.text


# --- ADR-0003 Layer 1: the strict Content-Security-Policy (#112) --------------------------------

def test_root_serves_exactly_one_csp_header():
    r = client.get("/")
    # httpx.Headers.raw exposes every header line delivered, including duplicates; a stray
    # second CSP header (e.g. from a leftover middleware) would silently be the one browsers
    # ignore, or worse, merge in an unintended way.
    csp_lines = [v for k, v in r.headers.raw if k.decode("latin-1").lower() == "content-security-policy"]
    assert len(csp_lines) == 1


def test_csp_contains_the_required_strict_directives():
    r = client.get("/")
    csp = r.headers["content-security-policy"]
    for expected in (
        "script-src 'self' 'sha256-",
        "object-src 'none'",
        "base-uri 'none'",
        "frame-ancestors 'none'",
        "connect-src 'self'",
    ):
        assert expected in csp, f"missing {expected!r} in CSP: {csp}"


def test_csp_script_src_never_allows_unsafe_inline_or_unsafe_eval():
    r = client.get("/")
    csp = r.headers["content-security-policy"]
    directives = {
        part.strip().split(" ", 1)[0]: part.strip()
        for part in csp.split(";") if part.strip()
    }
    script_src = directives["script-src"]
    assert "unsafe-inline" not in script_src
    assert "unsafe-eval" not in script_src


def test_csp_script_src_hash_matches_the_actual_inline_script_in_index_html():
    # Recomputed independently of backend.main's own hashing (see _independent_inline_script_hashes)
    # so this proves the served hash really matches the served bytes, not just that the app's
    # hashing function agrees with itself.
    expected_hashes = _independent_inline_script_hashes()
    assert expected_hashes, "expected at least one inline <script> in frontend/index.html"

    r = client.get("/")
    csp = r.headers["content-security-policy"]
    for expected_hash in expected_hashes:
        assert f"'{expected_hash}'" in csp


def test_integrity_policy_is_report_only_on_the_app_origin_not_enforced():
    # Enforcing Integrity-Policy would block frontend/js/mindmap.js's classic <script> element
    # for Cytoscape (no `integrity` attribute today), so the app origin ships report-only only.
    r = client.get("/")
    assert r.headers.get("integrity-policy") is None
    assert r.headers.get("integrity-policy-report-only") == "blocked-destinations=(script)"
