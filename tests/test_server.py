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
