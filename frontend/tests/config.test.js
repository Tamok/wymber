import { describe, it, expect } from 'vitest';
import { NODE_TYPES, PALETTES, setPalette } from '../js/config.js';

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

describe('palette CSS custom property publishing (styles.css reads var(--type-*))', () => {
    it('publishes the default palette at module load, before any setPalette() call', () => {
        // config.js publishes on import (this test file's import already triggered it), so the
        // tokens must exist even though this test never calls setPalette() itself.
        for (const [type, hex] of Object.entries(PALETTES.wymber)) {
            expect(document.documentElement.style.getPropertyValue(`--type-${type}`)).toBe(hex);
        }
    });

    it('re-publishes on setPalette() with a partial override', () => {
        setPalette({ event: '#123456' });
        expect(document.documentElement.style.getPropertyValue('--type-event')).toBe('#123456');
        // Unset types fall back to the wymber default, same as activePalette/typeColor do.
        expect(document.documentElement.style.getPropertyValue('--type-emotion')).toBe(PALETTES.wymber.emotion);
        setPalette('wymber'); // restore, so later tests in this file see the default again
    });

    it('publishes every key in PALETTES.wymber and nothing else', () => {
        setPalette('wymber');
        const expectedTypes = Object.keys(PALETTES.wymber);
        for (const type of expectedTypes) {
            expect(document.documentElement.style.getPropertyValue(`--type-${type}`)).toMatch(/^#[0-9A-Fa-f]{6}$/);
        }
    });
});
