import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
    mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync,
} from 'node:fs';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import {
    canonicalPayload, keyIdFor, sriSha384, chainHash, parseLog, verifyLog,
} from '../../scripts/integrity-log.mjs';
import { signLog, loadSigningKey, resolveSigningKeyPath } from '../../scripts/sign-integrity-log.mjs';

// ADR-0003 Layer 2: this suite exercises scripts/integrity-log.mjs (the shared library + verifier
// CLI) and scripts/sign-integrity-log.mjs (the owner-only signer) without ever generating,
// storing, or committing a real signing key. Every keypair here is a throwaway, generated at test
// time with generateKeyPairSync('ed25519'), and every file write goes through assertInTempDir()
// first, into a directory created fresh per test and removed in afterEach. This repo's real
// landing/integrity-manifest.json and landing/integrity-log.jsonl are read (never written) by a
// couple of tests below that check the actually-committed log verifies as-is; nothing here
// modifies them.

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const integrityLogScript = join(root, 'scripts', 'integrity-log.mjs');
const signIntegrityLogScript = join(root, 'scripts', 'sign-integrity-log.mjs');
const realLogPath = join(root, 'landing', 'integrity-log.jsonl');
const realManifestPath = join(root, 'landing', 'integrity-manifest.json');

let tmp;

beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'wymber-siglog-'));
});

afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
});

/**
 * Refuse to write anywhere outside the per-test tempdir. Called before every writeFileSync in
 * this suite, per the task's ABSOLUTE PROHIBITIONS on key material: a bug that pointed a write at
 * the repo instead of tmp must fail loudly here, not silently drop a key file into git status.
 */
function assertInTempDir(path) {
    const resolved = resolve(path);
    if (!resolved.startsWith(tmp + sep) && resolved !== tmp) {
        throw new Error(`test bug: refusing to write outside the tempdir: ${resolved}`);
    }
}

function writeInTemp(path, content) {
    assertInTempDir(path);
    writeFileSync(path, content);
    return path;
}

function signPayload(payload, privateKey) {
    return cryptoSign(null, Buffer.from(payload, 'utf8'), privateKey).toString('base64');
}

/** Build a fully-signed record object (schema..sig, in order) for one throwaway keypair. */
function buildRecord({ privateKey, publicKey, commit = 'abc1234', manifestBytes, prev = null, keyIdOverride = null, signedAt = '2026-08-09T12:00:00Z' }) {
    const bytes = manifestBytes ?? Buffer.from(JSON.stringify({ commit }));
    const record = {
        schema: 1,
        alg: 'ed25519',
        keyId: keyIdOverride ?? keyIdFor(publicKey),
        commit,
        manifest: '/integrity-manifest.json',
        manifestHash: sriSha384(bytes),
        signedAt,
        prev,
    };
    const sig = signPayload(canonicalPayload(record), privateKey);
    return { ...record, sig };
}

describe('canonicalPayload / keyIdFor / sriSha384 / chainHash (pure helpers)', () => {
    it('canonicalPayload rebuilds a fixed key order regardless of input order, and drops sig', () => {
        const inOrder = { schema: 1, alg: 'ed25519', keyId: 'k', commit: 'c', manifest: '/integrity-manifest.json', manifestHash: 'sha384-x', signedAt: '2026-08-09T12:00:00Z', prev: null, sig: 'ignored' };
        const shuffled = { sig: 'ignored', prev: null, signedAt: '2026-08-09T12:00:00Z', manifestHash: 'sha384-x', manifest: '/integrity-manifest.json', commit: 'c', keyId: 'k', alg: 'ed25519', schema: 1 };
        expect(canonicalPayload(inOrder)).toBe(canonicalPayload(shuffled));
        expect(canonicalPayload(inOrder)).not.toContain('ignored');
    });

    it('keyIdFor is 32 lowercase hex chars and differs between two keys', () => {
        const a = generateKeyPairSync('ed25519').publicKey;
        const b = generateKeyPairSync('ed25519').publicKey;
        expect(keyIdFor(a)).toMatch(/^[0-9a-f]{32}$/);
        expect(keyIdFor(a)).not.toBe(keyIdFor(b));
    });

    it('sriSha384 matches the sha384-<base64> SRI shape', () => {
        expect(sriSha384(Buffer.from('hello'))).toMatch(/^sha384-[A-Za-z0-9+/]+=*$/);
    });

    it('chainHash matches the sha256-<base64> shape and is stable for identical bytes', () => {
        const h1 = chainHash('{"a":1}');
        const h2 = chainHash(Buffer.from('{"a":1}', 'utf8'));
        expect(h1).toMatch(/^sha256-[A-Za-z0-9+/]+=*$/);
        expect(h1).toBe(h2);
    });
});

describe('verifyLog: signature checking', () => {
    it('1. a validly signed record verifies', () => {
        const { privateKey, publicKey } = generateKeyPairSync('ed25519');
        const record = buildRecord({ privateKey, publicKey });
        const text = JSON.stringify(record) + '\n';

        const result = verifyLog(text, { publicKey });
        expect(result.ok).toBe(true);
        expect(result.recordCount).toBe(1);
        expect(result.records[0].shapeOk).toBe(true);
        expect(result.records[0].chainOk).toBe(true);
        expect(result.records[0].sigOk).toBe(true);
        expect(result.records[0].keyIdMatch).toBe(true);
    });

    it('2. a tampered manifest is caught: recomputed hash no longer matches the signed manifestHash', () => {
        const { privateKey, publicKey } = generateKeyPairSync('ed25519');
        const originalManifest = Buffer.from(JSON.stringify({ commit: 'abc1234', assets: {} }));
        const record = buildRecord({ privateKey, publicKey, manifestBytes: originalManifest });

        // The record still verifies structurally and cryptographically as its own object...
        const text = JSON.stringify(record) + '\n';
        expect(verifyLog(text, { publicKey }).ok).toBe(true);

        // ...but the manifest it claims to describe has since changed (this is exactly what the
        // verifier CLI's --manifest flag checks, by recomputing sriSha384 on the file's current
        // bytes and comparing against record.manifestHash).
        const tamperedManifest = Buffer.from(JSON.stringify({ commit: 'abc1234', assets: { '/evil.js': 'sha384-x' } }));
        expect(sriSha384(tamperedManifest)).not.toBe(record.manifestHash);
    });

    it('3. a tampered record field (commit) fails signature verification', () => {
        const { privateKey, publicKey } = generateKeyPairSync('ed25519');
        const record = buildRecord({ privateKey, publicKey, commit: 'abc1234' });
        const tampered = { ...record, commit: 'evilcommit' }; // sig now covers the wrong payload
        const text = JSON.stringify(tampered) + '\n';

        const result = verifyLog(text, { publicKey });
        expect(result.ok).toBe(false);
        expect(result.records[0].sigOk).toBe(false);
    });

    it('3b. a tampered signedAt field also fails signature verification', () => {
        const { privateKey, publicKey } = generateKeyPairSync('ed25519');
        const record = buildRecord({ privateKey, publicKey });
        const tampered = { ...record, signedAt: '2099-01-01T00:00:00Z' };
        const result = verifyLog(JSON.stringify(tampered) + '\n', { publicKey });
        expect(result.ok).toBe(false);
        expect(result.records[0].sigOk).toBe(false);
    });

    it('4a. a signature checked against the wrong key fails', () => {
        const key1 = generateKeyPairSync('ed25519');
        const key2 = generateKeyPairSync('ed25519');
        const record = buildRecord({ privateKey: key1.privateKey, publicKey: key1.publicKey });
        const text = JSON.stringify(record) + '\n';

        const result = verifyLog(text, { publicKey: key2.publicKey });
        expect(result.ok).toBe(false);
        expect(result.records[0].keyIdMatch).toBe(false); // caught by keyId first
    });

    it('4b. a valid signature but wrong announced keyId is reported as a key-id mismatch, distinct from a bad signature', () => {
        const { privateKey, publicKey } = generateKeyPairSync('ed25519');
        // keyId itself is part of the signed payload, so signing with a bogus-but-self-consistent
        // keyId produces a record whose sig genuinely verifies against `publicKey` (it was signed
        // by that exact key, over that exact payload including the wrong keyId field), while the
        // announced keyId still does not match keyIdFor(publicKey).
        const bogusKeyId = 'f'.repeat(32);
        const record = buildRecord({ privateKey, publicKey, keyIdOverride: bogusKeyId });
        expect(record.keyId).not.toBe(keyIdFor(publicKey));

        const result = verifyLog(JSON.stringify(record) + '\n', { publicKey });
        expect(result.records[0].sigOk).toBe(true); // the bytes genuinely verify...
        expect(result.records[0].keyIdMatch).toBe(false); // ...but the announced keyId is wrong
        expect(result.records[0].sigError).toMatch(/keyId mismatch/);
        expect(result.ok).toBe(false); // and the overall record is still invalid
    });
});

describe('verifyLog: append-only chain', () => {
    function twoRecordLog() {
        const { privateKey, publicKey } = generateKeyPairSync('ed25519');
        const r1 = buildRecord({ privateKey, publicKey, commit: 'aaa1111', signedAt: '2026-08-09T12:00:00Z' });
        const line1 = JSON.stringify(r1);
        const r2 = buildRecord({ privateKey, publicKey, commit: 'bbb2222', prev: chainHash(line1), signedAt: '2026-08-09T13:00:00Z' });
        const line2 = JSON.stringify(r2);
        return { publicKey, privateKey, r1, r2, line1, line2, text: line1 + '\n' + line2 + '\n' };
    }

    it('5a. two legitimate, correctly-chained records verify cleanly', () => {
        const { publicKey, text, line1 } = twoRecordLog();
        const result = verifyLog(text, { publicKey });
        expect(result.ok).toBe(true);
        expect(result.recordCount).toBe(2);
        expect(result.chainOk).toBe(true);
        expect(result.records[0].record.prev).toBeNull();
        expect(result.records[1].record.prev).toBe(chainHash(line1));
    });

    it('5b. rewriting an earlier line is detected by the chain, naming the first offending line', () => {
        const { privateKey, publicKey, r2, line2 } = twoRecordLog();
        // Re-sign a DIFFERENT line 1 (different signedAt -> different bytes -> different hash),
        // but keep line 2 exactly as it was, still pointing at the ORIGINAL line 1's hash.
        const rewrittenR1 = buildRecord({ privateKey, publicKey, commit: 'aaa1111', signedAt: '2026-08-09T12:30:00Z' });
        const tamperedText = JSON.stringify(rewrittenR1) + '\n' + line2 + '\n';

        const result = verifyLog(tamperedText, { publicKey });
        expect(result.chainOk).toBe(false);
        expect(result.firstChainBreakLine).toBe(2);
        expect(result.records[1].chainOk).toBe(false);
        expect(result.records[1].chainError).toMatch(/prev mismatch/);
        expect(result.ok).toBe(false);
        void r2; // (kept for clarity that we intentionally did not touch line 2)
    });

    it('5c. appending a second legitimate record to a real file chains and verifies (via signLog)', () => {
        const { privateKey, publicKey } = generateKeyPairSync('ed25519');
        const manifestPath = writeInTemp(join(tmp, 'integrity-manifest.json'), JSON.stringify({ commit: 'cafe001', assets: {} }));
        const logPath = join(tmp, 'integrity-log.jsonl');
        assertInTempDir(logPath);

        const first = signLog({ manifestPath, logPath, privateKey, now: () => new Date('2026-08-09T12:00:00Z') });
        expect(first.appended).toBe(true);
        expect(readFileSync(logPath, 'utf8').split('\n').filter(Boolean)).toHaveLength(1);

        // Change the manifest so the second signature is not a rejected duplicate.
        writeInTemp(manifestPath, JSON.stringify({ commit: 'cafe002', assets: {} }));
        const second = signLog({ manifestPath, logPath, privateKey, now: () => new Date('2026-08-09T13:00:00Z') });
        expect(second.appended).toBe(true);

        const finalText = readFileSync(logPath, 'utf8');
        expect(finalText.split('\n').filter(Boolean)).toHaveLength(2);
        const result = verifyLog(finalText, { publicKey });
        expect(result.ok).toBe(true);
        expect(result.recordCount).toBe(2);
        expect(result.records[0].record.prev).toBeNull();
        expect(result.records[1].record.prev).not.toBeNull();
    });
});

describe('verifyLog: empty log', () => {
    it('6. zero bytes is a valid, unsigned log: 0 records, ok', () => {
        const result = verifyLog('', {});
        expect(result.ok).toBe(true);
        expect(result.recordCount).toBe(0);
        expect(result.chainOk).toBe(true);
    });

    it('parseLog("") returns an empty array', () => {
        expect(parseLog('')).toEqual([]);
    });
});

describe('the committed landing/integrity-log.jsonl', () => {
    it('7. is currently empty (no production key exists yet; see task boundary)', () => {
        const bytes = readFileSync(realLogPath);
        expect(bytes.length).toBe(0);
    });

    it('7b. passes structural + chain verification as-is', () => {
        const text = readFileSync(realLogPath, 'utf8');
        const result = verifyLog(text, {});
        expect(result.ok).toBe(true);
        expect(result.recordCount).toBe(0);
    });

    it('7c. the verifier CLI exits 0 against the committed log by default', () => {
        // No --key: only structure + chain are checked, which is exactly what an empty log needs
        // to pass. Runs the real CLI as a subprocess so this also covers its exit-code contract.
        const output = execFileSync(process.execPath, [integrityLogScript], { cwd: root, encoding: 'utf8' });
        expect(output).toMatch(/0 record\(s\)/);
        expect(output).toMatch(/CAVEAT: no --key was given/);
    });
});

describe('sign-integrity-log CLI: refuses to create key material', () => {
    it('8. exits non-zero and creates nothing when no key is supplied', () => {
        const beforeRoot = readdirSync(root).sort();
        const beforeScripts = readdirSync(join(root, 'scripts')).sort();
        const beforeLanding = readdirSync(join(root, 'landing')).sort();
        const beforeLogBytes = readFileSync(realLogPath).length;

        let threw = false;
        try {
            execFileSync(process.execPath, [signIntegrityLogScript], {
                cwd: root,
                encoding: 'utf8',
                env: { ...process.env, WYMBER_SIGNING_KEY: '' },
            });
        } catch (err) {
            threw = true;
            expect(err.status).not.toBe(0);
            expect(err.stderr).toMatch(/never creates one/);
            expect(err.stderr).toMatch(/generateKeyPairSync/);
        }
        expect(threw).toBe(true);

        // Nothing new appeared anywhere this script could plausibly have written to, and the
        // real (empty) log is still empty.
        expect(readdirSync(root).sort()).toEqual(beforeRoot);
        expect(readdirSync(join(root, 'scripts')).sort()).toEqual(beforeScripts);
        expect(readdirSync(join(root, 'landing')).sort()).toEqual(beforeLanding);
        expect(readFileSync(realLogPath).length).toBe(beforeLogBytes);
    });

    it('9. refuses a --key path inside the repository working tree, before ever reading it', () => {
        // This path need not even exist: the containment check runs on the path string, before
        // any file read, specifically so this test never has to place a key file inside the repo
        // (forbidden by the task's key-material rules) to prove the refusal works.
        const inRepoKeyPath = join(root, 'scripts', 'definitely-not-a-real-key.pem');
        expect(existsSync(inRepoKeyPath)).toBe(false);

        const beforeLogBytes = readFileSync(realLogPath).length;
        let threw = false;
        try {
            execFileSync(process.execPath, [signIntegrityLogScript, '--key', inRepoKeyPath], {
                cwd: root,
                encoding: 'utf8',
                env: { ...process.env, WYMBER_SIGNING_KEY: '' },
            });
        } catch (err) {
            threw = true;
            expect(err.status).not.toBe(0);
            expect(err.stderr).toMatch(/working tree/);
        }
        expect(threw).toBe(true);
        expect(existsSync(inRepoKeyPath)).toBe(false);
        expect(readFileSync(realLogPath).length).toBe(beforeLogBytes);
    });

    it('loadSigningKey() also refuses a repo-relative path directly (library-level, same check)', () => {
        expect(() => loadSigningKey(join(root, 'landing', 'integrity-manifest.json')))
            .toThrow(/working tree/);
    });

    it('resolveSigningKeyPath prefers --key over WYMBER_SIGNING_KEY', () => {
        expect(resolveSigningKeyPath({ keyArg: '/a', env: { WYMBER_SIGNING_KEY: '/b' } })).toBe('/a');
        expect(resolveSigningKeyPath({ keyArg: null, env: { WYMBER_SIGNING_KEY: '/b' } })).toBe('/b');
        expect(resolveSigningKeyPath({ keyArg: null, env: {} })).toBeNull();
    });
});

describe('signLog(): duplicate refusal, --force, and --dry-run', () => {
    it('refuses to sign the same manifest+key twice without --force', () => {
        const { privateKey } = generateKeyPairSync('ed25519');
        const manifestPath = writeInTemp(join(tmp, 'integrity-manifest.json'), JSON.stringify({ commit: 'dupe001', assets: {} }));
        const logPath = join(tmp, 'integrity-log.jsonl');

        signLog({ manifestPath, logPath, privateKey });
        expect(() => signLog({ manifestPath, logPath, privateKey })).toThrow(/already signs this exact manifest/);

        // --force overrides the refusal and appends a second record for the same manifest.
        const forced = signLog({ manifestPath, logPath, privateKey, force: true });
        expect(forced.appended).toBe(true);
        expect(readFileSync(logPath, 'utf8').split('\n').filter(Boolean)).toHaveLength(2);
    });

    it('--dry-run prints/returns the record but writes nothing', () => {
        const { privateKey } = generateKeyPairSync('ed25519');
        const manifestPath = writeInTemp(join(tmp, 'integrity-manifest.json'), JSON.stringify({ commit: 'dry0001', assets: {} }));
        const logPath = join(tmp, 'integrity-log.jsonl');

        const result = signLog({ manifestPath, logPath, privateKey, dryRun: true });
        expect(result.appended).toBe(false);
        expect(result.record.commit).toBe('dry0001');
        expect(existsSync(logPath)).toBe(false);
    });
});

describe('guard: no tracked source file contains a private-key PEM header', () => {
    it('10. scripts/, landing/, and frontend/ contain no "BEGIN ... PRIVATE KEY" text', () => {
        const tracked = execFileSync('git', ['ls-files', 'scripts', 'landing', 'frontend'], { cwd: root, encoding: 'utf8' })
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean);
        expect(tracked.length).toBeGreaterThan(0);

        const pemPrivateKeyRe = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/;
        const offenders = [];
        for (const relPath of tracked) {
            const full = join(root, relPath);
            let content;
            try {
                content = readFileSync(full, 'utf8');
            } catch {
                continue; // binary file (image, etc.): can't contain a PEM header we care about
            }
            if (pemPrivateKeyRe.test(content)) offenders.push(relPath);
        }
        expect(offenders).toEqual([]);
    });
});
