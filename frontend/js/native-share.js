/**
 * Native save/share shim — the mobile path for file exports (issue #147, ADR-0005).
 *
 * Inside the Capacitor WebView, the web download path (blob URL + <a download>) does
 * NOTHING — silently. On native we instead write the export to the app's cache dir and
 * hand it to the OS share sheet, so the user can save to Files/Drive or send it anywhere.
 * The exported vault is ciphertext (ADR-0001), so any destination is safe.
 *
 * Buildless note: like the other native shims, this reaches plugins through the Capacitor
 * bridge globals rather than bare package imports the browser can't resolve.
 */
import { isNativeShell } from './native-persistence.js';

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

/**
 * Save `text` as `filename` via the OS share sheet.
 * Returns true when the sheet was completed, false when the user backed out
 * (not an error — no scary toast needed). Throws on real failures.
 */
export async function nativeSaveFile(filename, text) {
    const { uri } = await fs().writeFile({
        path: `exports/${filename}`,
        data: text,
        directory: 'CACHE',
        encoding: 'utf8',
        recursive: true,
    });
    try {
        await share().share({
            title: filename,
            files: [uri],
            dialogTitle: 'Save or share your export',
        });
        return true;
    } catch (e) {
        // The Share plugin rejects when the user dismisses the sheet.
        if (/cancel/i.test(e?.message || '')) return false;
        throw e;
    }
}
