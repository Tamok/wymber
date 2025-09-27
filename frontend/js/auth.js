class AuthManager {
    constructor() {
        this.setupPromptShown = false;
    }
    
    async checkFirstRun() {
        try {
            const response = await fetch('/api/check');
            if (!response.ok) {
                // No users exist yet
                this.showSetupPrompt();
            }
        } catch (error) {
            // Server might not have any users
            this.showSetupPrompt();
        }
    }
    
    showSetupPrompt() {
        if (!this.setupPromptShown) {
            const prompt = document.getElementById('setup-prompt');
            if (prompt) {
                prompt.style.display = 'block';
                prompt.innerHTML = `
                    <p><strong>Welcome to TrauMapp'd!</strong></p>
                    <p>Create your account above to get started.</p>
                    <p>Your data will be encrypted and stored locally.</p>
                `;
            }
            this.setupPromptShown = true;
        }
    }
    
    async login(username, password) {
        const formData = new FormData();
        formData.append('username', username);
        formData.append('password', password);
        
        const response = await fetch('/api/login', {
            method: 'POST',
            body: formData
        });
        
        if (response.ok) {
            const data = await response.json();
            return data.access_token;
        } else {
            throw new Error('Login failed');
        }
    }
    
    async setup(username, password) {
        const response = await fetch('/api/setup', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });
        
        if (response.ok) {
            return true;
        } else {
            throw new Error('Setup failed');
        }
    }
    
    async logout(token) {
        await fetch('/api/logout', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
    }
}