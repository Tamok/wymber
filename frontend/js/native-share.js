/**
 * Native save/share shim — the mobile path for file exports (issue #147, ADR-0005).
 *
 * Inside the Capacitor WebView, the web download path (blob URL + <a download>) does
 * NOTHING — silently. On native we instead write the export to the app's cache dir and
 * hand it to the OS share sheet, so the user can save to Files/Drive or send it anywhere.
 *
 * Cache cleanup (#167): the staged file is NOT deleted the moment the share() promise
 * resolves. On Android the Share plugin's promise resolves when the chooser is dismissed
 * (i.e. the target app has *launched*), not when that app has finished reading the file —
 * Gmail, for example, only reads the attachment when the user hits Send, which can be
 * minutes later. Deleting on resolve would race that read and could silently truncate or
 * empty the user's export, which for a backup file is a far worse bug than a lingering
 * cache entry. So cleanup is sweep-based instead:
 *   - a cancelled or failed share deletes its staged file immediately (nothing else could
 *     possibly be reading a share nobody accepted, so this is unambiguously safe), and
 *   - a successful share's file is swept away lazily, right before the *next* export is
 *     staged, plus once at app start (see the module-init call at the bottom of this file).
 * Net effect: at most one staged export can ever linger, and only in the window between a
 * successful share and the next export or app launch — never forever. This applies to
 * every export, including the plaintext JSON/text ones, not just the encrypted `.wymber`
 * vault.
 *
 * Buildless note: like the other native shims, this reaches plugins through the Capacitor
 * bridge globals rather than bare package imports the browser can't resolve.
 */
import { isNativeShell, isNotFoundError } from './native-persistence.js';

const EXPORT_DIR = 'exports';
const DIRECTORY = 'CACHE';

function fs() {
    const p = globalThis.Capacitor?.Plugins?.Filesystem;
    if (!p) throw new Error('Filesystem plugin unavailable.');
    return p;
}

function share() {
    const p = globalThis.Capacitor?.Plugins?.Share;
    if (!p) throw new Error('Share plugin unavailable.');
    return p;
}

export { isNativeShell };

/** Best-effort delete of one staged file. Never throws — a failed cleanup must never surface as an error. */
async function deleteStagedQuiet(path) {
    try {
        await fs().deleteFile({ path, directory: DIRECTORY });
    } catch {
        // Already gone, plugin hiccup, whatever — cleanup is housekeeping, not the operation itself.
    }
}

/**
 * Remove the entire `exports/` staging directory (and anything left in it) from the cache.
 * The directory is exclusively ours (nothing else writes there), so clearing it wholesale is
 * simpler and more robust than pattern-matching filenames — exports are named after
 * user-facing content (`wymber-export-<date>.json`, `wymber-vault-<date>.wymber`, ...), not
 * a single fixed prefix a matcher could rely on.
 *
 * A no-op (not an error) when the directory does not exist yet. Never throws or rejects —
 * this is called both mid-flow (before staging a new export) and fire-and-forget at module
 * init, and neither call site should ever be able to fail loudly because housekeeping had a
 * bad day.
 */
export async function sweepStagedExports() {
    try {
        await fs().rmdir({ path: EXPORT_DIR, directory: DIRECTORY, recursive: true });
    } catch (err) {
        if (isNotFoundError(err)) return; // nothing staged — the normal case
        // Anything else (plugin unavailable, odd platform error, ...): swallow it too. A failed
        // sweep just means one more file lingers until the next sweep; it must never block or
        // fail the export flow it's guarding.
    }
}

/**
 * Save `text` as `filename` via the OS share sheet.
 * Returns true when the sheet was completed, false when the user backed out
 * (not an error — no scary toast needed). Throws on real failures.
 */
export async function nativeSaveFile(filename, text) {
    // Sweep any previous staged export first: whatever share it belonged to is long over by now,
    // so cleaning it up here (rather than leaving it to linger indefinitely) is always safe.
    await sweepStagedExports();

    const path = `${EXPORT_DIR}/${filename}`;
    const { uri } = await fs().writeFile({
        path,
        data: text,
        directory: DIRECTORY,
        encoding: 'utf8',
        recursive: true,
    });
    try {
        await share().share({
            title: filename,
            files: [uri],
            dialogTitle: 'Save or share your export',
        });
        // Deliberately NOT deleted here: on Android the receiving app may still be reading the
        // file well after this promise resolves (see the module doc comment). It is cleaned up
        // by the next sweep instead.
        return true;
    } catch (e) {
        // Cancelled or genuinely failed: either way nothing else could be relying on this file,
        // so it's safe (and unlike the success path, unambiguous) to delete it right now.
        await deleteStagedQuiet(path);
        // The Share plugin rejects when the user dismisses the sheet.
        if (/cancel/i.test(e?.message || '')) return false;
        throw e;
    }
}

// Belt-and-braces sweep at app start (#167). native-share.js is imported by export.js, which
// app.js imports at boot, so module evaluation IS app start. Deferred (never runs synchronously
// during module init, so it can't delay or break evaluation on the web build) and fully guarded
// (sweepStagedExports() already swallows everything; the extra .catch is a second belt in case
// isNativeShell() itself ever misbehaves). A complete no-op off the native shell.
if (isNativeShell()) {
    Promise.resolve().then(() => sweepStagedExports()).catch(() => {});
}
