def test_health_ok(client):
    """The health endpoint is unauthenticated and reports status + version."""
    resp = client.get("/api/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["version"]
