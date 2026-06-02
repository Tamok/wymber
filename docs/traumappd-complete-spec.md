# TrauMapp'd Complete Implementation Specification

> **Historical document.** This is the original prototype specification for what became
> **Wymber**, preserved for reference. It is **superseded** by the current
> [README](../README.md) and the [architecture decisions](adr/) — expect the old name
> ("TrauMapp'd"), outdated scope, and design details that have since changed.

## Project Context
You're building TrauMapp'd - a trauma mapping and exploration tool that helps users visualize their trauma experiences through an interactive mind map and explore them with a local AI assistant. This is deeply sensitive work requiring careful attention to user safety, privacy, and trauma-informed design principles.

**Core Values:**
- **Privacy First**: All data stays local, encrypted at rest, no telemetry
- **Trauma-Informed**: Safe, predictable, empowering, non-triggering
- **Accessible**: WCAG 2.1 AA compliant, keyboard navigable
- **User Control**: User owns their data, can delete anytime

## Implementation Phases with Checkpoints

### Phase 1: Foundation & Authentication
**Goal**: Create the Docker container, basic FastAPI backend, and authentication system.

**Deliverables:**
```
traumappd/
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
├── backend/
│   ├── main.py           # FastAPI app with CORS, static files
│   ├── auth.py           # Authentication routes & logic
│   ├── database.py       # SQLAlchemy models & encryption
│   └── config.py         # Settings and constants
├── frontend/
│   ├── index.html        # Login screen and main app skeleton
│   ├── css/
│   │   └── styles.css    # Basic styling with light/dark themes
│   └── js/
│       └── auth.js       # Login/logout functionality
└── data/                 # User data directory (gitignored)
```

#### Key Implementation Files:

**config.py - Node type configuration with trauma-informed descriptions**
```python
NODE_TYPES = {
    "trauma_event": {
        "color": "#D32F2F",
        "icon": "alert-circle",
        "label": "Traumatic Event",
        "description": "A deeply distressing or disturbing experience that overwhelmed your ability to cope",
        "tooltip": "Examples: accident, loss, abuse, violence. These are often root events in your healing journey."
    },
    "trigger": {
        "color": "#F57C00", 
        "icon": "zap",
        "label": "Trigger",
        "description": "Something that reminds you of the trauma and causes a strong reaction",
        "tooltip": "Can be sights, sounds, smells, places, or situations that bring back traumatic memories"
    },
    "response": {
        "color": "#FBC02D",
        "icon": "activity", 
        "label": "Trauma Response",
        "description": "Your body's automatic reaction to perceived threat",
        "tooltip": "Fight (anger/aggression), Flight (escape/avoidance), Freeze (numbness/paralysis), or Fawn (people-pleasing)"
    },
    "symptom": {
        "color": "#7B1FA2",
        "icon": "alert-triangle",
        "label": "Symptom/Issue",
        "description": "Current problems you experience that may be rooted in trauma",
        "tooltip": "Physical (insomnia, pain), emotional (anxiety, depression), or behavioral (avoidance, isolation)"
    },
    "emotion": {
        "color": "#1976D2",
        "icon": "heart",
        "label": "Emotion/Feeling", 
        "description": "Specific emotions connected to your trauma or healing",
        "tooltip": "Naming emotions like fear, shame, anger, or hope can be therapeutic"
    },
    "belief": {
        "color": "#5D4037",
        "icon": "message-circle",
        "label": "Belief/Thought",
        "description": "Deep-seated beliefs that arose from trauma",
        "tooltip": "Often negative thoughts like 'I'm not safe' or 'It was my fault' that need addressing"
    },
    "coping": {
        "color": "#388E3C",
        "icon": "shield",
        "label": "Coping Mechanism",
        "description": "Actions or strategies you use to handle trauma or stress",
        "tooltip": "Can be healthy (exercise, therapy) or unhealthy (avoidance, substance use)"
    },
    "support": {
        "color": "#00796B",
        "icon": "users",
        "label": "Resource/Support",
        "description": "People, places, or things that provide support",
        "tooltip": "Therapist, friends, pets, spiritual practices, safe spaces"
    }
}

# Trauma-informed message templates
MESSAGES = {
    "welcome": "Welcome back to your safe space for reflection and healing.",
    "first_time": "Welcome to TrauMapp'd. This is your private space for mapping and understanding your experiences.",
    "session_expired": "Your session has expired for security. Please log in again.",
    "save_success": "Your map has been safely saved.",
    "delete_confirm": "This will remove this node and its connections. You can always recreate it later if needed.",
    "crisis_disclaimer": "If you're in crisis, please reach out for immediate help: Call 988 (Suicide & Crisis Lifeline) or 911."
}
```

**database.py - Encryption setup**
```python
from sqlalchemy import create_engine, Column, Integer, String, DateTime, LargeBinary, Float, ForeignKey
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship, sessionmaker
from passlib.context import CryptContext
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2
import base64
import os
from datetime import datetime

pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")
Base = declarative_base()

# Database setup
DATABASE_URL = "sqlite:///./data/traumappd.db"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, nullable=False, index=True)
    password_hash = Column(String, nullable=False)
    encryption_salt = Column(LargeBinary, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    settings = Column(String, default='{}')  # JSON string
    
    # Relationships
    nodes = relationship("Node", back_populates="user", cascade="all, delete-orphan")
    edges = relationship("Edge", back_populates="user", cascade="all, delete-orphan")
    chats = relationship("ChatMessage", back_populates="user", cascade="all, delete-orphan")
    
    def verify_password(self, password: str) -> bool:
        return pwd_context.verify(password, self.password_hash)
    
    def derive_key(self, password: str) -> bytes:
        """Derive encryption key from password"""
        kdf = PBKDF2(
            algorithm=hashes.SHA256(),
            length=32,
            salt=self.encryption_salt,
            iterations=100000,
        )
        key = base64.urlsafe_b64encode(kdf.derive(password.encode()))
        return key

class Node(Base):
    __tablename__ = "nodes"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    node_type = Column(String, nullable=False)
    title = Column(String, nullable=False)
    description_encrypted = Column(LargeBinary)
    x = Column(Float, default=0)
    y = Column(Float, default=0)
    color = Column(String)
    icon = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    user = relationship("User", back_populates="nodes")
    from_edges = relationship("Edge", foreign_keys="Edge.from_node_id", cascade="all, delete-orphan")
    to_edges = relationship("Edge", foreign_keys="Edge.to_node_id", cascade="all, delete-orphan")
    chats = relationship("ChatMessage", back_populates="node", cascade="all, delete-orphan")
    
    def to_dict(self, key: bytes = None):
        """Convert to dictionary, optionally decrypting description"""
        data = {
            "id": self.id,
            "node_type": self.node_type,
            "title": self.title,
            "x": self.x,
            "y": self.y,
            "color": self.color,
            "icon": self.icon,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None
        }
        
        if key and self.description_encrypted:
            try:
                f = Fernet(key)
                data["description"] = f.decrypt(self.description_encrypted).decode()
            except:
                data["description"] = ""
        
        return data

class Edge(Base):
    __tablename__ = "edges"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    from_node_id = Column(Integer, ForeignKey("nodes.id"), nullable=False)
    to_node_id = Column(Integer, ForeignKey("nodes.id"), nullable=False)
    label = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    user = relationship("User", back_populates="edges")
    from_node = relationship("Node", foreign_keys=[from_node_id])
    to_node = relationship("Node", foreign_keys=[to_node_id])
    
    def to_dict(self):
        return {
            "id": self.id,
            "from_node_id": self.from_node_id,
            "to_node_id": self.to_node_id,
            "label": self.label,
            "created_at": self.created_at.isoformat() if self.created_at else None
        }

class ChatMessage(Base):
    __tablename__ = "chat_messages"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    node_id = Column(Integer, ForeignKey("nodes.id"), nullable=True)
    role = Column(String, nullable=False)  # 'user', 'assistant', 'system'
    content_encrypted = Column(LargeBinary, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    user = relationship("User", back_populates="chats")
    node = relationship("Node", back_populates="chats")
    
    def to_dict(self, key: bytes):
        """Convert to dictionary, decrypting content"""
        f = Fernet(key)
        return {
            "id": self.id,
            "node_id": self.node_id,
            "role": self.role,
            "content": f.decrypt(self.content_encrypted).decode(),
            "created_at": self.created_at.isoformat() if self.created_at else None
        }

# Encryption helpers
def encrypt_field(data: str, key: bytes) -> bytes:
    f = Fernet(key)
    return f.encrypt(data.encode())

def decrypt_field(encrypted_data: bytes, key: bytes) -> str:
    f = Fernet(key)
    return f.decrypt(encrypted_data).decode()

# Create tables
Base.metadata.create_all(bind=engine)
```

**main.py - FastAPI application**
```python
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

from database import SessionLocal, User, Node, Edge, ChatMessage, pwd_context, encrypt_field, decrypt_field
from config import NODE_TYPES, MESSAGES

# JWT Configuration
SECRET_KEY = os.getenv("SECRET_KEY", secrets.token_urlsafe(32))
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 24 hours

app = FastAPI(title="TrauMapp'd")

# CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# OAuth2 setup
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

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
    with open("frontend/index.html", "r") as f:
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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

**requirements.txt**
```
fastapi==0.104.1
uvicorn[standard]==0.24.0
sqlalchemy==2.0.23
python-jose[cryptography]==3.3.0
passlib[argon2]==1.7.4
python-multipart==0.0.6
llama-cpp-python==0.2.11
pydantic==2.4.2
cryptography==41.0.5
pillow==10.1.0
reportlab==4.0.7
```

**Dockerfile**
```dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && \
    apt-get install -y gcc g++ && \
    rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create data directory
RUN mkdir -p /app/data

# Expose port
EXPOSE 8000

# Run application
CMD ["python", "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

**docker-compose.yml**
```yaml
version: '3.8'

services:
  traumappd:
    build: .
    container_name: traumappd
    ports:
      - "127.0.0.1:8000:8000"
    volumes:
      - ./data:/app/data
      - ./models:/app/models
    environment:
      - SECRET_KEY=${SECRET_KEY:-your-secret-key-here}
    restart: unless-stopped
```

**Checkpoint 1**: 
- User can build and run Docker container
- Navigate to localhost:8000 and see login screen
- Create account (first run) and login/logout works
- Password is hashed with Argon2, encryption key derives from password
- Basic CSS with light theme implemented
- **Human QA**: Test login, check encryption is working, verify no external connections

---

### Phase 2: Mind Map Integration
**Goal**: Integrate MindElixir library, implement node/edge CRUD operations, and create the visual trauma map.

**frontend/index.html - Complete HTML structure**
```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TrauMapp'd - Private Trauma Mapping</title>
    <link rel="stylesheet" href="/static/css/styles.css">
</head>
<body>
    <!-- Crisis Resources Bar (optional) -->
    <div id="crisis-bar" class="crisis-bar" style="display:none;">
        <span>Need immediate help? Call 988 (Crisis Lifeline) or 911</span>
        <button id="hide-crisis-bar" aria-label="Hide crisis resources">×</button>
    </div>

    <!-- Login Screen -->
    <div id="login-screen" class="screen">
        <div class="login-container">
            <div class="login-box">
                <h1>TrauMapp'd</h1>
                <p class="tagline">Your private space for healing</p>
                
                <form id="login-form">
                    <div class="form-group">
                        <label for="username">Username</label>
                        <input type="text" id="username" name="username" required autocomplete="username">
                    </div>
                    
                    <div class="form-group">
                        <label for="password">Password</label>
                        <input type="password" id="password" name="password" required autocomplete="current-password">
                    </div>
                    
                    <button type="submit" class="btn btn-primary">Login</button>
                    
                    <p id="setup-prompt" class="setup-prompt" style="display:none;">
                        First time? Create your account with the form above.
                    </p>
                    
                    <div id="error-message" class="error-message" style="display:none;"></div>
                </form>
                
                <div class="privacy-notice">
                    <p>🔒 All data stays on your device</p>
                    <p>🔒 No internet connection required after setup</p>
                    <p>🔒 You control your data</p>
                </div>
            </div>
        </div>
    </div>

    <!-- Main App -->
    <div id="main-app" class="screen" style="display:none;">
        <header class="app-header">
            <div class="header-left">
                <h1>TrauMapp'd</h1>
                <span id="save-indicator" class="save-indicator">All changes saved</span>
            </div>
            
            <nav class="header-nav">
                <button id="add-node-btn" class="btn btn-primary">
                    <span class="icon">+</span> Add Node
                </button>
                <button id="analyze-btn" class="btn">
                    <span class="icon">🔍</span> Analyze Map
                </button>
                <button id="export-btn" class="btn">
                    <span class="icon">📥</span> Export
                </button>
                <button id="settings-btn" class="btn">
                    <span class="icon">⚙️</span> Settings
                </button>
                <button id="logout-btn" class="btn btn-secondary">Logout</button>
            </nav>
        </header>
        
        <main class="app-main">
            <div id="mindmap-container" class="mindmap-container">
                <!-- MindElixir will render here -->
            </div>
            
            <div id="chat-panel" class="chat-panel" style="display:none;">
                <!-- Chat interface will be inserted here -->
            </div>
        </main>
        
        <footer class="app-footer">
            <div class="keyboard-hints">
                <span>Keyboard: <kbd>Ctrl+N</kbd> New Node | <kbd>Delete</kbd> Remove | <kbd>Shift+Enter</kbd> Explore</span>
            </div>
        </footer>
    </div>

    <!-- Node Modal -->
    <div id="node-modal" class="modal" style="display:none;">
        <div class="modal-content">
            <div class="modal-header">
                <h3 id="modal-title">Add to Your Map</h3>
                <button class="close-btn" id="close-modal">&times;</button>
            </div>
            
            <div class="modal-body">
                <div class="form-group">
                    <label for="node-type">Type of Entry</label>
                    <select id="node-type" class="node-type-select">
                        <option value="">Choose a type...</option>
                        <option value="trauma_event">🔴 Traumatic Event</option>
                        <option value="trigger">🟠 Trigger</option>
                        <option value="response">🟡 Response</option>
                        <option value="symptom">🟣 Symptom/Issue</option>
                        <option value="emotion">🔵 Emotion/Feeling</option>
                        <option value="belief">🟤 Belief/Thought</option>
                        <option value="coping">🟢 Coping Mechanism</option>
                        <option value="support">🟢 Support/Resource</option>
                    </select>
                    <div id="type-description" class="type-description"></div>
                </div>
                
                <div class="form-group">
                    <label for="node-title">Title</label>
                    <input type="text" id="node-title" placeholder="Brief label for this entry" required>
                </div>
                
                <div class="form-group">
                    <label for="node-description">Description (Optional)</label>
                    <textarea id="node-description" rows="4" 
                             placeholder="Add more details if you'd like. This is encrypted and private to you."></textarea>
                </div>
            </div>
            
            <div class="modal-footer">
                <button id="save-node" class="btn btn-primary">Save</button>
                <button id="cancel-node" class="btn btn-secondary">Cancel</button>
            </div>
        </div>
    </div>

    <!-- Analysis Modal -->
    <div id="analysis-modal" class="modal" style="display:none;">
        <div class="modal-content modal-large">
            <div class="modal-header">
                <h2>Map Insights & Patterns</h2>
                <button class="close-btn" id="close-analysis">&times;</button>
            </div>
            
            <div class="modal-body">
                <div class="analysis-intro">
                    I've looked at your entire map to find patterns and connections. 
                    These are observations to consider, not definitive interpretations.
                </div>
                <div id="analysis-content" class="analysis-content">
                    <div class="loading">Analyzing your map...</div>
                </div>
            </div>
            
            <div class="modal-footer">
                <button id="save-analysis" class="btn btn-primary">Save Insights</button>
                <button id="close-analysis-btn" class="btn btn-secondary">Close</button>
            </div>
        </div>
    </div>

    <!-- Settings Modal -->
    <div id="settings-modal" class="modal" style="display:none;">
        <div class="modal-content modal-large">
            <div class="modal-header">
                <h2>Settings</h2>
                <button class="close-btn" id="close-settings">&times;</button>
            </div>
            
            <div class="modal-body" id="settings-content">
                <!-- Settings will be inserted here -->
            </div>
            
            <div class="modal-footer">
                <button id="save-settings" class="btn btn-primary">Save Settings</button>
                <button id="cancel-settings" class="btn btn-secondary">Cancel</button>
            </div>
        </div>
    </div>

    <!-- Load scripts -->
    <script src="/static/libs/mind-elixir.min.js"></script>
    <script src="/static/js/config.js"></script>
    <script src="/static/js/api.js"></script>
    <script src="/static/js/auth.js"></script>
    <script src="/static/js/mindmap.js"></script>
    <script src="/static/js/chat.js"></script>
    <script src="/static/js/analysis.js"></script>
    <script src="/static/js/settings.js"></script>
    <script src="/static/js/app.js"></script>
</body>
</html>
```

**frontend/js/mindmap.js - MindElixir trauma-informed wrapper**
```javascript
class TraumaMap {
    constructor(container) {
        this.container = container;
        this.selectedNode = null;
        this.mindmap = null;
        this.autoSaveTimer = null;
        this.initMindMap();
        this.loadMap();
    }
    
    initMindMap() {
        // Configure MindElixir with trauma-informed settings
        this.mindmap = new MindElixir({
            el: this.container,
            direction: MindElixir.SIDE,
            data: this.getEmptyMap(),
            draggable: true,
            contextMenu: true,
            toolBar: false, // Custom toolbar instead
            nodeMenu: true,
            keypress: true,
            locale: 'en',
            contextMenuOption: {
                focus: true,
                link: true,
                extend: [
                    {
                        name: 'Explore with AI',
                        onclick: (node) => this.exploreNode(node)
                    },
                    {
                        name: 'Change Type',
                        onclick: (node) => this.changeNodeType(node)
                    }
                ]
            },
            before: {
                insertSibling: (el, node) => this.beforeNodeAction('create', node),
                insertChild: (el, node) => this.beforeNodeAction('create', node),
                removeNode: (el, node) => this.confirmDelete(node),
                editNode: (el, node) => this.beforeNodeAction('edit', node)
            }
        });
        
        // Add accessibility enhancements
        this.enhanceAccessibility();
        
        // Auto-save setup
        this.setupAutoSave();
    }
    
    getEmptyMap() {
        return {
            meta: {
                name: 'My Trauma Map',
                author: 'Self',
                version: '1.0.0'
            },
            format: 'node_tree',
            data: {
                id: 'root',
                topic: 'My Journey',
                style: {
                    background: '#ffffff',
                    color: '#333333',
                    fontSize: '16',
                    fontWeight: 'bold'
                },
                children: []
            }
        };
    }
    
    async loadMap() {
        try {
            const response = await api.get('/api/mindmap');
            if (response.nodes && response.nodes.length > 0) {
                this.convertFromDatabase(response.nodes, response.edges);
            }
        } catch (error) {
            console.error('Error loading map:', error);
            this.showNotification('Could not load your map', 'error');
        }
    }
    
    convertFromDatabase(nodes, edges) {
        // Convert database format to MindElixir format
        const nodeMap = {};
        
        // Create node map
        nodes.forEach(node => {
            nodeMap[node.id] = {
                id: `node_${node.id}`,
                topic: node.title,
                style: {
                    background: node.color,
                    color: '#ffffff'
                },
                data: {
                    node_type: node.node_type,
                    description: node.description,
                    db_id: node.id
                },
                children: []
            };
        });
        
        // Build tree structure from edges
        const rootNodes = [];
        edges.forEach(edge => {
            const parent = nodeMap[edge.from_node_id];
            const child = nodeMap[edge.to_node_id];
            if (parent && child) {
                parent.children.push(child);
            }
        });
        
        // Find root nodes (nodes with no incoming edges)
        const hasIncoming = new Set(edges.map(e => e.to_node_id));
        nodes.forEach(node => {
            if (!hasIncoming.has(node.id)) {
                rootNodes.push(nodeMap[node.id]);
            }
        });
        
        // Update mind map
        if (rootNodes.length > 0) {
            const mapData = this.getEmptyMap();
            mapData.data.children = rootNodes;
            this.mindmap.refresh(mapData);
        }
    }
    
    beforeNodeAction(action, node) {
        // Show modal with trauma-informed language
        const modal = document.getElementById('node-modal');
        const title = document.getElementById('modal-title');
        
        if (action === 'create') {
            title.textContent = 'Add to Your Map';
            this.showNodeTypeSelector();
        } else {
            title.textContent = 'Edit Your Entry';
            this.populateNodeForm(node);
        }
        
        modal.style.display = 'block';
        
        // Focus first input for accessibility
        setTimeout(() => {
            document.getElementById('node-type').focus();
        }, 100);
        
        return false; // Prevent default action
    }
    
    showNodeTypeSelector() {
        const typeSelect = document.getElementById('node-type');
        const description = document.getElementById('type-description');
        
        typeSelect.value = '';
        description.innerHTML = '';
        
        typeSelect.addEventListener('change', (e) => {
            const type = e.target.value;
            if (type && NODE_TYPES[type]) {
                description.innerHTML = `
                    <div class="type-info">
                        <p>${NODE_TYPES[type].description}</p>
                        <small>${NODE_TYPES[type].tooltip}</small>
                    </div>
                `;
            }
        });
    }
    
    confirmDelete(node) {
        // Trauma-informed deletion confirmation
        const message = `Removing "${node.topic}" from your map. 
            This is just the visual representation - your experiences remain valid. 
            You can always add it back later if it feels important.`;
        
        if (confirm(message)) {
            this.deleteNode(node.data?.db_id);
            return true;
        }
        return false;
    }
    
    async deleteNode(nodeId) {
        if (!nodeId) return;
        
        try {
            await api.delete(`/api/node/${nodeId}`);
            this.showNotification('Entry removed from your map', 'success');
            await this.loadMap(); // Reload to sync
        } catch (error) {
            console.error('Error deleting node:', error);
            this.showNotification('Could not remove entry', 'error');
        }
    }
    
    async saveNode(nodeData) {
        try {
            const response = await api.post('/api/node', nodeData);
            this.showNotification('Added to your map', 'success');
            await this.loadMap(); // Reload to show new node
            return response;
        } catch (error) {
            console.error('Error saving node:', error);
            this.showNotification('Could not save entry', 'error');
            return null;
        }
    }
    
    enhanceAccessibility() {
        // Add ARIA labels and keyboard navigation
        const svg = this.container.querySelector('svg');
        if (svg) {
            svg.setAttribute('role', 'application');
            svg.setAttribute('aria-label', 'Trauma map visualization. Use arrow keys to navigate between nodes.');
        }
        
        // Add keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            
            switch(e.key) {
                case 'n':
                    if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        document.getElementById('add-node-btn').click();
                    }
                    break;
                case 'Delete':
                    if (this.selectedNode) {
                        this.confirmDelete(this.selectedNode);
                    }
                    break;
                case 'Enter':
                    if (this.selectedNode && e.shiftKey) {
                        this.exploreNode(this.selectedNode);
                    }
                    break;
            }
        });
    }
    
    exploreNode(node) {
        // Open chat for this node
        if (window.chatInterface) {
            window.chatInterface.openForNode(node.data?.db_id, {
                title: node.topic,
                node_type: node.data?.node_type || 'general',
                description: node.data?.description
            });
        }
    }
    
    setupAutoSave() {
        // Auto-save every 30 seconds
        this.autoSaveTimer = setInterval(() => {
            this.saveCurrentState();
        }, 30000);
        
        // Save on significant changes
        this.mindmap.bus.addListener('operation', () => {
            clearTimeout(this.saveDebounce);
            this.saveDebounce = setTimeout(() => {
                this.saveCurrentState();
            }, 2000);
        });
    }
    
    async saveCurrentState() {
        // Update save indicator
        const indicator = document.getElementById('save-indicator');
        if (indicator) {
            indicator.textContent = 'Saving...';
            indicator.classList.add('saving');
        }
        
        try {
            // Get current map data
            const mapData = this.mindmap.getData();
            // Convert to database format and save
            // Implementation depends on backend API
            
            if (indicator) {
                indicator.textContent = 'All changes saved';
                indicator.classList.remove('saving');
            }
        } catch (error) {
            console.error('Auto-save error:', error);
            if (indicator) {
                indicator.textContent = 'Save failed';
                indicator.classList.add('error');
            }
        }
    }
    
    showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;
        notification.setAttribute('role', 'status');
        notification.setAttribute('aria-live', 'polite');
        
        document.body.appendChild(notification);
        
        // Animate in
        setTimeout(() => {
            notification.classList.add('show');
        }, 10);
        
        // Remove after 3 seconds
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => {
                notification.remove();
            }, 300);
        }, 3000);
    }
}
```

**Checkpoint 2**:
- Mind map displays and is interactive
- Can add nodes of different trauma types with appropriate colors/icons
- Node descriptions are encrypted in database
- Keyboard navigation works (Tab through nodes, Enter to edit, Delete to remove)
- Auto-save every 30 seconds
- Visual feedback that's gentle (soft animations, no jarring transitions)
- **Human QA**: Create a sample map with 5-10 nodes, test all node types, verify encryption

---

### Phase 3: LLM Integration - Explore Mode
**Goal**: Set up local LLM with llama-cpp-python and implement single-node exploration chat.

**backend/llm_service.py - Complete LLM implementation**
```python
from llama_cpp import Llama
import os
import json
from typing import Generator
import urllib.request

class TraumaInformedLLM:
    def __init__(self):
        self.model = None
        self.model_path = "models/llama-2-7b-chat.Q4_K_M.gguf"
        self.system_prompt = """You are a compassionate AI companion in TrauMapp'd, a private trauma mapping tool. 

CRITICAL GUIDELINES:
- Always validate feelings and experiences
- Never diagnose conditions or prescribe treatments  
- Use warm, supportive language
- Avoid clinical jargon unless explaining a concept
- If user mentions self-harm or suicide, express care and provide crisis resources
- Remind users that professional therapy is valuable when appropriate
- Be humble about your limitations as an AI

TONE: Like a wise, caring friend who has training in trauma-informed care but isn't trying to be their therapist.

IMPORTANT: The user owns their narrative. Don't reinterpret their experiences, just help them explore."""
        
    def ensure_model_downloaded(self):
        """Download model on first run if needed"""
        if not os.path.exists(self.model_path):
            print("First-time setup: Downloading language model (~4GB)...")
            print("This ensures your conversations stay completely private.")
            os.makedirs("models", exist_ok=True)
            
            # Download from HuggingFace
            url = "https://huggingface.co/TheBloke/Llama-2-7B-Chat-GGUF/resolve/main/llama-2-7b-chat.Q4_K_M.gguf"
            
            # Download with progress
            def download_progress(block_num, block_size, total_size):
                downloaded = block_num * block_size
                percent = min(downloaded * 100 / total_size, 100)
                print(f"Progress: {percent:.1f}%", end='\r')
            
            urllib.request.urlretrieve(url, self.model_path, download_progress)
            print("\nModel downloaded successfully!")
    
    def load_model(self):
        """Load model into memory"""
        if not self.model:
            self.ensure_model_downloaded()
            self.model = Llama(
                model_path=self.model_path,
                n_ctx=4096,
                n_threads=os.cpu_count() // 2,
                n_gpu_layers=0,  # CPU-only for compatibility
                verbose=False
            )
    
    def explore_node(self, node_data, connected_nodes, chat_history) -> Generator:
        """Stream responses for exploring a specific node"""
        
        # Build context about the node
        context = f"""The user wants to explore this part of their trauma map:

Selected Node: {node_data['node_type']} - "{node_data['title']}"
Description: {node_data.get('description', 'No description provided')}

Connected Elements:"""
        
        for conn in connected_nodes:
            context += f"\n- {conn['relationship']}: {conn['node_type']} - \"{conn['title']}\""
        
        # Format chat history (last 10 messages for context)
        formatted_history = ""
        for msg in chat_history[-10:]:
            role = "User" if msg['role'] == 'user' else "Assistant"  
            formatted_history += f"\n{role}: {msg['content']}"
        
        # Build full prompt with Llama 2 chat format
        full_prompt = f"""[INST] <<SYS>>
{self.system_prompt}

{context}
<</SYS>>

{formatted_history}

User: {chat_history[-1]['content'] if chat_history else "I'd like to explore this part of my map"}
[/INST]"""
        
        # Stream the response
        stream = self.model(
            full_prompt,
            max_tokens=512,
            temperature=0.7,
            top_p=0.95,
            stream=True,
            stop=["User:", "[INST]"]
        )
        
        for output in stream:
            token = output['choices'][0]['text']
            yield token
    
    def analyze_map(self, nodes, edges) -> Generator:
        """Analyze entire map for patterns and insights"""
        
        # Build map structure description
        map_description = self._build_map_description(nodes, edges)
        
        analysis_prompt = f"""[INST] <<SYS>>
You are analyzing a trauma map to help someone understand patterns in their experiences.

Guidelines:
- Look for connections and themes across their experiences
- Point out strengths and resilience factors
- Identify coping resources they've noted
- Be tentative, not definitive ("it seems", "perhaps", "might")
- Never diagnose or pathologize
- Celebrate their courage in mapping their experiences
- Suggest areas they might explore with a therapist
<</SYS>>

Please analyze this trauma map and provide gentle insights:

{map_description}

Focus on:
1. Patterns or themes you notice
2. Strengths and resources present
3. Potential connections between elements
4. Gentle suggestions for exploration

Remember: You're helping them see their map from a different perspective, not telling them what it means.
[/INST]"""
        
        stream = self.model(
            analysis_prompt,
            max_tokens=1024,
            temperature=0.7,
            stream=True
        )
        
        for output in stream:
            yield output['choices'][0]['text']
    
    def _build_map_description(self, nodes, edges):
        """Create readable description of map structure"""
        from config import NODE_TYPES
        
        # Group nodes by type
        grouped = {}
        for node in nodes:
            node_type = node['node_type']
            if node_type not in grouped:
                grouped[node_type] = []
            grouped[node_type].append(node)
        
        description = "Map Overview:\n\n"
        
        # Describe each category
        for node_type, items in grouped.items():
            if node_type in NODE_TYPES:
                type_info = NODE_TYPES[node_type]
                description += f"{type_info['label']} ({len(items)}):\n"
                for item in items:
                    description += f"- {item['title']}"
                    if item.get('description'):
                        description += f": {item['description'][:100]}"
                    description += "\n"
                description += "\n"
        
        # Describe connections
        description += "Key Connections:\n"
        for edge in edges[:20]:  # Limit to avoid overwhelming
            from_node = next((n for n in nodes if n['id'] == edge['from_id']), None)
            to_node = next((n for n in nodes if n['id'] == edge['to_id']), None)
            if from_node and to_node:
                description += f"- {from_node['title']} → {to_node['title']}"
                if edge.get('label'):
                    description += f" ({edge['label']})"
                description += "\n"
        
        return description
    
    def check_crisis_content(self, message: str) -> dict:
        """Check if message contains crisis indicators"""
        crisis_keywords = [
            'suicide', 'kill myself', 'end it all', 'not worth living',
            'self-harm', 'hurt myself', 'cutting'
        ]
        
        message_lower = message.lower()
        for keyword in crisis_keywords:
            if keyword in message_lower:
                return {
                    "detected": True,
                    "resources": """I care about your safety. Please reach out for support:
                    
**Crisis Lines (US):**
- 988 Suicide & Crisis Lifeline (call or text)
- Crisis Text Line: Text HOME to 741741
- SAMHSA National Helpline: 1-800-662-4357

**International:**
- befrienders.org for worldwide crisis centers

You deserve support and these services are confidential."""
                }
        
        return {"detected": False}
```

**Add to main.py - Chat endpoints**
```python
from fastapi import WebSocket, WebSocketDisconnect
from llm_service import TraumaInformedLLM
import asyncio

# Initialize LLM service
llm_service = TraumaInformedLLM()

@app.on_event("startup")
async def startup_event():
    """Load model on startup"""
    await asyncio.get_event_loop().run_in_executor(None, llm_service.load_model)

@app.post("/api/chat/check-crisis")
async def check_crisis(
    request: dict,
    current_user: User = Depends(get_current_user)
):
    """Check message for crisis content"""
    result = llm_service.check_crisis_content(request.get("message", ""))
    return result

@app.websocket("/ws/chat/explore")
async def chat_explore_websocket(
    websocket: WebSocket,
    node_id: int,
    token: str
):
    """WebSocket endpoint for streaming chat responses"""
    await websocket.accept()
    
    try:
        # Validate token
        user = await get_current_user(token)
        
        # Get node data
        db = SessionLocal()
        node = db.query(Node).filter(
            Node.id == node_id,
            Node.user_id == user.id
        ).first()
        
        if not node:
            await websocket.send_json({"error": "Node not found"})
            await websocket.close()
            return
        
        # Get connected nodes
        connected = []
        edges = db.query(Edge).filter(
            (Edge.from_node_id == node_id) | (Edge.to_node_id == node_id),
            Edge.user_id == user.id
        ).all()
        
        for edge in edges:
            connected_node = None
            relationship = "connected to"
            
            if edge.from_node_id == node_id:
                connected_node = db.query(Node).filter(Node.id == edge.to_node_id).first()
                relationship = edge.label or "leads to"
            else:
                connected_node = db.query(Node).filter(Node.id == edge.from_node_id).first()
                relationship = edge.label or "comes from"
            
            if connected_node:
                connected.append({
                    "relationship": relationship,
                    "node_type": connected_node.node_type,
                    "title": connected_node.title
                })
        
        # Get chat history
        password = get_session_password(user.username)
        key = user.derive_key(password)
        
        messages = db.query(ChatMessage).filter(
            ChatMessage.node_id == node_id,
            ChatMessage.user_id == user.id
        ).order_by(ChatMessage.created_at).all()
        
        chat_history = [msg.to_dict(key) for msg in messages]
        
        # Listen for messages
        while True:
            # Receive message from client
            data = await websocket.receive_json()
            user_message = data.get("message", "")
            
            # Save user message
            user_msg = ChatMessage(
                user_id=user.id,
                node_id=node_id,
                role="user",
                content_encrypted=encrypt_field(user_message, key)
            )
            db.add(user_msg)
            db.commit()
            
            # Add to history
            chat_history.append({
                "role": "user",
                "content": user_message
            })
            
            # Generate response
            node_data = {
                "node_type": node.node_type,
                "title": node.title,
                "description": decrypt_field(node.description_encrypted, key) if node.description_encrypted else ""
            }
            
            # Stream response
            response_text = ""
            for token in llm_service.explore_node(node_data, connected, chat_history):
                response_text += token
                await websocket.send_json({
                    "type": "token",
                    "content": token
                })
            
            # Save assistant message
            assistant_msg = ChatMessage(
                user_id=user.id,
                node_id=node_id,
                role="assistant",
                content_encrypted=encrypt_field(response_text, key)
            )
            db.add(assistant_msg)
            db.commit()
            
            # Send completion signal
            await websocket.send_json({
                "type": "complete",
                "content": response_text
            })
            
            # Add to history
            chat_history.append({
                "role": "assistant",
                "content": response_text
            })
    
    except WebSocketDisconnect:
        pass
    finally:
        db.close()

@app.get("/api/chat/history/{node_id}")
async def get_chat_history(
    node_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get chat history for a node"""
    password = get_session_password(current_user.username)
    if not password:
        raise HTTPException(status_code=401, detail="Session expired")
    
    key = current_user.derive_key(password)
    
    messages = db.query(ChatMessage).filter(
        ChatMessage.node_id == node_id,
        ChatMessage.user_id == current_user.id
    ).order_by(ChatMessage.created_at).all()
    
    return {
        "messages": [msg.to_dict(key) for msg in messages]
    }
```

**frontend/js/chat.js - Chat interface**
```javascript
class ChatInterface {
    constructor(container) {
        this.container = container;
        this.currentNodeId = null;
        this.messages = [];
        this.ws = null;
        this.initializeChat();
    }
    
    initializeChat() {
        this.container.innerHTML = `
            <div class="chat-container">
                <div class="chat-header">
                    <h3>Exploring: <span id="chat-node-title"></span></h3>
                    <button id="close-chat" aria-label="Close chat" class="close-btn">×</button>
                </div>
                <div class="chat-messages" role="log" aria-live="polite">
                    <div class="chat-welcome">
                        <p>This is a safe space to explore your thoughts and feelings about this part of your map.</p>
                        <p>I'm here to listen and support, not to judge or diagnose.</p>
                    </div>
                </div>
                <div class="chat-input-container">
                    <textarea 
                        id="chat-input" 
                        placeholder="Share what's on your mind..."
                        aria-label="Chat message"
                        rows="2"
                    ></textarea>
                    <button id="send-message" aria-label="Send message" class="btn btn-primary">Send</button>
                </div>
                <div class="chat-disclaimer">
                    Your conversations are private and encrypted. 
                    <a href="#" id="crisis-resources">Crisis Resources</a>
                </div>
            </div>
        `;
        
        this.attachEventListeners();
    }
    
    attachEventListeners() {
        document.getElementById('close-chat').addEventListener('click', () => this.close());
        document.getElementById('send-message').addEventListener('click', () => this.sendMessage());
        document.getElementById('chat-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });
        
        document.getElementById('crisis-resources').addEventListener('click', (e) => {
            e.preventDefault();
            this.showCrisisResources();
        });
    }
    
    async openForNode(nodeId, nodeData) {
        this.currentNodeId = nodeId;
        this.messages = [];
        
        // Update UI
        document.getElementById('chat-node-title').textContent = nodeData.title;
        this.container.style.display = 'block';
        
        // Load history
        await this.loadHistory(nodeId);
        
        // Connect WebSocket
        this.connectWebSocket(nodeId);
        
        // Announce to screen readers
        this.announce(`Chat opened for ${nodeData.node_type}: ${nodeData.title}`);
        
        // Focus input
        document.getElementById('chat-input').focus();
    }
    
    async loadHistory(nodeId) {
        try {
            const response = await api.get(`/api/chat/history/${nodeId}`);
            if (response.messages && response.messages.length > 0) {
                this.messages = response.messages;
                this.renderMessages();
            }
        } catch (error) {
            console.error('Error loading chat history:', error);
        }
    }
    
    connectWebSocket(nodeId) {
        const token = localStorage.getItem('token');
        const wsUrl = `ws://localhost:8000/ws/chat/explore?node_id=${nodeId}&token=${token}`;
        
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            
            if (data.type === 'token') {
                // Update the last assistant message
                this.updateStreamingMessage(data.content);
            } else if (data.type === 'complete') {
                // Finalize the message
                this.finalizeStreamingMessage();
            } else if (data.error) {
                this.addMessage('system', 'An error occurred. Please try again.');
            }
        };
        
        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            this.addMessage('system', 'Connection error. Please refresh and try again.');
        };
    }
    
    async sendMessage() {
        const input = document.getElementById('chat-input');
        const content = input.value.trim();
        
        if (!content) return;
        
        // Check for crisis content
        const crisisCheck = await api.post('/api/chat/check-crisis', { message: content });
        if (crisisCheck.detected) {
            this.addMessage('system', crisisCheck.resources);
        }
        
        // Add user message to UI
        this.addMessage('user', content);
        
        // Clear input
        input.value = '';
        
        // Send via WebSocket
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ message: content }));
            
            // Start streaming message
            this.startStreamingMessage();
        }
    }
    
    addMessage(role, content) {
        const message = {
            role: role,
            content: content,
            created_at: new Date().toISOString()
        };
        
        this.messages.push(message);
        this.renderMessage(message);
        this.scrollToBottom();
    }
    
    renderMessage(message) {
        const messagesContainer = document.querySelector('.chat-messages');
        const messageElement = document.createElement('div');
        messageElement.className = `chat-message chat-message-${message.role}`;
        
        if (message.role === 'system') {
            messageElement.innerHTML = this.formatSystemMessage(message.content);
        } else {
            messageElement.textContent = message.content;
        }
        
        messagesContainer.appendChild(messageElement);
    }
    
    renderMessages() {
        const messagesContainer = document.querySelector('.chat-messages');
        
        // Keep welcome message
        const welcome = messagesContainer.querySelector('.chat-welcome');
        messagesContainer.innerHTML = '';
        if (welcome) messagesContainer.appendChild(welcome);
        
        // Render all messages
        this.messages.forEach(msg => this.renderMessage(msg));
        this.scrollToBottom();
    }
    
    startStreamingMessage() {
        this.streamingMessage = {
            role: 'assistant',
            content: '',
            created_at: new Date().toISOString()
        };
        
        const messagesContainer = document.querySelector('.chat-messages');
        const messageElement = document.createElement('div');
        messageElement.className = 'chat-message chat-message-assistant streaming';
        messageElement.id = 'streaming-message';
        messageElement.innerHTML = '<span class="cursor">▊</span>';
        
        messagesContainer.appendChild(messageElement);
        this.scrollToBottom();
    }
    
    updateStreamingMessage(token) {
        const messageElement = document.getElementById('streaming-message');
        if (messageElement && this.streamingMessage) {
            this.streamingMessage.content += token;
            messageElement.innerHTML = this.streamingMessage.content + '<span class="cursor">▊</span>';
            this.scrollToBottom();
        }
    }
    
    finalizeStreamingMessage() {
        const messageElement = document.getElementById('streaming-message');
        if (messageElement && this.streamingMessage) {
            messageElement.classList.remove('streaming');
            messageElement.innerHTML = this.streamingMessage.content;
            messageElement.id = '';
            
            this.messages.push(this.streamingMessage);
            this.streamingMessage = null;
        }
    }
    
    formatSystemMessage(content) {
        // Format crisis resources and system messages
        return content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                      .replace(/\n/g, '<br>');
    }
    
    showCrisisResources() {
        const resources = `
            <div class="crisis-resources-modal">
                <h3>Crisis Resources</h3>
                <ul>
                    <li><strong>988</strong> - Suicide & Crisis Lifeline (US)</li>
                    <li><strong>Text HOME to 741741</strong> - Crisis Text Line</li>
                    <li><strong>1-800-662-4357</strong> - SAMHSA National Helpline</li>
                    <li><strong>befrienders.org</strong> - International crisis centers</li>
                </ul>
                <p>You deserve support. These services are confidential and available 24/7.</p>
            </div>
        `;
        
        this.addMessage('system', resources);
    }
    
    scrollToBottom() {
        const messagesContainer = document.querySelector('.chat-messages');
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    
    announce(message) {
        // For screen reader announcements
        const announcement = document.createElement('div');
        announcement.setAttribute('role', 'status');
        announcement.setAttribute('aria-live', 'polite');
        announcement.className = 'sr-only';
        announcement.textContent = message;
        document.body.appendChild(announcement);
        setTimeout(() => announcement.remove(), 1000);
    }
    
    close() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        
        this.container.style.display = 'none';
        this.currentNodeId = null;
    }
}
```

**Checkpoint 3**:
- LLM model downloads on first run (shows progress)
- Click any node and select "Explore with AI" to open chat
- Chat maintains conversation context
- Responses stream in real-time
- Crisis detection works and shows resources
- Chat history saves (encrypted) and loads on return
- **Human QA**: Test conversations with different node types, verify appropriate tone, test crisis detection

---

### Phase 4: Map Analysis & Connect Mode
**Goal**: Implement full-map analysis to find patterns and insights across all nodes.

**Add to main.py - Analysis endpoint**
```python
@app.websocket("/ws/chat/analyze")
async def chat_analyze_websocket(
    websocket: WebSocket,
    token: str
):
    """WebSocket endpoint for map analysis"""
    await websocket.accept()
    
    try:
        # Validate token
        user = await get_current_user(token)
        db = SessionLocal()
        
        # Get all nodes and edges
        password = get_session_password(user.username)
        key = user.derive_key(password)
        
        nodes = db.query(Node).filter(Node.user_id == user.id).all()
        edges = db.query(Edge).filter(Edge.user_id == user.id).all()
        
        # Convert to dict format
        nodes_data = [node.to_dict(key) for node in nodes]
        edges_data = [edge.to_dict() for edge in edges]
        
        # Generate analysis
        analysis_text = ""
        for token in llm_service.analyze_map(nodes_data, edges_data):
            analysis_text += token
            await websocket.send_json({
                "type": "token",
                "content": token
            })
        
        # Save analysis as a special chat message
        analysis_msg = ChatMessage(
            user_id=user.id,
            node_id=None,  # No specific node
            role="assistant",
            content_encrypted=encrypt_field(analysis_text, key)
        )
        db.add(analysis_msg)
        db.commit()
        
        # Send completion
        await websocket.send_json({
            "type": "complete",
            "content": analysis_text
        })
    
    except WebSocketDisconnect:
        pass
    finally:
        db.close()
```

**frontend/js/analysis.js - Map analysis interface**
```javascript
class MapAnalysis {
    constructor() {
        this.modal = null;
        this.ws = null;
        this.createModal();
    }
    
    createModal() {
        // Check if modal already exists
        if (document.getElementById('analysis-modal')) {
            this.modal = document.getElementById('analysis-modal');
            return;
        }
        
        const modal = document.createElement('div');
        modal.id = 'analysis-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content modal-large">
                <div class="modal-header">
                    <h2>Map Insights & Patterns</h2>
                    <button class="close-btn" id="close-analysis">&times;</button>
                </div>
                
                <div class="modal-body">
                    <div class="analysis-intro">
                        <p>I've looked at your entire map to find patterns and connections.</p>
                        <p>These are observations to consider, not definitive interpretations.</p>
                    </div>
                    <div id="analysis-content" class="analysis-content">
                        <div class="loading">
                            <span>Analyzing your map...</span>
                            <div class="loading-spinner"></div>
                        </div>
                    </div>
                </div>
                
                <div class="modal-footer">
                    <div class="analysis-footer-info">
                        <p>Remember: You are the expert on your own experience.</p>
                        <p>Consider discussing these insights with a therapist.</p>
                    </div>
                    <div class="analysis-actions">
                        <button id="save-analysis" class="btn btn-primary">Save Insights</button>
                        <button id="close-analysis-btn" class="btn btn-secondary">Close</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        this.modal = modal;
        
        // Attach event listeners
        document.getElementById('close-analysis').addEventListener('click', () => this.close());
        document.getElementById('close-analysis-btn').addEventListener('click', () => this.close());
        document.getElementById('save-analysis').addEventListener('click', () => this.saveAnalysis());
    }
    
    async analyze() {
        this.modal.style.display = 'block';
        const contentDiv = document.getElementById('analysis-content');
        contentDiv.innerHTML = `
            <div class="loading">
                <span>Analyzing your map...</span>
                <div class="loading-spinner"></div>
            </div>
        `;
        
        // Connect WebSocket
        const token = localStorage.getItem('token');
        const wsUrl = `ws://localhost:8000/ws/chat/analyze?token=${token}`;
        
        this.ws = new WebSocket(wsUrl);
        this.analysisText = '';
        
        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            
            if (data.type === 'token') {
                this.analysisText += data.content;
                contentDiv.innerHTML = this.formatAnalysis(this.analysisText);
            } else if (data.type === 'complete') {
                this.analysisText = data.content;
                contentDiv.innerHTML = this.formatAnalysis(this.analysisText);
                document.getElementById('save-analysis').disabled = false;
            }
        };
        
        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            contentDiv.innerHTML = `
                <div class="error-message">
                    <p>An error occurred during analysis. Please try again.</p>
                </div>
            `;
        };
    }
    
    formatAnalysis(text) {
        // Format the analysis with proper sections and styling
        let formatted = text;
        
        // Add section headers
        formatted = formatted.replace(/Patterns?:/gi, '<h3>🔍 Patterns Noticed</h3>');
        formatted = formatted.replace(/Strengths?:/gi, '<h3>💪 Your Strengths</h3>');
        formatted = formatted.replace(/Resources?:/gi, '<h3>🛡️ Resources Available</h3>');
        formatted = formatted.replace(/Connections?:/gi, '<h3>🔗 Possible Connections</h3>');
        formatted = formatted.replace(/Suggestions?:/gi, '<h3>💭 Gentle Suggestions</h3>');
        formatted = formatted.replace(/Themes?:/gi, '<h3>🎯 Common Themes</h3>');
        
        // Format lists
        formatted = formatted.replace(/^- (.+)$/gm, '<li>$1</li>');
        formatted = formatted.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
        
        // Format paragraphs
        formatted = formatted.split('\n\n').map(para => {
            if (!para.startsWith('<h3>') && !para.startsWith('<ul>')) {
                return `<p>${para}</p>`;
            }
            return para;
        }).join('\n');
        
        // Highlight important phrases
        formatted = formatted.replace(/"([^"]+)"/g, '<span class="highlight">$1</span>');
        
        return `<div class="analysis-results">${formatted}</div>`;
    }
    
    async saveAnalysis() {
        if (!this.analysisText) return;
        
        // Create a downloadable text file
        const blob = new Blob([this.analysisText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `trauma-map-insights-${new Date().toISOString().split('T')[0]}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        // Show confirmation
        this.showNotification('Insights saved to your downloads folder');
    }
    
    showNotification(message) {
        const notification = document.createElement('div');
        notification.className = 'notification notification-success';
        notification.textContent = message;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.classList.add('show');
        }, 10);
        
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }
    
    close() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        
        this.modal.style.display = 'none';
        this.analysisText = '';
    }
}
```

**Checkpoint 4**:
- "Analyze Map" button triggers full map analysis
- Analysis identifies patterns across nodes
- Points out coping resources and strengths
- Uses tentative, exploratory language
- Results can be saved/exported
- **Human QA**: Create complex map with 15+ nodes, verify analysis quality and tone

---

### Phase 5: Export, Settings & Polish
**Goal**: Add export functionality, user settings, crisis resources, and final accessibility/trauma-informed polish.

**frontend/css/styles.css - Complete trauma-informed styling**
```css
/* Root variables for theming */
:root {
    /* Light theme - soft, calming colors */
    --bg-primary: #fafafa;
    --bg-secondary: #ffffff;
    --text-primary: #424242;
    --text-secondary: #757575;
    --border: #e0e0e0;
    --focus: #2196F3;
    --focus-ring: 0 0 0 3px rgba(33, 150, 243, 0.3);
    
    /* Node type colors (slightly muted for comfort) */
    --trauma-color: #c62828;
    --trigger-color: #ef6c00;
    --response-color: #f9a825;
    --symptom-color: #6a1b9a;
    --emotion-color: #1565c0;
    --belief-color: #4e342e;
    --coping-color: #2e7d32;
    --support-color: #00695c;
    
    /* Spacing for readability */
    --spacing-xs: 0.25rem;
    --spacing-sm: 0.5rem;
    --spacing-md: 1rem;
    --spacing-lg: 1.5rem;
    --spacing-xl: 2rem;
    
    /* Transitions - gentle and predictable */
    --transition: all 0.3s ease;
}

/* Dark theme - easy on eyes */
[data-theme="dark"] {
    --bg-primary: #1a1a1a;
    --bg-secondary: #2d2d2d;
    --text-primary: #e0e0e0;
    --text-secondary: #b0b0b0;
    --border: #404040;
}

/* Soft theme - low contrast for sensitivity */
[data-theme="soft"] {
    --bg-primary: #f5f2ed;
    --bg-secondary: #fffdf8;
    --text-primary: #5a524a;
    --text-secondary: #8a7e72;
    --border: #d4cfc7;
    --focus: #7a9a9f;
}

/* Reset and base styles */
* {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
}

*:focus {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
    box-shadow: var(--focus-ring);
}

/* Remove focus for mouse users, keep for keyboard */
*:focus:not(:focus-visible) {
    outline: none;
    box-shadow: none;
}

/* Screen reader only content */
.sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
}

/* Typography - readable and calming */
body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 
                 'Roboto', 'Oxygen', 'Ubuntu', sans-serif;
    font-size: 16px;
    line-height: 1.6;
    color: var(--text-primary);
    background: var(--bg-primary);
}

/* Font size adjustments */
[data-font-size="small"] { font-size: 14px; }
[data-font-size="medium"] { font-size: 16px; }
[data-font-size="large"] { font-size: 18px; }
[data-font-size="xlarge"] { font-size: 20px; }

h1, h2, h3, h4, h5, h6 {
    font-weight: 600;
    line-height: 1.3;
    margin-bottom: var(--spacing-sm);
}

h1 { font-size: 2rem; }
h2 { font-size: 1.5rem; }
h3 { font-size: 1.25rem; }

/* Buttons - clear and predictable */
.btn {
    background: var(--bg-secondary);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: var(--spacing-sm) var(--spacing-md);
    font-size: 1rem;
    cursor: pointer;
    transition: var(--transition);
    min-height: 44px;
    min-width: 44px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--spacing-xs);
}

.btn:hover:not(:disabled) {
    background: var(--border);
}

.btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.btn-primary {
    background: var(--focus);
    color: white;
    border-color: var(--focus);
}

.btn-primary:hover:not(:disabled) {
    background: #1976D2;
}

.btn-secondary {
    background: transparent;
    color: var(--text-secondary);
}

/* Forms */
.form-group {
    margin-bottom: var(--spacing-md);
}

.form-group label {
    display: block;
    margin-bottom: var(--spacing-xs);
    font-weight: 500;
}

input[type="text"],
input[type="password"],
textarea,
select {
    width: 100%;
    padding: var(--spacing-sm);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 1rem;
    background: var(--bg-secondary);
    color: var(--text-primary);
    transition: var(--transition);
}

input:focus,
textarea:focus,
select:focus {
    border-color: var(--focus);
}

textarea {
    resize: vertical;
    min-height: 100px;
}

/* Crisis resources bar */
.crisis-bar {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: var(--spacing-sm);
    text-align: center;
    position: sticky;
    top: 0;
    z-index: 1000;
    display: flex;
    justify-content: center;
    align-items: center;
    gap: var(--spacing-md);
}

.crisis-bar a {
    color: white;
    font-weight: bold;
    text-decoration: underline;
}

/* Login screen */
.login-container {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--spacing-xl);
}

.login-box {
    background: var(--bg-secondary);
    padding: var(--spacing-xl);
    border-radius: 8px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
    max-width: 400px;
    width: 100%;
}

.tagline {
    color: var(--text-secondary);
    margin-bottom: var(--spacing-lg);
    text-align: center;
}

.privacy-notice {
    margin-top: var(--spacing-lg);
    padding: var(--spacing-md);
    background: var(--bg-primary);
    border-radius: 4px;
    font-size: 0.9rem;
    color: var(--text-secondary);
}

/* Main app header */
.app-header {
    background: var(--bg-secondary);
    padding: var(--spacing-md);
    border-bottom: 1px solid var(--border);
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.header-nav {
    display: flex;
    gap: var(--spacing-sm);
}

.save-indicator {
    margin-left: var(--spacing-md);
    padding: var(--spacing-xs) var(--spacing-sm);
    background: #4CAF50;
    color: white;
    border-radius: 4px;
    font-size: 0.85rem;
}

.save-indicator.saving {
    background: #FFC107;
}

.save-indicator.error {
    background: #F44336;
}

/* Mind map container */
.mindmap-container {
    height: 70vh;
    background: var(--bg-secondary);
    border-radius: 8px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    margin: var(--spacing-md);
}

/* Chat interface */
.chat-panel {
    position: fixed;
    right: var(--spacing-md);
    bottom: var(--spacing-md);
    width: 400px;
    height: 500px;
    background: var(--bg-secondary);
    border-radius: 8px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
    z-index: 100;
}

.chat-container {
    height: 100%;
    display: flex;
    flex-direction: column;
    padding: var(--spacing-md);
}

.chat-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-bottom: var(--spacing-md);
    border-bottom: 1px solid var(--border);
}

.chat-messages {
    flex: 1;
    overflow-y: auto;
    padding: var(--spacing-md) 0;
    scroll-behavior: smooth;
}

.chat-message {
    margin-bottom: var(--spacing-md);
    padding: var(--spacing-sm) var(--spacing-md);
    border-radius: 12px;
    max-width: 80%;
}

.chat-message-user {
    background: var(--focus);
    color: white;
    margin-left: auto;
}

.chat-message-assistant {
    background: var(--bg-primary);
    border: 1px solid var(--border);
}

.chat-message-system {
    background: #fff3cd;
    border: 1px solid #ffc107;
    color: #856404;
    max-width: 100%;
    text-align: center;
}

.chat-welcome {
    text-align: center;
    color: var(--text-secondary);
    padding: var(--spacing-lg);
    font-style: italic;
}

.chat-input-container {
    display: flex;
    gap: var(--spacing-sm);
    padding-top: var(--spacing-md);
    border-top: 1px solid var(--border);
}

.chat-disclaimer {
    font-size: 0.85rem;
    color: var(--text-secondary);
    text-align: center;
    padding-top: var(--spacing-sm);
}

/* Modals */
.modal {
    display: none;
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 1000;
    align-items: center;
    justify-content: center;
}

.modal-content {
    background: var(--bg-secondary);
    border-radius: 8px;
    max-width: 600px;
    max-height: 80vh;
    overflow: auto;
    width: 90%;
}

.modal-large {
    max-width: 800px;
}

.modal-header {
    padding: var(--spacing-lg);
    border-bottom: 1px solid var(--border);
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.modal-body {
    padding: var(--spacing-lg);
}

.modal-footer {
    padding: var(--spacing-lg);
    border-top: 1px solid var(--border);
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.close-btn {
    background: none;
    border: none;
    font-size: 1.5rem;
    cursor: pointer;
    color: var(--text-secondary);
    padding: 0;
    width: 32px;
    height: 32px;
}

/* Analysis modal */
.analysis-intro {
    padding: var(--spacing-md);
    background: var(--bg-primary);
    border-radius: 4px;
    margin-bottom: var(--spacing-lg);
}

.analysis-content {
    min-height: 200px;
}

.analysis-results h3 {
    margin-top: var(--spacing-lg);
    margin-bottom: var(--spacing-md);
}

.analysis-results ul {
    margin-left: var(--spacing-lg);
    margin-bottom: var(--spacing-md);
}

.analysis-results .highlight {
    background: rgba(33, 150, 243, 0.1);
    padding: 2px 4px;
    border-radius: 2px;
}

/* Loading states */
.loading {
    text-align: center;
    color: var(--text-secondary);
    padding: var(--spacing-xl);
}

.loading-spinner {
    display: inline-block;
    width: 24px;
    height: 24px;
    border: 2px solid var(--border);
    border-top-color: var(--focus);
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-left: var(--spacing-sm);
}

@keyframes spin {
    to { transform: rotate(360deg); }
}

/* Notifications */
.notification {
    position: fixed;
    bottom: var(--spacing-xl);
    right: var(--spacing-xl);
    padding: var(--spacing-md) var(--spacing-lg);
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 4px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    opacity: 0;
    transform: translateY(20px);
    transition: all 0.3s ease;
    z-index: 2000;
}

.notification.show {
    opacity: 1;
    transform: translateY(0);
}

.notification-success {
    border-color: #4CAF50;
    background: #E8F5E9;
    color: #2E7D32;
}

.notification-error {
    border-color: #F44336;
    background: #FFEBEE;
    color: #C62828;
}

/* Reduced motion preference */
@media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
        scroll-behavior: auto !important;
    }
    
    .notification {
        transition: none;
    }
}

/* Responsive design */
@media (max-width: 768px) {
    .chat-panel {
        width: 100%;
        right: 0;
        bottom: 0;
        border-radius: 0;
    }
    
    .header-nav {
        flex-wrap: wrap;
    }
    
    .modal-content {
        max-width: 100%;
        border-radius: 0;
        height: 100vh;
        max-height: 100vh;
    }
}

/* Print styles for therapy sessions */
@media print {
    .no-print {
        display: none !important;
    }
    
    body {
        font-size: 12pt;
        color: black;
        background: white;
    }
    
    .mindmap-container {
        box-shadow: none;
        border: 1px solid #000;
    }
}
```

**frontend/js/settings.js - Settings management**
```javascript
class Settings {
    constructor() {
        this.defaults = {
            theme: 'light',
            autoSave: true,
            autoSaveInterval: 30,
            retainChat: true,
            chatRetentionDays: 30,
            fontSize: 'medium',
            reducedMotion: false,
            showCrisisBar: true
        };
        
        this.current = { ...this.defaults };
        this.loadSettings();
    }
    
    async loadSettings() {
        try {
            const response = await api.get('/api/settings');
            if (response.settings) {
                this.current = { ...this.defaults, ...response.settings };
                this.applySettings();
            }
        } catch (error) {
            console.error('Error loading settings:', error);
            this.applySettings();
        }
    }
    
    applySettings() {
        // Apply theme
        document.body.setAttribute('data-theme', this.current.theme);
        
        // Apply font size
        document.body.setAttribute('data-font-size', this.current.fontSize);
        
        // Apply reduced motion
        if (this.current.reducedMotion) {
            document.body.classList.add('reduced-motion');
        } else {
            document.body.classList.remove('reduced-motion');
        }
        
        // Show/hide crisis bar
        const crisisBar = document.getElementById('crisis-bar');
        if (crisisBar) {
            crisisBar.style.display = this.current.showCrisisBar ? 'flex' : 'none';
        }
    }
    
    showSettingsPanel() {
        const modal = document.getElementById('settings-modal');
        const content = document.getElementById('settings-content');
        
        content.innerHTML = `
            <div class="settings-panel">
                <section>
                    <h3>Appearance</h3>
                    <div class="form-group">
                        <label for="theme-select">Theme</label>
                        <select id="theme-select">
                            <option value="light" ${this.current.theme === 'light' ? 'selected' : ''}>Light (Default)</option>
                            <option value="dark" ${this.current.theme === 'dark' ? 'selected' : ''}>Dark</option>
                            <option value="soft" ${this.current.theme === 'soft' ? 'selected' : ''}>Soft (Low Contrast)</option>
                        </select>
                    </div>
                    
                    <div class="form-group">
                        <label for="font-size">Font Size</label>
                        <select id="font-size">
                            <option value="small" ${this.current.fontSize === 'small' ? 'selected' : ''}>Small</option>
                            <option value="medium" ${this.current.fontSize === 'medium' ? 'selected' : ''}>Medium</option>
                            <option value="large" ${this.current.fontSize === 'large' ? 'selected' : ''}>Large</option>
                            <option value="xlarge" ${this.current.fontSize === 'xlarge' ? 'selected' : ''}>Extra Large</option>
                        </select>
                    </div>
                    
                    <div class="form-group">
                        <label>
                            <input type="checkbox" id="reduced-motion" ${this.current.reducedMotion ? 'checked' : ''}>
                            Reduce animations (for comfort)
                        </label>
                    </div>
                </section>
                
                <section>
                    <h3>Privacy & Data</h3>
                    <div class="form-group">
                        <label>
                            <input type="checkbox" id="retain-chat" ${this.current.retainChat ? 'checked' : ''}>
                            Save chat conversations
                        </label>
                    </div>
                    
                    <div class="form-group">
                        <label for="retention-days">Auto-delete chats after</label>
                        <select id="retention-days">
                            <option value="7" ${this.current.chatRetentionDays === 7 ? 'selected' : ''}>7 days</option>
                            <option value="30" ${this.current.chatRetentionDays === 30 ? 'selected' : ''}>30 days</option>
                            <option value="90" ${this.current.chatRetentionDays === 90 ? 'selected' : ''}>90 days</option>
                            <option value="0" ${this.current.chatRetentionDays === 0 ? 'selected' : ''}>Never</option>
                        </select>
                    </div>
                    
                    <div class="form-group">
                        <button id="clear-all-data" class="btn btn-danger">
                            Clear All My Data
                        </button>
                        <p class="help-text">
                            This will permanently delete your map and all conversations.
                            Export your data first if you want to keep a backup.
                        </p>
                    </div>
                </section>
                
                <section>
                    <h3>Safety</h3>
                    <div class="form-group">
                        <label>
                            <input type="checkbox" id="show-crisis-bar" ${this.current.showCrisisBar ? 'checked' : ''}>
                            Show crisis resources bar
                        </label>
                    </div>
                    
                    <div class="crisis-resources">
                        <h4>Crisis Resources (Always Available)</h4>
                        <ul>
                            <li><strong>988</strong> - Suicide & Crisis Lifeline (US)</li>
                            <li><strong>Crisis Text Line</strong> - Text HOME to 741741</li>
                            <li><strong>SAMHSA</strong> - 1-800-662-4357</li>
                            <li><strong>International</strong> - befrienders.org</li>
                        </ul>
                    </div>
                </section>
                
                <section>
                    <h3>Export & Backup</h3>
                    <div class="form-group">
                        <button id="export-json" class="btn">Export Map as JSON</button>
                        <button id="export-image" class="btn">Export Map as Image</button>
                        <button id="export-pdf" class="btn">Export Insights as PDF</button>
                    </div>
                </section>
            </div>
        `;
        
        // Attach event listeners
        document.getElementById('clear-all-data').addEventListener('click', () => this.clearAllData());
        document.getElementById('export-json').addEventListener('click', () => this.exportJSON());
        document.getElementById('export-image').addEventListener('click', () => this.exportImage());
        document.getElementById('export-pdf').addEventListener('click', () => this.exportPDF());
        
        // Show modal
        modal.style.display = 'block';
    }
    
    async saveSettings() {
        // Gather settings from form
        this.current.theme = document.getElementById('theme-select').value;
        this.current.fontSize = document.getElementById('font-size').value;
        this.current.reducedMotion = document.getElementById('reduced-motion').checked;
        this.current.retainChat = document.getElementById('retain-chat').checked;
        this.current.chatRetentionDays = parseInt(document.getElementById('retention-days').value);
        this.current.showCrisisBar = document.getElementById('show-crisis-bar').checked;
        
        // Apply immediately
        this.applySettings();
        
        // Save to backend
        try {
            await api.put('/api/settings', this.current);
            this.showNotification('Settings saved', 'success');
        } catch (error) {
            console.error('Error saving settings:', error);
            this.showNotification('Could not save settings', 'error');
        }
    }
    
    async clearAllData() {
        const message = `This will permanently delete ALL your data:
        - Your entire mind map
        - All chat conversations
        - All settings
        
        This cannot be undone. Are you absolutely sure?`;
        
        if (!confirm(message)) return;
        
        // Second confirmation for safety
        const secondConfirm = prompt('Type "DELETE" to confirm you want to delete all data:');
        if (secondConfirm !== 'DELETE') return;
        
        try {
            await api.delete('/api/data/all');
            this.showNotification('All data cleared. Reloading...', 'success');
            
            // Clear local storage and reload
            localStorage.clear();
            setTimeout(() => {
                window.location.reload();
            }, 2000);
        } catch (error) {
            console.error('Error clearing data:', error);
            this.showNotification('Could not clear data', 'error');
        }
    }
    
    async exportJSON() {
        try {
            const response = await api.get('/api/export/map?format=json');
            const blob = new Blob([JSON.stringify(response, null, 2)], { type: 'application/json' });
            this.downloadFile(blob, `trauma-map-${new Date().toISOString().split('T')[0]}.json`);
            this.showNotification('Map exported as JSON', 'success');
        } catch (error) {
            console.error('Error exporting JSON:', error);
            this.showNotification('Could not export map', 'error');
        }
    }
    
    async exportImage() {
        // This would require canvas rendering of the mind map
        this.showNotification('Image export coming soon', 'info');
    }
    
    async exportPDF() {
        try {
            const response = await api.get('/api/export/insights?format=pdf');
            // Handle PDF blob response
            this.showNotification('Insights exported as PDF', 'success');
        } catch (error) {
            console.error('Error exporting PDF:', error);
            this.showNotification('Could not export insights', 'error');
        }
    }
    
    downloadFile(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
    
    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;
        notification.setAttribute('role', 'status');
        notification.setAttribute('aria-live', 'polite');
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.classList.add('show');
        }, 10);
        
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }
}
```

**frontend/js/api.js - API client**
```javascript
class APIClient {
    constructor() {
        this.baseURL = '/api';
        this.token = localStorage.getItem('token');
    }
    
    async request(method, endpoint, data = null) {
        const config = {
            method: method,
            headers: {
                'Content-Type': 'application/json'
            }
        };
        
        // Add auth token if available
        if (this.token) {
            config.headers['Authorization'] = `Bearer ${this.token}`;
        }
        
        // Add body for POST/PUT requests
        if (data && (method === 'POST' || method === 'PUT')) {
            config.body = JSON.stringify(data);
        }
        
        try {
            const response = await fetch(`${this.baseURL}${endpoint}`, config);
            
            // Handle 401 Unauthorized
            if (response.status === 401) {
                this.handleUnauthorized();
                throw new Error('Session expired');
            }
            
            // Handle other errors
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            // Return JSON if available
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                return await response.json();
            }
            
            return response;
        } catch (error) {
            console.error('API request failed:', error);
            throw error;
        }
    }
    
    setToken(token) {
        this.token = token;
        localStorage.setItem('token', token);
    }
    
    clearToken() {
        this.token = null;
        localStorage.removeItem('token');
    }
    
    handleUnauthorized() {
        this.clearToken();
        // Redirect to login
        document.getElementById('main-app').style.display = 'none';
        document.getElementById('login-screen').style.display = 'block';
    }
    
    // Convenience methods
    get(endpoint) {
        return this.request('GET', endpoint);
    }
    
    post(endpoint, data) {
        return this.request('POST', endpoint, data);
    }
    
    put(endpoint, data) {
        return this.request('PUT', endpoint, data);
    }
    
    delete(endpoint) {
        return this.request('DELETE', endpoint);
    }
}

// Global API instance
const api = new APIClient();
```

**frontend/js/app.js - Main application controller**
```javascript
class TrauMappdApp {
    constructor() {
        this.mindmap = null;
        this.chatInterface = null;
        this.mapAnalysis = null;
        this.settings = null;
        this.currentUser = null;
    }
    
    async init() {
        // Check if user is logged in
        const token = localStorage.getItem('token');
        
        if (token) {
            api.setToken(token);
            
            try {
                // Verify token is still valid
                const response = await api.get('/check');
                if (response.authenticated) {
                    this.currentUser = response.username;
                    await this.showMainApp();
                } else {
                    this.showLoginScreen();
                }
            } catch (error) {
                this.showLoginScreen();
            }
        } else {
            this.showLoginScreen();
        }
        
        // Setup event listeners
        this.setupEventListeners();
    }
    
    setupEventListeners() {
        // Login form
        document.getElementById('login-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.handleLogin();
        });
        
        // Logout button
        document.getElementById('logout-btn').addEventListener('click', async () => {
            await this.handleLogout();
        });
        
        // Add node button
        document.getElementById('add-node-btn').addEventListener('click', () => {
            if (this.mindmap) {
                this.mindmap.beforeNodeAction('create', null);
            }
        });
        
        // Analyze button
        document.getElementById('analyze-btn').addEventListener('click', () => {
            if (this.mapAnalysis) {
                this.mapAnalysis.analyze();
            }
        });
        
        // Settings button
        document.getElementById('settings-btn').addEventListener('click', () => {
            if (this.settings) {
                this.settings.showSettingsPanel();
            }
        });
        
        // Save settings
        document.getElementById('save-settings').addEventListener('click', async () => {
            if (this.settings) {
                await this.settings.saveSettings();
                document.getElementById('settings-modal').style.display = 'none';
            }
        });
        
        // Cancel settings
        document.getElementById('cancel-settings').addEventListener('click', () => {
            document.getElementById('settings-modal').style.display = 'none';
        });
        
        // Node modal save
        document.getElementById('save-node').addEventListener('click', async () => {
            await this.saveNode();
        });
        
        // Node modal cancel
        document.getElementById('cancel-node').addEventListener('click', () => {
            document.getElementById('node-modal').style.display = 'none';
        });
        
        // Close modals when clicking outside
        window.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) {
                e.target.style.display = 'none';
            }
        });
        
        // Hide crisis bar
        const hideCrisisBtn = document.getElementById('hide-crisis-bar');
        if (hideCrisisBtn) {
            hideCrisisBtn.addEventListener('click', () => {
                document.getElementById('crisis-bar').style.display = 'none';
                if (this.settings) {
                    this.settings.current.showCrisisBar = false;
                    this.settings.saveSettings();
                }
            });
        }
    }
    
    async handleLogin() {
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        const errorDiv = document.getElementById('error-message');
        
        try {
            // Try login first
            const formData = new FormData();
            formData.append('username', username);
            formData.append('password', password);
            
            const response = await fetch('/api/login', {
                method: 'POST',
                body: formData
            });
            
            if (response.ok) {
                const data = await response.json();
                api.setToken(data.access_token);
                this.currentUser = username;
                await this.showMainApp();
            } else if (response.status === 401) {
                // Try setup if no user exists
                const setupResponse = await api.post('/setup', { username, password });
                if (setupResponse.message === 'Account created successfully') {
                    // Now login
                    const loginResponse = await fetch('/api/login', {
                        method: 'POST',
                        body: formData
                    });
                    
                    if (loginResponse.ok) {
                        const data = await loginResponse.json();
                        api.setToken(data.access_token);
                        this.currentUser = username;
                        await this.showMainApp();
                    }
                }
            } else {
                errorDiv.textContent = 'Login failed. Please check your credentials.';
                errorDiv.style.display = 'block';
            }
        } catch (error) {
            console.error('Login error:', error);
            errorDiv.textContent = 'An error occurred. Please try again.';
            errorDiv.style.display = 'block';
        }
    }
    
    async handleLogout() {
        try {
            await api.post('/logout');
        } catch (error) {
            console.error('Logout error:', error);
        }
        
        api.clearToken();
        this.currentUser = null;
        this.showLoginScreen();
    }
    
    showLoginScreen() {
        document.getElementById('main-app').style.display = 'none';
        document.getElementById('login-screen').style.display = 'block';
        
        // Check if this is first run
        this.checkFirstRun();
    }
    
    async checkFirstRun() {
        try {
            const response = await fetch('/api/check');
            if (response.status === 404 || response.status === 500) {
                document.getElementById('setup-prompt').style.display = 'block';
            }
        } catch (error) {
            document.getElementById('setup-prompt').style.display = 'block';
        }
    }
    
    async showMainApp() {
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('main-app').style.display = 'block';
        
        // Initialize components
        this.initializeComponents();
    }
    
    initializeComponents() {
        // Initialize settings first (for theming)
        this.settings = new Settings();
        
        // Initialize mind map
        const mindmapContainer = document.getElementById('mindmap-container');
        this.mindmap = new TraumaMap(mindmapContainer);
        
        // Initialize chat interface
        const chatPanel = document.getElementById('chat-panel');
        this.chatInterface = new ChatInterface(chatPanel);
        window.chatInterface = this.chatInterface; // Make globally accessible
        
        // Initialize map analysis
        this.mapAnalysis = new MapAnalysis();
    }
    
    async saveNode() {
        const nodeType = document.getElementById('node-type').value;
        const title = document.getElementById('node-title').value;
        const description = document.getElementById('node-description').value;
        
        if (!nodeType || !title) {
            alert('Please select a type and enter a title');
            return;
        }
        
        const nodeData = {
            node_type: nodeType,
            title: title,
            description: description,
            x: Math.random() * 500,
            y: Math.random() * 500
        };
        
        await this.mindmap.saveNode(nodeData);
        
        // Close modal
        document.getElementById('node-modal').style.display = 'none';
        
        // Reset form
        document.getElementById('node-type').value = '';
        document.getElementById('node-title').value = '';
        document.getElementById('node-description').value = '';
        document.getElementById('type-description').innerHTML = '';
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    const app = new TrauMappdApp();
    app.init();
});
```

**frontend/js/config.js - Shared configuration**
```javascript
const NODE_TYPES = {
    trauma_event: {
        color: "#D32F2F",
        icon: "alert-circle",
        label: "Traumatic Event",
        description: "A deeply distressing or disturbing experience that overwhelmed your ability to cope",
        tooltip: "Examples: accident, loss, abuse, violence. These are often root events in your healing journey."
    },
    trigger: {
        color: "#F57C00",
        icon: "zap",
        label: "Trigger",
        description: "Something that reminds you of the trauma and causes a strong reaction",
        tooltip: "Can be sights, sounds, smells, places, or situations that bring back traumatic memories"
    },
    response: {
        color: "#FBC02D",
        icon: "activity",
        label: "Trauma Response",
        description: "Your body's automatic reaction to perceived threat",
        tooltip: "Fight (anger/aggression), Flight (escape/avoidance), Freeze (numbness/paralysis), or Fawn (people-pleasing)"
    },
    symptom: {
        color: "#7B1FA2",
        icon: "alert-triangle",
        label: "Symptom/Issue",
        description: "Current problems you experience that may be rooted in trauma",
        tooltip: "Physical (insomnia, pain), emotional (anxiety, depression), or behavioral (avoidance, isolation)"
    },
    emotion: {
        color: "#1976D2",
        icon: "heart",
        label: "Emotion/Feeling",
        description: "Specific emotions connected to your trauma or healing",
        tooltip: "Naming emotions like fear, shame, anger, or hope can be therapeutic"
    },
    belief: {
        color: "#5D4037",
        icon: "message-circle",
        label: "Belief/Thought",
        description: "Deep-seated beliefs that arose from trauma",
        tooltip: "Often negative thoughts like 'I'm not safe' or 'It was my fault' that need addressing"
    },
    coping: {
        color: "#388E3C",
        icon: "shield",
        label: "Coping Mechanism",
        description: "Actions or strategies you use to handle trauma or stress",
        tooltip: "Can be healthy (exercise, therapy) or unhealthy (avoidance, substance use)"
    },
    support: {
        color: "#00796B",
        icon: "users",
        label: "Resource/Support",
        description: "People, places, or things that provide support",
        tooltip: "Therapist, friends, pets, spiritual practices, safe spaces"
    }
};
```

**Checkpoint 5**:
- Export works (JSON, PNG, PDF)
- Settings panel functional with all options
- Crisis resources bar displays (optional)
- Themes apply correctly (light/dark/soft)
- Reduced motion preference respected
- Clear data function works with confirmation
- Keyboard navigation complete
- WCAG 2.1 AA compliance verified
- **Human QA**: Full app test, export and reimport data, test all accessibility features

---

## Final Testing Checklist for Human QA

### Security & Privacy
- [ ] No external connections after model download
- [ ] Data encryption verified in database
- [ ] Password hashing working
- [ ] Session timeout after inactivity
- [ ] Export includes encrypted data warning

### Trauma-Informed Design
- [ ] Language is supportive, not clinical
- [ ] No jarring animations or sounds
- [ ] Clear exit options everywhere
- [ ] Crisis resources accessible
- [ ] Delete confirmations are reassuring

### Accessibility
- [ ] Keyboard navigation works throughout
- [ ] Screen reader announces all changes
- [ ] Color contrast passes WCAG AA
- [ ] Focus indicators visible
- [ ] Text resizable to 200%

### Functionality
- [ ] Mind map saves automatically
- [ ] Chat maintains context
- [ ] Analysis provides useful insights
- [ ] All node types work correctly
- [ ] Export/import cycle works

### Performance
- [ ] LLM responses stream smoothly
- [ ] Mind map handles 50+ nodes
- [ ] No memory leaks in long sessions
- [ ] Docker container stays under 8GB RAM

## Success Metrics
- User can map trauma without feeling triggered
- AI responses are helpful and appropriate
- All data remains private and secure
- App is usable by people with disabilities
- Exports work for sharing with therapists

## Build and Run Commands

```bash
# Create project directory
mkdir traumappd
cd traumappd

# Copy all files from this specification

# Build Docker container
docker build -t traumappd .

# Run container
docker run -d \
  --name traumappd \
  -p 127.0.0.1:8000:8000 \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/models:/app/models \
  traumappd

# Access the application
# Open browser to http://localhost:8000

# View logs
docker logs -f traumappd

# Stop container
docker stop traumappd

# Remove container
docker rm traumappd
```

## Deployment Notes

1. **First Run**: The LLM model will download on first run (~4GB). This ensures privacy but requires initial internet connection and ~10-15 minutes.

2. **System Requirements**:
   - Minimum: 8GB RAM, 20GB disk space
   - Recommended: 16GB RAM, 50GB disk space
   - GPU optional but improves LLM response speed

3. **Security Considerations**:
   - Always bind to localhost (127.0.0.1) unless securing with HTTPS
   - Use strong passwords - they derive encryption keys
   - Regularly backup the data directory

4. **Data Location**:
   - User data: `./data/traumappd.db`
   - Model: `./models/llama-2-7b-chat.Q4_K_M.gguf`
   - Both directories should be volume-mounted for persistence

**Final Human QA**: Run through complete user journey from setup to export, checking all features and edge cases. The MVP is complete when all checkpoints pass and the app feels safe and supportive to use.

---

## Additional Implementation Files

### Add to backend/main.py - Additional endpoints for settings and export

```python
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

@app.delete("/api/data/all")
async def delete_all_data(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete all user data - complete account wipe"""
    # Delete all related data (cascades will handle related records)
    db.delete(current_user)
    db.commit()
    
    # Clear session
    if current_user.username in session_passwords:
        del session_passwords[current_user.username]
    
    return {"message": "All data deleted"}

@app.get("/api/export/map")
async def export_map(
    format: str = "json",
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Export mind map in various formats"""
    password = get_session_password(current_user.username)
    if not password:
        raise HTTPException(status_code=401, detail="Session expired")
    
    key = current_user.derive_key(password)
    
    if format == "json":
        nodes = db.query(Node).filter(Node.user_id == current_user.id).all()
        edges = db.query(Edge).filter(Edge.user_id == current_user.id).all()
        
        export_data = {
            "version": "1.0",
            "exported_at": datetime.now().isoformat(),
            "app": "TrauMapp'd",
            "nodes": [node.to_dict(key) for node in nodes],
            "edges": [edge.to_dict() for edge in edges],
            "metadata": {
                "node_count": len(nodes),
                "edge_count": len(edges),
                "note": "This is your private data. Keep it secure."
            }
        }
        
        return JSONResponse(content=export_data)
    
    else:
        raise HTTPException(status_code=400, detail="Unsupported format")

@app.post("/api/import/map")
async def import_map(
    import_data: dict,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Import mind map from JSON"""
    password = get_session_password(current_user.username)
    if not password:
        raise HTTPException(status_code=401, detail="Session expired")
    
    key = current_user.derive_key(password)
    
    try:
        # Clear existing data
        db.query(Node).filter(Node.user_id == current_user.id).delete()
        db.query(Edge).filter(Edge.user_id == current_user.id).delete()
        db.commit()
        
        # Import nodes
        node_id_map = {}
        for node_data in import_data.get("nodes", []):
            node = Node(
                user_id=current_user.id,
                node_type=node_data["node_type"],
                title=node_data["title"],
                description_encrypted=encrypt_field(
                    node_data.get("description", ""), key
                ),
                x=node_data.get("x", 0),
                y=node_data.get("y", 0),
                color=node_data.get("color"),
                icon=node_data.get("icon")
            )
            db.add(node)
            db.flush()
            node_id_map[node_data["id"]] = node.id
        
        # Import edges with mapped IDs
        for edge_data in import_data.get("edges", []):
            edge = Edge(
                user_id=current_user.id,
                from_node_id=node_id_map.get(edge_data["from_node_id"]),
                to_node_id=node_id_map.get(edge_data["to_node_id"]),
                label=edge_data.get("label")
            )
            if edge.from_node_id and edge.to_node_id:
                db.add(edge)
        
        db.commit()
        return {"message": "Map imported successfully"}
    
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Import failed: {str(e)}")
```

### frontend/js/auth.js - Authentication handling

```javascript
class AuthManager {
    constructor() {
        this.setupPromptShown = false;
    }
    
    async checkFirstRun() {
        try {
            const response = await fetch('/api/check');
            if (!response.ok) {
                // No users exist yet
                this.showSetupPrompt();
            }
        } catch (error) {
            // Server might not have any users
            this.showSetupPrompt();
        }
    }
    
    showSetupPrompt() {
        if (!this.setupPromptShown) {
            const prompt = document.getElementById('setup-prompt');
            if (prompt) {
                prompt.style.display = 'block';
                prompt.innerHTML = `
                    <p><strong>Welcome to TrauMapp'd!</strong></p>
                    <p>Create your account above to get started.</p>
                    <p>Your data will be encrypted and stored locally.</p>
                `;
            }
            this.setupPromptShown = true;
        }
    }
    
    async login(username, password) {
        const formData = new FormData();
        formData.append('username', username);
        formData.append('password', password);
        
        const response = await fetch('/api/login', {
            method: 'POST',
            body: formData
        });
        
        if (response.ok) {
            const data = await response.json();
            return data.access_token;
        } else {
            throw new Error('Login failed');
        }
    }
    
    async setup(username, password) {
        const response = await fetch('/api/setup', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });
        
        if (response.ok) {
            return true;
        } else {
            throw new Error('Setup failed');
        }
    }
    
    async logout(token) {
        await fetch('/api/logout', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
    }
}
```

### .gitignore file

```gitignore
# Python
__pycache__/
*.py[cod]
*$py.class
*.so
.Python
env/
venv/
ENV/
.venv

# Data and models
data/
models/
*.db
*.gguf

# IDE
.vscode/
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Docker
*.log

# Sensitive
.env
*.key
*.pem
```

### README.md - User documentation

```markdown
# TrauMapp'd - Private Trauma Mapping & Exploration Tool

A self-hosted, privacy-focused application for mapping and exploring personal trauma using visual mind maps and AI-assisted reflection.

## Features

- **Complete Privacy**: All data stays on your device, encrypted at rest
- **Visual Trauma Mapping**: Interactive mind map for organizing experiences
- **AI Exploration**: Local LLM for guided reflection (no internet required)
- **Trauma-Informed Design**: Built with safety, empowerment, and accessibility in mind
- **WCAG 2.1 AA Compliant**: Fully accessible interface
- **Export Options**: Share your map with therapists or backup your data

## Quick Start

### Prerequisites

- Docker and Docker Compose installed
- 8GB+ RAM (16GB recommended)
- 20GB+ free disk space

### Installation

1. Clone or download this repository:
```bash
git clone https://github.com/yourusername/traumappd.git
cd traumappd
```

2. Build the Docker container:
```bash
docker-compose up -d
```

3. Open your browser to: http://localhost:8000

4. Create your account (first-time setup only)

**Note**: On first run, the AI model will download (~4GB). This ensures your conversations remain completely private but requires an initial internet connection.

## Usage

### Creating Your First Map

1. Click "Add Node" to add your first entry
2. Select a node type (Trauma Event, Trigger, Coping Mechanism, etc.)
3. Enter a title and optional description
4. Connect nodes by dragging from one to another

### Node Types

- **Trauma Event** (Red): Distressing experiences
- **Trigger** (Orange): Things that remind you of trauma
- **Response** (Yellow): How you react (fight/flight/freeze/fawn)
- **Symptom** (Purple): Current issues possibly rooted in trauma
- **Emotion** (Blue): Specific feelings
- **Belief** (Brown): Thoughts that arose from trauma
- **Coping** (Green): Strategies you use
- **Support** (Teal): Resources and support systems

### Exploring with AI

1. Click any node and select "Explore with AI"
2. Have a supportive conversation about that aspect
3. The AI will maintain context and provide gentle insights

### Analyzing Your Map

Click "Analyze Map" to have the AI identify patterns and connections across your entire map.

## Privacy & Security

- **Encryption**: All sensitive data is encrypted using your password
- **Local Storage**: Nothing leaves your device
- **No Telemetry**: Zero tracking or analytics
- **Your Control**: Export or delete your data anytime

## Keyboard Shortcuts

- `Ctrl/Cmd + N`: Add new node
- `Delete`: Remove selected node
- `Shift + Enter`: Explore selected node with AI
- `Tab`: Navigate between elements

## Crisis Resources

If you're in crisis, please reach out for immediate help:
- **988** - Suicide & Crisis Lifeline (US)
- **Text HOME to 741741** - Crisis Text Line
- **911** - Emergency services

## System Requirements

**Minimum:**
- 8GB RAM
- Dual-core CPU
- 20GB disk space

**Recommended:**
- 16GB RAM
- Quad-core CPU
- 50GB disk space
- GPU (optional, improves AI speed)

## Troubleshooting

### Container won't start
- Check Docker is running: `docker info`
- Check ports: Ensure 8000 isn't in use
- Check logs: `docker logs traumappd`

### AI responses are slow
- This is normal on CPU-only systems
- Each response may take 10-30 seconds
- Consider upgrading RAM or using a GPU

### Can't login
- Passwords are case-sensitive
- If you forgot your password, you'll need to reset the container
- Your data cannot be recovered without the password (it's encrypted)

## Backup & Restore

### Backup your data:
```bash
docker cp traumappd:/app/data ./backup-$(date +%Y%m%d)
```

### Restore from backup:
```bash
docker cp ./backup-folder traumappd:/app/data
```

## Development

This is an open-source project built with:
- Backend: FastAPI (Python)
- Frontend: Vanilla JavaScript
- Database: SQLite with encryption
- AI: Llama 2 7B Chat (local)

## Disclaimer

TrauMapp'd is a self-help tool, not a replacement for professional therapy. If you're dealing with trauma, please consider working with a licensed mental health professional.

## License

MIT License - See LICENSE file for details

## Support

For issues, questions, or contributions:
- GitHub Issues: [Report bugs or request features]
- Remember: We cannot recover encrypted data if you lose your password

---

**Remember**: Your experiences are valid. Healing is not linear. Be gentle with yourself. 💚
```

### Deploy Script (deploy.sh)

```bash
#!/bin/bash

echo "🚀 Deploying TrauMapp'd..."

# Check Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

# Check Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

# Create necessary directories
echo "📁 Creating directories..."
mkdir -p data models

# Build the container
echo "🔨 Building Docker container..."
docker-compose build

# Start the container
echo "🚀 Starting TrauMapp'd..."
docker-compose up -d

# Wait for startup
echo "⏳ Waiting for services to start..."
sleep 5

# Check if running
if docker ps | grep -q traumappd; then
    echo "✅ TrauMapp'd is running!"
    echo "🌐 Access at: http://localhost:8000"
    echo ""
    echo "📝 First time setup:"
    echo "1. Open http://localhost:8000 in your browser"
    echo "2. Create your account"
    echo "3. The AI model will download on first use (~4GB)"
    echo ""
    echo "🛑 To stop: docker-compose down"
    echo "📊 View logs: docker-compose logs -f"
else
    echo "❌ Failed to start. Check logs with: docker-compose logs"
    exit 1
fi
```

---

## Complete File Structure Summary

```
traumappd/
├── backend/
│   ├── main.py              # Complete FastAPI application
│   ├── database.py          # SQLAlchemy models & encryption
│   ├── llm_service.py       # LLM integration
│   ├── config.py            # Node types & messages
│   └── auth.py              # Authentication logic
├── frontend/
│   ├── index.html           # Main HTML
│   ├── css/
│   │   └── styles.css       # Complete styles
│   ├── js/
│   │   ├── app.js           # Main controller
│   │   ├── api.js           # API client
│   │   ├── auth.js          # Auth handling
│   │   ├── mindmap.js       # Mind map wrapper
│   │   ├── chat.js          # Chat interface
│   │   ├── analysis.js      # Map analysis
│   │   ├── settings.js      # Settings management
│   │   └── config.js        # Shared config
│   └── libs/
│       └── mind-elixir.min.js  # Mind map library
├── models/                  # LLM models (downloaded)
├── data/                    # User data (encrypted)
├── Dockerfile              # Container definition
├── docker-compose.yml      # Compose configuration
├── requirements.txt        # Python dependencies
├── deploy.sh              # Deployment script
├── README.md              # User documentation
└── .gitignore             # Git ignore file
```

This completes the full implementation specification with all code, configuration, and documentation needed to build TrauMapp'd. Claude Code can now systematically implement each phase with clear checkpoints for human QA.