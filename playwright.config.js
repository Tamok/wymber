import { defineConfig } from '@playwright/test';
import { existsSync } from 'fs';

// Prefer the project-local virtualenv if it exists (reproducible local runs, since the
// machine's global Python may have an incompatible FastAPI/Starlette). CI has no .venv,
// so it falls back to `python`, which there resolves to the requirements.lock install.
const venvPython = process.platform === 'win32'
    ? '.venv\\Scripts\\python.exe'
    : '.venv/bin/python';
const python = existsSync(venvPython) ? venvPython : 'python';

// 8089 by default (what CI and CLAUDE.md document). Overridable because several git worktrees
// of this repo can be checked out at once, and a fixed port means a suite running in one
// worktree blocks every other one with "port already in use":
//   E2E_PORT=8199 npx playwright test
const port = Number(process.env.E2E_PORT) || 8089;

export default defineConfig({
    testDir: './e2e',
    timeout: 30000,
    // Each vault create/unlock runs real PBKDF2 (600k), so under serial load a step can
    // occasionally exceed a timeout. Retry to absorb that inherent flakiness.
    retries: 2,
    // Serial on purpose, and set HERE rather than only as ci.yml's `--workers=1` flag. Playwright
    // otherwise defaults to half the local CPU count, so a local run went 6-wide: six concurrent
    // 600k-iteration PBKDF2 unlocks starve each other and time out. That reproduced as a flaky
    // keyword-tag assertion in mindmap.spec.js. CI was always serial; local runs (including the
    // UX-emulation checklist pass in docs/ux-emulation-checklist.md) now match it.
    workers: 1,
    // The html report is what CI uploads on failure (the artifact step in ci.yml);
    // without it the default list reporter writes no playwright-report/ at all.
    reporter: [['list'], ['html', { open: 'never' }]],
    use: {
        baseURL: `http://localhost:${port}`,
        headless: true,
    },
    webServer: {
        command: `${python} -m uvicorn backend.main:app --host 0.0.0.0 --port ${port}`,
        port,
        timeout: 15000,
        reuseExistingServer: false,
    },
    projects: [
        {
            name: 'chromium',
            use: { browserName: 'chromium' },
        },
    ],
});
