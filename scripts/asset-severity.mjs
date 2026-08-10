/**
 * Severity classification for every shipped asset (ADR-0003, Layer 1: the published integrity
 * manifest becomes the shared source of truth for "how alarmed should I be if this file's hash
 * doesn't match", not something the CLI, a future browser extension, and an on-page comparator
 * each invent separately). This module is the ONLY place that decision gets made; every consumer
 * (integrity-manifest.mjs, and anything built later) reads it here rather than re-deriving it.
 *
 * The classification is a fixed, exact-path map, deliberately. No extension rule ("*.js is high"),
 * no prefix rule ("/static/js/ is high"), no default tier for anything unrecognised. A file added
 * to the shipped app later that isn't in ASSET_SEVERITY is not silently "low", it makes
 * classifyAssets() throw, naming exactly which paths need a deliberate decision. That refusal to
 * default is the point: severity is a judgment call about what a file can reach (the unlock
 * secret, the decrypted map, or neither), and a judgment call skipped by accident is a judgment
 * call made wrong.
 *
 * Severity is triage, not a security boundary. See SEVERITY_NOTE below, which every consumer of
 * this module should surface next to the tiers, not just the tiers themselves: every file here is
 * served under Subresource Integrity and a strict CSP (ADR-0003 Layer 1), so ANY unexpected hash
 * difference means the deploy is not what was published, whatever its tier says.
 */

// Most severe first. A future consumer that just wants "the worst tier present" can take
// SEVERITY_ORDER[0] that appears among a set of mismatches.
export const SEVERITY_ORDER = ['critical', 'high', 'moderate', 'low'];

// Plain-language tier descriptions, written for someone who is not a security engineer
// (docs/CONTENT-GUIDELINES.md: gentle, plain, no alarm, no "attacker" theatre).
export const SEVERITY_TIERS = {
    critical: {
        label: 'Critical',
        meaning: 'A change here could reach your password, your recovery code, or the key that ' +
            'unlocks your map, or decide what code runs at all.',
    },
    high: {
        label: 'High',
        meaning: 'A change here could reach your whole decrypted map, or is one of the ways a ' +
            'copy of it can leave your device.',
    },
    moderate: {
        label: 'Moderate',
        meaning: 'A change here cannot reach your map or your key, but it can change what the ' +
            'app tells you or asks of you while you use it.',
    },
    low: {
        label: 'Low',
        meaning: 'A change here cannot read your map. It can still change what you see, and ' +
            'what you see is how you decide whether to trust this page.',
    },
};

// The honesty paragraph: severity ranks where to look first, it is not a claim that a lower tier
// is safe to differ. Every consumer that shows tiers should show this alongside them.
export const SEVERITY_NOTE =
    'Severity is triage, not permission. It answers "how alarmed should I be, and what should I ' +
    'look at first", nothing more. Every file here is served under Subresource Integrity and a ' +
    'strict Content-Security-Policy, so any unexpected difference means the deploy is not what ' +
    'was published, whatever its tier. "Differs, low severity" is still "differs". ' +
    'Low does not mean harmless. A stylesheet cannot read your vault, but it can restyle the ' +
    'page to fake an unlock prompt, hide a warning, or make a storage error look like a fresh ' +
    'start, so that someone creates a new vault over their real one. It cannot take your data; ' +
    'it can persuade you to hand it over. ' +
    'Every file under /static/js/ and /static/libs/ runs as script in the app\'s own origin, so a ' +
    'swapped one could in principle do what any other module can. These tiers rank where to look ' +
    'first, by how directly the published file touches keys or the decrypted map. They are not a ' +
    'statement that a lower tier is safe to differ.';

// --- The classification (ADR-0003, verified against what each file actually does) -----------

export const ASSET_SEVERITY = {
    // critical: on the path of the unlock secret or the encryption key, or decides what code the
    // browser loads and validates at all.
    '/index.html': 'critical', // the shell: SRI attributes, the import map, the CSP-hashed theme guard, the build stamp
    '/sw.js': 'critical', // can answer every same-origin request for this origin, indefinitely; decides what code runs
    '/static/js/app.js': 'critical', // owns create/unlock/recover; the typed password and recovery code pass through here
    '/static/js/crypto.js': 'critical', // derives keys, wraps/unwraps the data key, seals the document
    '/static/js/local-repo.js': 'critical', // holds the unlocked data key for the session, mediates every read/write
    '/static/js/persistence.js': 'critical', // reads and writes the ciphertext at rest, and can destroy it
    '/static/js/utils.js': 'critical', // passwordStrength() is handed the plaintext password on create/unlock
    '/static/js/native-biometric.js': 'critical', // passes the raw data key to and from the device keystore
    '/static/js/native-persistence.js': 'critical', // reads/writes vault ciphertext on device; a storage-failure misread here can put a fresh vault over a real one

    // high: handles the whole decrypted document, or is a route by which it leaves the device.
    '/static/js/vault-store.js': 'high', // the decrypted document in memory
    '/static/js/export.js': 'high', // writes the decrypted map out to a file
    '/static/js/native-share.js': 'high', // stages plaintext exports on disk and hands them to the OS share sheet
    '/static/js/mindmap.js': 'high', // receives the whole decrypted document to render; the app's only dynamic <script> injection site
    '/static/js/analyze.js': 'high', // reads the whole decrypted document
    '/static/js/suggest.js': 'high', // reads the whole decrypted document
    '/static/libs/cytoscape.min.js': 'high', // runs in the app's own realm, handed every node's text; largest, least human-diffable file shipped

    // moderate: changes what the app says or does, without touching keys or the decrypted map.
    '/static/js/config.js': 'moderate', // colours + the gentle prompts shown while mapping; reworded, they steer what someone writes down
    '/static/js/tutorial.js': 'moderate', // the first-run walkthrough, the copy that teaches what is and isn't private
    '/static/js/changelog.js': 'moderate', // the in-app "what's new"; can announce a change that never happened
    '/static/js/build-info.js': 'moderate', // reports the build honestly, and is the seam meant to gate the Cytoscape load
    '/404.html': 'moderate', // a page on the real origin: the most convincing place for a fake prompt without touching any script

    // low: cannot read the vault.
    '/static/css/styles.css': 'low',
    '/static/favicon.svg': 'low',
    '/static/icons/apple-touch-icon.png': 'low',
    '/static/icons/icon-192.png': 'low',
    '/static/icons/icon-512.png': 'low',
    '/static/og-image.png': 'low',
    '/manifest.webmanifest': 'low',
    '/robots.txt': 'low',
    '/.well-known/security.txt': 'low',
};

/**
 * The tier for a single asset path.
 * @param {string} path an asset key exactly as it appears in the integrity manifest (e.g. '/sw.js')
 * @returns {'critical'|'high'|'moderate'|'low'}
 * @throws if `path` is not in ASSET_SEVERITY
 */
export function severityFor(path) {
    // Object.hasOwn, not a truthiness check on the lookup: ASSET_SEVERITY is a plain object, so
    // `ASSET_SEVERITY['constructor']` (or 'toString', '__proto__', ...) resolves up the prototype
    // chain to something truthy and would be returned as if it were a tier. That is exactly the
    // silent-default this module exists to refuse, so the own-property check is the fail-closed one.
    const tier = Object.hasOwn(ASSET_SEVERITY, path) ? ASSET_SEVERITY[path] : undefined;
    if (!tier) {
        throw new Error(
            `[asset-severity] no severity classified for "${path}". Add it to ASSET_SEVERITY in ` +
            'scripts/asset-severity.mjs, choosing a tier deliberately.'
        );
    }
    return tier;
}

/**
 * Classify a whole list of asset paths at once (what writeManifest() needs). Throws listing
 * EVERY unclassified path together, rather than stopping at the first one, so a batch of newly
 * added files is reported in one pass instead of one error per build.
 * @param {string[]} paths
 * @returns {Record<string, 'critical'|'high'|'moderate'|'low'>}
 * @throws if any path is not in ASSET_SEVERITY
 */
export function classifyAssets(paths) {
    const missing = paths.filter((p) => !Object.hasOwn(ASSET_SEVERITY, p)); // own-property only, see severityFor
    if (missing.length > 0) {
        throw new Error(
            `[asset-severity] ${missing.length} shipped asset(s) have no severity classification: ` +
            `${missing.join(', ')}. Add ${missing.length === 1 ? 'it' : 'them'} to ASSET_SEVERITY in ` +
            'scripts/asset-severity.mjs, choosing a tier deliberately.'
        );
    }
    const out = {};
    for (const p of paths) out[p] = ASSET_SEVERITY[p];
    return out;
}
