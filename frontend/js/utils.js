import { NODE_TYPES } from './config.js';

/**
 * Parse a #rgb or #rrggbb hex color into 0-255 channel values.
 * @param {string} hex
 * @returns {{ r: number, g: number, b: number }}
 */
function hexToRgb(hex) {
    let h = String(hex).trim().replace(/^#/, '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const int = parseInt(h, 16);
    return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

/**
 * WCAG 2.x relative luminance of a hex color (the L in the contrast-ratio formula).
 * @param {string} hex
 * @returns {number} 0 (black) to 1 (white)
 */
export function relativeLuminance(hex) {
    const { r, g, b } = hexToRgb(hex);
    const [R, G, B] = [r, g, b].map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

/**
 * WCAG 2.x contrast ratio between two hex colors, order-independent.
 * @param {string} hexA
 * @param {string} hexB
 * @returns {number} 1 (no contrast) to 21 (black on white)
 */
export function contrastRatio(hexA, hexB) {
    const l1 = relativeLuminance(hexA);
    const l2 = relativeLuminance(hexB);
    const [lighter, darker] = l1 >= l2 ? [l1, l2] : [l2, l1];
    return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Validate node form data before submission.
 * @param {{ node_type: string, title: string }} data
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateNodeData(data) {
    if (!data.node_type || !NODE_TYPES[data.node_type]) {
        return { valid: false, error: 'Please choose what kind of dot this is' };
    }
    if (!data.title || data.title.trim().length === 0) {
        return { valid: false, error: 'Please enter a title' };
    }
    if (data.title.length > 200) {
        return { valid: false, error: 'Title must be under 200 characters' };
    }
    if (data.description && data.description.length > 5000) {
        return { valid: false, error: 'Description must be under 5000 characters' };
    }
    return { valid: true };
}

/**
 * Lightweight password-strength heuristic (0-4) for the account-creation meter.
 * @param {string} password
 * @returns {{ score: number, label: string }}
 */
export function passwordStrength(password) {
    const pw = password || '';
    let score = 0;
    if (pw.length >= 8) score++;
    if (pw.length >= 12) score++;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
    if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
    score = Math.min(score, 4);
    const labels = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong'];
    return { score, label: labels[score] };
}

/**
 * Decide whether to show the quiet "back up your vault" nudge (#147).
 *
 * Milestone-based, never naggy: the map must have meaningfully grown (>= minNodes),
 * there must be work that isn't in any backup (never exported, or edited since the
 * last export), and we must not have asked recently (>= cooldownDays since the last
 * nudge). Pure and injectable so the policy is unit-testable.
 *
 * @param {{ nodeCount: number, lastBackupAt?: string|null, lastEditAt?: string|null,
 *           lastNudgeAt?: string|null, now?: number, minNodes?: number, cooldownDays?: number }} p
 * @returns {boolean}
 */
export function shouldNudgeBackup({
    nodeCount, lastBackupAt = null, lastEditAt = null, lastNudgeAt = null,
    now = Date.now(), minNodes = 10, cooldownDays = 30,
} = {}) {
    if (!nodeCount || nodeCount < minNodes) return false;
    // Everything already backed up? Stay quiet.
    if (lastBackupAt && (!lastEditAt || Date.parse(lastEditAt) <= Date.parse(lastBackupAt))) return false;
    // Asked recently? Stay quiet.
    if (lastNudgeAt && now - Date.parse(lastNudgeAt) < cooldownDays * 24 * 60 * 60 * 1000) return false;
    return true;
}
