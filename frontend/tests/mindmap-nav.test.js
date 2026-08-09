import { describe, it, expect } from 'vitest';
import { nextNodeInDirection } from '../js/mindmap.js';

// A small cross layout around the origin, used by most of the direction tests below:
//     up(2)
// left(3)  origin(1)  right(4)
//     down(5)
const cross = [
    { id: 1, x: 0, y: 0 },
    { id: 2, x: 0, y: -100 }, // up: smaller y is up on screen
    { id: 3, x: -100, y: 0 }, // left
    { id: 4, x: 100, y: 0 },  // right
    { id: 5, x: 0, y: 100 },  // down
];

describe('nextNodeInDirection', () => {
    it('picks the node straight up', () => {
        expect(nextNodeInDirection(cross, 1, 'up', new Set())).toBe(2);
    });

    it('picks the node straight down', () => {
        expect(nextNodeInDirection(cross, 1, 'down', new Set())).toBe(5);
    });

    it('picks the node straight left', () => {
        expect(nextNodeInDirection(cross, 1, 'left', new Set())).toBe(3);
    });

    it('picks the node straight right', () => {
        expect(nextNodeInDirection(cross, 1, 'right', new Set())).toBe(4);
    });

    it('ignores a node outside the +-60 degree cone around the pressed axis', () => {
        // At 75 degrees off the "right" axis (pressed = 0deg), this is outside the +-60 cone,
        // so pressing "right" must not jump to a node that reads as "mostly up" to a sighted user.
        const nodes = [
            { id: 1, x: 0, y: 0 },
            { id: 2, x: 26, y: -97 }, // atan2(-97, 26) ~= -75 degrees from source
        ];
        expect(nextNodeInDirection(nodes, 1, 'right', new Set())).toBeNull();
    });

    it('includes a node just inside the cone edge (within 60 degrees)', () => {
        const nodes = [
            { id: 1, x: 0, y: 0 },
            { id: 2, x: 50, y: -80 }, // atan2(-80, 50) ~= -58 degrees, inside the 60-degree cone
        ];
        expect(nextNodeInDirection(nodes, 1, 'right', new Set())).toBe(2);
    });

    it('prefers a connected neighbour over a slightly nearer unconnected node', () => {
        const nodes = [
            { id: 1, x: 0, y: 0 },
            { id: 2, x: 80, y: 0 },  // unconnected, nearer (dist 80)
            { id: 3, x: 100, y: 0 }, // connected neighbour, a bit farther (dist 100 -> scores 50)
        ];
        const neighbourIds = new Set([3]);
        expect(nextNodeInDirection(nodes, 1, 'right', neighbourIds)).toBe(3);
    });

    it('does not let the neighbour bonus override a much nearer unconnected node', () => {
        const nodes = [
            { id: 1, x: 0, y: 0 },
            { id: 2, x: 50, y: 0 },  // unconnected, much nearer (dist 50)
            { id: 3, x: 300, y: 0 }, // connected neighbour, far away (dist 300 -> scores 150)
        ];
        const neighbourIds = new Set([3]);
        // 50 (unconnected) beats 150 (connected * 0.5): the bonus is a tie-breaker, not a
        // teleport license.
        expect(nextNodeInDirection(nodes, 1, 'right', neighbourIds)).toBe(2);
    });

    it('returns null when nothing lies in the requested direction', () => {
        const nodes = [
            { id: 1, x: 0, y: 0 },
            { id: 2, x: -100, y: 0 }, // only a node to the left
        ];
        expect(nextNodeInDirection(nodes, 1, 'right', new Set())).toBeNull();
    });

    it('breaks ties deterministically by lowest id', () => {
        const nodes = [
            { id: 1, x: 0, y: 0 },
            { id: 5, x: 100, y: 0 },
            { id: 2, x: 100, y: 0 }, // exact same distance and bearing as id 5
        ];
        expect(nextNodeInDirection(nodes, 1, 'right', new Set())).toBe(2);
    });

    it('handles an empty node list without throwing', () => {
        expect(nextNodeInDirection([], 1, 'right', new Set())).toBeNull();
    });

    it('handles a fromId that is not present without throwing', () => {
        expect(nextNodeInDirection(cross, 999, 'right', new Set())).toBeNull();
    });

    it('defaults neighbourIds to an empty set when omitted', () => {
        expect(() => nextNodeInDirection(cross, 1, 'right')).not.toThrow();
        expect(nextNodeInDirection(cross, 1, 'right')).toBe(4);
    });
});
