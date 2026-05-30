def test_create_edge(auth_client):
    n1 = auth_client.post("/api/node", json={"node_type": "event", "title": "A"}).json()["id"]
    n2 = auth_client.post("/api/node", json={"node_type": "emotion", "title": "B"}).json()["id"]

    resp = auth_client.post("/api/edge", json={
        "from_node_id": n1,
        "to_node_id": n2,
        "label": "causes"
    })
    assert resp.status_code == 200
    assert "id" in resp.json()


def test_edge_appears_in_mindmap(auth_client):
    n1 = auth_client.post("/api/node", json={"node_type": "trigger", "title": "T"}).json()["id"]
    n2 = auth_client.post("/api/node", json={"node_type": "coping", "title": "C"}).json()["id"]
    auth_client.post("/api/edge", json={"from_node_id": n1, "to_node_id": n2})

    mindmap = auth_client.get("/api/mindmap").json()
    assert len(mindmap["edges"]) == 1
    assert mindmap["edges"][0]["from_node_id"] == n1
    assert mindmap["edges"][0]["to_node_id"] == n2


def test_delete_edge(auth_client):
    n1 = auth_client.post("/api/node", json={"node_type": "event", "title": "X"}).json()["id"]
    n2 = auth_client.post("/api/node", json={"node_type": "event", "title": "Y"}).json()["id"]
    edge_id = auth_client.post("/api/edge", json={"from_node_id": n1, "to_node_id": n2}).json()["id"]

    resp = auth_client.delete(f"/api/edge/{edge_id}")
    assert resp.status_code == 200

    mindmap = auth_client.get("/api/mindmap").json()
    assert len(mindmap["edges"]) == 0


def test_edge_invalid_node(auth_client):
    n1 = auth_client.post("/api/node", json={"node_type": "event", "title": "Real"}).json()["id"]
    resp = auth_client.post("/api/edge", json={"from_node_id": n1, "to_node_id": 9999})
    assert resp.status_code == 404
