import { NODE_TYPES } from './config.js';

/**
 * Validate node form data before submission.
 * @param {{ node_type: string, title: string }} data
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateNodeData(data) {
    if (!data.node_type || !NODE_TYPES[data.node_type]) {
        return { valid: false, error: 'Please select a valid node type' };
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
