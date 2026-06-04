# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Summary

Wymber is a **privacy-first, local-first** trauma-mapping tool. Users visualize trauma experiences as an interactive mind map. The data **never leaves the device**: it lives in a single encrypted vault in the browser, unlocked by the user's password (or a recovery code). Trauma-informed design throughout: gentle language, soft colors, predictable UI, no jarring animations. Live at **wymber.app**; currently alpha. Open-source (AGPL-3.0).

## Architecture: local-first (see `docs/adr/0001-local-first-encrypted-file.md`)

There is **no server account, no database, and no user API.** The browser is the backend:

- **Frontend**: vanilla JS + ES modules, no build step. Entry point `frontend/js/app.js`.
- **The vault**: `crypto.js` (envelope encryption: a random AES-256-GCM data key, wrapped per unlock method: password, recovery code, later passkeys; PBKDF2-600k now, Argon2id tracked) + `vault-store.js` (the in-memory document: nodes, edges, settings) + `persistence.js` (only ciphertext at rest, in OPFS with an IndexedDB fallback).
- **The api seam**: `local-repo.js` exposes the same `get/post/put/delete` surface the app already used, so `app.js` / `mindmap.js` / `export.js` didn't change. `const api = new LocalRepo()`.
- **Backend**: `backend/main.py` is a small FastAPI app that **only serves the static frontend** (+ `/api/health`, and `/sw.js` / `/manifest.webmanifest` at root for the PWA). It exists for self-hosting and is where an optional, future, zero-knowledge sync endpoint would live. No DB, no auth, no secrets.
- **PWA**: installable + fully offline (`frontend/sw.js` caches the shell; the data is already on-device). Cytoscape is lazy-loaded by `mindmap.js` so the auth screens stay light.

**Data flow**: `app.js` → `local-repo.js` → `vault-store.js` (decrypted doc in memory) → `crypto.js` seals it → `persistence.js` (OPFS/IndexedDB). Unlock per session; auto-lock on idle.

## Build & Run

```bash
# Direct dev: venv + lockfile (reproducible)
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.lock
.venv\Scripts\python.exe -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
# open http://localhost:8000  (the server just serves the static app)

# Docker (self-host)
docker-compose up -d          # serves on localhost:8080

# Tests
.venv\Scripts\python.exe -m pytest tests/ -q   # backend: serves-the-app smoke tests
npx vitest run                                  # frontend units incl. crypto/vault
npx playwright test                             # E2E vault flow (port 8089)
```

Run commands from the repo root.

## Key files

- `frontend/js/crypto.js`: vault crypto (`createVault`/`unlockVault`/`sealDocument`/`changePassword`/`resetPassword`, recovery codes). Tested by Vitest (WebCrypto via `// @vitest-environment node`).
- `frontend/js/vault-store.js`: the document model + migrations (`emptyDocument`, add/update node + edge, settings).
- `frontend/js/local-repo.js`: the `api.js`-shaped adapter over the vault (drop-in for the old APIClient).
- `frontend/js/persistence.js`: OPFS / IndexedDB ciphertext storage.
- `frontend/js/app.js`: orchestrator: create / unlock / recover panels, recovery sheet, auto-lock, the map, the add-node modal, and the node detail drawer (#108: type/title/description/story/keywords, edit-in-place, auto-saving).
- `frontend/js/mindmap.js`: the graph renderer (Cytoscape, vendored in `frontend/libs/`). Draws pastel building-block nodes + first-class edges straight from `/mindmap`, theme-aware via `applyTheme()`, and keeps an accessible `#map-outline` list twin in lockstep (the keyboard-first, non-visual surface).
- `frontend/js/{utils,analyze,export}.js`: pure utils, local map analysis, export.
- `frontend/js/suggest.js`: the discovery engine (`suggestLinks`): proposes *possible* links from shared keywords + an "anchor gap" type hint (a lone trigger/need with no coping/support). Pure/testable; surfaced via a quiet, opt-in "possible connections" prompt (never auto-added). A first cut meant to grow (ADR-0002).
- `frontend/js/config.js`: `NODE_TYPES` + `MESSAGES` (source of truth).
- `backend/main.py`: the static server (+ health). That's the whole backend.

The 11 node types: `event`, `emotion`, `body`, `person`, `place`, `trigger`, `coping`, `support`, `need`, `insight`, `growth`. Each has a color + a gentle, non-directive `prompt` (config.js is the source of truth).

A node carries `{ node_type, title, description, story, keywords[], x, y, parent_id }` (vault schema v2; a migration backfills `story`/`keywords` on older docs). `keywords` are discovery fuel: shared keywords are the co-occurrence signal the future `suggestLinks()` uses (ADR-0002).

## Gotchas (non-obvious)

- **The vault *is* the data.** Lose the password *and* the recovery code → it's unrecoverable (encrypted client-side; nothing sits on a server). The recovery sheet exists precisely to avoid the cruel "forgot password = data gone" failure.
- **Storage is OPFS (IndexedDB fallback), per origin.** `localhost` vs `127.0.0.1` vs different ports are *separate origins* → separate vaults. Handy for testing a clean state; surprising if you forget.
- **Auto-lock on idle** clears the in-memory key; a page reload also requires unlock (only ciphertext persists).
- **The service worker caches the app shell.** Bump `VERSION` in `frontend/sw.js` whenever shell assets change, or returning users can be served stale JS/CSS (navigations are network-first, static assets are stale-while-revalidate). It never caches `/api` or any vault data.
- **E2E** (Playwright, port 8089) creates fresh-context OPFS vaults; `--workers=1`, `retries:2` for crypto-load timing. The webServer prefers `.venv` Python.
- **No server state.** A server restart changes nothing for users: their data is in the browser. The backend is stateless static serving.

## Design Constraints

- **Trauma-informed**: gentle language, soft pastels, 0.3s ease transitions, Escape closes all modals, no jarring motion.
- **Privacy-first**: local-first, client-side encryption, no accounts/telemetry, localhost-only CORS, open-source (AGPL-3.0) so the privacy claims are auditable.
- **Accessibility (architecture, not a checkbox)**: WCAG 2.1 AA, keyboard navigable, ARIA, `prefers-reduced-motion`, three themes (light/dark/soft).

## Architecture decisions

- **ADR-0001**: local-first encrypted vault (the data model).
- **ADR-0002**: graph + discovery direction (own the taxonomy, rent the renderer). Cytoscape is the live renderer (it replaced MindElixir); the map is a true graph (nodes + first-class edges), with the `#map-outline` list as its accessible twin.
