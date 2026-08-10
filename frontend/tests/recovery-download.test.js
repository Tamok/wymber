// Regression coverage for #176: WymberApp.downloadRecovery() used to build its own blob and
// fire a raw `<a download>` click, bypassing the downloadBlob() seam every other export goes
// through. Inside the Capacitor WebView an anchor-click download does NOTHING — silently — so
// a mobile user could tap Download, see no error, tick "I've saved my recovery code somewhere
// safe", and continue holding a recovery code they do not actually have.
//
// The fix is export.js's downloadRecoveryCode(code), which routes through the existing,
// already-tested downloadBlob() seam (same one exportAsJSON/exportAsText/exportVaultFile use).
// These tests exercise that function directly, following the house style for mocking the
// Capacitor Filesystem/Share plugins established in native-share.test.js.
//
// app.js's downloadRecovery() itself is not exported by app.js (no test in this repo imports
// app.js directly — the WymberApp class is instantiated only on DOMContentLoaded), so its
// wiring is covered lightly here via direct code inspection/manual trace and more heavily by
// the e2e recovery-sheet journeys; the native delivery path — the actual bug — is fully
// covered below at the export.js layer.
import { describe, it, expect, vi, afterEach, afterAll } from 'vitest';
import { Blob as NodeBlob } from 'node:buffer';
import { downloadRecoveryCode } from '../js/export.js';

// jsdom's own Blob polyfill (the default test environment here) doesn't implement
// `.text()`, which downloadBlob()'s native branch relies on. Swap in Node's real Blob
// (which does) for this file only; document/URL/anchor DOM APIs are untouched. Real
// browsers and the Capacitor WebView both implement Blob.text(), so this stands in for
// the production behaviour rather than papering over a gap in it.
const jsdomBlob = globalThis.Blob;
globalThis.Blob = NodeBlob;
afterAll(() => { globalThis.Blob = jsdomBlob; });

const RECOVERY_CODE = 'WYMB-7F2Q-9K3X-RECOVER';

/** Minimal in-memory stand-in for window.Capacitor.Plugins.Filesystem (mirrors native-share.test.js). */
function makeFs() {
    const store = new Map(); // path -> data
    return {
        _store: store,
        writeFile: vi.fn(async ({ path, data }) => {
            store.set(path, data);
            return { uri: `mock://${path}` };
        }),
        deleteFile: vi.fn(async ({ path }) => {
            store.delete(path);
        }),
        rmdir: vi.fn(async () => {
            // Nothing staged yet in these tests; behave as a no-op "already empty" sweep.
        }),
    };
}

function makeShare(overrides = {}) {
    return { share: vi.fn(async () => ({ activityType: '' })), ...overrides };
}

function installNativeShell(fs, share) {
    globalThis.Capacitor = { Plugins: { Filesystem: fs, Share: share }, isNativePlatform: () => true };
}

afterEach(() => {
    delete globalThis.Capacitor;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('downloadRecoveryCode: native branch (#176 — the actual bug)', () => {
    it('stages the real recovery code and reaches the OS share sheet, not a silent no-op', async () => {
        const fs = makeFs();
        const share = makeShare();
        installNativeShell(fs, share);

        const result = await downloadRecoveryCode(RECOVERY_CODE);

        expect(result).toBe(true);
        expect(share.share).toHaveBeenCalledTimes(1);
        expect(share.share.mock.calls[0][0]).toMatchObject({ files: [expect.any(String)] });

        // The staged file's content must contain the actual recovery code, not just be "a file".
        const staged = [...fs._store.values()];
        expect(staged.some((v) => v.includes(RECOVERY_CODE))).toBe(true);

        // This is the assertion that would have FAILED against the pre-fix downloadRecovery():
        // that code built its own <a download> anchor and never touched the Filesystem or Share
        // plugins at all, so inside the Capacitor WebView nothing would ever have been staged or
        // shared here — fs.writeFile and share.share would simply never be called.
        expect(fs.writeFile).toHaveBeenCalledTimes(1);
    });

    it('names the staged file wymber-recovery-code.txt', async () => {
        const fs = makeFs();
        installNativeShell(fs, makeShare());

        await downloadRecoveryCode(RECOVERY_CODE);

        const [[{ path }]] = fs.writeFile.mock.calls;
        expect(path.endsWith('wymber-recovery-code.txt')).toBe(true);
    });
});

describe('downloadRecoveryCode: web branch', () => {
    it('produces an anchor download and resolves true when off the native shell', async () => {
        const created = [];
        const originalCreateElement = document.createElement.bind(document);
        vi.spyOn(document, 'createElement').mockImplementation((tag) => {
            const el = originalCreateElement(tag);
            if (tag === 'a') {
                vi.spyOn(el, 'click').mockImplementation(() => {});
                created.push(el);
            }
            return el;
        });
        const createObjectURL = vi.fn(() => 'blob:mock-recovery-url');
        const revokeObjectURL = vi.fn();
        vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });

        const result = await downloadRecoveryCode(RECOVERY_CODE);

        expect(result).toBe(true);
        expect(created).toHaveLength(1);
        expect(created[0].download).toBe('wymber-recovery-code.txt');
        expect(created[0].click).toHaveBeenCalledTimes(1);
        expect(createObjectURL).toHaveBeenCalledTimes(1);
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-recovery-url');

        // Sanity: the blob handed to createObjectURL carries the real code, not a placeholder.
        const blob = createObjectURL.mock.calls[0][0];
        const text = await blob.text();
        expect(text).toContain(RECOVERY_CODE);
        expect(text).toContain('We cannot recover it for you.');
    });
});

describe('downloadRecoveryCode: dismissal', () => {
    it('resolves false (not a throw) when the user backs out of the native share sheet', async () => {
        const fs = makeFs();
        const share = makeShare({ share: vi.fn(async () => { throw new Error('User canceled the share sheet.'); }) });
        installNativeShell(fs, share);

        await expect(downloadRecoveryCode(RECOVERY_CODE)).resolves.toBe(false);
    });
});

describe('downloadRecoveryCode: refuses to deliver a file with no code in it', () => {
    // The guard exists because the alternative is the exact failure #176 is about, one step
    // further along: a file that looks like a saved backup but carries no recovery code. On the
    // one screen shown once, a visible error beats a plausible-looking empty file every time.
    it.each([['empty string', ''], ['undefined', undefined], ['whitespace only', '   \n ']])(
        'rejects a %s code instead of staging a codeless file',
        async (_label, badCode) => {
            const fs = makeFs();
            const share = makeShare();
            installNativeShell(fs, share);

            await expect(downloadRecoveryCode(badCode)).rejects.toThrow(/no recovery code/i);
            // Nothing was written and nothing was shared: the caller gets an error to surface,
            // not a success it would wrongly report as a saved backup.
            expect(fs.writeFile).not.toHaveBeenCalled();
            expect(share.share).not.toHaveBeenCalled();
        }
    );

    it('rejects rather than throwing synchronously, so `await` in a try/catch always catches it', async () => {
        installNativeShell(makeFs(), makeShare());
        const returned = downloadRecoveryCode('');
        expect(returned).toBeInstanceOf(Promise);
        await expect(returned).rejects.toThrow();
    });
});

describe('downloadRecoveryCode: failure', () => {
    it('propagates a genuine share failure to the caller instead of swallowing it', async () => {
        const fs = makeFs();
        const share = makeShare({ share: vi.fn(async () => { throw new Error('Share target crashed'); }) });
        installNativeShell(fs, share);

        await expect(downloadRecoveryCode(RECOVERY_CODE)).rejects.toThrow(/crashed/);
    });
});
