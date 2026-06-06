import { NODE_TYPES } from './config.js';
import { LocalRepo } from './local-repo.js';
import { TrauMindMap } from './mindmap.js';
import { validateNodeData, passwordStrength } from './utils.js';
import { analyzeMap, renderAnalysis } from './analyze.js';
import { suggestLinks } from './suggest.js';
import { exportAsJSON, exportAsText, importMap, exportVaultFile, importVaultFile } from './export.js';

// Local-first: the encrypted vault on this device IS the backend. `api` keeps the
// same get/post/put/delete surface the rest of the app already uses.
const api = new LocalRepo();

class WymberApp {
    constructor() {
        this.currentUser = null;
        this.mindMap = null;
        this.detailNodeId = null; // node open in the detail drawer (#108)
        this.detailKeywords = []; // working copy of that node's keywords
        this.suggestions = []; // current link suggestions (discovery engine)
        this.dismissedSuggestions = new Set(); // pair keys the user said "not now" to this session
        this.authPanel = 'create';
        this.currentRecoveryCode = null;
        this.autoLockMinutes = 15;
        this.idleTimer = null;
        this._resetIdle = null;
        this._mainListenersSet = false;
    }

    async init() {
        this.setupEventListeners();
        let hasVault = false;
        try {
            hasVault = await api.hasVault();
        } catch {
            hasVault = false;
        }
        this.showAuthPanel(hasVault ? 'unlock' : 'create');
    }

    // ===== AUTH (local vault) =====

    setupEventListeners() {
        document.getElementById('create-form')?.addEventListener('submit', (e) => this.handleCreate(e));
        document.getElementById('unlock-form')?.addEventListener('submit', (e) => this.handleUnlock(e));
        document.getElementById('recover-form')?.addEventListener('submit', (e) => this.handleRecover(e));
        document.getElementById('create-password')?.addEventListener('input', () => this.updateStrengthMeter());
        document.getElementById('show-recover')?.addEventListener('click', () => this.showAuthPanel('recover'));
        document.getElementById('back-to-unlock')?.addEventListener('click', () => this.showAuthPanel('unlock'));
        document.getElementById('restore-vault-file')?.addEventListener('change', (e) => this.doRestoreVault(e));
        document.getElementById('restore-confirm-btn')?.addEventListener('click', () => this.confirmRestore());
        document.getElementById('restore-cancel-btn')?.addEventListener('click', () => this.closeRestoreConfirm());
        document.getElementById('close-restore-confirm')?.addEventListener('click', () => this.closeRestoreConfirm());
        document.getElementById('restore-export-first')?.addEventListener('click', () => this.doExportVault());
        document.getElementById('download-recovery')?.addEventListener('click', () => this.downloadRecovery());
        document.getElementById('copy-recovery')?.addEventListener('click', () => this.copyRecovery());
        document.getElementById('ack-saved-recovery')?.addEventListener('change', (e) => {
            const cont = document.getElementById('recovery-continue');
            if (cont) cont.disabled = !e.target.checked;
        });
        document.getElementById('recovery-continue')?.addEventListener('click', () => this.enterApp());

        const logoutBtn = document.getElementById('logout-btn');
        if (logoutBtn) logoutBtn.addEventListener('click', () => this.handleLogout());

        // Close modals on outside click
        window.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) {
                e.target.style.display = 'none';
                if (e.target.id === 'grounding-modal') this.stopBreathing();
            }
        });

        // Escape closes whatever is open, from anywhere, even mid-typing in a field. Other
        // shortcuts (Ctrl+N) stay out of text fields.
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeAllOverlays();
                return;
            }
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            if ((e.ctrlKey || e.metaKey) && (e.key === 'n' || e.key === 'N')) {
                e.preventDefault();
                this.showNodeModal();
            }
        });

        // Crisis bar dismiss
        const hideCrisisBtn = document.getElementById('hide-crisis-bar');
        if (hideCrisisBtn) {
            hideCrisisBtn.addEventListener('click', () => {
                document.getElementById('crisis-bar').style.display = 'none';
            });
        }

        // Safety affordances — available on both the auth and main screens.
        document.getElementById('grounding-btn')?.addEventListener('click', () => this.openGrounding());
        document.getElementById('crisis-btn')?.addEventListener('click', () => this.openSafetyModal('crisis-modal'));
        document.getElementById('close-crisis')?.addEventListener('click', () => this.closeSafetyModal('crisis-modal'));
        document.getElementById('close-crisis-btn')?.addEventListener('click', () => this.closeSafetyModal('crisis-modal'));
        document.getElementById('close-grounding')?.addEventListener('click', () => this.closeGrounding());
        document.getElementById('close-grounding-btn')?.addEventListener('click', () => this.closeGrounding());

        this.addPasswordToggles();
    }

    /** Add a show/hide eye toggle to every password field (covers future ones automatically). */
    addPasswordToggles() {
        const EYE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
        const EYE_OFF = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

        document.querySelectorAll('input[type="password"]').forEach((input) => {
            if (input.dataset.toggleWrapped) return;
            input.dataset.toggleWrapped = '1';

            const wrap = document.createElement('div');
            wrap.className = 'password-wrap';
            input.parentNode.insertBefore(wrap, input);
            wrap.appendChild(input);

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'password-toggle';
            btn.setAttribute('aria-label', 'Show password');
            btn.setAttribute('aria-pressed', 'false');
            btn.innerHTML = EYE;
            btn.addEventListener('click', () => {
                const reveal = input.type === 'password';
                input.type = reveal ? 'text' : 'password';
                btn.innerHTML = reveal ? EYE_OFF : EYE;
                btn.setAttribute('aria-pressed', reveal ? 'true' : 'false');
                btn.setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');
            });
            wrap.appendChild(btn);
        });
    }

    /** What Escape does: close every open overlay (modals, the detail drawer, the nudge) and
        stop the breathing timer. Safe to call when nothing is open. */
    closeAllOverlays() {
        document.querySelectorAll('.modal').forEach((m) => { m.style.display = 'none'; });
        this.stopBreathing();
        this.pendingRestoreFile = null;
        this.closeNodeDetail();
        document.querySelectorAll('.notification-nudge').forEach((n) => n.remove());
    }

    showAuthPanel(name) {
        const panels = {
            create: 'create-form',
            unlock: 'unlock-form',
            recover: 'recover-form',
            'recovery-sheet': 'recovery-sheet',
        };
        document.querySelectorAll('.auth-panel').forEach((p) => { p.style.display = 'none'; });
        const el = document.getElementById(panels[name]);
        if (el) el.style.display = 'block';
        this.authPanel = name;
        this.showError('', false);

        // Clear secret fields whenever we switch panels (privacy hygiene).
        ['create-password', 'create-confirm', 'unlock-password', 'recover-code', 'recover-password', 'recover-confirm']
            .forEach((id) => { const f = document.getElementById(id); if (f) f.value = ''; });

        document.getElementById('main-app').style.display = 'none';
        document.getElementById('login-screen').style.display = 'block';

        if (name === 'create') this.updateStrengthMeter();
        setTimeout(() => {
            const focusId = { create: 'create-password', unlock: 'unlock-password', recover: 'recover-code' }[name];
            document.getElementById(focusId)?.focus();
        }, 50);
    }

    async handleCreate(e) {
        e.preventDefault();
        const password = document.getElementById('create-password').value;
        const confirm = document.getElementById('create-confirm').value;
        this.showError('', false);
        if (password.length < 8) {
            this.showError('Please choose a password with at least 8 characters.');
            return;
        }
        if (password !== confirm) {
            this.showError("The passwords don't match. Please re-enter them.");
            return;
        }
        try {
            this.currentRecoveryCode = await api.createVault(password);
            // Start a new vault in the OS color scheme so it matches the screens just seen.
            try {
                if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
                    await api.put('/settings', { theme: 'dark' });
                }
            } catch (_) {}
            this.showRecoverySheet(this.currentRecoveryCode);
        } catch (error) {
            console.error('Create vault failed:', error);
            this.showError('Could not create your space. Please try again.');
        }
    }

    async handleUnlock(e) {
        e.preventDefault();
        const password = document.getElementById('unlock-password').value;
        this.showError('', false);
        try {
            await api.unlock(password);
            this.enterApp();
        } catch {
            this.showError('Incorrect password. Please try again, or use your recovery code.');
        }
    }

    async handleRecover(e) {
        e.preventDefault();
        const code = document.getElementById('recover-code').value.trim();
        const password = document.getElementById('recover-password').value;
        const confirm = document.getElementById('recover-confirm').value;
        this.showError('', false);
        if (password.length < 8) {
            this.showError('Please choose a new password with at least 8 characters.');
            return;
        }
        if (password !== confirm) {
            this.showError("The passwords don't match. Please re-enter them.");
            return;
        }
        try {
            await api.resetPassword(code, password);
            await api.unlock(password);
            this.enterApp();
            this.showNotification('Welcome back. Your new password is set.', 'success');
        } catch {
            this.showError('That recovery code was not recognized. Please check it and try again.');
        }
    }

    showRecoverySheet(code) {
        document.getElementById('recovery-code-display').textContent = code;
        const ack = document.getElementById('ack-saved-recovery');
        const cont = document.getElementById('recovery-continue');
        if (ack) ack.checked = false;
        if (cont) cont.disabled = true;
        // Show without clearing fields-of-other-panels logic interfering with the code display.
        document.querySelectorAll('.auth-panel').forEach((p) => { p.style.display = 'none'; });
        document.getElementById('recovery-sheet').style.display = 'block';
        this.authPanel = 'recovery-sheet';
        this.showError('', false);
    }

    downloadRecovery() {
        const code = this.currentRecoveryCode || '';
        const text = 'Wymber recovery code\n\n'
            + 'Keep this somewhere safe. It is the only way back into your space if you\n'
            + 'forget your password. We cannot recover it for you.\n\n'
            + `${code}\n`;
        const blob = new Blob([text], { type: 'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'wymber-recovery-code.txt';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
    }

    copyRecovery() {
        const code = this.currentRecoveryCode || '';
        navigator.clipboard?.writeText(code).then(
            () => this.showNotification('Recovery code copied', 'success'),
            () => this.showNotification('Could not copy. Write it down instead.', 'error')
        );
    }

    async handleLogout() {
        this.stopIdleTimer();
        if (this.mindMap) {
            this.mindMap.destroy();
            this.mindMap = null;
        }
        api.lock();
        this.currentUser = null;
        this.showAuthPanel('unlock');
    }

    updateStrengthMeter() {
        const pwInput = document.getElementById('create-password');
        const fill = document.getElementById('strength-fill');
        const label = document.getElementById('strength-label');
        const hint = document.getElementById('strength-hint');
        if (!pwInput || !fill || !label) return;
        const pw = pwInput.value;
        const { score, label: text } = passwordStrength(pw);
        fill.style.width = `${(score / 4) * 100}%`;
        fill.className = `strength-fill strength-${score}`;
        label.textContent = pw ? text : '';
        if (hint) hint.textContent = pw ? this.passwordHint(pw) : '';
    }

    /** Actionable guidance: tell the user what would make this password stronger. */
    passwordHint(pw) {
        const tips = [];
        if (pw.length < 12) tips.push('make it longer (aim for 12+)');
        if (!(/[a-z]/.test(pw) && /[A-Z]/.test(pw))) tips.push('mix upper and lower case');
        if (!/\d/.test(pw)) tips.push('add a number');
        if (!/[^A-Za-z0-9]/.test(pw)) tips.push('add a symbol');
        if (tips.length === 0) return 'Strong. A passphrase of a few unrelated words works well too.';
        return 'To strengthen: ' + tips.slice(0, 2).join(', ') + '.';
    }

    async enterApp() {
        this.currentUser = 'you';
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('main-app').style.display = 'block';

        if (!this._mainListenersSet) {
            this.setupMainAppEventListeners();
            this._mainListenersSet = true;
        }
        await this.loadSettings();
        this.showSoftStart();
        this.startIdleTimer();
    }

    // ===== AUTO-LOCK (trauma-informed privacy) =====

    getAutoLockMs() {
        const mins = this.autoLockMinutes ?? 15;
        return mins > 0 ? mins * 60 * 1000 : 0; // 0 = never
    }

    startIdleTimer() {
        this.stopIdleTimer();
        const ms = this.getAutoLockMs();
        if (!ms) return;
        this._resetIdle = () => {
            clearTimeout(this.idleTimer);
            this.idleTimer = setTimeout(() => this.autoLock(), ms);
        };
        ['mousemove', 'keydown', 'click', 'touchstart', 'scroll']
            .forEach((ev) => document.addEventListener(ev, this._resetIdle, { passive: true }));
        this._resetIdle();
    }

    stopIdleTimer() {
        clearTimeout(this.idleTimer);
        if (this._resetIdle) {
            ['mousemove', 'keydown', 'click', 'touchstart', 'scroll']
                .forEach((ev) => document.removeEventListener(ev, this._resetIdle));
            this._resetIdle = null;
        }
    }

    autoLock() {
        this.stopIdleTimer();
        if (this.mindMap) {
            this.mindMap.destroy();
            this.mindMap = null;
        }
        api.lock();
        this.currentUser = null;
        this.showAuthPanel('unlock');
        this.showNotification('Locked for your privacy. Enter your password to continue.', 'info');
    }

    // ===== SAFETY AFFORDANCES =====

    openSafetyModal(id) {
        const modal = document.getElementById(id);
        if (modal) modal.style.display = 'flex';
    }

    closeSafetyModal(id) {
        const modal = document.getElementById(id);
        if (modal) modal.style.display = 'none';
    }

    openGrounding() {
        this.openSafetyModal('grounding-modal');
        this.startBreathing();
    }

    closeGrounding() {
        this.stopBreathing();
        this.closeSafetyModal('grounding-modal');
    }

    startBreathing() {
        const label = document.getElementById('breathing-guide');
        if (!label) return;
        this.stopBreathing();
        const orb = document.getElementById('breathing-orb');
        // 4 in, 4 hold, 6 out: the orb's CSS transition for each class matches the phase length,
        // so the swell and the words stay in step (and match the on-screen hint).
        const phases = [
            { cls: 'is-in', text: 'Breathe in', ms: 4000 },
            { cls: 'is-hold', text: 'Hold', ms: 4000 },
            { cls: 'is-out', text: 'Breathe out', ms: 6000 },
        ];
        let i = 0;
        const step = () => {
            const p = phases[i];
            if (orb) {
                orb.classList.remove('is-in', 'is-hold', 'is-out');
                orb.classList.add(p.cls);
            }
            // Fade the word out, swap it while invisible, fade it back in (CSS handles the ease).
            label.style.opacity = '0';
            this.breathingFadeTimeout = setTimeout(() => {
                label.textContent = p.text;
                label.style.opacity = '1';
            }, 350);
            i = (i + 1) % phases.length;
            this.breathingTimeout = setTimeout(step, p.ms);
        };
        step();
    }

    stopBreathing() {
        if (this.breathingTimeout) {
            clearTimeout(this.breathingTimeout);
            this.breathingTimeout = null;
        }
        if (this.breathingFadeTimeout) {
            clearTimeout(this.breathingFadeTimeout);
            this.breathingFadeTimeout = null;
        }
        document.getElementById('breathing-orb')?.classList.remove('is-in', 'is-hold', 'is-out');
    }

    setupMainAppEventListeners() {
        document.getElementById('add-node-btn')?.addEventListener('click', () => this.showNodeModal());
        document.getElementById('settings-btn')?.addEventListener('click', () => this.showSettingsModal());
        document.getElementById('analyze-btn')?.addEventListener('click', () => this.showAnalysis());
        document.getElementById('export-btn')?.addEventListener('click', () => this.showExportModal());
        document.getElementById('suggest-btn')?.addEventListener('click', () => this.openSuggestModal());

        // Modal close buttons
        document.querySelectorAll('.close-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const modal = e.target.closest('.modal');
                if (modal) modal.style.display = 'none';
            });
        });

        // Node modal
        document.getElementById('save-node')?.addEventListener('click', () => this.saveNode());
        document.getElementById('cancel-node')?.addEventListener('click', () => {
            document.getElementById('node-modal').style.display = 'none';
        });

        // Node type description updates
        document.getElementById('node-type')?.addEventListener('change', (e) => {
            this.updateNodeTypeDescription(e.target.value);
        });

        // Node detail drawer (#108)
        document.getElementById('detail-close')?.addEventListener('click', () => this.closeNodeDetail());
        document.getElementById('detail-save')?.addEventListener('click', () => this.saveNodeDetail());
        document.getElementById('detail-delete')?.addEventListener('click', () => this.deleteFromDetail());
        document.getElementById('detail-type')?.addEventListener('change', (e) => {
            const info = NODE_TYPES[e.target.value] || {};
            document.getElementById('detail-chip').style.background = info.color || '#cfc7ba';
            document.getElementById('detail-type-name').textContent = info.label || e.target.value;
        });
        const kwInput = document.getElementById('detail-keyword-input');
        kwInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                this.addDetailKeyword(kwInput.value);
            }
        });
        // Escape closes the drawer even with focus inside a field (saving as it goes).
        document.getElementById('node-detail')?.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                this.closeNodeDetail();
            }
        });

        // Settings save
        document.getElementById('save-settings')?.addEventListener('click', () => this.saveSettings());
        document.getElementById('cancel-settings')?.addEventListener('click', () => {
            document.getElementById('settings-modal').style.display = 'none';
        });

        // Analyze close
        document.getElementById('close-analyze-btn')?.addEventListener('click', () => {
            document.getElementById('analyze-modal').style.display = 'none';
        });

        // Export buttons
        document.getElementById('export-vault')?.addEventListener('click', () => this.doExportVault());
        document.getElementById('export-json')?.addEventListener('click', () => this.doExport('json'));
        document.getElementById('export-text')?.addEventListener('click', () => this.doExport('text'));
        document.getElementById('import-file')?.addEventListener('change', (e) => this.doImport(e));

        document.getElementById('open-map-btn')?.addEventListener('click', () => this.openMapFromSoftStart());
        document.getElementById('soft-start-grounding-btn')?.addEventListener('click', () => this.openGrounding());
    }

    showSoftStart() {
        const ss = document.getElementById('soft-start');
        if (ss) ss.style.display = 'flex';
    }

    async openMapFromSoftStart() {
        const ss = document.getElementById('soft-start');
        if (ss) ss.style.display = 'none';
        try {
            await this.initMindMap();
        } catch (error) {
            console.error('Error initializing mind map:', error);
            this.updateSaveIndicator('Error loading mind map', 'error');
        }
    }

    // ===== MIND MAP =====

    async initMindMap() {
        const container = document.getElementById('mindmap');
        const placeholder = document.getElementById('mindmap-placeholder');
        if (!container) throw new Error('Mind map container not found');

        this.mindMap = new TrauMindMap(container, api);
        // Selecting or editing a node opens its detail drawer (#108); the add-node modal is now
        // only for creating new nodes. Tapping empty canvas (deselect) closes the drawer.
        this.mindMap.onShowNodeModal = (node) => this.openNodeDetail(node);
        this.mindMap.onSelectNode = (node) => this.openNodeDetail(node);
        this.mindMap.onDeselect = () => this.closeNodeDetail();
        this.mindMap.onMapLoaded = (data) => {
            this.refreshSuggestions(data);
            // Keep the open drawer's Connections list in lockstep with the map (e.g. after an
            // unlink from the canvas, or a new link).
            if (this.detailNodeId != null) {
                const fresh = (data.nodes || []).find((n) => n.id === this.detailNodeId);
                if (fresh) this.renderDetailConnections(fresh);
            }
        };

        const success = await this.mindMap.init();
        if (success) {
            if (placeholder) placeholder.style.display = 'none';
            container.style.display = 'block';
            container.focus();
            this.updateSaveIndicator('Mind map loaded');
        } else {
            if (placeholder) placeholder.style.display = 'block';
            container.style.display = 'none';
        }
    }

    // ===== NODE MODAL =====

    // The modal is now only for creating a node; editing an existing node lives in the
    // detail drawer (#108). `presetType` pre-selects a type (used by the pairing nudge).
    showNodeModal(presetType = null) {
        const modal = document.getElementById('node-modal');
        document.getElementById('modal-title').textContent = 'Add to Your Map';
        document.getElementById('node-type').value = presetType || '';
        document.getElementById('node-title').value = '';
        document.getElementById('node-description').value = '';
        document.getElementById('type-description').innerHTML = '';
        if (presetType) this.updateNodeTypeDescription(presetType);

        modal.style.display = 'flex';
        setTimeout(() => {
            // With a type pre-set, focus the title; otherwise the type picker.
            (presetType ? document.getElementById('node-title') : document.getElementById('node-type')).focus();
        }, 100);
    }

    updateNodeTypeDescription(nodeType) {
        const el = document.getElementById('type-description');
        const desc = document.getElementById('node-description');
        if (nodeType && NODE_TYPES[nodeType]) {
            const info = NODE_TYPES[nodeType];
            el.innerHTML = `<div class="type-info"><p>${info.description}</p><small>${info.tooltip}</small></div>`;
            // A gentle, non-directive prompt for this type. Never required.
            if (desc && info.prompt) desc.placeholder = info.prompt;
        } else {
            el.innerHTML = '';
            if (desc) desc.placeholder = '';
        }
    }

    async saveNode() {
        const nodeType = document.getElementById('node-type').value;
        const title = document.getElementById('node-title').value.trim();
        const description = document.getElementById('node-description').value.trim();

        const validation = validateNodeData({ node_type: nodeType, title, description });
        if (!validation.valid) {
            this.showNotification(validation.error, 'error');
            return;
        }

        let newTriggerId = null;
        try {
            const nodeData = {
                node_type: nodeType,
                title,
                description,
                x: Math.random() * 300 + 50,
                y: Math.random() * 200 + 50
            };
            let newId;
            if (this.mindMap) {
                newId = await this.mindMap.addNode(nodeData);
            } else {
                const res = await api.post('/node', nodeData);
                newId = res?.id;
            }

            // If this node answers a trigger (added via the pairing nudge), connect them so
            // the pair is visible on the map. A trigger should never sit alone with no anchor.
            const triggerId = this.pairingTriggerId;
            this.pairingTriggerId = null;
            if (triggerId && newId && (nodeType === 'coping' || nodeType === 'support')) {
                try {
                    await api.post('/edge', { from_node_id: triggerId, to_node_id: newId, label: '' });
                    await this.mindMap?.loadMap();
                } catch (e) {
                    console.error('Could not link anchor to trigger:', e);
                }
            }

            this.showNotification('Added to your map', 'success');
            if (nodeType === 'trigger' && newId) newTriggerId = newId;

            document.getElementById('node-modal').style.display = 'none';
        } catch (error) {
            console.error('Error saving node:', error);
            this.showNotification('Could not save entry', 'error');
            return;
        }

        // After the modal closes, gently invite an anchor for a brand-new trigger.
        if (newTriggerId) this.showPairingNudge(newTriggerId);
    }

    // ===== NODE DETAIL DRAWER (#108) =====

    /** Open the drawer for a node (a raw node or its id), populated with the freshest data. */
    async openNodeDetail(node) {
        const id = typeof node === 'object' && node !== null ? node.id : node;
        if (id == null) return;

        // Persist whatever is already open first, so switching nodes never drops edits.
        if (this.detailNodeId != null && this.detailNodeId !== id) {
            await this.commitDetail({ silent: true });
        }

        let fresh = null;
        try {
            const map = await api.get('/mindmap');
            fresh = (map.nodes || []).find((n) => n.id === id);
        } catch (error) {
            console.error('Could not load node detail:', error);
        }
        if (!fresh) return;

        this.detailNodeId = fresh.id;
        this.detailKeywords = Array.isArray(fresh.keywords) ? [...fresh.keywords] : [];

        const info = NODE_TYPES[fresh.node_type] || {};
        document.getElementById('detail-chip').style.background = info.color || '#cfc7ba';
        document.getElementById('detail-type-name').textContent = info.label || fresh.node_type || 'Details';
        document.getElementById('detail-type').value = fresh.node_type || 'event';
        document.getElementById('detail-title').value = fresh.title || '';
        document.getElementById('detail-description').value = fresh.description || '';
        document.getElementById('detail-story').value = fresh.story || '';
        document.getElementById('detail-keyword-input').value = '';
        this.renderDetailKeywords();
        this.renderDetailConnections(fresh);
        this.detailSnapshot = this.currentDetailValues(); // baseline for the dirty check

        const drawer = document.getElementById('node-detail');
        drawer.inert = false;
        drawer.classList.add('open');
        setTimeout(() => document.getElementById('detail-title')?.focus(), 60);
    }

    renderDetailKeywords() {
        const wrap = document.getElementById('detail-keywords');
        if (!wrap) return;
        wrap.innerHTML = '';
        this.detailKeywords.forEach((kw, i) => {
            const tag = document.createElement('span');
            tag.className = 'keyword-tag';
            const label = document.createElement('span');
            label.textContent = kw;
            const rm = document.createElement('button');
            rm.type = 'button';
            rm.setAttribute('aria-label', `Remove keyword ${kw}`);
            rm.textContent = '×';
            rm.addEventListener('click', () => {
                this.detailKeywords.splice(i, 1);
                this.renderDetailKeywords();
            });
            tag.append(label, rm);
            wrap.appendChild(tag);
        });
    }

    addDetailKeyword(raw) {
        const kw = (raw || '').replace(/,+$/, '').trim();
        if (!kw) return;
        const exists = this.detailKeywords.some((k) => k.toLowerCase() === kw.toLowerCase());
        if (!exists) {
            this.detailKeywords.push(kw);
            this.renderDetailKeywords();
        }
        const input = document.getElementById('detail-keyword-input');
        if (input) input.value = '';
    }

    renderDetailConnections(node) {
        const ul = document.getElementById('detail-connections');
        if (!ul) return;
        ul.innerHTML = '';
        const nodes = this.mindMap?.lastData?.nodes || [];
        const edges = this.mindMap?.lastData?.edges || [];
        const byId = new Map(nodes.map((n) => [n.id, n]));

        // Each connection carries how to undo it: an explicit edge (delete the edge record) or a
        // legacy parent link (clear the child's parent_id). Dedupe by the other node so a pair
        // shows once.
        const entries = [];
        const others = new Set();
        edges.forEach((e) => {
            let otherId = null;
            if (e.from_node_id === node.id) otherId = e.to_node_id;
            else if (e.to_node_id === node.id) otherId = e.from_node_id;
            if (otherId != null && byId.has(otherId) && !others.has(otherId)) {
                others.add(otherId);
                entries.push({ kind: 'edge', edgeId: e.id, other: byId.get(otherId) });
            }
        });
        const self = byId.get(node.id);
        if (self && self.parent_id != null && byId.has(self.parent_id) && !others.has(self.parent_id)) {
            others.add(self.parent_id);
            entries.push({ kind: 'parent', childId: self.id, other: byId.get(self.parent_id) });
        }
        nodes.forEach((n) => {
            if (n.parent_id === node.id && !others.has(n.id)) {
                others.add(n.id);
                entries.push({ kind: 'parent', childId: n.id, other: n });
            }
        });

        if (entries.length === 0) {
            const li = document.createElement('li');
            li.className = 'detail-connections-empty';
            li.textContent = 'No connections yet. Use Link Nodes to relate this to another.';
            ul.appendChild(li);
            return;
        }
        entries.forEach((entry) => {
            const li = document.createElement('li');
            li.className = 'detail-connection';
            const name = document.createElement('span');
            name.className = 'detail-connection-name';
            name.textContent = entry.other.title;
            const unlink = document.createElement('button');
            unlink.type = 'button';
            unlink.className = 'detail-unlink';
            unlink.textContent = 'Unlink';
            unlink.setAttribute('aria-label', `Unlink from ${entry.other.title}`);
            unlink.addEventListener('click', () => this.unlinkConnection(entry, node.id));
            li.append(name, unlink);
            ul.appendChild(li);
        });
    }

    /** Remove one connection from the open node's detail drawer, then refresh in place. */
    async unlinkConnection(entry, nodeId) {
        try {
            if (entry.kind === 'edge') await api.delete(`/edge/${entry.edgeId}`);
            else await api.put(`/node/${entry.childId}`, { parent_id: null });
            await this.mindMap?.loadMap();
            const fresh = (this.mindMap?.lastData?.nodes || []).find((n) => n.id === nodeId);
            if (fresh) this.renderDetailConnections(fresh);
            this.showNotification(`Unlinked from "${entry.other.title}"`, 'success');
        } catch (error) {
            console.error('Could not unlink:', error);
            this.showNotification('Could not unlink', 'error');
        }
    }

    /** The drawer's current field values, used both to save and to detect changes. */
    currentDetailValues() {
        return {
            node_type: document.getElementById('detail-type').value,
            title: document.getElementById('detail-title').value.trim(),
            description: document.getElementById('detail-description').value.trim(),
            story: document.getElementById('detail-story').value,
            keywords: [...this.detailKeywords],
        };
    }

    /** Save the drawer's fields to the open node. Silent on auto-save (close/switch). */
    async commitDetail({ silent = false } = {}) {
        if (this.detailNodeId == null) return true;
        const id = this.detailNodeId;
        // Fold any half-typed keyword still in the input into the set before reading values.
        this.addDetailKeyword(document.getElementById('detail-keyword-input')?.value);

        const values = this.currentDetailValues();
        if (!values.title) {
            if (!silent) this.showNotification('Please give this node a title', 'error');
            return false;
        }
        // No change since it opened: skip the write + re-render (no flicker on plain browsing).
        const prev = this.detailSnapshot;
        const unchanged = prev
            && prev.node_type === values.node_type && prev.title === values.title
            && prev.description === values.description && prev.story === values.story
            && prev.keywords.length === values.keywords.length
            && prev.keywords.every((k, i) => k === values.keywords[i]);
        if (unchanged) return true;

        try {
            await api.put(`/node/${id}`, values);
            await this.mindMap?.loadMap();
            this.detailSnapshot = values;
            if (!silent) this.showNotification('Saved', 'success');
            return true;
        } catch (error) {
            console.error('Could not save node detail:', error);
            if (!silent) this.showNotification('Could not save', 'error');
            return false;
        }
    }

    async closeNodeDetail({ skipSave = false } = {}) {
        const drawer = document.getElementById('node-detail');
        if (!drawer || !drawer.classList.contains('open')) return;
        if (!skipSave) await this.commitDetail({ silent: true });
        drawer.classList.remove('open');
        drawer.inert = true;
        this.detailNodeId = null;
        this.detailKeywords = [];
    }

    async saveNodeDetail() {
        const ok = await this.commitDetail({ silent: false });
        if (ok) await this.closeNodeDetail({ skipSave: true });
    }

    async deleteFromDetail() {
        if (this.detailNodeId == null) return;
        const id = this.detailNodeId;
        const title = document.getElementById('detail-title').value.trim() || 'this node';
        const confirmed = confirm(
            `This will remove "${title}" and its connections from your map. ` +
            `You can always add it back later. Would you like to continue?`
        );
        if (!confirmed) return;
        try {
            await api.delete(`/node/${id}`);
            await this.closeNodeDetail({ skipSave: true });
            await this.mindMap?.loadMap();
            this.showNotification('Removed from your map', 'success');
        } catch (error) {
            console.error('Could not remove node:', error);
            this.showNotification('Could not remove node', 'error');
        }
    }

    // ===== DISCOVERY: possible connections (quiet, opt-in) =====

    suggestKey(s) {
        const a = s.from_node_id;
        const b = s.to_node_id;
        return a < b ? `${a}|${b}` : `${b}|${a}`;
    }

    /** Recompute suggestions whenever the map (re)loads, and update the gentle affordance. */
    refreshSuggestions(data) {
        const nodes = data?.nodes || this.mindMap?.lastData?.nodes || [];
        const edges = data?.edges || this.mindMap?.lastData?.edges || [];
        const all = suggestLinks(nodes, edges);

        // Forget session-dismissals that no longer apply (e.g. the pair got connected).
        const live = new Set(all.map((s) => this.suggestKey(s)));
        for (const k of [...this.dismissedSuggestions]) if (!live.has(k)) this.dismissedSuggestions.delete(k);

        this.suggestions = all.filter((s) => !this.dismissedSuggestions.has(this.suggestKey(s)));
        this.updateSuggestAffordance();

        // Keep an open modal honest if its contents changed underneath it.
        if (document.getElementById('suggest-modal')?.style.display === 'flex') this.renderSuggestList();
    }

    updateSuggestAffordance() {
        const btn = document.getElementById('suggest-btn');
        const label = document.getElementById('suggest-label');
        if (!btn || !label) return;
        const n = this.suggestions.length;
        label.textContent = `${n} possible connection${n === 1 ? '' : 's'}`;
        btn.hidden = n === 0;
    }

    openSuggestModal() {
        if (!this.suggestions.length) return;
        this.renderSuggestList();
        document.getElementById('suggest-modal').style.display = 'flex';
    }

    closeSuggestModal() {
        document.getElementById('suggest-modal').style.display = 'none';
    }

    renderSuggestList() {
        const ul = document.getElementById('suggest-list');
        if (!ul) return;
        ul.innerHTML = '';
        const byId = new Map((this.mindMap?.lastData?.nodes || []).map((n) => [n.id, n]));

        if (!this.suggestions.length) {
            const li = document.createElement('li');
            li.className = 'suggest-empty';
            li.textContent = 'Nothing to suggest yet. As your map grows, possible links will show up here.';
            ul.appendChild(li);
            return;
        }

        for (const s of this.suggestions) {
            const a = byId.get(s.from_node_id);
            const b = byId.get(s.to_node_id);
            if (!a || !b) continue;

            const li = document.createElement('li');
            li.className = 'suggest-item';

            const pair = document.createElement('div');
            pair.className = 'suggest-pair';
            pair.append(
                this.suggestChip(a), document.createTextNode(a.title),
                this.suggestArrow(),
                this.suggestChip(b), document.createTextNode(b.title),
            );

            const reason = document.createElement('p');
            reason.className = 'suggest-reason';
            reason.textContent = s.reason;

            const actions = document.createElement('div');
            actions.className = 'suggest-actions';
            const connect = document.createElement('button');
            connect.type = 'button';
            connect.className = 'suggest-connect';
            connect.textContent = 'Connect';
            connect.addEventListener('click', () => this.connectSuggestion(s));
            const dismiss = document.createElement('button');
            dismiss.type = 'button';
            dismiss.className = 'suggest-dismiss';
            dismiss.textContent = 'Not now';
            dismiss.addEventListener('click', () => this.dismissSuggestion(s));
            actions.append(connect, dismiss);

            li.append(pair, reason, actions);
            ul.appendChild(li);
        }
    }

    suggestChip(node) {
        const chip = document.createElement('span');
        chip.className = 'suggest-chip';
        chip.style.background = NODE_TYPES[node.node_type]?.color || '#cfc7ba';
        chip.setAttribute('aria-hidden', 'true');
        return chip;
    }

    suggestArrow() {
        const span = document.createElement('span');
        span.className = 'suggest-link-icon';
        span.setAttribute('aria-hidden', 'true');
        span.textContent = '↔';
        return span;
    }

    async connectSuggestion(s) {
        try {
            await api.post('/edge', { from_node_id: s.from_node_id, to_node_id: s.to_node_id, label: '' });
            // loadMap fires onMapLoaded -> refreshSuggestions, which drops the now-connected pair
            // and re-renders the open list.
            await this.mindMap?.loadMap();
            if (!this.suggestions.length) this.closeSuggestModal();
            this.showNotification('Connected', 'success');
        } catch (error) {
            console.error('Could not connect suggestion:', error);
            this.showNotification('Could not connect', 'error');
        }
    }

    dismissSuggestion(s) {
        this.dismissedSuggestions.add(this.suggestKey(s));
        this.suggestions = this.suggestions.filter((x) => this.suggestKey(x) !== this.suggestKey(s));
        this.renderSuggestList();
        this.updateSuggestAffordance();
        if (!this.suggestions.length) this.closeSuggestModal();
    }

    // ===== SETTINGS =====

    showSettingsModal() {
        const content = document.getElementById('settings-content');
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
        const currentFont = document.documentElement.getAttribute('data-font-size') || 'medium';
        const al = this.autoLockMinutes ?? 15;
        const lockOpt = (val, text) => `<option value="${val}" ${al === val ? 'selected' : ''}>${text}</option>`;

        content.innerHTML = `
            <div class="settings-panel">
                <section>
                    <h3>Appearance</h3>
                    <div class="form-group">
                        <label for="theme-select">Theme</label>
                        <select id="theme-select">
                            <option value="light" ${currentTheme === 'light' ? 'selected' : ''}>Light (Default)</option>
                            <option value="dark" ${currentTheme === 'dark' ? 'selected' : ''}>Dark</option>
                            <option value="soft" ${currentTheme === 'soft' ? 'selected' : ''}>Soft (Low Contrast)</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="font-size">Font Size</label>
                        <select id="font-size">
                            <option value="small" ${currentFont === 'small' ? 'selected' : ''}>Small</option>
                            <option value="medium" ${currentFont === 'medium' ? 'selected' : ''}>Medium</option>
                            <option value="large" ${currentFont === 'large' ? 'selected' : ''}>Large</option>
                            <option value="xlarge" ${currentFont === 'xlarge' ? 'selected' : ''}>Extra Large</option>
                        </select>
                    </div>
                </section>
                <section>
                    <h3>Privacy</h3>
                    <div class="form-group">
                        <label for="autolock-select">Auto-lock after inactivity</label>
                        <select id="autolock-select">
                            ${lockOpt(5, '5 minutes')}
                            ${lockOpt(15, '15 minutes')}
                            ${lockOpt(30, '30 minutes')}
                            ${lockOpt(60, '60 minutes')}
                            ${lockOpt(0, 'Never')}
                        </select>
                        <p class="settings-note">Locks your space and asks for your password again after a period of inactivity.</p>
                    </div>
                </section>
                <section>
                    <h3>Safety</h3>
                    <div class="crisis-resources">
                        <h4>Crisis Resources (Always Available)</h4>
                        <ul>
                            <li><strong>988</strong> - Suicide & Crisis Lifeline (US)</li>
                            <li><strong>Crisis Text Line</strong> - Text HOME to 741741</li>
                            <li><strong>SAMHSA</strong> - 1-800-662-4357</li>
                            <li><strong>International</strong> - befrienders.org</li>
                        </ul>
                    </div>
                </section>
                <section>
                    <h3>Your data</h3>
                    <p class="settings-note">Everything you write is stored <strong>locally on this device</strong>, encrypted with your password. Nothing is sent anywhere.</p>
                    <button id="delete-account-btn" class="btn btn-danger" type="button">Delete everything</button>
                    <p class="settings-note">Permanently removes your space and all entries from this device. This can't be undone, and there's no backup unless you exported one.</p>
                </section>
            </div>
        `;

        document.getElementById('delete-account-btn')?.addEventListener('click', () => this.deleteAccount());
        document.getElementById('settings-modal').style.display = 'flex';
    }

    async deleteAccount() {
        const confirmed = confirm(
            'Permanently delete your space and ALL your entries from this device?\n\n' +
            "This cannot be undone, and there's no backup unless you exported one."
        );
        if (!confirmed) return;
        try {
            await api.destroyVault();
            this.stopIdleTimer();
            if (this.mindMap) { this.mindMap.destroy(); this.mindMap = null; }
            this.currentUser = null;
            document.getElementById('settings-modal').style.display = 'none';
            this.showAuthPanel('create');
            this.showNotification('Your space and data were permanently deleted.', 'success');
        } catch (error) {
            console.error('Error deleting data:', error);
            this.showNotification('Could not delete your data. Please try again.', 'error');
        }
    }

    async saveSettings() {
        const theme = document.getElementById('theme-select').value;
        const fontSize = document.getElementById('font-size').value;
        const autoLockMinutes = parseInt(document.getElementById('autolock-select').value, 10);

        document.documentElement.setAttribute('data-theme', theme);
        document.documentElement.setAttribute('data-font-size', fontSize);
        this.mindMap?.applyTheme(); // keep the map canvas in sync with the app theme
        this.autoLockMinutes = autoLockMinutes;

        try {
            await api.put('/settings', { theme, fontSize, autoLockMinutes });
        } catch (error) {
            console.error('Error saving settings:', error);
        }

        this.startIdleTimer(); // apply the new timeout immediately
        document.getElementById('settings-modal').style.display = 'none';
        this.showNotification('Settings saved', 'success');
    }

    async loadSettings() {
        try {
            const data = await api.get('/settings');
            const settings = data.settings || {};
            if (settings.theme) {
                document.documentElement.setAttribute('data-theme', settings.theme);
            }
            if (settings.fontSize) {
                document.documentElement.setAttribute('data-font-size', settings.fontSize);
            }
            this.autoLockMinutes = settings.autoLockMinutes ?? 15;
        } catch {
            this.autoLockMinutes = 15;
        }
    }

    // ===== ANALYZE =====

    async showAnalysis() {
        try {
            const mapData = await api.get('/mindmap');
            const analysis = analyzeMap(mapData.nodes || [], mapData.edges || []);
            document.getElementById('analyze-content').innerHTML = renderAnalysis(analysis);
            document.getElementById('analyze-modal').style.display = 'flex';
        } catch (error) {
            console.error('Error analyzing map:', error);
            this.showNotification('Could not analyze map', 'error');
        }
    }

    // ===== EXPORT =====

    showExportModal() {
        document.getElementById('export-modal').style.display = 'flex';
    }

    async doExport(format) {
        try {
            const mapData = await api.get('/mindmap');
            if (format === 'json') {
                exportAsJSON(mapData.nodes || [], mapData.edges || []);
            } else {
                exportAsText(mapData.nodes || [], mapData.edges || []);
            }
            document.getElementById('export-modal').style.display = 'none';
            this.showNotification('Export downloaded', 'success');
        } catch (error) {
            console.error('Error exporting:', error);
            this.showNotification('Could not export map', 'error');
        }
    }

    async doImport(event) {
        const file = event.target.files?.[0];
        if (!file) return;
        try {
            const data = JSON.parse(await file.text());
            const result = await importMap(data, api);
            event.target.value = '';
            document.getElementById('export-modal').style.display = 'none';
            this.showNotification(`Restored ${result.nodeCount} entries to your map.`, 'success');
            if (this.mindMap) await this.mindMap.loadMap();
        } catch (error) {
            console.error('Import failed:', error);
            event.target.value = '';
            this.showNotification('Could not import that file. Make sure it is a valid map export.', 'error');
        }
    }

    async doExportVault() {
        try {
            await exportVaultFile(api);
            document.getElementById('export-modal').style.display = 'none';
            this.showNotification('Encrypted vault downloaded', 'success');
        } catch (error) {
            console.error('Vault export failed:', error);
            this.showNotification('Could not export your vault', 'error');
        }
    }

    async doRestoreVault(event) {
        const file = event.target.files?.[0];
        if (!file) return;
        event.target.value = ''; // let the same file be re-picked later

        // Fresh device (no vault yet) → restore directly; that's the migration path, no friction.
        if (!(await api.hasVault())) {
            await this.performRestore(file);
            return;
        }
        // A vault already exists → gate the destructive overwrite behind the current password,
        // so someone with your locked device can't wipe your data by importing over it.
        this.pendingRestoreFile = file;
        this.openRestoreConfirm();
    }

    openRestoreConfirm() {
        document.getElementById('restore-current-password').value = '';
        this.showRestoreConfirmError('', false);
        document.getElementById('restore-confirm-modal').style.display = 'flex';
        setTimeout(() => document.getElementById('restore-current-password')?.focus(), 60);
    }

    closeRestoreConfirm() {
        document.getElementById('restore-confirm-modal').style.display = 'none';
        this.pendingRestoreFile = null;
    }

    async confirmRestore() {
        const file = this.pendingRestoreFile;
        if (!file) return;
        const pw = document.getElementById('restore-current-password').value;
        if (!pw) {
            this.showRestoreConfirmError('Enter your current password to confirm.');
            return;
        }
        // Verify the password by unlocking the current vault. Wrong password → no wipe.
        try {
            await api.unlock(pw);
        } catch {
            this.showRestoreConfirmError('That password does not match the space on this device.');
            return;
        }
        document.getElementById('restore-confirm-modal').style.display = 'none';
        this.pendingRestoreFile = null;
        await this.performRestore(file);
    }

    async performRestore(file) {
        try {
            await importVaultFile(file, api); // validates, replaces the ciphertext, then locks
            this.showNotification('Backup restored. Unlock it with its password.', 'success');
            this.showAuthPanel('unlock');
        } catch (error) {
            console.error('Vault restore failed:', error);
            api.lock(); // the old vault is untouched; don't leave a verified-but-not-restored state
            this.showNotification('That does not look like a .wymber file.', 'error');
        }
    }

    showRestoreConfirmError(message, show = true) {
        const el = document.getElementById('restore-confirm-error');
        if (!el) return;
        if (show && message) {
            el.textContent = message;
            el.style.display = 'block';
        } else {
            el.textContent = '';
            el.style.display = 'none';
        }
    }

    // ===== UI HELPERS =====

    showError(message, show = true) {
        const el = document.getElementById('error-message');
        if (!el) return;
        if (show && message) {
            el.textContent = message;
            el.style.display = 'block';
        } else {
            el.style.display = 'none';
        }
    }

    updateSaveIndicator(message, type = 'success') {
        const el = document.getElementById('save-indicator');
        if (!el) return;
        el.textContent = message;
        el.className = 'save-indicator';
        if (type === 'saving') el.classList.add('saving');
        else if (type === 'error') el.classList.add('error');
    }

    showNotification(message, type = 'info') {
        const el = document.createElement('div');
        el.className = `notification notification-${type}`;
        el.textContent = message;
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        document.body.appendChild(el);
        setTimeout(() => el.classList.add('show'), 10);
        setTimeout(() => {
            el.classList.remove('show');
            setTimeout(() => el.remove(), 300);
        }, 3000);
    }

    /**
     * A gentle, opt-in invitation to pair a freshly-added Trigger with a calming anchor (a coping
     * skill or a support), so a map is never only pain. Never forced; always easy to dismiss.
     */
    showPairingNudge(triggerId) {
        document.querySelector('.notification-nudge')?.remove();
        const el = document.createElement('div');
        el.className = 'notification notification-nudge';
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        el.innerHTML = `
            <p class="nudge-text">Triggers can feel lighter with an anchor nearby. Add a coping skill or a support for this one?</p>
            <div class="nudge-actions">
                <button type="button" class="nudge-add">Add an anchor</button>
                <button type="button" class="nudge-dismiss">Not now</button>
            </div>`;
        document.body.appendChild(el);
        setTimeout(() => el.classList.add('show'), 10);
        const close = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); };
        el.querySelector('.nudge-add').addEventListener('click', () => {
            this.pairingTriggerId = triggerId;
            close();
            this.showNodeModal('coping');
        });
        el.querySelector('.nudge-dismiss').addEventListener('click', close);
        // Lingers longer than a toast, but never nags forever.
        setTimeout(close, 15000);
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    const app = new WymberApp();
    app.init();
});

// Register the service worker (offline + installable). Best-effort; the app works without it.
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('SW registration failed:', err));
    });
}
