import { defineConfig } from '@playwright/test';
import { existsSync } from 'fs';

// Prefer the project-local virtualenv if it exists (reproducible local runs, since the
// machine's global Python may have an incompatible FastAPI/Starlette). CI has no .venv,
// so it falls back to `python`, which there resolves to the requirements.lock install.
const venvPython = process.platform === 'win32'
    ? '.venv\\Scripts\\python.exe'
    : '.venv/bin/python';
const python = existsSync(venvPython) ? venvPython : 'python';

export default defineConfig({
    testDir: './e2e',
    timeout: 30000,
    retries: 0,
    use: {
        baseURL: 'http://localhost:8089',
        headless: true,
    },
    webServer: {
        command: `${python} -m uvicorn backend.main:app --host 0.0.0.0 --port 8089`,
        port: 8089,
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
