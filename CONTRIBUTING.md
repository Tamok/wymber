# Contributing to Wymber

Wymber is a privacy-first, local-first, trauma-informed mapping tool. It's alpha, maintained by
[@tamok](https://github.com/tamok), built with Claude Code as a tool and reviewed and audited by the
maintainer before anything ships. These are the working rules that keep the repo clean as it grows.

## Branching model

- **`main`** is production. Cloudflare Pages deploys it on every push, so keep it releasable.
- **`develop`** is integration. Day-to-day work lands here, then fast-forwards to `main` to release.
- **Feature branches** for anything non-trivial: `feat/...`, `fix/...`, `docs/...`, `chore/...`,
  `spike/...`. Open a PR into `develop`. Once the app is live, avoid committing extensive work
  straight to `main` or `develop`; branch and open a PR.

After go-live, `main` is **protected** (PR-only, CI must pass). Turn it on with:

```bash
gh api -X PUT repos/Tamok/wymber/branches/main/protection --input - <<'JSON'
{
  "required_status_checks": { "strict": true,
    "contexts": ["Lint (Ruff)", "Backend (pytest)", "Frontend unit (Vitest)", "E2E (Playwright)"] },
  "enforce_admins": true,
  "required_pull_request_reviews": { "required_approving_review_count": 0 },
  "restrictions": null
}
JSON
```

## The commit pass (run on every change)

Issue hygiene, roadmap, and docs are part of *committing* here, not a separate chore. Every change
runs this pass (the PR template is the same list as checkboxes):

1. **Tests green:** `pytest` (backend), `vitest` (frontend units); add or refresh **E2E** for UI work.
2. **E2E + UX:** `npx playwright test`, plus a real browser walk-through of the affected app and
   landing screens. Assess the *feel* (trauma-informed, accessible), not just the green checks.
3. **Issues:** close what's done, file what surfaced, keep labels (`type:` / `area:` / `priority:`).
4. **Roadmap:** adjust priorities and epics if the change moved them.
5. **Docs:** README, ADRs, and CONTENT-GUIDELINES match reality; no stale names or references; the
   docs read in the maintainer's voice (the AI is a tool, not an author or a decider).
6. **Branch and author:** feature branch for extensive work; commits authored by **Tamok**; no
   em-dashes; gentle, trauma-informed tone.

## How it's enforced

- **CI** (`.github/workflows/ci.yml`) runs Ruff + pytest + vitest + Playwright on every push and PR.
  With branch protection on, a red check blocks the merge.
- **Local git hooks** (`.githooks/`) run vitest before a frontend commit and nudge you off direct
  `main` pushes. Enable them once per clone:

  ```bash
  git config core.hooksPath .githooks
  ```

- **Branch protection** on `main` (command above) is the hard gate at go-live.

## Running it

```bash
python -m venv .venv
.venv/bin/pip install -r requirements.lock      # Windows: .venv\Scripts\pip
.venv/bin/python -m uvicorn backend.main:app --port 8000   # http://localhost:8000

python -m pytest tests/ -q     # backend
npx vitest run                 # frontend units
npx playwright test            # E2E
```
