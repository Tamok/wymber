import os

from backend.database import DEFAULT_KDF_ITERATIONS, User, decrypt_field, encrypt_field


def _user(iterations):
    return User(
        username="u",
        password_hash="h",
        encryption_salt=os.urandom(32),
        kdf_iterations=iterations,
    )


def test_default_kdf_is_owasp_hardened():
    # OWASP recommends >= 600k iterations for PBKDF2-HMAC-SHA256.
    assert DEFAULT_KDF_ITERATIONS >= 600000


def test_derive_key_is_deterministic():
    u = _user(100000)
    assert u.derive_key("pw") == u.derive_key("pw")


def test_derive_key_depends_on_iteration_count():
    salt = os.urandom(32)
    weak = User(username="u", password_hash="h", encryption_salt=salt, kdf_iterations=100000)
    strong = User(username="u", password_hash="h", encryption_salt=salt, kdf_iterations=600000)
    # Iteration count is part of the derivation, so the keys differ.
    assert weak.derive_key("pw") != strong.derive_key("pw")


def test_fernet_roundtrip_for_both_kdf_levels():
    # Backward compatibility: data encrypted under either cost decrypts with the matching key.
    for iterations in (100000, 600000):
        u = _user(iterations)
        key = u.derive_key("secret-pw")
        assert decrypt_field(encrypt_field("hello", key), key) == "hello"
