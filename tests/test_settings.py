def test_get_default_settings(auth_client):
    resp = auth_client.get("/api/settings")
    assert resp.status_code == 200
    assert resp.json()["settings"] == {}


def test_put_and_get_settings(auth_client):
    auth_client.put("/api/settings", json={"theme": "dark", "fontSize": "large"})

    resp = auth_client.get("/api/settings")
    settings = resp.json()["settings"]
    assert settings["theme"] == "dark"
    assert settings["fontSize"] == "large"


def test_settings_overwrite(auth_client):
    auth_client.put("/api/settings", json={"theme": "dark"})
    auth_client.put("/api/settings", json={"theme": "soft", "fontSize": "xlarge"})

    resp = auth_client.get("/api/settings")
    settings = resp.json()["settings"]
    assert settings["theme"] == "soft"
    assert settings["fontSize"] == "xlarge"
