import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './e2e',
    timeout: 30000,
    retries: 0,
    use: {
        baseURL: 'http://localhost:8089',
        headless: true,
    },
    webServer: {
        command: 'python -m uvicorn backend.main:app --host 0.0.0.0 --port 8089',
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
