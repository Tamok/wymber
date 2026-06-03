import { NODE_TYPES } from './config.js';
import { LocalRepo } from './local-repo.js';
import { TrauMindMap } from './mindmap.js';
import { validateNodeData, passwordStrength } from './utils.js';
import { analyzeMap, renderAnalysis } from './analyze.js';
import { exportAsJSON, exportAsText, importMap, exportVaultFile, importVaultFile } from './export.js';

// Local-first: the encrypted vault on this device IS the backend. `api` keeps the
// same get/post/put/delete surface the rest of the app already uses.
const api = new LocalRepo();

class WymberApp {
    constructor() {
        this.currentUser = null;
        this.mindMap = null;
        this.editingNode = null;
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
                if (e.target.id === 'node-modal') this.editingNode = null;
                if (e.target.id === 'grounding-modal') this.stopBreathing();
            }
        });

        // Close all modals on Escape, Ctrl+N for new node
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            if (e.key === 'Escape') {
                document.querySelectorAll('.modal').forEach(m => {
                    if (m.style.display === 'flex') {
                        m.style.display = 'none';
                        if (m.id === 'node-modal') this.editingNode = null;
                    }
                });
                this.stopBreathing();
            }

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
            () => this.showNotification('Could not copy — please write it down', 'error')
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
        if (!pwInput || !fill || !label) return;
        const pw = pwInput.value;
        const { score, label: text } = passwordStrength(pw);
        fill.style.width = `${(score / 4) * 100}%`;
        fill.className = `strength-fill strength-${score}`;
        label.textContent = pw ? text : '';
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
        const el = document.getElementById('breathing-guide');
        if (!el) return;
        this.stopBreathing();
        const phases = ['Breathe in…', 'Hold…', 'Breathe out…'];
        let i = 0;
        el.textContent = phases[0];
        this.breathingInterval = setInterval(() => {
            i = (i + 1) % phases.length;
            el.textContent = phases[i];
        }, 4000);
    }

    stopBreathing() {
        if (this.breathingInterval) {
            clearInterval(this.breathingInterval);
            this.breathingInterval = null;
        }
    }

    setupMainAppEventListeners() {
        document.getElementById('add-node-btn')?.addEventListener('click', () => this.showNodeModal());
        document.getElementById('settings-btn')?.addEventListener('click', () => this.showSettingsModal());
        document.getElementById('analyze-btn')?.addEventListener('click', () => this.showAnalysis());
        document.getElementById('export-btn')?.addEventListener('click', () => this.showExportModal());

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
            this.editingNode = null;
        });

        // Node type description updates
        document.getElementById('node-type')?.addEventListener('change', (e) => {
            this.updateNodeTypeDescription(e.target.value);
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
        this.mindMap.onShowNodeModal = (nodeObj) => this.showNodeModal(nodeObj);

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

    showNodeModal(nodeObj = null, presetType = null) {
        const modal = document.getElementById('node-modal');
        const title = document.getElementById('modal-title');
        this.editingNode = nodeObj;

        if (nodeObj) {
            title.textContent = 'Edit Node';
            this.populateNodeModal(nodeObj);
        } else {
            title.textContent = 'Add to Your Map';
            document.getElementById('node-type').value = presetType || '';
            document.getElementById('node-title').value = '';
            document.getElementById('node-description').value = '';
            document.getElementById('type-description').innerHTML = '';
            if (presetType) this.updateNodeTypeDescription(presetType);
        }

        modal.style.display = 'flex';
        setTimeout(() => {
            // With a type already chosen (edit, or a pre-set add), focus the title; otherwise the type.
            (nodeObj || presetType ? document.getElementById('node-title') : document.getElementById('node-type')).focus();
        }, 100);
    }

    async populateNodeModal(nodeObj) {
        try {
            const nodeId = typeof nodeObj === 'string' ? nodeObj : nodeObj?.id;
            const mapData = await api.get('/mindmap');
            const idNum = typeof nodeId === 'string' && nodeId.startsWith('node-')
                ? parseInt(nodeId.replace('node-', ''), 10)
                : nodeId;
            const node = mapData.nodes.find(n => n.id === idNum);

            if (node) {
                document.getElementById('node-type').value = node.node_type;
                document.getElementById('node-title').value = node.title;
                document.getElementById('node-description').value = node.description || '';
                this.updateNodeTypeDescription(node.node_type);
            }
        } catch (error) {
            console.error('Error loading node data:', error);
        }
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
            if (this.editingNode) {
                const nodeId = typeof this.editingNode === 'string'
                    ? this.editingNode.replace('node-', '')
                    : this.editingNode?.id?.replace?.('node-', '') || this.editingNode;
                await api.put(`/node/${nodeId}`, { title, description });

                if (this.editingNode?.topic !== undefined) {
                    this.editingNode.topic = title;
                    this.mindMap?.mindElixir?.refresh();
                }
                this.showNotification('Node updated', 'success');
            } else {
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
            }

            document.getElementById('node-modal').style.display = 'none';
            this.editingNode = null;
        } catch (error) {
            console.error('Error saving node:', error);
            this.showNotification('Could not save entry', 'error');
            return;
        }

        // After the modal closes, gently invite an anchor for a brand-new trigger.
        if (newTriggerId) this.showPairingNudge(newTriggerId);
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
        try {
            if (await api.hasVault() &&
                !confirm('This replaces the space currently on this device. Continue?')) {
                event.target.value = '';
                return;
            }
            await importVaultFile(file, api);
            event.target.value = '';
            this.showNotification('Backup restored. Unlock it with its password.', 'success');
            this.showAuthPanel('unlock');
        } catch (error) {
            console.error('Vault restore failed:', error);
            event.target.value = '';
            this.showNotification('That does not look like a .wymber file.', 'error');
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
            this.showNodeModal(null, 'coping');
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
