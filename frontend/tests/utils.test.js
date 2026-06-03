import { describe, it, expect } from 'vitest';
import { validateNodeData, passwordStrength } from '../js/utils.js';

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
