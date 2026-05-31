import { NODE_TYPES } from './config.js';
import { api } from './api.js';
import { AuthManager } from './auth.js';
import { TrauMindMap } from './mindmap.js';
import { validateNodeData, passwordStrength } from './utils.js';
import { analyzeMap, renderAnalysis } from './analyze.js';
import { exportAsJSON, exportAsText, importMap } from './export.js';

class TrauMappdApp {
    constructor() {
        this.currentUser = null;
        this.authManager = new AuthManager();
        this.mindMap = null;
        this.editingNode = null;
        this.authMode = 'login';
    }

    async init() {
        const token = localStorage.getItem('token');

        if (token) {
            api.setToken(token);
            try {
                const response = await api.get('/check');
                if (response.authenticated) {
                    this.currentUser = response.username;
                    await this.showMainApp();
                } else {
                    this.showLoginScreen();
                }
            } catch {
                this.showLoginScreen();
            }
        } else {
            this.showLoginScreen();
        }

        this.setupEventListeners();
    }

    // ===== AUTH =====

    setupEventListeners() {
        const loginForm = document.getElementById('login-form');
        if (loginForm) {
            loginForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                await this.handleLogin();
            });
        }

        const passwordInput = document.getElementById('password');
        if (passwordInput) {
            passwordInput.addEventListener('input', () => this.updateStrengthMeter());
        }

        const logoutBtn = document.getElementById('logout-btn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => this.handleLogout());
        }

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

        // Safety affordances — available on both the login and main screens.
        document.getElementById('grounding-btn')?.addEventListener('click', () => this.openGrounding());
        document.getElementById('crisis-btn')?.addEventListener('click', () => this.openSafetyModal('crisis-modal'));
        document.getElementById('close-crisis')?.addEventListener('click', () => this.closeSafetyModal('crisis-modal'));
        document.getElementById('close-crisis-btn')?.addEventListener('click', () => this.closeSafetyModal('crisis-modal'));
        document.getElementById('close-grounding')?.addEventListener('click', () => this.closeGrounding());
        document.getElementById('close-grounding-btn')?.addEventListener('click', () => this.closeGrounding());
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
        document.getElementById('export-json')?.addEventListener('click', () => this.doExport('json'));
        document.getElementById('export-text')?.addEventListener('click', () => this.doExport('text'));
        document.getElementById('import-file')?.addEventListener('change', (e) => this.doImport(e));

        document.getElementById('open-map-btn')?.addEventListener('click', () => this.openMapFromSoftStart());
        document.getElementById('soft-start-grounding-btn')?.addEventListener('click', () => this.openGrounding());
    }

    async handleLogin() {
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;

        if (!username || !password) {
            this.showError('Please enter both your username and password');
            return;
        }

        try {
            this.showError('', false);
            api.clearToken();

            if (this.authMode === 'create') {
                const confirmPw = document.getElementById('confirm-password').value;
                const acknowledged = document.getElementById('ack-no-recovery').checked;
                if (password.length < 8) {
                    this.showError('Please choose a password with at least 8 characters.');
                    return;
                }
                if (password !== confirmPw) {
                    this.showError("The passwords don't match. Please re-enter them.");
                    return;
                }
                if (!acknowledged) {
                    this.showError('Please confirm you understand there is no password recovery.');
                    return;
                }
                await this.authManager.setup(username, password);
            }

            const token = await this.authManager.login(username, password);
            api.setToken(token);
            this.currentUser = username;
            await this.showMainApp();
        } catch {
            this.showError(this.authMode === 'create'
                ? 'Could not create your account. That username may be taken — please try another.'
                : 'Login failed. Please check your credentials and try again.');
        }
    }

    async handleLogout() {
        try {
            if (this.currentUser) await this.authManager.logout(api.token);
        } catch { /* ignore */ }

        if (this.mindMap) {
            this.mindMap.destroy();
            this.mindMap = null;
        }

        api.clearToken();
        this.currentUser = null;
        this.showLoginScreen();
    }

    showLoginScreen() {
        document.getElementById('main-app').style.display = 'none';
        document.getElementById('login-screen').style.display = 'block';
        api.clearToken();

        document.getElementById('username').value = '';
        document.getElementById('password').value = '';
        const confirmPw = document.getElementById('confirm-password');
        if (confirmPw) confirmPw.value = '';
        const ack = document.getElementById('ack-no-recovery');
        if (ack) ack.checked = false;
        this.showError('', false);
        this.applyAuthMode();
        this.updateStrengthMeter();
        document.getElementById('username').focus();
    }

    async applyAuthMode() {
        let hasUser = true;
        try {
            const res = await fetch('/api/status');
            if (res.ok) hasUser = (await res.json()).has_user;
        } catch {
            hasUser = true;
        }
        this.authMode = hasUser ? 'login' : 'create';
        const createMode = this.authMode === 'create';

        const toggle = (id, show) => {
            const el = document.getElementById(id);
            if (el) el.style.display = show ? 'block' : 'none';
        };
        toggle('confirm-group', createMode);
        toggle('password-strength', createMode);
        toggle('ack-group', createMode);

        const submit = document.getElementById('auth-submit');
        if (submit) submit.textContent = createMode ? 'Create account' : 'Log in';

        const note = document.getElementById('setup-prompt');
        if (note) {
            note.style.display = createMode ? 'block' : 'none';
            if (createMode) {
                note.innerHTML = "<p><strong>Welcome.</strong> Create your private account below. " +
                    "Your password encrypts everything and is the only key — there's no recovery, " +
                    "so choose something you'll remember.</p>";
            }
        }
        this.updateStrengthMeter();
    }

    updateStrengthMeter() {
        const pwInput = document.getElementById('password');
        const fill = document.getElementById('strength-fill');
        const label = document.getElementById('strength-label');
        if (!pwInput || !fill || !label) return;
        if (this.authMode !== 'create') {
            fill.style.width = '0';
            label.textContent = '';
            return;
        }
        const pw = pwInput.value;
        const { score, label: text } = passwordStrength(pw);
        fill.style.width = `${(score / 4) * 100}%`;
        fill.className = `strength-fill strength-${score}`;
        label.textContent = pw ? text : '';
    }

    async showMainApp() {
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('main-app').style.display = 'block';

        this.setupMainAppEventListeners();
        await this.loadSettings();

        // A gentle "soft start" — the map renders only when the user chooses to open it.
        this.showSoftStart();
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

    showNodeModal(nodeObj = null) {
        const modal = document.getElementById('node-modal');
        const title = document.getElementById('modal-title');
        this.editingNode = nodeObj;

        if (nodeObj) {
            title.textContent = 'Edit Node';
            this.populateNodeModal(nodeObj);
        } else {
            title.textContent = 'Add to Your Map';
            document.getElementById('node-type').value = '';
            document.getElementById('node-title').value = '';
            document.getElementById('node-description').value = '';
            document.getElementById('type-description').innerHTML = '';
        }

        modal.style.display = 'flex';
        setTimeout(() => {
            (nodeObj ? document.getElementById('node-title') : document.getElementById('node-type')).focus();
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
        if (nodeType && NODE_TYPES[nodeType]) {
            const info = NODE_TYPES[nodeType];
            el.innerHTML = `<div class="type-info"><p>${info.description}</p><small>${info.tooltip}</small></div>`;
        } else {
            el.innerHTML = '';
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
                if (this.mindMap) {
                    await this.mindMap.addNode(nodeData);
                } else {
                    await api.post('/node', nodeData);
                }
                this.showNotification('Added to your map', 'success');
            }

            document.getElementById('node-modal').style.display = 'none';
            this.editingNode = null;
        } catch (error) {
            console.error('Error saving node:', error);
            this.showNotification('Could not save entry', 'error');
        }
    }

    // ===== SETTINGS =====

    showSettingsModal() {
        const content = document.getElementById('settings-content');
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
        const currentFont = document.documentElement.getAttribute('data-font-size') || 'medium';

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
                    <p class="settings-note">Permanently removes your account and all entries from this device. This can't be undone, and there's no backup unless you exported one.</p>
                </section>
            </div>
        `;

        document.getElementById('delete-account-btn')?.addEventListener('click', () => this.deleteAccount());
        document.getElementById('settings-modal').style.display = 'flex';
    }

    async deleteAccount() {
        const confirmed = confirm(
            'Permanently delete your account and ALL your entries from this device?\n\n' +
            "This cannot be undone, and there's no backup unless you exported one."
        );
        if (!confirmed) return;
        try {
            await api.delete('/account');
            if (this.mindMap) { this.mindMap.destroy(); this.mindMap = null; }
            api.clearToken();
            this.currentUser = null;
            document.getElementById('settings-modal').style.display = 'none';
            this.showLoginScreen();
            this.showNotification('Your account and data were permanently deleted.', 'success');
        } catch (error) {
            console.error('Error deleting account:', error);
            this.showNotification('Could not delete your data. Please try again.', 'error');
        }
    }

    async saveSettings() {
        const theme = document.getElementById('theme-select').value;
        const fontSize = document.getElementById('font-size').value;

        document.documentElement.setAttribute('data-theme', theme);
        document.documentElement.setAttribute('data-font-size', fontSize);

        try {
            await api.put('/settings', { theme, fontSize });
        } catch (error) {
            console.error('Error saving settings:', error);
        }

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
        } catch {
            // Settings not available, use defaults
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
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    const app = new TrauMappdApp();
    app.init();
});
