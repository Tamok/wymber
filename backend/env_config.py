"""
Environment configuration for TrauMapp'd
Handles loading of environment variables and configuration settings
"""
import os
from typing import Optional
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

class Config:
    """Application configuration from environment variables"""
    
    # Test User Credentials
    TEST_USERNAME: str = os.getenv('TEST_USERNAME', 'TestUser')
    TEST_PASSWORD: str = os.getenv('TEST_PASSWORD', 'SecureTest2025!')
    
    # Database
    DATABASE_PATH: str = os.getenv('DATABASE_PATH', '/app/data/traumappd.db')
    
    # Security
    JWT_SECRET_KEY: str = os.getenv('JWT_SECRET_KEY', 'dev-secret-key-change-in-production')
    JWT_EXPIRES_HOURS: int = int(os.getenv('JWT_EXPIRES_HOURS', '24'))
    
    # Development
    DEBUG: bool = os.getenv('DEBUG', 'false').lower() == 'true'
    AUTO_CREATE_TEST_USER: bool = os.getenv('AUTO_CREATE_TEST_USER', 'true').lower() == 'true'
    
    # App settings
    APP_NAME: str = "TrauMapp'd"
    APP_VERSION: str = "2.0.0"

# Global config instance
config = Config()