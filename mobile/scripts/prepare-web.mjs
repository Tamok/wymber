/**
 * Stage the web core for the Capacitor WebView.
 *
 * The web app references its assets with absolute `/static/...` URLs, because the FastAPI server
 * maps `/static` -> `frontend/` (see backend/main.py `app.mount("/static", ...)`). Capacitor serves
 * `webDir` at the WebView root, so a flat copy of `frontend/` leaves every `/static/*` request
 * unresolved (no CSS, no JS, no app). To keep `frontend/` untouched (it is owned by the app, not the
 * mobile shell), we stage a `www/` dir that mirrors `frontend/` BOTH at the root and under `static/`,
 * so `/` and `/static/` both resolve inside the app. See mobile/README and ADR-0005.
 */
import { cpSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const mobileDir = process.cwd(); // npm runs scripts from mobile/
const frontend = resolve(mobileDir, '..', 'frontend');
const www = resolve(mobileDir, 'www');

rmSync(www, { recursive: true, force: true });
cpSync(frontend, www, { recursive: true }); // serves "/"
cpSync(frontend, resolve(www, 'static'), { recursive: true }); // serves "/static/"
console.log(`[prepare-web] staged ${frontend} -> ${www} (+ /static mirror)`);
