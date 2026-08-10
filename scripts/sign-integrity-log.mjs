#!/usr/bin/env node
/**
 * ADR-0003 Layer 2: sign the currently-published landing/integrity-manifest.json and append one
 * record to the hash-chained transparency log, landing/integrity-log.jsonl. Owner-run, by hand,
 * never by CI (CI has no key; see .github/workflows/ci.yml, which only structurally/chain-verifies
 * the log on every push, never signs it).
 *
 * Signing is INFORMATIONAL ONLY (see scripts/integrity-log.mjs's header comment): this script
 * never touches the running app, and nothing anywhere gates on whether a build got signed.
 *
 * ABSOLUTE BOUNDARY, enforced in code below, not just by convention: this script NEVER creates a
 * signing key. If WYMBER_SIGNING_KEY / --key is absent, it prints the key-generation ceremony for
 * the owner to run FOR THEMSELVES, and creates nothing. It also refuses any key path that resolves
 * inside this repository's working tree, a signing key committed even by accident defeats the
 * entire point of Layer 2 (the log would be signable by anyone who can read the repo).
 */
import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { createPrivateKey, createPublicKey, sign as cryptoSign } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { canonicalPayload, keyIdFor, sriSha384, chainHash, parseLog, verifyLog } from './integrity-log.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const KEY_CEREMONY = `
[sign-integrity-log] No signing key was given (no --key, no WYMBER_SIGNING_KEY). This script
never creates one, that boundary is deliberate: a production signing key must be generated once,
by the owner, on a machine they control, and must never touch this repository or any git history.

To generate a NEW Ed25519 keypair (stdlib only, run this yourself, ONCE, from a directory OUTSIDE
any git checkout of this repo):

  node -e "const{generateKeyPairSync}=require('node:crypto');const{writeFileSync}=require('node:fs');const{privateKey,publicKey}=generateKeyPairSync('ed25519');writeFileSync('wymber-signing-key.pem',privateKey.export({type:'pkcs8',format:'pem'}));writeFileSync('wymber-signing-key.pub.pem',publicKey.export({type:'spki',format:'pem'}));console.log('wrote wymber-signing-key.pem (PRIVATE - keep offline, never commit, never share) and wymber-signing-key.pub.pem (publish this one)');"

That writes two files in your current directory:
  wymber-signing-key.pem      the PRIVATE key. Keep it offline (a password manager, an air-gapped
                               drive, a hardware key). Never commit it. Never put it in .secrets/
                               or anywhere inside a wymber checkout.
  wymber-signing-key.pub.pem  the PUBLIC key. This is what you publish, through a channel
                               independent of this repo/site (ADR-0003: "a client cannot prove its
                               own honesty" applies just as much to a log verifying itself, so the
                               key that checks it has to be findable somewhere else too).

Then sign, pointing this script at the private key's path from OUTSIDE the repo:

  WYMBER_SIGNING_KEY=/absolute/path/to/wymber-signing-key.pem node scripts/sign-integrity-log.mjs

(or: node scripts/sign-integrity-log.mjs --key /absolute/path/to/wymber-signing-key.pem)
`.trim();

/**
 * Is `candidatePath` inside this repository's working tree? Resolves relative to CWD, so it
 * catches "../wymber/oops.pem" and "./wymber-signing-key.pem" run from inside a checkout, not
 * just an absolute in-repo path.
 * @param {string} candidatePath
 * @returns {boolean}
 */
function isInsideRepo(candidatePath) {
    const resolved = resolve(candidatePath);
    const rel = relative(root, resolved);
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * `--key <path>` wins over the WYMBER_SIGNING_KEY env var; neither is required to be set (the
 * caller decides what "absent" means).
 * @param {{ keyArg?: string|null, env?: NodeJS.ProcessEnv }} [options]
 * @returns {string|null}
 */
export function resolveSigningKeyPath({ keyArg = null, env = process.env } = {}) {
    return keyArg || env.WYMBER_SIGNING_KEY || null;
}

/**
 * Load and validate a private signing key from disk. Checks repo-containment BEFORE ever reading
 * the file, so a bad --key value is refused without this script touching anything inside the
 * repo at all, refusing purely on the path string.
 * @param {string} keyPath
 * @returns {import('node:crypto').KeyObject}
 */
export function loadSigningKey(keyPath) {
    if (isInsideRepo(keyPath)) {
        throw new Error(`refusing to use a signing key inside this repository's working tree: ${keyPath} (a signing key must live outside the repo it signs; see the key-generation ceremony this script prints when no key is given)`);
    }
    if (!existsSync(keyPath)) {
        throw new Error(`no file at ${keyPath}`);
    }
    const pem = readFileSync(keyPath, 'utf8');
    const privateKey = createPrivateKey({ key: pem, format: 'pem' });
    if (privateKey.asymmetricKeyType !== 'ed25519') {
        throw new Error(`key at ${keyPath} is ${privateKey.asymmetricKeyType}, not ed25519`);
    }
    return privateKey;
}

/**
 * The actual sign-and-append logic, factored out from the CLI entrypoint below so it takes
 * explicit paths rather than hardcoding landing/integrity-manifest.json and
 * landing/integrity-log.jsonl. This mirrors scripts/integrity-manifest.mjs's split between
 * writeManifest(distDir, options) and its CLI wrapper: it lets frontend/tests/integrity-log.test.js
 * exercise the real signing/append/re-verify logic against tempdir files, without ever touching
 * this repo's actual committed manifest or log (both of which are otherwise off-limits, per the
 * task boundary that keeps landing/integrity-log.jsonl empty until a real key exists).
 *
 * @param {{
 *   manifestPath: string, logPath: string, privateKey: import('node:crypto').KeyObject,
 *   manifestUrl?: string, dryRun?: boolean, force?: boolean, now?: () => Date
 * }} options
 * @returns {{ record: object, publicKeySpkiPem: string, keyId: string, appended: boolean }}
 */
export function signLog({ manifestPath, logPath, privateKey, manifestUrl = '/integrity-manifest.json', dryRun = false, force = false, now = () => new Date() }) {
    const publicKey = createPublicKey(privateKey);
    const keyId = keyIdFor(publicKey);
    const publicKeySpkiPem = publicKey.export({ type: 'spki', format: 'pem' });

    const manifestBytes = readFileSync(manifestPath);
    const manifest = JSON.parse(manifestBytes);
    // The manifest's OWN `commit` field, deliberately not `git rev-parse HEAD`: the landing
    // manifest is a release snapshot that legitimately trails HEAD (it is refreshed by hand, see
    // scripts/integrity-manifest.mjs --publish), so signing must describe the artifact being
    // signed, not whatever commit the signer's checkout happens to be sitting on.
    if (typeof manifest.commit !== 'string' || manifest.commit.length === 0) {
        throw new Error(`${manifestPath} has no usable "commit" field to sign`);
    }
    const manifestHash = sriSha384(manifestBytes);

    const existingText = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '';
    // Throws with a line number if the existing log is already corrupt; refuse to build a new,
    // validly-chained record on top of a log that isn't trustworthy to begin with.
    const entries = parseLog(existingText);

    const last = entries.length ? entries[entries.length - 1] : null;
    if (last && last.record.manifestHash === manifestHash && last.record.keyId === keyId && !force) {
        throw new Error(`the newest record (line ${last.line}) already signs this exact manifest with this key (keyId ${keyId}); nothing changed since. Pass --force to sign again anyway.`);
    }

    const prev = last ? chainHash(last.raw) : null;

    const record = {
        schema: 1,
        alg: 'ed25519',
        keyId,
        commit: manifest.commit,
        manifest: manifestUrl,
        manifestHash,
        // Whole-second UTC, no milliseconds, matching the documented "2026-08-09T12:34:56Z" shape.
        signedAt: now().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        prev,
    };

    const payload = canonicalPayload(record);
    const sig = cryptoSign(null, Buffer.from(payload, 'utf8'), privateKey).toString('base64');
    const fullRecord = { ...record, sig };
    const newLine = JSON.stringify(fullRecord);

    if (dryRun) {
        return { record: fullRecord, publicKeySpkiPem, keyId, appended: false };
    }

    // Append-only, enforced, not just assumed: capture the exact bytes before writing, then
    // assert afterwards that the file grew by precisely the appended line and that every byte
    // that existed before is still there, unchanged, at the same offset. This is the concrete
    // check behind "never rewrites an existing line."
    const beforeBuf = existsSync(logPath) ? readFileSync(logPath) : Buffer.alloc(0);
    appendFileSync(logPath, newLine + '\n');
    const afterBuf = readFileSync(logPath);
    const appendedBuf = Buffer.from(newLine + '\n', 'utf8');
    const grewCorrectly = afterBuf.length === beforeBuf.length + appendedBuf.length &&
        afterBuf.subarray(0, beforeBuf.length).equals(beforeBuf);
    if (!grewCorrectly) {
        throw new Error(`${logPath} did not grow by exactly the appended record; refusing to trust it. Inspect it by hand (git diff) before signing again.`);
    }

    // Re-verify the log we just wrote, with the key we just signed with. If this fails, something
    // is wrong beyond the append-only check above (canonicalPayload()/crypto.sign() disagreeing,
    // a chain computation bug, etc.), and the operator needs to know NOW, at signing time, not the
    // next time someone happens to run the verifier.
    const verifyResult = verifyLog(readFileSync(logPath, 'utf8'), { publicKey });
    if (!verifyResult.ok) {
        throw new Error(`appended the record, but re-verifying the log afterwards FAILED: ${logPath} is now suspect. Do not publish it; inspect by hand. Detail: ${JSON.stringify(verifyResult)}`);
    }

    return { record: fullRecord, publicKeySpkiPem, keyId, appended: true };
}

// ------------------------------------------------------------------------------------------------
// CLI: `node scripts/sign-integrity-log.mjs [--key <path>] [--dry-run] [--force]`
// ------------------------------------------------------------------------------------------------

function parseArgs(argv) {
    const args = { key: null, dryRun: false, force: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--key') args.key = argv[++i];
        else if (a === '--dry-run') args.dryRun = true;
        else if (a === '--force') args.force = true;
        else throw new Error(`unrecognised argument: ${a}`);
    }
    return args;
}

function main(argv) {
    const args = parseArgs(argv);
    const keyPath = resolveSigningKeyPath({ keyArg: args.key });
    if (!keyPath) {
        console.error(KEY_CEREMONY);
        process.exitCode = 1;
        return;
    }

    let privateKey;
    try {
        privateKey = loadSigningKey(keyPath);
    } catch (err) {
        console.error(`[sign-integrity-log] ${err.message}`);
        process.exitCode = 1;
        return;
    }

    const manifestPath = join(root, 'landing', 'integrity-manifest.json');
    const logPath = join(root, 'landing', 'integrity-log.jsonl');

    let result;
    try {
        result = signLog({ manifestPath, logPath, privateKey, dryRun: args.dryRun, force: args.force });
    } catch (err) {
        console.error(`[sign-integrity-log] ${err.message}`);
        process.exitCode = 1;
        return;
    }

    console.log(args.dryRun
        ? '[sign-integrity-log] DRY RUN, nothing written. Record that would be appended:'
        : `[sign-integrity-log] appended a record to ${logPath}`);
    console.log(JSON.stringify(result.record, null, 2));
    console.log('');
    console.log('Publish this public key (through a channel independent of this repo/site, per');
    console.log('ADR-0003) so verifiers can check the signature above against it:');
    console.log(result.publicKeySpkiPem.trim());
    console.log(`keyId: ${result.keyId}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
    try {
        main(process.argv.slice(2));
    } catch (err) {
        console.error(`[sign-integrity-log] ${err.message}`);
        process.exitCode = 1;
    }
}
