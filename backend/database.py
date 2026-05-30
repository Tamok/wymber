from sqlalchemy import create_engine, Column, Integer, String, DateTime, LargeBinary, Float, ForeignKey
from sqlalchemy.orm import declarative_base
from sqlalchemy.orm import relationship, sessionmaker
from passlib.context import CryptContext
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
import base64
from datetime import datetime

pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")
Base = declarative_base()

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
    settings = Column(String, default='{}')

    nodes = relationship("Node", back_populates="user", cascade="all, delete-orphan")
    edges = relationship("Edge", back_populates="user", cascade="all, delete-orphan")

    def verify_password(self, password: str) -> bool:
        return pwd_context.verify(password, self.password_hash)

    def derive_key(self, password: str) -> bytes:
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=self.encryption_salt,
            iterations=100000,
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
