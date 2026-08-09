import { describe, it, expect } from 'vitest';
import { validateNodeData, passwordStrength, shouldNudgeBackup } from '../js/utils.js';

describe('validateNodeData', () => {
    it('accepts valid node data', () => {
        const result = validateNodeData({ node_type: 'event', title: 'Test' });
        expect(result.valid).toBe(true);
    });

    it('rejects missing node type', () => {
        const result = validateNodeData({ node_type: '', title: 'Test' });
        expect(result.valid).toBe(false);
    });

    it('rejects invalid node type', () => {
        const result = validateNodeData({ node_type: 'invalid', title: 'Test' });
        expect(result.valid).toBe(false);
    });

    it('rejects empty title', () => {
        const result = validateNodeData({ node_type: 'event', title: '' });
        expect(result.valid).toBe(false);
    });

    it('rejects whitespace-only title', () => {
        const result = validateNodeData({ node_type: 'event', title: '   ' });
        expect(result.valid).toBe(false);
    });

    it('rejects title over 200 chars', () => {
        const result = validateNodeData({ node_type: 'event', title: 'x'.repeat(201) });
        expect(result.valid).toBe(false);
    });

    it('rejects description over 5000 chars', () => {
        const result = validateNodeData({
            node_type: 'event',
            title: 'Test',
            description: 'x'.repeat(5001)
        });
        expect(result.valid).toBe(false);
    });

    it('accepts all valid node types', () => {
        const types = ['event', 'emotion', 'body', 'person', 'place', 'trigger', 'coping', 'support', 'need', 'insight', 'growth'];
        for (const type of types) {
            expect(validateNodeData({ node_type: type, title: 'Test' }).valid).toBe(true);
        }
    });
});

describe('passwordStrength', () => {
    it('scores empty/short passwords as very weak', () => {
        expect(passwordStrength('').score).toBe(0);
        expect(passwordStrength('abc').score).toBe(0);
    });

    it('rewards length and character variety', () => {
        expect(passwordStrength('abcdefgh').score).toBeGreaterThanOrEqual(1);
        expect(passwordStrength('Str0ng!Passphrase').score).toBe(4);
        expect(passwordStrength('Str0ng!Passphrase').label).toBe('Strong');
    });

    it('caps the score at 4 and returns a label', () => {
        const result = passwordStrength('aB3$aB3$aB3$aB3$');
        expect(result.score).toBeLessThanOrEqual(4);
        expect(typeof result.label).toBe('string');
    });
});

describe('shouldNudgeBackup (#147 backup nudge policy)', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const now = Date.parse('2026-07-03T12:00:00Z');
    const iso = (t) => new Date(t).toISOString();

    it('stays quiet below the growth milestone', () => {
        expect(shouldNudgeBackup({ nodeCount: 9, now })).toBe(false);
        expect(shouldNudgeBackup({ nodeCount: 0, now })).toBe(false);
    });

    it('nudges at 10+ entries when never backed up', () => {
        expect(shouldNudgeBackup({ nodeCount: 10, now })).toBe(true);
    });

    it('stays quiet when the last backup covers the last edit', () => {
        expect(shouldNudgeBackup({
            nodeCount: 25, lastBackupAt: iso(now - DAY), lastEditAt: iso(now - 2 * DAY), now,
        })).toBe(false);
    });

    it('nudges again when edits postdate the backup and the cooldown passed', () => {
        expect(shouldNudgeBackup({
            nodeCount: 25, lastBackupAt: iso(now - 45 * DAY), lastEditAt: iso(now - DAY),
            lastNudgeAt: iso(now - 31 * DAY), now,
        })).toBe(true);
    });

    it('respects the cooldown after "Later"', () => {
        expect(shouldNudgeBackup({
            nodeCount: 25, lastNudgeAt: iso(now - 5 * DAY), now,
        })).toBe(false);
        expect(shouldNudgeBackup({
            nodeCount: 25, lastNudgeAt: iso(now - 30 * DAY), now,
        })).toBe(true);
    });

    it('treats missing lastEditAt as backed-up (no false alarms)', () => {
        expect(shouldNudgeBackup({ nodeCount: 25, lastBackupAt: iso(now - 100 * DAY), now })).toBe(false);
    });

    it('treats an edit exactly at the backup time as covered', () => {
        const t = iso(now - 10 * DAY);
        expect(shouldNudgeBackup({ nodeCount: 25, lastBackupAt: t, lastEditAt: t, now })).toBe(false);
    });

    it('keeps a backed-up, untouched map quiet even long after the cooldown (#147 regression)', () => {
        // The bug: recording the backup bumped the "edit" signal, so this re-fired once the
        // cooldown lapsed. With a content watermark, the last real edit predates the backup,
        // so an untouched map stays quiet no matter how much time passes.
        expect(shouldNudgeBackup({
            nodeCount: 40,
            lastBackupAt: iso(now - 60 * DAY),
            lastEditAt: iso(now - 61 * DAY),   // last real map edit predates the backup
            lastNudgeAt: iso(now - 59 * DAY),  // cooldown long since lapsed
            now,
        })).toBe(false);
    });
});
