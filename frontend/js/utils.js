import { NODE_TYPES } from './config.js';

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
