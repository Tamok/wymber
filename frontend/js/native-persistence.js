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
 * Error semantics (#165): a read that fails for any reason OTHER than "the file isn't there yet"
 * must never be reported as "no vault". Collapsing a transient I/O error to "fresh install" lets
 * the create-vault flow overwrite a vault that is still on the device but momentarily unreadable,
 * which for this product is the worst possible failure (silent vault loss, epic #26). So loadVault
 * distinguishes not-found from real failures, and saveVault refuses to clobber an unreadable vault
 * and writes atomically (temp-then-rename) so a mid-write hiccup can't leave a half-written vault.
 *
 * Buildless note: the frontend ships as plain ES modules with no bundler, so we reach the
 * Filesystem plugin through the Capacitor bridge global (window.Capacitor.Plugins.Filesystem)
 * rather than a bare `import '@capacitor/filesystem'` specifier the browser cannot resolve. If an
 * import map is added later, this can switch to a normal ESM import with no behaviour change.
 */

const FILE = 'wymber.vault';
// Staging file for the atomic write (write here, then rename over FILE). Same directory as FILE so
// the rename stays on one filesystem and is a single atomic replace.
const TMP_FILE = 'wymber.vault.tmp';

// Directory.Data: app-private, persistent, and excluded from OS cloud backup by default. Backup is
// deliberate and user-driven (export to a portable .wymber file), see issue #147 and ADR-0001.
const DIRECTORY = 'DATA';
const ENCODING = 'utf8';

/**
 * A read/write failed for a reason other than "no vault yet" (I/O error, permission hiccup,
 * storage pressure). The app must surface this as a retryable "storage unavailable" state and MUST
 * NOT fall through to the create-vault flow: creating would overwrite a vault that is still on disk
 * but momentarily unreadable (#165). Carries a stable `code` so callers can branch on it across the
 * ES-module boundary without importing the class.
 */
export class StorageUnavailableError extends Error {
    constructor(message, cause) {
        super(message);
        this.name = 'StorageUnavailableError';
        this.code = 'STORAGE_UNAVAILABLE';
        if (cause !== undefined) this.cause = cause;
    }
}

/**
 * True only when the error means the file simply isn't there yet, the one signal that may mean
 * "no vault on this device". Capacitor Filesystem reports a missing file the same way across its
 * web shim and the iOS/Android native plugins: an Error whose message is "File does not exist." We
 * match that narrowly (plus the POSIX spellings an OS layer might surface) so that ANY other
 * failure is treated as a real error. Being narrow is deliberate: a false "not found" is the one
 * that destroys data, so we would rather show a needless retry than risk an overwrite (#165).
 */
export function isNotFoundError(err) {
    if (err?.code === 'ENOENT') return true;
    const msg = String(err?.message ?? err ?? '').toLowerCase();
    return msg.includes('does not exist')
        || msg.includes('not found')
        || msg.includes('no such file');
}

/** True when the app should show the retryable "storage unavailable" state, not create/unlock. */
export function isStorageUnavailableError(err) {
    return err?.code === 'STORAGE_UNAVAILABLE' || err?.name === 'StorageUnavailableError';
}

function filesystem() {
    const fs = globalThis.Capacitor?.Plugins?.Filesystem;
    if (!fs) {
        throw new Error('Capacitor Filesystem plugin is unavailable (not running in the native shell?).');
    }
    return fs;
}

export class NativePersistence {
    constructor() {
        // Set when a read failed for a reason other than not-found this session. While true we
        // refuse to write: a vault may be present on disk but unreadable, so writing would clobber
        // it. Cleared by any read that resolves (found, or genuinely absent). This is the last-line
        // guard behind the app-side check; it holds even if a caller reaches saveVault directly.
        this._readFailed = false;
    }

    async hasVault() {
        return (await this.loadVault()) != null;
    }

    async loadVault() {
        try {
            const { data } = await filesystem().readFile({ path: FILE, directory: DIRECTORY, encoding: ENCODING });
            this._readFailed = false;
            // With an encoding set, the plugin returns a string. The Blob branch is defensive
            // (the web Filesystem shim can hand back a Blob).
            return typeof data === 'string' ? data : await data.text();
        } catch (err) {
            if (isNotFoundError(err)) {
                this._readFailed = false;
                return null; // no vault on this device yet
            }
            // A real failure (I/O, permission, storage pressure). Do NOT collapse to "no vault":
            // surface it so the app can offer a retry and never overwrite an unreadable vault (#165).
            this._readFailed = true;
            throw new StorageUnavailableError('Could not read the vault from device storage.', err);
        }
    }

    async saveVault(str) {
        if (this._readFailed) {
            // A vault may exist on disk but we could not read it this session. Refuse to write so a
            // transient read error can never turn into a create-vault overwrite (#165).
            throw new StorageUnavailableError('Refusing to write: the existing vault could not be read this session.');
        }
        // Atomic write: stage to a temp file, then rename over the target. rename replaces the
        // destination in one step (POSIX rename / Android Files.move REPLACE_EXISTING / iOS
        // remove-then-move), so a crash or storage hiccup mid-write leaves the previous vault intact
        // and never yields a half-written one (#145: no data loss under storage pressure).
        await filesystem().writeFile({ path: TMP_FILE, data: str, directory: DIRECTORY, encoding: ENCODING });
        await filesystem().rename({ from: TMP_FILE, to: FILE, directory: DIRECTORY, toDirectory: DIRECTORY });
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
