from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from jose import JWTError, jwt
from pydantic import BaseModel, field_validator
import os
from typing import Optional
import json

from backend.database import (
    SessionLocal, engine, Base,
    User, Node, Edge, pwd_context, encrypt_field, decrypt_field,
    run_lightweight_migrations
)
from backend.config import NODE_TYPES
from backend.env_config import config

# Fail fast on insecure production config (e.g. default/empty JWT secret); warns in dev.
config.validate()

# JWT Configuration
SECRET_KEY = config.JWT_SECRET_KEY
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = config.JWT_EXPIRES_HOURS * 60

# Create database tables
Base.metadata.create_all(bind=engine)
# Add columns introduced after the initial release to existing databases.
run_lightweight_migrations()

# Auto-create test user if enabled
def create_test_user_if_needed():
    if not config.AUTO_CREATE_TEST_USER:
        return
    db = SessionLocal()
    try:
        existing = db.query(User).filter(User.username == config.TEST_USERNAME).first()
        if existing:
            return
        salt = os.urandom(32)
        user = User(
            username=config.TEST_USERNAME,
            password_hash=pwd_context.hash(config.TEST_PASSWORD),
            encryption_salt=salt
        )
        db.add(user)
        db.commit()
        print(f"Test user '{config.TEST_USERNAME}' created")
    except Exception as e:
        print(f"Error creating test user: {e}")
        db.rollback()
    finally:
        db.close()

create_test_user_if_needed()

app = FastAPI(title="TrauMapp'd", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8080", "http://localhost:8000", "http://localhost:8089"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/login")
app.mount("/static", StaticFiles(directory="frontend"), name="static")

# ===== Pydantic models with validation =====

class UserCreate(BaseModel):
    username: str
    password: str

    @field_validator('username')
    @classmethod
    def validate_username(cls, v):
        v = v.strip()
        if len(v) < 1 or len(v) > 50:
            raise ValueError('Username must be 1-50 characters')
        if not v.replace('_', '').replace('-', '').isalnum():
            raise ValueError('Username must be alphanumeric (underscores and hyphens allowed)')
        return v

class NodeCreate(BaseModel):
    node_type: str
    title: str
    description: Optional[str] = ""
    x: Optional[float] = 0
    y: Optional[float] = 0
    parent_id: Optional[int] = None

    @field_validator('title')
    @classmethod
    def validate_title(cls, v):
        if not v or not v.strip():
            raise ValueError('Title is required')
        if len(v) > 200:
            raise ValueError('Title must be under 200 characters')
        return v.strip()

    @field_validator('description')
    @classmethod
    def validate_description(cls, v):
        if v and len(v) > 5000:
            raise ValueError('Description must be under 5000 characters')
        return v

class NodeUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    x: Optional[float] = None
    y: Optional[float] = None
    parent_id: Optional[int] = None

    @field_validator('title')
    @classmethod
    def validate_title(cls, v):
        if v is not None:
            if not v.strip():
                raise ValueError('Title cannot be empty')
            if len(v) > 200:
                raise ValueError('Title must be under 200 characters')
            return v.strip()
        return v

    @field_validator('description')
    @classmethod
    def validate_description(cls, v):
        if v is not None and len(v) > 5000:
            raise ValueError('Description must be under 5000 characters')
        return v

class EdgeCreate(BaseModel):
    from_node_id: int
    to_node_id: int
    label: Optional[str] = ""

class Token(BaseModel):
    access_token: str
    token_type: str

# ===== Database dependency =====

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# ===== Session key management =====
# Store derived Fernet keys instead of plaintext passwords

session_keys: dict[str, bytes] = {}

def store_session_key(username: str, user: User, password: str):
    """Derive encryption key from password and store it. Discard password."""
    key = user.derive_key(password)
    session_keys[username] = key

def get_session_key(username: str) -> Optional[bytes]:
    return session_keys.get(username)

# ===== Auth helpers =====

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=15))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

async def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = db.query(User).filter(User.username == username).first()
    if user is None:
        raise credentials_exception
    return user

def require_session_key(username: str) -> bytes:
    key = get_session_key(username)
    if not key:
        raise HTTPException(status_code=401, detail="Session expired")
    return key

def set_node_parent(db: Session, node: Node, parent_id: int, user_id: int):
    """Reparent `node` under `parent_id`, rejecting self-parenting and cycles."""
    if parent_id == node.id:
        raise HTTPException(status_code=400, detail="A node cannot be its own parent")
    parent = db.query(Node).filter(Node.id == parent_id, Node.user_id == user_id).first()
    if not parent:
        raise HTTPException(status_code=404, detail="Parent node not found")
    # Walk up from the prospective parent; reject if we reach `node` (would create a cycle).
    ancestor = parent
    seen = set()
    while ancestor is not None:
        if ancestor.id == node.id:
            raise HTTPException(status_code=400, detail="Cannot reparent a node under its own descendant")
        if ancestor.id in seen or ancestor.parent_id is None:
            break
        seen.add(ancestor.id)
        ancestor = db.query(Node).filter(Node.id == ancestor.parent_id).first()
    node.parent_id = parent_id

# ===== Routes =====

@app.get("/")
async def root():
    with open("frontend/index.html", "r", encoding="utf-8") as f:
        return HTMLResponse(content=f.read())

@app.post("/api/setup")
async def setup_user(user_data: UserCreate, db: Session = Depends(get_db)):
    existing = db.query(User).first()
    if existing:
        raise HTTPException(status_code=400, detail="User already exists")

    salt = os.urandom(32)
    user = User(
        username=user_data.username,
        password_hash=pwd_context.hash(user_data.password),
        encryption_salt=salt
    )
    db.add(user)
    db.commit()
    return {"message": "Account created successfully"}

@app.post("/api/login", response_model=Token)
async def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == form_data.username).first()

    if not user or not user.verify_password(form_data.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Derive and store encryption key, discard password
    store_session_key(user.username, user, form_data.password)

    access_token = create_access_token(
        data={"sub": user.username},
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    return {"access_token": access_token, "token_type": "bearer"}

@app.post("/api/logout")
async def logout(current_user: User = Depends(get_current_user)):
    session_keys.pop(current_user.username, None)
    return {"message": "Logged out successfully"}

@app.get("/api/check")
async def check_auth(current_user: User = Depends(get_current_user)):
    return {"authenticated": True, "username": current_user.username}

@app.get("/api/mindmap")
async def get_mindmap(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    key = require_session_key(current_user.username)

    nodes = db.query(Node).filter(Node.user_id == current_user.id).all()
    edges = db.query(Edge).filter(Edge.user_id == current_user.id).all()

    return {
        "nodes": [node.to_dict(key) for node in nodes],
        "edges": [edge.to_dict() for edge in edges],
        "metadata": {
            "last_saved": datetime.now().isoformat(),
            "node_count": len(nodes),
            "edge_count": len(edges)
        }
    }

@app.post("/api/node")
async def create_node(
    node_data: NodeCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    key = require_session_key(current_user.username)

    if node_data.node_type not in NODE_TYPES:
        raise HTTPException(status_code=400, detail="Invalid node type")

    if node_data.parent_id is not None:
        parent = db.query(Node).filter(
            Node.id == node_data.parent_id, Node.user_id == current_user.id
        ).first()
        if not parent:
            raise HTTPException(status_code=404, detail="Parent node not found")

    node = Node(
        user_id=current_user.id,
        node_type=node_data.node_type,
        title=node_data.title,
        description_encrypted=encrypt_field(node_data.description or "", key),
        x=node_data.x,
        y=node_data.y,
        color=NODE_TYPES[node_data.node_type]["color"],
        icon=NODE_TYPES[node_data.node_type]["icon"],
        parent_id=node_data.parent_id
    )
    db.add(node)
    db.commit()
    db.refresh(node)
    return {"id": node.id, "message": "Added to your map"}

@app.put("/api/node/{node_id}")
async def update_node(
    node_id: int,
    node_data: NodeUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    node = db.query(Node).filter(Node.id == node_id, Node.user_id == current_user.id).first()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    key = require_session_key(current_user.username)

    if node_data.title is not None:
        node.title = node_data.title
    if node_data.description is not None:
        node.description_encrypted = encrypt_field(node_data.description, key)
    if node_data.x is not None:
        node.x = node_data.x
    if node_data.y is not None:
        node.y = node_data.y
    if node_data.parent_id is not None:
        set_node_parent(db, node, node_data.parent_id, current_user.id)

    node.updated_at = datetime.utcnow()
    db.commit()
    return {"message": "Node updated"}

@app.delete("/api/node/{node_id}")
async def delete_node(
    node_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    node = db.query(Node).filter(Node.id == node_id, Node.user_id == current_user.id).first()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    db.delete(node)
    db.commit()
    return {"message": "Node removed from your map"}

@app.post("/api/edge")
async def create_edge(
    edge_data: EdgeCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    from_node = db.query(Node).filter(Node.id == edge_data.from_node_id, Node.user_id == current_user.id).first()
    to_node = db.query(Node).filter(Node.id == edge_data.to_node_id, Node.user_id == current_user.id).first()

    if not from_node or not to_node:
        raise HTTPException(status_code=404, detail="Node not found")

    edge = Edge(
        user_id=current_user.id,
        from_node_id=edge_data.from_node_id,
        to_node_id=edge_data.to_node_id,
        label=edge_data.label
    )
    db.add(edge)
    db.commit()
    db.refresh(edge)
    return {"id": edge.id, "message": "Connection created"}

@app.delete("/api/edge/{edge_id}")
async def delete_edge(
    edge_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    edge = db.query(Edge).filter(Edge.id == edge_id, Edge.user_id == current_user.id).first()
    if not edge:
        raise HTTPException(status_code=404, detail="Edge not found")

    db.delete(edge)
    db.commit()
    return {"message": "Connection removed"}

@app.get("/api/settings")
async def get_settings(current_user: User = Depends(get_current_user)):
    try:
        settings = json.loads(current_user.settings) if current_user.settings else {}
        return {"settings": settings}
    except (json.JSONDecodeError, TypeError):
        return {"settings": {}}

@app.put("/api/settings")
async def update_settings(
    settings: dict,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    current_user.settings = json.dumps(settings)
    db.commit()
    return {"message": "Settings updated"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
