import base64
import os
from datetime import datetime

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from passlib.context import CryptContext
from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, LargeBinary, String, create_engine, inspect, text
from sqlalchemy.orm import declarative_base, relationship, sessionmaker

pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")
Base = declarative_base()

# Key-derivation cost. New accounts use the OWASP-recommended PBKDF2-SHA256 count;
# existing accounts keep their stored (per-user) value so their data still decrypts.
DEFAULT_KDF_ITERATIONS = 600000

# DB location is configurable so a container host can point it at a mounted volume.
# Defaults to the gitignored ./data dir (relative to CWD) for local dev and tests.
DB_PATH = os.getenv("DATABASE_PATH", "./data/traumappd.db")
os.makedirs(os.path.dirname(DB_PATH) or ".", exist_ok=True)
DATABASE_URL = f"sqlite:///{DB_PATH}"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, nullable=False, index=True)
    password_hash = Column(String, nullable=False)
    encryption_salt = Column(LargeBinary, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    settings = Column(String, default='{}')
    kdf_iterations = Column(Integer, nullable=False, default=DEFAULT_KDF_ITERATIONS)

    nodes = relationship("Node", back_populates="user", cascade="all, delete-orphan")
    edges = relationship("Edge", back_populates="user", cascade="all, delete-orphan")

    def verify_password(self, password: str) -> bool:
        return pwd_context.verify(password, self.password_hash)

    def derive_key(self, password: str) -> bytes:
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=self.encryption_salt,
            iterations=self.kdf_iterations or 100000,
        )
        return base64.urlsafe_b64encode(kdf.derive(password.encode()))


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
    parent_id = Column(Integer, ForeignKey("nodes.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="nodes")
    from_edges = relationship("Edge", foreign_keys="Edge.from_node_id", cascade="all, delete-orphan")
    to_edges = relationship("Edge", foreign_keys="Edge.to_node_id", cascade="all, delete-orphan")

    def to_dict(self, key: bytes = None):
        data = {
            "id": self.id,
            "node_type": self.node_type,
            "title": self.title,
            "x": self.x,
            "y": self.y,
            "color": self.color,
            "icon": self.icon,
            "parent_id": self.parent_id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None
        }
        if key and self.description_encrypted:
            try:
                data["description"] = Fernet(key).decrypt(self.description_encrypted).decode()
            except Exception:
                data["description"] = ""
        else:
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

    user = relationship("User", back_populates="edges")
    from_node = relationship("Node", foreign_keys=[from_node_id], overlaps="from_edges")
    to_node = relationship("Node", foreign_keys=[to_node_id], overlaps="to_edges")

    def to_dict(self):
        return {
            "id": self.id,
            "from_node_id": self.from_node_id,
            "to_node_id": self.to_node_id,
            "label": self.label,
            "created_at": self.created_at.isoformat() if self.created_at else None
        }


def encrypt_field(data: str, key: bytes) -> bytes:
    return Fernet(key).encrypt(data.encode())


def decrypt_field(encrypted_data: bytes, key: bytes) -> str:
    return Fernet(key).decrypt(encrypted_data).decode()


def run_lightweight_migrations():
    """Add columns introduced after the initial release to existing SQLite tables.

    The app uses Base.metadata.create_all (no migration framework), which does not
    ALTER existing tables. This adds new nullable columns idempotently so existing
    databases pick up schema additions without data loss.
    """
    def add_column_if_missing(table, column, ddl):
        insp = inspect(engine)
        if table not in insp.get_table_names():
            return
        if column in {c["name"] for c in insp.get_columns(table)}:
            return
        with engine.begin() as conn:
            conn.execute(text(ddl))

    add_column_if_missing("nodes", "parent_id", "ALTER TABLE nodes ADD COLUMN parent_id INTEGER")
    # Existing accounts used PBKDF2 @ 100k; preserve that so their encrypted data still decrypts.
    add_column_if_missing(
        "users", "kdf_iterations",
        "ALTER TABLE users ADD COLUMN kdf_iterations INTEGER NOT NULL DEFAULT 100000"
    )
