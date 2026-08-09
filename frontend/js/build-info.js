/**
 * Build stamp for this copy of the app (ADR-0003, Layer 1: "make the official client
 * verifiable, not self-attesting").
 *
 * `commit` is rewritten to the real short git SHA by scripts/build-pages.mjs when it assembles
 * the Cloudflare Pages output; a self-hosted or locally-served copy is never rewritten, so it
 * honestly reports 'dev'. That is not a bug: nothing stamped it, so nothing should claim to know
 * what it is.
 *
 * IMPORTANT: this module must never grow into a self-attestation ("I checked myself, I'm legit").
 * A modified client can report anything it likes from its own code, so this is transparency
 * (what build is running) only, never proof of integrity. Real assurance comes from outside the
 * page: compare `commit` against the published landing/integrity-manifest.json on a different
 * origin, or (future) an out-of-band verifier (ADR-0003, Layer 2).
 *
 * Nothing imports this module yet. Wiring buildLabel() into visible UI belongs to app.js, which
 * is out of bounds for this change; this file is a clean, dependency-free seam for that to land
 * later without touching build tooling again.
 */
export const BUILD = Object.freeze({
    commit: 'dev',
    origin: 'source',
});

/**
 * A short, quiet, plain-text label for the running build. Deliberately free of any judgment
 * word ("verified", "secure", "safe") or iconography (checkmark, warning, emoji): per ADR-0003
 * this is transparency, not a security claim, and a trauma-informed surface stays calm either way.
 * @returns {string}
 */
export function buildLabel() {
    return BUILD.commit === 'dev' ? 'dev build' : `build ${BUILD.commit}`;
}

/**
 * Read the SHA-384 integrity hash for `url` out of the `<script type="importmap">` that
 * scripts/build-pages.mjs injects into the built index.html (see that file's "Import-map
 * integrity" step). Returns `null` when there is no import map on the page at all, which is the
 * normal case for a self-hosted or locally-served, unbuilt copy: nothing stamped one, so nothing
 * should claim to have a hash. Also returns `null` (never throws) on any parse failure, so a
 * caller can use this unconditionally without its own try/catch.
 *
 * Nothing calls this yet. It exists as the seam for a future one-line change in
 * frontend/js/mindmap.js: `s.integrity = integrityFor('/static/libs/cytoscape.min.js')` on the
 * classic <script> element it creates to lazy-load Cytoscape (mindmap.js is out of bounds for
 * this change). Today that element ships with no `integrity` attribute, which is precisely why
 * ADR-0003's `Integrity-Policy` header is shipped report-only on the app origin rather than
 * enforced: enforcing it now would block that unprotected load and break the map. Wiring this
 * helper in is what would let that enforcement happen safely.
 * @param {string} url the same URL key used in the import map, e.g. '/static/libs/cytoscape.min.js'
 * @returns {string|null} 'sha384-...' or null
 */
export function integrityFor(url) {
    try {
        const el = document.querySelector('script[type="importmap"]');
        if (!el) return null;
        const map = JSON.parse(el.textContent);
        return (map && map.integrity && map.integrity[url]) || null;
    } catch (_) {
        return null;
    }
}
