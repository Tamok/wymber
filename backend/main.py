from fastapi import FastAPI, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from jose import JWTError, jwt
from pydantic import BaseModel
import os
import secrets
from typing import Optional, List
import json

from database import SessionLocal, User, Node, Edge, ChatMessage, pwd_context, encrypt_field, decrypt_field, create_tables
from config import NODE_TYPES, MESSAGES

# JWT Configuration
SECRET_KEY = os.getenv("SECRET_KEY", secrets.token_urlsafe(32))
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 24 hours

# Create database tables
create_tables()

app = FastAPI(
    title="TrauMapp'd",
    description="Private trauma mapping and exploration tool",
    version="1.0.0"
)

# CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# OAuth2 setup
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/login")

# Static files
app.mount("/static", StaticFiles(directory="frontend"), name="static")

# Pydantic models
class UserCreate(BaseModel):
    username: str
    password: str

class NodeCreate(BaseModel):
    node_type: str
    title: str
    description: Optional[str] = ""
    x: Optional[float] = 0
    y: Optional[float] = 0

class NodeUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    x: Optional[float] = None
    y: Optional[float] = None

class EdgeCreate(BaseModel):
    from_node_id: int
    to_node_id: int
    label: Optional[str] = ""

class Token(BaseModel):
    access_token: str
    token_type: str

# Dependency to get DB session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Authentication functions
def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

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

# Store passwords temporarily in session for encryption
# In production, consider a more secure session management
session_passwords = {}

def store_session_password(username: str, password: str):
    session_passwords[username] = password

def get_session_password(username: str) -> str:
    return session_passwords.get(username)

# Routes
@app.get("/")
async def root():
    with open("frontend/index.html", "r", encoding="utf-8") as f:
        return HTMLResponse(content=f.read())

@app.post("/api/setup")
async def setup_user(user_data: UserCreate, db: Session = Depends(get_db)):
    """First-run user creation"""
    # Check if any user exists
    existing_user = db.query(User).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="User already exists")
    
    # Create user with encrypted password
    salt = os.urandom(32)
    hashed_password = pwd_context.hash(user_data.password)
    
    user = User(
        username=user_data.username,
        password_hash=hashed_password,
        encryption_salt=salt
    )
    
    db.add(user)
    db.commit()
    
    return {"message": "Account created successfully"}

@app.post("/api/login", response_model=Token)
async def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    """Login and get access token"""
    user = db.query(User).filter(User.username == form_data.username).first()
    
    if not user or not user.verify_password(form_data.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Store password for session encryption
    store_session_password(user.username, form_data.password)
    
    # Create access token
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.username}, expires_delta=access_token_expires
    )
    
    return {"access_token": access_token, "token_type": "bearer"}

@app.post("/api/logout")
async def logout(current_user: User = Depends(get_current_user)):
    """Clear session"""
    if current_user.username in session_passwords:
        del session_passwords[current_user.username]
    return {"message": "Logged out successfully"}

@app.get("/api/check")
async def check_auth(current_user: User = Depends(get_current_user)):
    """Check if user is authenticated"""
    return {"authenticated": True, "username": current_user.username}

@app.get("/api/mindmap")
async def get_mindmap(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Get user's mind map with decrypted content"""
    password = get_session_password(current_user.username)
    if not password:
        raise HTTPException(status_code=401, detail="Session expired")
    
    key = current_user.derive_key(password)
    
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
    """Create a new node with encrypted description"""
    password = get_session_password(current_user.username)
    if not password:
        raise HTTPException(status_code=401, detail="Session expired")
    
    key = current_user.derive_key(password)
    
    # Validate node type
    if node_data.node_type not in NODE_TYPES:
        raise HTTPException(status_code=400, detail="Invalid node type")
    
    node = Node(
        user_id=current_user.id,
        node_type=node_data.node_type,
        title=node_data.title,
        description_encrypted=encrypt_field(node_data.description or "", key),
        x=node_data.x,
        y=node_data.y,
        color=NODE_TYPES[node_data.node_type]["color"],
        icon=NODE_TYPES[node_data.node_type]["icon"]
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
    """Update an existing node"""
    node = db.query(Node).filter(
        Node.id == node_id,
        Node.user_id == current_user.id
    ).first()
    
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    
    password = get_session_password(current_user.username)
    if not password:
        raise HTTPException(status_code=401, detail="Session expired")
    
    key = current_user.derive_key(password)
    
    if node_data.title is not None:
        node.title = node_data.title
    if node_data.description is not None:
        node.description_encrypted = encrypt_field(node_data.description, key)
    if node_data.x is not None:
        node.x = node_data.x
    if node_data.y is not None:
        node.y = node_data.y
    
    node.updated_at = datetime.utcnow()
    
    db.commit()
    
    return {"message": "Node updated"}

@app.delete("/api/node/{node_id}")
async def delete_node(
    node_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a node and its connections"""
    node = db.query(Node).filter(
        Node.id == node_id,
        Node.user_id == current_user.id
    ).first()
    
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
    """Create a new edge between nodes"""
    # Verify both nodes exist and belong to user
    from_node = db.query(Node).filter(
        Node.id == edge_data.from_node_id,
        Node.user_id == current_user.id
    ).first()
    
    to_node = db.query(Node).filter(
        Node.id == edge_data.to_node_id,
        Node.user_id == current_user.id
    ).first()
    
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
    """Delete an edge"""
    edge = db.query(Edge).filter(
        Edge.id == edge_id,
        Edge.user_id == current_user.id
    ).first()
    
    if not edge:
        raise HTTPException(status_code=404, detail="Edge not found")
    
    db.delete(edge)
    db.commit()
    
    return {"message": "Connection removed"}

@app.get("/api/settings")
async def get_settings(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get user settings"""
    try:
        settings = json.loads(current_user.settings) if current_user.settings else {}
        return {"settings": settings}
    except:
        return {"settings": {}}

@app.put("/api/settings")
async def update_settings(
    settings: dict,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update user settings"""
    current_user.settings = json.dumps(settings)
    db.commit()
    return {"message": "Settings updated"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)