"""Tests for production-safety validation in env_config."""
import pytest

from backend.env_config import DEFAULT_JWT_SECRET, Config


def _config(**overrides):
    c = Config()
    for k, v in overrides.items():
        setattr(c, k, v)
    return c


def test_production_rejects_default_secret():
    c = _config(APP_ENV="production", JWT_SECRET_KEY=DEFAULT_JWT_SECRET, AUTO_CREATE_TEST_USER=False)
    with pytest.raises(RuntimeError):
        c.validate()


def test_production_rejects_empty_secret():
    c = _config(APP_ENV="production", JWT_SECRET_KEY="", AUTO_CREATE_TEST_USER=False)
    with pytest.raises(RuntimeError):
        c.validate()


def test_production_rejects_auto_test_user():
    c = _config(APP_ENV="production", JWT_SECRET_KEY="a-strong-unique-secret", AUTO_CREATE_TEST_USER=True)
    with pytest.raises(RuntimeError):
        c.validate()


def test_production_ok_with_strong_secret():
    c = _config(APP_ENV="production", JWT_SECRET_KEY="a-strong-unique-secret", AUTO_CREATE_TEST_USER=False)
    c.validate()  # should not raise


def test_development_warns_with_default_secret():
    c = _config(APP_ENV="development", JWT_SECRET_KEY=DEFAULT_JWT_SECRET)
    with pytest.warns(UserWarning):
        c.validate()
