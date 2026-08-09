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
