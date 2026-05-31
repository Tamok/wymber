# Wymber - Development Instructions

## Project Overview

**Wymber** is a privacy-first trauma mapping tool that helps users visualize trauma experiences through an interactive mind map. All data is encrypted at rest and processed locally.

### Core Principles

- **Privacy First**: All data local, encrypted at rest, no telemetry
- **Trauma-Informed Design**: Safe, predictable, empowering, non-triggering
- **Accessibility**: WCAG 2.1 AA, keyboard navigable, screen reader friendly
- **Gentle Language**: Supportive, validating tone — never clinical or judgmental

## Technical Stack

**Backend**: FastAPI + SQLAlchemy + SQLite + Argon2 + Fernet encryption + JWT auth
**Frontend**: Vanilla JS (ES modules) + MindElixir.js + CSS custom properties for theming
**Testing**: pytest (backend), Vitest + jsdom (frontend unit), Playwright (E2E)
**Deployment**: Docker (single container)

## Architecture

```
backend/
  main.py          # FastAPI app, routes, auth, Pydantic models
  database.py      # SQLAlchemy models (User, Node, Edge), encryption helpers
  config.py        # NODE_TYPES (8 trauma node types), MESSAGES
  env_config.py    # Environment configuration with defaults

frontend/
  index.html       # Single-page app shell
  css/styles.css   # Theming (light/dark/soft), trauma-informed styling
  js/
    app.js         # Entry point (ES module), wires everything together
    api.js         # APIClient class — all fetch calls to backend
    auth.js        # AuthManager class — login/setup/logout
    mindmap.js     # TrauMindMap class — MindElixir wrapper, sync, connections
    config.js      # NODE_TYPES and MESSAGES (shared with backend)
    utils.js       # Pure functions: extractNodeId, convertToMindElixirFormat, validateNodeData
    analyze.js     # Local-only map analysis (counts, patterns, ratios)
    export.js      # Export as JSON or formatted text
  libs/
    mind-elixir.min.js  # Vendored UMD library

tests/             # pytest backend tests
frontend/tests/    # Vitest frontend unit tests
e2e/               # Playwright E2E tests
```

## Key Commands

```bash
# Backend
pip install -r requirements.txt
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8089

# Backend tests
python -m pytest tests/ -v

# Frontend unit tests
npx vitest run

# E2E tests (backend must be running on port 8089)
npx playwright test

# Docker
docker-compose up --build
```

## Security Model

1. **Passwords**: Argon2 hashed, never stored in plaintext
2. **Encryption**: Fernet (AES-128) with PBKDF2 key derived from user password
3. **Session keys**: Derived Fernet key stored in memory (not the password)
4. **JWT**: HS256 tokens with configurable expiration
5. **Input validation**: Pydantic validators on all user input

## Node Types

Eight trauma-informed node types defined in `backend/config.py` and `frontend/js/config.js`:
`trauma_event`, `emotion`, `body_sensation`, `belief`, `trigger`, `coping`, `resource`, `insight`

Each has a color, icon, label, and placeholder text.

## Frontend Patterns

- **ES modules**: All JS uses `import`/`export`, loaded via `<script type="module">`
- **No globals**: Dependencies injected via constructors or function parameters
- **MindElixir**: UMD library loaded as regular `<script>`, accessed as `window.MindElixir`
- **Theming**: `data-theme` and `data-font-size` attributes on `<html>`, CSS custom properties

## Testing Patterns

- **Backend**: In-memory SQLite per test, `TestClient` fixture, `auth_client` fixture for authenticated requests
- **Frontend unit**: jsdom environment, mock `fetch` with `vi.fn()`
- **E2E**: Playwright against running backend on port 8089, test user auto-created via env config

## Sensitivity Reminder

This application is used by people in vulnerable states dealing with trauma. Every implementation decision should prioritize safety, privacy, and emotional wellbeing. Use gentle language in UI text and error messages.
