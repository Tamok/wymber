# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Summary

Wymber is a privacy-first, self-hosted trauma mapping tool. Users visualize trauma experiences as an interactive mind map. All data stays local and encrypted. The app follows trauma-informed design principles: gentle language, soft colors, predictable UI, no jarring animations.

## Build & Run Commands

```bash
# Docker
docker-compose up -d          # Start (serves on localhost:8080)

# Direct development (no Docker) — use a venv + the lockfile (reproducible)
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.lock
.venv\Scripts\python.exe -m uvicorn backend.main:app --host 0.0.0.0 --port 8000

# Tests
python -m pytest tests/ -v              # Backend (23 tests)
npx vitest run                          # Frontend unit (29 tests)
npx playwright test                     # E2E browser (15 tests, uses port 8089)

# Single test
python -m pytest tests/test_nodes.py::test_create_node -v   # one backend test
npx vitest run frontend/tests/utils.test.js                 # one frontend file
npx playwright test e2e/auth.spec.js                        # one E2E file

# Access: http://localhost:8080 (Docker) or http://localhost:8000 (direct)
# API docs: http://localhost:8000/docs
```

Run all commands from the repo root (see Gotchas — the DB path is relative).

## Architecture

**Backend**: FastAPI (Python 3.11) + SQLAlchemy + SQLite. `backend/main.py` has all endpoints. `backend/database.py` has ORM models with Fernet encryption.

**Frontend**: Vanilla JS with ES modules (no build step). Served as static files by FastAPI. MindElixir.js vendored in `frontend/libs/`. Entry point: `frontend/js/app.js` imports all other modules.

**Data flow**: `app.js` orchestrates → `api.js` (fetch + Bearer token) → FastAPI REST → SQLAlchemy → SQLite with encrypted description fields.

**Security**: Argon2 password hashing → JWT (HS256). On login, a Fernet key is derived from the password (PBKDF2, 100k iterations) and stored in `session_keys` dict — the plaintext password is never stored. Node descriptions are encrypted at rest.

## Key Files

- `frontend/js/utils.js` — Pure utility functions (extractNodeId, convertToMindElixirFormat, validateNodeData). Tested by Vitest.
- `frontend/js/analyze.js` — Local-only map analysis (node counts, isolated nodes, trigger-to-coping ratio)
- `frontend/js/export.js` — Export as JSON or text
- `frontend/js/mindmap.js` — MindElixir wrapper with working sync, connections, toolbar
- `backend/config.py` + `frontend/js/config.js` — `NODE_TYPES` and `MESSAGES` (must stay in sync between the two files)
- `backend/env_config.py` — Reads env vars / `.env` (test user, JWT secret, expiry, DEBUG)

The 8 node types are: `event`, `emotion`, `person`, `place`, `trigger`, `coping`, `insight`, `growth`. (Note: `.github/instructions/copilot.instructions.md` lists outdated/wrong slugs like `trauma_event`/`body_sensation` — trust `config.py`, not that file.)

## API Endpoints

- `POST /api/setup` — Create first user
- `POST /api/login` — Returns JWT (form-encoded body)
- `GET /api/mindmap` — All nodes and edges for authenticated user
- `POST|PUT|DELETE /api/node[/{id}]` — Node CRUD (title max 200 chars, description max 5000)
- `POST|DELETE /api/edge[/{id}]` — Edge CRUD
- `GET|PUT /api/settings` — User preferences (theme, fontSize)

## Gotchas (non-obvious)

- **`session_keys` is in-memory** (`backend/main.py`). The per-user Fernet key is derived from the password only at login, then held in a module-level dict. A server restart wipes it, so any endpoint that touches descriptions (`GET /api/mindmap`, node create/update) returns `401 "Session expired"` via `require_session_key` until the user logs in again. There is no key persistence and no password recovery — forgotten password = unrecoverable encrypted descriptions.
- **DB path: relative by default, override with `DATABASE_PATH`.** `database.py` reads the `DATABASE_PATH` env var (default `./data/traumappd.db`, relative to CWD) and creates its parent dir on startup. Container hosts point it at a mounted volume (the Docker image sets `/app/data/traumappd.db`). For local dev/tests leave it unset and launch from the repo root so the default resolves to `./data/`.
- **Three ports, all in the CORS allowlist** (`main.py`): 8000 (direct dev), 8080 (Docker host → container's 8000, bound to `127.0.0.1`), 8089 (E2E). Playwright starts its own server on 8089 with `reuseExistingServer: false`, so don't run a server yourself before `npx playwright test`.
- **Test user auto-creation.** When `AUTO_CREATE_TEST_USER=true` (the default), `TestUser` / `SecureTest2025!` is created on startup. E2E tests rely on this.
- **`data/`, `*.db`, and `.env` are gitignored.** A fresh checkout has no DB; it's created on first run.

## Design Constraints

- **Trauma-informed**: Gentle language, soft pastels, 0.3s ease transitions, Escape to close all modals
- **Privacy-first**: No external API calls, no telemetry, localhost-only CORS, Fernet-encrypted sensitive fields
- **Accessibility**: WCAG 2.1 AA, keyboard navigable, ARIA labels, `prefers-reduced-motion`, three themes (light/dark/soft)
