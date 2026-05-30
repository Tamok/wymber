export class APIClient {
    constructor() {
        this.baseURL = '/api';
        this.token = localStorage.getItem('token');
    }

    async request(method, endpoint, data = null) {
        const config = {
            method,
            headers: { 'Content-Type': 'application/json' }
        };

        if (this.token) {
            config.headers['Authorization'] = `Bearer ${this.token}`;
        }

        if (data && (method === 'POST' || method === 'PUT')) {
            config.body = JSON.stringify(data);
        }

        const response = await fetch(`${this.baseURL}${endpoint}`, config);

        if (response.status === 401) {
            this.handleUnauthorized();
            throw new Error('Session expired');
        }

        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.detail || `HTTP ${response.status}`);
        }

        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            return await response.json();
        }

        return response;
    }

    setToken(token) {
        this.token = token;
        localStorage.setItem('token', token);
    }

    clearToken() {
        this.token = null;
        localStorage.removeItem('token');
    }

    handleUnauthorized() {
        this.clearToken();
        const mainApp = document.getElementById('main-app');
        const loginScreen = document.getElementById('login-screen');
        if (mainApp) mainApp.style.display = 'none';
        if (loginScreen) loginScreen.style.display = 'block';
    }

    get(endpoint) { return this.request('GET', endpoint); }
    post(endpoint, data) { return this.request('POST', endpoint, data); }
    put(endpoint, data) { return this.request('PUT', endpoint, data); }
    delete(endpoint) { return this.request('DELETE', endpoint); }
}

export const api = new APIClient();
