# TrauMapp'd - Private Trauma Mapping Tool

A self-hosted, privacy-first application for mapping trauma experiences through interactive mind maps.

## Features

- **Interactive Mind Map**: Organize experiences with 8 node types (Event, Emotion, Person, Place, Trigger, Coping, Insight, Growth)
- **Map Analysis**: Local-only pattern analysis — node counts, isolated nodes, trigger-to-coping ratio
- **Export**: Download your map as JSON or formatted text
- **Encrypted at Rest**: Node descriptions encrypted with Fernet (AES) using a key derived from your password
- **Trauma-Informed Design**: Soft colors, gentle language, predictable UI, keyboard navigable, WCAG 2.1 AA
- **Three Themes**: Light, Dark, and Soft (low contrast)

## Quick Start

### Docker

```bash
cp .env.example .env       # then set JWT_SECRET_KEY (see the file for how to generate one)
docker-compose up -d
# Open http://localhost:8080
```

### Direct (no Docker)

```bash
# Use a virtual environment + the lockfile for a reproducible install
python -m venv .venv
# Windows: .venv\Scripts\activate    |    macOS/Linux: source .venv/bin/activate
pip install -r requirements.lock
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
# Open http://localhost:8000
```

> `requirements.lock` pins exact, tested versions (including transitive deps) so the
> app builds the same everywhere. `requirements.txt` lists the top-level deps you edit.

On first visit, enter a username and password to create your account. Your password encrypts all sensitive data — there is no recovery if you forget it.

### Test Credentials

If `AUTO_CREATE_TEST_USER=true` in `.env` (the default):
- Username: `TestUser`
- Password: `SecureTest2025!`

## Running Tests

```bash
# Backend API tests (pytest)
python -m pytest tests/ -v

# Frontend unit tests (Vitest)
npx vitest run

# End-to-end browser tests (Playwright)
npx playwright test
```

## Architecture

```
Frontend (vanilla JS, ES modules)     Backend (FastAPI, Python 3.11)
  app.js  ── orchestrator              main.py  ── all API endpoints
  api.js  ── fetch + Bearer auth       database.py ── SQLAlchemy + encryption
  mindmap.js ── MindElixir wrapper     config.py ── node type definitions
  analyze.js ── local map analysis
  export.js  ── JSON/text export
  config.js  ── node types (synced with backend)
  utils.js   ── pure functions (tested)
```

All frontend JS uses ES module `import`/`export`. No build step. MindElixir.js is vendored in `frontend/libs/`.

## Keyboard Shortcuts

- `Ctrl+N` — New node
- `Delete` — Remove selected node
- `Tab` — Navigate between nodes
- `Escape` — Close modals

## Privacy & Security

- All data stored locally in SQLite
- Sensitive fields (descriptions) encrypted with Fernet using PBKDF2-derived keys
- No external API calls, no telemetry
- Passwords hashed with Argon2

## Crisis Resources

If you're in crisis, please reach out:
- **988** — Suicide & Crisis Lifeline (US)
- **Text HOME to 741741** — Crisis Text Line
- **911** — Emergency services

## Disclaimer

TrauMapp'd is a self-help tool, not a replacement for professional therapy.
