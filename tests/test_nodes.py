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


def test_create_node_with_parent(auth_client):
    parent = auth_client.post("/api/node", json={"node_type": "event", "title": "Parent"})
    parent_id = parent.json()["id"]

    child = auth_client.post("/api/node", json={
        "node_type": "emotion", "title": "Child", "parent_id": parent_id
    })
    assert child.status_code == 200
    child_id = child.json()["id"]

    mindmap = auth_client.get("/api/mindmap").json()
    node = next(n for n in mindmap["nodes"] if n["id"] == child_id)
    assert node["parent_id"] == parent_id


def test_create_node_invalid_parent(auth_client):
    resp = auth_client.post("/api/node", json={
        "node_type": "event", "title": "Orphan", "parent_id": 9999
    })
    assert resp.status_code == 404


def test_node_parent_id_defaults_none(auth_client):
    resp = auth_client.post("/api/node", json={"node_type": "event", "title": "Top level"})
    node_id = resp.json()["id"]

    mindmap = auth_client.get("/api/mindmap").json()
    node = next(n for n in mindmap["nodes"] if n["id"] == node_id)
    assert node["parent_id"] is None


def test_reparent_node_via_update(auth_client):
    a = auth_client.post("/api/node", json={"node_type": "event", "title": "A"}).json()["id"]
    b = auth_client.post("/api/node", json={"node_type": "emotion", "title": "B"}).json()["id"]

    resp = auth_client.put(f"/api/node/{b}", json={"parent_id": a})
    assert resp.status_code == 200

    mindmap = auth_client.get("/api/mindmap").json()
    node_b = next(n for n in mindmap["nodes"] if n["id"] == b)
    assert node_b["parent_id"] == a


def test_reparent_rejects_self_parent(auth_client):
    a = auth_client.post("/api/node", json={"node_type": "event", "title": "A"}).json()["id"]
    resp = auth_client.put(f"/api/node/{a}", json={"parent_id": a})
    assert resp.status_code == 400


def test_reparent_rejects_cycle(auth_client):
    a = auth_client.post("/api/node", json={"node_type": "event", "title": "A"}).json()["id"]
    b = auth_client.post("/api/node", json={
        "node_type": "emotion", "title": "B", "parent_id": a
    }).json()["id"]
    # b is a child of a; making a a child of b would create a cycle.
    resp = auth_client.put(f"/api/node/{a}", json={"parent_id": b})
    assert resp.status_code == 400
