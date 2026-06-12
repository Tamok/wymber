"""The local-first server only serves the static app — no accounts, no DB, no user API.
The app's real logic is tested by Vitest (frontend units) and Playwright (E2E vault flow)."""
from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


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
