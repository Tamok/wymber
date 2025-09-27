class TrauMappdApp {
    constructor() {
        this.currentUser = null;
        this.authManager = new AuthManager();
    }
    
    async init() {
        // Check if user is logged in
        const token = localStorage.getItem('token');
        
        if (token) {
            api.setToken(token);
            
            try {
                // Verify token is still valid
                const response = await api.get('/check');
                if (response.authenticated) {
                    this.currentUser = response.username;
                    await this.showMainApp();
                } else {
                    this.showLoginScreen();
                }
            } catch (error) {
                this.showLoginScreen();
            }
        } else {
            this.showLoginScreen();
        }
        
        // Setup event listeners
        this.setupEventListeners();
    }
    
    setupEventListeners() {
        // Login form
        const loginForm = document.getElementById('login-form');
        if (loginForm) {
            loginForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                await this.handleLogin();
            });
        }
        
        // Logout button
        const logoutBtn = document.getElementById('logout-btn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', async () => {
                await this.handleLogout();
            });
        }
        
        // Add node button
        const addNodeBtn = document.getElementById('add-node-btn');
        if (addNodeBtn) {
            addNodeBtn.addEventListener('click', () => {
                this.showNodeModal();
            });
        }
        
        // Settings button
        const settingsBtn = document.getElementById('settings-btn');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', () => {
                this.showSettingsModal();
            });
        }
        
        // Modal close buttons
        document.querySelectorAll('.close-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const modal = e.target.closest('.modal');
                if (modal) {
                    modal.style.display = 'none';
                }
            });
        });
        
        // Save node button
        const saveNodeBtn = document.getElementById('save-node');
        if (saveNodeBtn) {
            saveNodeBtn.addEventListener('click', async () => {
                await this.saveNode();
            });
        }
        
        // Cancel node button
        const cancelNodeBtn = document.getElementById('cancel-node');
        if (cancelNodeBtn) {
            cancelNodeBtn.addEventListener('click', () => {
                document.getElementById('node-modal').style.display = 'none';
            });
        }
        
        // Node type selector
        const nodeTypeSelect = document.getElementById('node-type');
        if (nodeTypeSelect) {
            nodeTypeSelect.addEventListener('change', (e) => {
                this.updateNodeTypeDescription(e.target.value);
            });
        }
        
        // Close modals when clicking outside
        window.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) {
                e.target.style.display = 'none';
            }
        });
        
        // Hide crisis bar
        const hideCrisisBtn = document.getElementById('hide-crisis-bar');
        if (hideCrisisBtn) {
            hideCrisisBtn.addEventListener('click', () => {
                document.getElementById('crisis-bar').style.display = 'none';
            });
        }
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            
            switch(e.key) {
                case 'n':
                case 'N':
                    if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        this.showNodeModal();
                    }
                    break;
                case 'Escape':
                    // Close any open modal
                    document.querySelectorAll('.modal').forEach(modal => {
                        if (modal.style.display === 'block' || modal.style.display === 'flex') {
                            modal.style.display = 'none';
                        }
                    });
                    break;
            }
        });
    }
    
    async handleLogin() {
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;
        const errorDiv = document.getElementById('error-message');
        
        if (!username || !password) {
            this.showError('Please enter both username and password');
            return;
        }
        
        try {
            this.showError('', false); // Clear previous errors
            
            // Clear any existing token to ensure clean login
            api.clearToken();
            
            // Try login first
            try {
                const token = await this.authManager.login(username, password);
                localStorage.setItem('token', token); // Store token in localStorage
                api.setToken(token);
                this.currentUser = username;
                await this.showMainApp();
                return;
            } catch (loginError) {
                // If login fails, try setup (first-time user)
                try {
                    await this.authManager.setup(username, password);
                    // Now try login again
                    const token = await this.authManager.login(username, password);
                    localStorage.setItem('token', token); // Store token in localStorage
                    api.setToken(token);
                    this.currentUser = username;
                    await this.showMainApp();
                    return;
                } catch (setupError) {
                    throw loginError; // Use original login error
                }
            }
        } catch (error) {
            console.error('Authentication error:', error);
            this.showError('Login failed. Please check your credentials and try again.');
        }
    }
    
    async handleLogout() {
        try {
            if (this.currentUser) {
                await this.authManager.logout(api.token);
            }
        } catch (error) {
            console.error('Logout error:', error);
        }
        
        // Complete cleanup of authentication state
        api.clearToken();
        localStorage.removeItem('token');
        this.currentUser = null;
        this.showLoginScreen();
    }
    
    showLoginScreen() {
        document.getElementById('main-app').style.display = 'none';
        document.getElementById('login-screen').style.display = 'block';
        
        // Complete cleanup on login screen
        api.clearToken();
        localStorage.removeItem('token');
        
        // Clear form
        document.getElementById('username').value = '';
        document.getElementById('password').value = '';
        this.showError('', false);
        
        // Check if this is first run
        this.authManager.checkFirstRun();
        
        // Focus username field
        document.getElementById('username').focus();
    }
    
    async showMainApp() {
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('main-app').style.display = 'block';
        
        // Load user's map
        try {
            const mapData = await api.get('/mindmap');
            this.updateSaveIndicator('All changes saved');
            // TODO: Render mind map when Phase 2 is implemented
        } catch (error) {
            console.error('Error loading map:', error);
            this.updateSaveIndicator('Error loading map', 'error');
        }
    }
    
    showNodeModal() {
        const modal = document.getElementById('node-modal');
        const title = document.getElementById('modal-title');
        
        // Reset form
        document.getElementById('node-type').value = '';
        document.getElementById('node-title').value = '';
        document.getElementById('node-description').value = '';
        document.getElementById('type-description').innerHTML = '';
        
        title.textContent = 'Add to Your Map';
        modal.style.display = 'flex';
        
        // Focus first input for accessibility
        setTimeout(() => {
            document.getElementById('node-type').focus();
        }, 100);
    }
    
    showSettingsModal() {
        const modal = document.getElementById('settings-modal');
        const content = document.getElementById('settings-content');
        
        content.innerHTML = `
            <div class="settings-panel">
                <section>
                    <h3>Appearance</h3>
                    <div class="form-group">
                        <label for="theme-select">Theme</label>
                        <select id="theme-select">
                            <option value="light">Light (Default)</option>
                            <option value="dark">Dark</option>
                            <option value="soft">Soft (Low Contrast)</option>
                        </select>
                    </div>
                    
                    <div class="form-group">
                        <label for="font-size">Font Size</label>
                        <select id="font-size">
                            <option value="small">Small</option>
                            <option value="medium" selected>Medium</option>
                            <option value="large">Large</option>
                            <option value="xlarge">Extra Large</option>
                        </select>
                    </div>
                </section>
                
                <section>
                    <h3>Privacy & Data</h3>
                    <div class="form-group">
                        <label>
                            <input type="checkbox" id="retain-chat" checked>
                            Save chat conversations
                        </label>
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
            </div>
        `;
        
        modal.style.display = 'flex';
    }
    
    updateNodeTypeDescription(nodeType) {
        const description = document.getElementById('type-description');
        
        if (nodeType && NODE_TYPES[nodeType]) {
            const typeInfo = NODE_TYPES[nodeType];
            description.innerHTML = `
                <div class="type-info">
                    <p>${typeInfo.description}</p>
                    <small>${typeInfo.tooltip}</small>
                </div>
            `;
        } else {
            description.innerHTML = '';
        }
    }
    
    async saveNode() {
        const nodeType = document.getElementById('node-type').value;
        const title = document.getElementById('node-title').value.trim();
        const description = document.getElementById('node-description').value.trim();
        
        if (!nodeType || !title) {
            this.showNotification('Please select a type and enter a title', 'error');
            return;
        }
        
        const nodeData = {
            node_type: nodeType,
            title: title,
            description: description,
            x: Math.random() * 300 + 50, // Random position for now
            y: Math.random() * 200 + 50
        };
        
        try {
            const response = await api.post('/node', nodeData);
            this.showNotification('Added to your map', 'success');
            
            // Close modal
            document.getElementById('node-modal').style.display = 'none';
            
            // TODO: Update mind map display when Phase 2 is implemented
            
        } catch (error) {
            console.error('Error saving node:', error);
            this.showNotification('Could not save entry', 'error');
        }
    }
    
    showError(message, show = true) {
        const errorDiv = document.getElementById('error-message');
        if (errorDiv) {
            if (show && message) {
                errorDiv.textContent = message;
                errorDiv.style.display = 'block';
            } else {
                errorDiv.style.display = 'none';
            }
        }
    }
    
    updateSaveIndicator(message, type = 'success') {
        const indicator = document.getElementById('save-indicator');
        if (indicator) {
            indicator.textContent = message;
            indicator.className = 'save-indicator';
            
            if (type === 'saving') {
                indicator.classList.add('saving');
            } else if (type === 'error') {
                indicator.classList.add('error');
            }
        }
    }
    
    showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;
        notification.setAttribute('role', 'status');
        notification.setAttribute('aria-live', 'polite');
        
        document.body.appendChild(notification);
        
        // Animate in
        setTimeout(() => {
            notification.classList.add('show');
        }, 10);
        
        // Remove after 3 seconds
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => {
                notification.remove();
            }, 300);
        }, 3000);
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    const app = new TrauMappdApp();
    app.init();
});