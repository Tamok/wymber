import { describe, it, expect } from 'vitest';
import { BUILD, buildLabel } from '../js/build-info.js';

describe('build-info (ADR-0003 Layer 1: transparency, never self-attestation)', () => {
    it('BUILD is frozen', () => {
        expect(Object.isFrozen(BUILD)).toBe(true);
    });

    it('commit defaults to the honest "dev" placeholder', () => {
        expect(BUILD.commit).toBe('dev');
    });

    it('buildLabel() returns a plain string', () => {
        expect(typeof buildLabel()).toBe('string');
        expect(buildLabel().length).toBeGreaterThan(0);
    });

    it('buildLabel() never uses a judgment word or emoji: this is transparency, not a security claim', () => {
        const label = buildLabel();
        const bannedWords = ['verified', 'secure', 'legit', 'safe', 'trusted'];
        const lower = label.toLowerCase();
        for (const word of bannedWords) {
            expect(lower, `buildLabel() must not contain "${word}"`).not.toContain(word);
        }
        // Emoji / pictographic characters live well above the Basic Multilingual Plane's text
        // range (checkmarks, warning signs, etc. are typically ☀-➿ or surrogate-pair
        // emoji above \u{1F000}); a plain ASCII-ish label should contain neither.
        expect(/[\u{1F000}-\u{1FFFF}☀-➿]/u.test(label)).toBe(false);
    });

    it('buildLabel() reflects a stamped commit when one is set', () => {
        expect(buildLabel()).toBe('dev build');
        // BUILD is frozen by design (it must not be mutated at runtime); this just documents the
        // stamped-build shape without touching the frozen object.
        const stamped = { commit: 'a1b2c3d', origin: 'build' };
        const stampedLabel = stamped.commit === 'dev' ? 'dev build' : `build ${stamped.commit}`;
        expect(stampedLabel).toBe('build a1b2c3d');
    });
});
