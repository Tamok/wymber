#!/usr/bin/env node
/**
 * ADR-0003 Layer 2: an Ed25519 signature over the published integrity manifest
 * (landing/integrity-manifest.json), recorded as an append-only, hash-chained transparency log
 * (landing/integrity-log.jsonl, JSONL: one JSON object per line). This file is the shared
 * library (imported by scripts/sign-integrity-log.mjs and by tests) AND the verifier CLI a
 * stranger runs: `node scripts/integrity-log.mjs`. Stdlib-only (node:crypto's Ed25519 support),
 * no npm install needed, so it works straight out of a fresh `git clone`.
 *
 * IMPORTANT, and this is the whole point of Layer 2 per ADR-0003 ("a client cannot prove its own
 * honesty"): signing is INFORMATIONAL ONLY. Nothing in the running app reads this file or this
 * log, nothing gates on whether a build is signed, and a missing or failed signature never
 * degrades the app. This log exists so a THIRD PARTY, outside wymber.app, can check "was this
 * manifest actually endorsed by the keyholder, and has this log been rewritten since." Verifying
 * it here, against a key fetched from this same repo, is a weaker claim than that; see the CLI's
 * printed caveats below, and cross-check the key independently before trusting a green result.
 *
 * Record schema (JSONL, one object per line, no trailing whitespace, file ends with a newline
 * when non-empty). Keys are written in EXACTLY this order — the order is load-bearing, it is
 * the shape of the canonical payload that gets signed (see canonicalPayload() below):
 *
 *   schema        1
 *   alg           "ed25519"
 *   keyId         first 32 hex chars of sha256(public key SPKI DER)
 *   commit        the `commit` field copied from the manifest being signed
 *   manifest      the public URL path of the manifest, e.g. "/integrity-manifest.json"
 *   manifestHash  "sha384-<base64>" SRI hash of the manifest file's exact bytes
 *   signedAt      ISO-8601 UTC, e.g. "2026-08-09T12:34:56Z"
 *   prev          "sha256-<base64>" of the PREVIOUS line's exact bytes (no trailing newline),
 *                 or null for the first record
 *   sig           base64 Ed25519 signature, over canonicalPayload(record) (this field itself is
 *                 excluded from what it signs, obviously)
 *
 * canonicalPayload() ALWAYS rebuilds the object in this fixed order via destructuring, rather
 * than trusting whatever order a parsed record happens to have. Two reasons: (1) it is the one
 * function scripts/sign-integrity-log.mjs and this file's own verifyLog() both call, so the
 * signer and the verifier structurally cannot compute the payload differently and silently
 * disagree; (2) it makes signature verification robust to a JSON reserializer that preserves the
 * *values* but not the *order* of an object's keys (JS itself preserves string-key insertion
 * order, so an untouched log round-trips fine, but nothing stops a future tool from normalizing
 * it). validateShape() below separately checks that the bytes on disk actually use this order,
 * because THAT is part of the documented format even though the signature check does not depend
 * on it.
 */
import { readFileSync, existsSync } from 'node:fs';
import { createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_LOG_PATH = join(root, 'landing', 'integrity-log.jsonl');

// Keys of a record, in the order the format requires (see the header comment above).
const REQUIRED_FIELDS = ['schema', 'alg', 'keyId', 'commit', 'manifest', 'manifestHash', 'signedAt', 'prev', 'sig'];
// Same, minus `sig`: this is what gets signed (see canonicalPayload()).
const PAYLOAD_FIELDS = REQUIRED_FIELDS.filter((k) => k !== 'sig');

/**
 * The exact bytes that get signed / that a signature is checked against, for one record. Rebuilds
 * the object in the fixed field order via destructuring (see header comment: this is deliberate,
 * not incidental) and JSON.stringifies it. `record.sig`, if present, is dropped: a signature
 * cannot cover itself. Both scripts/sign-integrity-log.mjs and verifyLog() below call this same
 * function, so they cannot drift apart.
 * @param {object} record
 * @returns {string}
 */
export function canonicalPayload(record) {
    const { schema, alg, keyId, commit, manifest, manifestHash, signedAt, prev } = record;
    return JSON.stringify({ schema, alg, keyId, commit, manifest, manifestHash, signedAt, prev });
}

/**
 * The keyId a record should carry for a given Ed25519 public key: the first 32 hex characters of
 * sha256(the key's SPKI DER encoding). Not the whole hash, this is a short, human-glanceable tag
 * for "which key signed this," not a security boundary in itself (the actual proof is the
 * signature; keyId just lets a reader tell keys apart, and lets the verifier catch a record that
 * *claims* a different key than the one it was actually signed with, see verifyLog()'s
 * keyId-mismatch check).
 * @param {import('node:crypto').KeyObject} publicKey an Ed25519 public key
 * @returns {string} 32 lowercase hex characters
 */
export function keyIdFor(publicKey) {
    const der = publicKey.export({ type: 'spki', format: 'der' });
    return createHash('sha256').update(der).digest('hex').slice(0, 32);
}

/**
 * SHA-384 of `bytes`, in SRI format ('sha384-' + base64 digest). Identical in shape to
 * scripts/integrity-manifest.mjs's sriHash(); duplicated rather than imported because that file's
 * hasher is a private, unexported helper and pulling in the whole manifest-writing module for one
 * hash function would be the wrong direction of coupling (this file has nothing to do with
 * building dist/).
 * @param {Buffer|Uint8Array} bytes
 * @returns {string}
 */
export function sriSha384(bytes) {
    return 'sha384-' + createHash('sha384').update(bytes).digest('base64');
}

/**
 * The chain hash of one JSONL line's exact bytes (no trailing newline): 'sha256-' + base64
 * digest. This is what the NEXT record's `prev` field must equal, which is what makes the log
 * append-only in practice: rewriting an earlier line changes its hash, which breaks every `prev`
 * pointer after it, and verifyLog() names the first line where that break is detected.
 * @param {Buffer|string} lineBytes the exact bytes (or utf8 text) of one log line, no newline
 * @returns {string}
 */
export function chainHash(lineBytes) {
    const buf = Buffer.isBuffer(lineBytes) ? lineBytes : Buffer.from(lineBytes, 'utf8');
    return 'sha256-' + createHash('sha256').update(buf).digest('base64');
}

/**
 * Normalize CRLF/CR to LF. This repo's core.autocrlf=true (see docs/adr/0003-...md's own note on
 * scripts/csp.mjs) rewrites this file's committed LF line endings to CRLF on a Windows checkout.
 * Without normalizing before splitting into lines, the "exact bytes of the previous line" that
 * chainHash() sees would differ by platform: the same log would chain-verify on Linux CI and fail
 * on a contributor's Windows machine, for a reason that has nothing to do with tampering.
 * scripts/sign-integrity-log.mjs reads through parseLog() too, so it normalizes the same way
 * before computing `prev` for a new record, keeping signer and verifier in agreement regardless
 * of checkout platform.
 * @param {string} text
 * @returns {string}
 */
function normalizeNewlines(text) {
    return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Split `text` (the raw contents of integrity-log.jsonl) into records. Each line must be valid
 * JSON; a malformed line throws immediately, naming the 1-based line number, rather than being
 * silently skipped (a log verifier that quietly ignores a line it can't parse is exactly the kind
 * of "structural" failure this format exists to catch). An empty/whitespace-only input parses to
 * an empty array (0 records), which is a VALID, unsigned log, not an error.
 * @param {string} text
 * @returns {{ line: number, raw: string, record: object }[]}
 */
export function parseLog(text) {
    const normalized = normalizeNewlines(text);
    if (normalized.trim().length === 0) return [];
    const lines = normalized.split('\n');
    // A well-formed non-empty file ends with a newline, so the split leaves one trailing "" entry.
    if (lines[lines.length - 1] === '') lines.pop();
    return lines.map((raw, i) => {
        const line = i + 1;
        let record;
        try {
            record = JSON.parse(raw);
        } catch (err) {
            throw new Error(`[integrity-log] line ${line}: malformed JSON (${err.message})`);
        }
        return { line, raw, record };
    });
}

/**
 * Field/shape validity for one parsed record: exactly the required fields, in the required
 * order (see this file's header comment on why order is part of the format even though the
 * signature check itself does not depend on it), with the right types and value shapes.
 * @param {object} record
 * @returns {string[]} human-readable problems; empty means the shape is valid
 */
function validateShape(record) {
    if (record === null || typeof record !== 'object' || Array.isArray(record)) {
        return ['record is not a JSON object'];
    }
    const keys = Object.keys(record);
    const missing = REQUIRED_FIELDS.filter((k) => !(k in record));
    const extra = keys.filter((k) => !REQUIRED_FIELDS.includes(k));
    const errors = [];
    if (missing.length) errors.push(`missing field(s): ${missing.join(', ')}`);
    if (extra.length) errors.push(`unexpected field(s): ${extra.join(', ')}`);
    if (missing.length === 0 && extra.length === 0 && keys.join(',') !== REQUIRED_FIELDS.join(',')) {
        errors.push(`field order does not match the schema (expected: ${REQUIRED_FIELDS.join(', ')}; got: ${keys.join(', ')})`);
    }
    if (errors.length) return errors; // type checks below assume the fields are actually present

    if (record.schema !== 1) errors.push(`schema must be 1, got ${JSON.stringify(record.schema)}`);
    if (record.alg !== 'ed25519') errors.push(`alg must be "ed25519", got ${JSON.stringify(record.alg)}`);
    if (typeof record.keyId !== 'string' || !/^[0-9a-f]{32}$/.test(record.keyId)) {
        errors.push('keyId must be a 32-character lowercase hex string');
    }
    if (typeof record.commit !== 'string' || record.commit.length === 0) {
        errors.push('commit must be a non-empty string');
    }
    if (typeof record.manifest !== 'string' || !record.manifest.startsWith('/')) {
        errors.push('manifest must be a URL path starting with "/"');
    }
    if (typeof record.manifestHash !== 'string' || !/^sha384-[A-Za-z0-9+/]+=*$/.test(record.manifestHash)) {
        errors.push('manifestHash must be in sha384-<base64> SRI format');
    }
    if (typeof record.signedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(record.signedAt)) {
        errors.push('signedAt must be ISO-8601 UTC, e.g. "2026-08-09T12:34:56Z"');
    }
    if (!(record.prev === null || (typeof record.prev === 'string' && /^sha256-[A-Za-z0-9+/]+=*$/.test(record.prev)))) {
        errors.push('prev must be null or sha256-<base64>');
    }
    if (typeof record.sig !== 'string' || record.sig.length === 0) {
        errors.push('sig must be a non-empty base64 string');
    }
    return errors;
}

/**
 * Verify a log's structure, its hash chain, and (only if a public key is supplied) every
 * record's signature. Does NOT print anything, only reports; the CLI below is the thing that
 * prints, so this function stays usable from tests and from other tooling.
 *
 * An empty log (0 bytes, or whitespace-only) is VALID: 0 records, ok: true. There is nothing
 * dishonest about an unsigned, empty log, only an unsigned one that CLAIMS to have records.
 * @param {string} text raw contents of integrity-log.jsonl
 * @param {{ publicKey?: import('node:crypto').KeyObject|null }} [options]
 * @returns {{
 *   ok: boolean,
 *   recordCount: number,
 *   records: { line: number, record: object|null, shapeOk: boolean, shapeErrors: string[],
 *              chainOk: boolean, chainError: string|null,
 *              sigOk: boolean|null, keyIdMatch: boolean|null, sigError: string|null }[],
 *   chainOk: boolean,
 *   firstChainBreakLine: number|null,
 *   signaturesChecked: boolean,
 *   parseError: string|null
 * }}
 */
export function verifyLog(text, { publicKey = null } = {}) {
    let entries;
    try {
        entries = parseLog(text);
    } catch (err) {
        return {
            ok: false,
            recordCount: 0,
            records: [],
            chainOk: false,
            firstChainBreakLine: null,
            signaturesChecked: Boolean(publicKey),
            parseError: err.message,
        };
    }

    const records = [];
    let chainOk = true;
    let firstChainBreakLine = null;
    let prevRaw = null; // normalized raw bytes (string) of the previous line, or null before line 1

    for (const { line, raw, record } of entries) {
        const shapeErrors = validateShape(record);
        const shapeOk = shapeErrors.length === 0;

        const rec = {
            line,
            record: (record && typeof record === 'object' && !Array.isArray(record)) ? record : null,
            shapeOk,
            shapeErrors,
            chainOk: true,
            chainError: null,
            sigOk: null,
            keyIdMatch: null,
            sigError: null,
        };

        // Chain check: independent of shape validity as long as `prev` is present at all, so a
        // record with some OTHER field problem still gets an honest chain verdict.
        if (record && typeof record === 'object' && 'prev' in record) {
            const expectedPrev = line === 1 ? null : chainHash(prevRaw);
            if (record.prev !== expectedPrev) {
                rec.chainOk = false;
                rec.chainError = `prev mismatch: expected ${expectedPrev === null ? 'null' : expectedPrev}, got ${JSON.stringify(record.prev)}`;
                if (chainOk) { chainOk = false; firstChainBreakLine = line; }
            }
        } else {
            rec.chainOk = false;
            rec.chainError = 'no "prev" field to check';
            if (chainOk) { chainOk = false; firstChainBreakLine = line; }
        }

        // Signature check: only when a key was supplied, and only when the shape is sound enough
        // to compute canonicalPayload() from (all the fields it reads must exist).
        if (publicKey && shapeOk) {
            try {
                const payload = canonicalPayload(record);
                const sigBuf = Buffer.from(record.sig, 'base64');
                const sigValid = cryptoVerify(null, Buffer.from(payload, 'utf8'), publicKey, sigBuf);
                const expectedKeyId = keyIdFor(publicKey);
                const keyIdMatch = record.keyId === expectedKeyId;
                rec.sigOk = sigValid;
                rec.keyIdMatch = keyIdMatch;
                // Reported distinctly on purpose: a record whose announced keyId does not match
                // the key you're checking against is a different failure than "the bytes don't
                // verify," even in the (rarer) case where the signature happens to validate too
                // (self-consistently signed over a wrong keyId field, see the format's `keyId`
                // comment above and frontend/tests/integrity-log.test.js for the concrete case).
                if (!keyIdMatch) rec.sigError = `keyId mismatch: record says ${record.keyId}, supplied key is ${expectedKeyId}`;
                else if (!sigValid) rec.sigError = 'signature does not verify against the supplied public key';
            } catch (err) {
                rec.sigOk = false;
                rec.sigError = err.message;
            }
        }

        records.push(rec);
        prevRaw = raw;
    }

    const ok = records.every((r) =>
        r.shapeOk &&
        r.chainOk &&
        (r.sigOk === null || r.sigOk === true) &&
        (r.keyIdMatch === null || r.keyIdMatch === true));

    return {
        ok,
        recordCount: records.length,
        records,
        chainOk,
        firstChainBreakLine,
        signaturesChecked: Boolean(publicKey),
        parseError: null,
    };
}

// ------------------------------------------------------------------------------------------------
// CLI: `node scripts/integrity-log.mjs [--log <path>] [--key <path-or-inline-spki>]
//       [--manifest <path>] [--require-signed]`
//
// `--log` defaults to this repo's committed landing/integrity-log.jsonl, which is the convenient
// case (and what CI runs), but it is the WEAK one: a log checked out of the same repo as the
// verifier only tells you the repo is internally consistent. The check this file actually exists
// for is the out-of-band one, where every input comes from somewhere different:
//
//   curl -o log.jsonl      https://wymber.app/integrity-log.jsonl          # the landing origin
//   curl -o manifest.json  https://web.wymber.app/integrity-manifest.json  # the app origin
//   dig +short TXT _wymber-integrity.wymber.app                            # the key, third source
//   node scripts/integrity-log.mjs --log log.jsonl --manifest manifest.json --key <the key>
//
// That is why --log is a flag rather than a hardcoded path: without it a stranger could only ever
// verify the copy sitting next to the verifier, which proves the least of any of these.
// ------------------------------------------------------------------------------------------------

const USAGE = `Usage: node scripts/integrity-log.mjs [options]

  --log <path>       transparency log to verify (default: landing/integrity-log.jsonl)
  --key <path|b64>   Ed25519 public key, PEM file, or inline/file base64 SPKI. Without it,
                     only structure and the hash chain are checked, never signatures.
  --manifest <path>  also report whether any record covers this manifest file's exact bytes
  --require-signed   exit non-zero unless --manifest is covered by a record with a valid
                     signature from --key (off by default: signing gates nothing)
  --help             this message`;

/**
 * Load a public key from a `--key` argument, which may be: a path to a PEM public key file, a
 * path to a file containing inline base64 SPKI, or either of those passed as an inline string
 * rather than a path. Tries "is this a readable file" first; falls back to treating the value
 * itself as the key material.
 * @param {string} value
 * @returns {import('node:crypto').KeyObject}
 */
function loadPublicKeyArg(value) {
    const content = existsSync(value) ? readFileSync(value, 'utf8').trim() : value.trim();
    if (content.includes('BEGIN PUBLIC KEY')) {
        return createPublicKey({ key: content, format: 'pem' });
    }
    // Not a PEM block: treat as inline base64 SPKI DER (whitespace-stripped, in case it was
    // pasted with line breaks).
    const der = Buffer.from(content.replace(/\s+/g, ''), 'base64');
    if (der.length === 0) throw new Error(`--key value is neither a PEM public key nor decodable base64: ${value.slice(0, 40)}...`);
    return createPublicKey({ key: der, format: 'der', type: 'spki' });
}

function parseArgs(argv) {
    const args = { log: null, key: null, manifest: null, requireSigned: false, help: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--log') args.log = argv[++i];
        else if (a === '--key') args.key = argv[++i];
        else if (a === '--manifest') args.manifest = argv[++i];
        else if (a === '--require-signed') args.requireSigned = true;
        else if (a === '--help' || a === '-h') args.help = true;
        else throw new Error(`unrecognised argument: ${a}\n\n${USAGE}`);
    }
    return args;
}

function main(argv) {
    const args = parseArgs(argv);
    if (args.help) {
        console.log(USAGE);
        return;
    }
    const logPath = args.log ?? DEFAULT_LOG_PATH;
    // A missing --log is an error (the caller named a file that isn't there); a missing DEFAULT
    // log is just an unsigned repo, which is a valid state and reads as an empty log.
    if (args.log && !existsSync(logPath)) {
        console.error(`[integrity-log] no log file at ${logPath}`);
        process.exitCode = 1;
        return;
    }
    const text = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '';

    let publicKey = null;
    if (args.key) {
        try {
            publicKey = loadPublicKeyArg(args.key);
        } catch (err) {
            console.error(`[integrity-log] could not load --key: ${err.message}`);
            process.exitCode = 1;
            return;
        }
    }

    const result = verifyLog(text, { publicKey });

    console.log(`[integrity-log] verifying ${logPath}`);
    if (result.parseError) {
        console.error(`[integrity-log] FAILED TO PARSE: ${result.parseError}`);
    } else {
        console.log(`[integrity-log] ${result.recordCount} record(s)`);
        for (const r of result.records) {
            if (!r.shapeOk) console.error(`  line ${r.line}: INVALID SHAPE - ${r.shapeErrors.join('; ')}`);
            if (!r.chainOk) console.error(`  line ${r.line}: CHAIN BROKEN - ${r.chainError}`);
            if (publicKey && r.shapeOk) {
                if (!r.keyIdMatch) console.error(`  line ${r.line}: KEY-ID MISMATCH - ${r.sigError}`);
                else if (!r.sigOk) console.error(`  line ${r.line}: SIGNATURE INVALID`);
                else console.log(`  line ${r.line}: signature OK (commit ${r.record.commit}, keyId ${r.record.keyId})`);
            }
        }
    }

    console.log('');
    if (!publicKey) {
        console.log('CAVEAT: no --key was given. Only structure and the hash chain were checked.');
        console.log('Signatures were NOT verified. A structurally sound, unbroken chain is not proof');
        console.log('that any record here was actually signed by anyone in particular.');
    } else {
        console.log('CAVEAT: verifying against a key fetched from the same place as this log proves');
        console.log('little on its own, a party able to rewrite the log could publish a matching key');
        console.log('right next to it. Real assurance has to come from OUTSIDE this repo/site (see');
        console.log('docs/adr/0003-client-integrity-and-anti-phishing.md: "a client cannot prove its');
        console.log('own honesty" applies just as much to a log verifying itself). Cross-check this');
        console.log('key against a second, independent source before trusting a green result here.');
    }

    let requireSignedFailed = false;
    if (args.manifest) {
        const manifestBytes = readFileSync(args.manifest);
        const hash = sriSha384(manifestBytes);
        const matches = result.records.filter((r) => r.record && r.record.manifestHash === hash);
        console.log('');
        if (matches.length === 0) {
            console.log(`[integrity-log] no record's manifestHash matches ${args.manifest} (${hash})`);
            if (args.requireSigned) requireSignedFailed = true;
        } else {
            for (const m of matches) {
                const sigNote = publicKey
                    ? (m.sigOk && m.keyIdMatch ? 'signature OK' : 'SIGNATURE NOT VALID for the supplied key')
                    : 'signature not checked, no --key given';
                console.log(`[integrity-log] line ${m.line} covers ${args.manifest}: commit=${m.record.commit} keyId=${m.record.keyId} (${sigNote})`);
            }
            if (args.requireSigned && !matches.some((m) => publicKey && m.sigOk && m.keyIdMatch)) {
                requireSignedFailed = true;
            }
        }
    }
    if (args.requireSigned && !publicKey) {
        console.error('[integrity-log] --require-signed given but no --key was supplied.');
        requireSignedFailed = true;
    }

    const failed = Boolean(result.parseError) || !result.ok || requireSignedFailed;
    console.log('');
    if (failed) {
        console.error('[integrity-log] VERIFICATION FAILED');
        process.exitCode = 1;
    } else {
        console.log('[integrity-log] structure and chain are sound' + (publicKey ? ', signatures verified.' : ' (signatures not checked).'));
    }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
    try {
        main(process.argv.slice(2));
    } catch (err) {
        console.error(`[integrity-log] ${err.message}`);
        process.exitCode = 1;
    }
}
