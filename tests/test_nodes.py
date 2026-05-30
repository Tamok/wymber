def test_create_node(auth_client):
    resp = auth_client.post("/api/node", json={
        "node_type": "event",
        "title": "First memory",
        "description": "Details here"
    })
    assert resp.status_code == 200
    assert "id" in resp.json()


def test_create_node_invalid_type(auth_client):
    resp = auth_client.post("/api/node", json={
        "node_type": "invalid_type",
        "title": "Bad node"
    })
    assert resp.status_code == 400


def test_get_mindmap(auth_client):
    auth_client.post("/api/node", json={"node_type": "event", "title": "Node 1"})
    auth_client.post("/api/node", json={"node_type": "emotion", "title": "Node 2"})

    resp = auth_client.get("/api/mindmap")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["nodes"]) == 2
    assert data["metadata"]["node_count"] == 2


def test_update_node(auth_client):
    create_resp = auth_client.post("/api/node", json={"node_type": "event", "title": "Original"})
    node_id = create_resp.json()["id"]

    resp = auth_client.put(f"/api/node/{node_id}", json={"title": "Updated"})
    assert resp.status_code == 200

    mindmap = auth_client.get("/api/mindmap").json()
    node = next(n for n in mindmap["nodes"] if n["id"] == node_id)
    assert node["title"] == "Updated"


def test_delete_node(auth_client):
    create_resp = auth_client.post("/api/node", json={"node_type": "event", "title": "To delete"})
    node_id = create_resp.json()["id"]

    resp = auth_client.delete(f"/api/node/{node_id}")
    assert resp.status_code == 200

    mindmap = auth_client.get("/api/mindmap").json()
    assert len(mindmap["nodes"]) == 0


def test_delete_nonexistent_node(auth_client):
    resp = auth_client.delete("/api/node/9999")
    assert resp.status_code == 404


def test_title_length_validation(auth_client):
    resp = auth_client.post("/api/node", json={
        "node_type": "event",
        "title": "x" * 201
    })
    assert resp.status_code == 422


def test_node_description_encrypted(auth_client):
    resp = auth_client.post("/api/node", json={
        "node_type": "insight",
        "title": "Secret thought",
        "description": "This should be encrypted"
    })
    node_id = resp.json()["id"]

    mindmap = auth_client.get("/api/mindmap").json()
    node = next(n for n in mindmap["nodes"] if n["id"] == node_id)
    assert node["description"] == "This should be encrypted"
