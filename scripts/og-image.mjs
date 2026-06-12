#!/usr/bin/env node
/**
 * Render landing/og.png (1200x630), the social/share card for wymber.app, from an inline HTML
 * scene that reuses the landing palette + the dots motif. Rerun whenever the brand changes:
 * `node scripts/og-image.mjs` (requires the Playwright chromium already used by the E2E suite).
 */
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; box-sizing: border-box; }
  body {
    width: 1200px; height: 630px; overflow: hidden;
    background: #faf7f2;
    font-family: 'Segoe UI', 'Nunito', -apple-system, system-ui, sans-serif;
    color: #44403c; display: flex; align-items: center; justify-content: space-between;
    padding: 0 84px;
  }
  .text { max-width: 640px; }
  .wordmark { font-size: 64px; font-weight: 800; letter-spacing: -0.02em; margin-bottom: 18px; }
  .tagline { font-size: 40px; font-weight: 700; line-height: 1.2; margin-bottom: 22px; letter-spacing: -0.01em; }
  .sub { font-size: 26px; color: #5f5852; line-height: 1.45; }
  svg { flex: none; }
</style></head>
<body>
  <div class="text">
    <div class="wordmark">Wymber</div>
    <div class="tagline">Put down a dot,<br>connect the dots.</div>
    <div class="sub">A private space to map and understand your experiences. Nothing leaves your device.</div>
  </div>
  <svg width="380" height="430" viewBox="0 0 190 215">
    <line x1="57" y1="57" x2="133" y2="57" stroke="#44403c" stroke-width="7" stroke-linecap="round"/>
    <line x1="57" y1="57" x2="89" y2="139" stroke="#44403c" stroke-width="7" stroke-linecap="round"/>
    <line x1="133" y1="57" x2="89" y2="139" stroke="#44403c" stroke-width="7" stroke-linecap="round" stroke-dasharray="14 14" opacity="0.45"/>
    <circle cx="57" cy="57" r="28" fill="#B7D5F0"/>
    <circle cx="133" cy="57" r="28" fill="#F5DD9A"/>
    <circle cx="89" cy="139" r="28" fill="#A9D6AC"/>
  </svg>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'networkidle' });
const out = join(root, 'landing', 'og.png');
await page.screenshot({ path: out, type: 'png' });
await browser.close();
console.log(`[og-image] wrote ${out}`);
