import { describe, it, expect } from 'vitest';
import { NODE_TYPES, MESSAGES } from '../js/config.js';

describe('NODE_TYPES', () => {
    const expectedTypes = ['event', 'emotion', 'body', 'person', 'place', 'trigger', 'coping', 'support', 'need', 'insight', 'growth'];

    it('has all 11 node types', () => {
        expect(Object.keys(NODE_TYPES)).toHaveLength(11);
        for (const type of expectedTypes) {
            expect(NODE_TYPES[type]).toBeDefined();
        }
    });

    it('each type has required fields', () => {
        for (const [key, type] of Object.entries(NODE_TYPES)) {
            expect(type.color, `${key} missing color`).toBeDefined();
            expect(type.icon, `${key} missing icon`).toBeDefined();
            expect(type.label, `${key} missing label`).toBeDefined();
            expect(type.description, `${key} missing description`).toBeDefined();
            expect(type.tooltip, `${key} missing tooltip`).toBeDefined();
            expect(type.prompt, `${key} missing prompt`).toBeDefined();
        }
    });

    it('colors are valid hex', () => {
        for (const [key, type] of Object.entries(NODE_TYPES)) {
            expect(type.color, `${key} has invalid color`).toMatch(/^#[0-9A-Fa-f]{6}$/);
        }
    });

    it('labels are non-empty strings', () => {
        for (const type of Object.values(NODE_TYPES)) {
            expect(typeof type.label).toBe('string');
            expect(type.label.length).toBeGreaterThan(0);
        }
    });
});

describe('MESSAGES', () => {
    it('has required message keys', () => {
        expect(MESSAGES.welcome).toBeDefined();
        expect(MESSAGES.first_time).toBeDefined();
        expect(MESSAGES.session_expired).toBeDefined();
        expect(MESSAGES.crisis_disclaimer).toBeDefined();
    });
});
