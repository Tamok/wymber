"""
Environment configuration for Wymber
Handles loading of environment variables and configuration settings
"""
import os
import warnings

from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# The shipped development default. Must NEVER be used to sign tokens in production.
DEFAULT_JWT_SECRET = 'dev-secret-key-change-in-production'


class Config:
    """Application configuration from environment variables"""

    # Environment: 'development' (default) or 'production'
    APP_ENV: str = os.getenv('APP_ENV', 'development')

    # Test User Credentials
    TEST_USERNAME: str = os.getenv('TEST_USERNAME', 'TestUser')
    TEST_PASSWORD: str = os.getenv('TEST_PASSWORD', 'SecureTest2025!')

    # Database
    DATABASE_PATH: str = os.getenv('DATABASE_PATH', '/app/data/traumappd.db')

    # Security
    JWT_SECRET_KEY: str = os.getenv('JWT_SECRET_KEY', DEFAULT_JWT_SECRET)
    JWT_EXPIRES_HOURS: int = int(os.getenv('JWT_EXPIRES_HOURS', '24'))

    # Development
    DEBUG: bool = os.getenv('DEBUG', 'false').lower() == 'true'
    AUTO_CREATE_TEST_USER: bool = os.getenv('AUTO_CREATE_TEST_USER', 'true').lower() == 'true'

    # App settings
    APP_NAME: str = "Wymber"
    APP_VERSION: str = "2.0.0"

    @property
    def IS_PRODUCTION(self) -> bool:
        return self.APP_ENV.strip().lower() in ('production', 'prod')

    def validate(self) -> None:
        """Fail fast on insecure production config; warn (don't fail) in development."""
        using_default_secret = (not self.JWT_SECRET_KEY) or (self.JWT_SECRET_KEY == DEFAULT_JWT_SECRET)
        if self.IS_PRODUCTION:
            if using_default_secret:
                raise RuntimeError(
                    "JWT_SECRET_KEY must be set to a strong, unique value when APP_ENV=production. "
                    "Generate one with: python -c \"import secrets; print(secrets.token_urlsafe(64))\""
                )
            if self.AUTO_CREATE_TEST_USER:
                raise RuntimeError(
                    "AUTO_CREATE_TEST_USER must be false when APP_ENV=production "
                    "(it creates a known-credential account)."
                )
        elif using_default_secret:
            warnings.warn(
                "Using the default development JWT secret. Set JWT_SECRET_KEY and "
                "APP_ENV=production before deploying.",
                stacklevel=2,
            )


# Global config instance
config = Config()
