/**
 * Wymber service worker, the offline + installable layer.
 *
 * Wymber is local-first: the data already lives on the device (encrypted, in OPFS/IndexedDB),
 * so once the static shell is cached the whole app works with no network at all. This SW caches
 * the shell on install, serves it cache-first for offline, and keeps it fresh in the background.
 * No user data is ever touched here (the vault is never fetched over the network).
 *
 * VERSION is derived from a content hash of the cached shell by scripts/sw-version.mjs (run in
 * the pre-commit hook), so it bumps automatically when the shell changes. Don't hand-edit it.
 */
const VERSION = 'wymber-shell-6a557b61263d';

const CORE = [
    '/',
    '/static/css/styles.css',
    '/static/js/app.js',
    '/static/js/config.js',
    '/static/js/crypto.js',
    '/static/js/vault-store.js',
    '/static/js/persistence.js',
    '/static/js/local-repo.js',
    '/static/js/mindmap.js',
    '/static/js/utils.js',
    '/static/js/analyze.js',
    '/static/js/export.js',
    '/static/js/suggest.js',
    '/static/js/tutorial.js',
    '/static/js/changelog.js',
    '/static/libs/cytoscape.min.js',
    '/static/favicon.svg',
    '/static/icons/icon-192.png',
    '/static/icons/icon-512.png',
    '/static/icons/apple-touch-icon.png',
    '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(VERSION)
            // Resilient precache: one missing asset shouldn't fail the whole install.
            .then((cache) => Promise.allSettled(CORE.map((url) => cache.add(url))))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return; // leave cross-origin requests alone
    if (url.pathname.startsWith('/api/')) return; // never cache health/api

    // Navigations: network-first (fresh shell when online), fall back to the cached shell offline.
    if (req.mode === 'navigate') {
        event.respondWith(
            fetch(req)
                .then((res) => {
                    const copy = res.clone();
                    caches.open(VERSION).then((c) => c.put('/', copy));
                    return res;
                })
                .catch(() => caches.match('/'))
        );
        return;
    }

    // Static assets: network-first, cache fallback. Stale-while-revalidate used to hand
    // returning users one page-load of OLD scripts after every deploy (fresh HTML + stale JS:
    // "the fix doesn't work until I hard-refresh"). The shell is small, so paying one fetch for
    // always-current code is the right trade; offline still serves the cached copy.
    event.respondWith(
        fetch(req)
            .then((res) => {
                if (res && res.status === 200) {
                    const copy = res.clone();
                    caches.open(VERSION).then((c) => c.put(req, copy));
                }
                return res;
            })
            .catch(() => caches.match(req))
    );
});
