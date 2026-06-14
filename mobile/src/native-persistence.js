/**
 * NativePersistence: the mobile (Capacitor) storage backend for the Wymber vault.
 *
 * It implements the exact persistence interface LocalRepo injects (see
 * frontend/js/local-repo.js, `new LocalRepo({ persistence })`): hasVault / loadVault /
 * saveVault / clearVault, storing the single sealed vault string.
 *
 * Why this exists (ADR-0005): inside a mobile WebView, OPFS/IndexedDB are not safe as the
 * system of record. WKWebView caps each OPFS file at 10 MB (our vault is one blob),
 * navigator.storage.persist() is weak on iOS, the OS can reclaim WebView storage under disk
 * pressure, and some Android WebView builds restrict OPFS. So on native we write the sealed blob
 * to app-private native storage instead. Only ciphertext is ever written here: the WebView still
 * does 100% of the crypto, so the zero-knowledge property ([[ADR-0001]]) holds.
 *
 * Buildless note: the frontend ships as plain ES modules with no bundler, so we reach the
 * Filesystem plugin through the Capacitor bridge global (window.Capacitor.Plugins.Filesystem)
 * rather than a bare `import '@capacitor/filesystem'` specifier the browser cannot resolve. If an
 * import map is added later, this can switch to a normal ESM import with no behaviour change.
 */

const FILE = 'wymber.vault';

// Directory.Data: app-private, persistent, and excluded from OS cloud backup by default. Backup is
// deliberate and user-driven (export to a portable .wymber file), see issue #147 and ADR-0001.
const DIRECTORY = 'DATA';
const ENCODING = 'utf8';

function filesystem() {
    const fs = globalThis.Capacitor?.Plugins?.Filesystem;
    if (!fs) {
        throw new Error('Capacitor Filesystem plugin is unavailable (not running in the native shell?).');
    }
    return fs;
}

export class NativePersistence {
    async hasVault() {
        return (await this.loadVault()) != null;
    }

    async loadVault() {
        try {
            const { data } = await filesystem().readFile({ path: FILE, directory: DIRECTORY, encoding: ENCODING });
            // With an encoding set, the plugin returns a string. The Blob branch is defensive
            // (the web Filesystem shim can hand back a Blob).
            return typeof data === 'string' ? data : await data.text();
        } catch {
            return null; // no vault on this device yet
        }
    }

    async saveVault(str) {
        await filesystem().writeFile({ path: FILE, data: str, directory: DIRECTORY, encoding: ENCODING });
    }

    async clearVault() {
        try {
            await filesystem().deleteFile({ path: FILE, directory: DIRECTORY });
        } catch {
            /* already gone */
        }
    }
}

/**
 * True when running inside the Capacitor native shell (Android/iOS), false in a plain browser.
 *
 * This is the hook for the single app-side change ADR-0005 requires. At the LocalRepo
 * construction site (frontend/js/app.js), the backend is chosen like so:
 *
 *     const api = isNativeShell()
 *         ? new LocalRepo({ persistence: new NativePersistence() })
 *         : new LocalRepo();
 *
 * Everything else (crypto, vault-store, the graph, the outline twin) is unchanged.
 */
export function isNativeShell() {
    return globalThis.Capacitor?.isNativePlatform?.() === true;
}
