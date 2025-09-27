class APIClient {
    constructor() {
        this.baseURL = '/api';
        this.token = localStorage.getItem('token');
    }
    
    async request(method, endpoint, data = null) {
        const config = {
            method: method,
            headers: {
                'Content-Type': 'application/json'
            }
        };
        
        // Add auth token if available
        if (this.token) {
            config.headers['Authorization'] = `Bearer ${this.token}`;
        }
        
        // Add body for POST/PUT requests
        if (data && (method === 'POST' || method === 'PUT')) {
            config.body = JSON.stringify(data);
        }
        
        try {
            const response = await fetch(`${this.baseURL}${endpoint}`, config);
            
            // Handle 401 Unauthorized
            if (response.status === 401) {
                this.handleUnauthorized();
                throw new Error('Session expired');
            }
            
            // Handle other errors
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            // Return JSON if available
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                return await response.json();
            }
            
            return response;
        } catch (error) {
            console.error('API request failed:', error);
            throw error;
        }
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
        // Redirect to login
        if (document.getElementById('main-app')) {
            document.getElementById('main-app').style.display = 'none';
            document.getElementById('login-screen').style.display = 'block';
        }
    }
    
    // Convenience methods
    get(endpoint) {
        return this.request('GET', endpoint);
    }
    
    post(endpoint, data) {
        return this.request('POST', endpoint, data);
    }
    
    put(endpoint, data) {
        return this.request('PUT', endpoint, data);
    }
    
    delete(endpoint) {
        return this.request('DELETE', endpoint);
    }
}

// Global API instance
const api = new APIClient();