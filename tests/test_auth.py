def test_setup_creates_user(client):
    resp = client.post("/api/setup", json={"username": "newuser", "password": "SecurePass1!"})
    assert resp.status_code == 200
    assert resp.json()["message"] == "Account created successfully"


def test_setup_rejects_duplicate(client):
    client.post("/api/setup", json={"username": "user1", "password": "Pass1234!"})
    resp = client.post("/api/setup", json={"username": "user2", "password": "Pass5678!"})
    assert resp.status_code == 400


def test_login_returns_token(client):
    client.post("/api/setup", json={"username": "loginuser", "password": "MyPass99!"})
    resp = client.post("/api/login", data={"username": "loginuser", "password": "MyPass99!"})
    assert resp.status_code == 200
    assert "access_token" in resp.json()
    assert resp.json()["token_type"] == "bearer"


def test_login_rejects_bad_password(client):
    client.post("/api/setup", json={"username": "badpw", "password": "RealPass1!"})
    resp = client.post("/api/login", data={"username": "badpw", "password": "WrongPass!"})
    assert resp.status_code == 401


def test_check_with_valid_token(auth_client):
    resp = auth_client.get("/api/check")
    assert resp.status_code == 200
    assert resp.json()["authenticated"] is True
    assert resp.json()["username"] == "testuser"


def test_check_with_invalid_token(client):
    resp = client.get("/api/check", headers={"Authorization": "Bearer invalidtoken"})
    assert resp.status_code == 401


def test_logout(auth_client):
    resp = auth_client.post("/api/logout")
    assert resp.status_code == 200


def test_username_validation(client):
    resp = client.post("/api/setup", json={"username": "", "password": "Pass1234!"})
    assert resp.status_code == 422

    resp = client.post("/api/setup", json={"username": "a" * 51, "password": "Pass1234!"})
    assert resp.status_code == 422


def test_setup_rejects_short_password(client):
    resp = client.post("/api/setup", json={"username": "shorty", "password": "abc"})
    assert resp.status_code == 422


def test_status_reports_no_user_then_user(client):
    resp = client.get("/api/status")
    assert resp.status_code == 200
    assert resp.json()["has_user"] is False

    client.post("/api/setup", json={"username": "someone", "password": "GoodPass1!"})
    assert client.get("/api/status").json()["has_user"] is True


def test_delete_account_requires_auth(client):
    resp = client.delete("/api/account")
    assert resp.status_code == 401


def test_delete_account_removes_user_and_data(auth_client):
    auth_client.post("/api/node", json={"node_type": "event", "title": "Gone soon"})
    resp = auth_client.delete("/api/account")
    assert resp.status_code == 200
    # The only user is gone, so /api/status reports no account exists.
    assert auth_client.get("/api/status").json()["has_user"] is False
