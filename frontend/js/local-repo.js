/**
 * LocalRepo — a drop-in, api.js-compatible local-first data layer.
 *
 * It exposes the same surface the UI already uses (`get/post/put/delete`, plus token
 * shims), but instead of talking to a server it drives the encrypted vault: a VaultStore
 * holds the decrypted document in memory, crypto.js handles the envelope encryption, and
 * a persistence backend stores only the ciphertext. Swapping `api` for a LocalRepo makes
 * the app local-first without changing the UI's call sites.
 */
import * as vaultCrypto from './crypto.js';
import { VaultStore, emptyDocument } from './vault-store.js';
import { VaultPersistence } from './persistence.js';

export class LocalRepo {
    constructor({ persistence, iterations } = {}) {
        this.persistence = persistence || new VaultPersistence();
        this.iterations = iterations; // undefined → crypto.js uses DEFAULT_ITERATIONS
        this.vault = null;
        this.store = null;
        this.dekKey = null;
    }

    isUnlocked() {
        return this.store != null;
    }

    async hasVault() {
        return this.persistence.hasVault();
    }

    /** Create a new vault, persist it, unlock it, and return the one-time recovery code. */
    async createVault(password) {
        const opts = this.iterations ? { iterations: this.iterations } : {};
        const { vault, recoveryCode } = await vaultCrypto.createVault(emptyDocument(), password, opts);
        await this.persistence.saveVault(vaultCrypto.serializeVault(vault));
        await this.unlock(password);
        return recoveryCode;
    }

    /** Unlock the stored vault with a password or recovery code. */
    async unlock(secret, method = 'password') {
        const str = await this.persistence.loadVault();
        if (!str) throw new Error('No vault on this device yet.');
        const vault = vaultCrypto.parseVault(str);
        const { document, dekKey } = await vaultCrypto.unlockVault(vault, secret, method);
        this.vault = vault;
        this.dekKey = dekKey;
        this.store = VaultStore.fromDocument(document);
        return true;
    }

    lock() {
        this.vault = null;
        this.store = null;
        this.dekKey = null;
    }

    async changePassword(oldPassword, newPassword) {
        this._assertUnlocked();
        this.vault = await vaultCrypto.changePassword(this.vault, oldPassword, newPassword);
        await this.persistence.saveVault(vaultCrypto.serializeVault(this.vault));
    }

    /** Forgot-password flow: reset the password using the recovery code (stays locked after). */
    async resetPassword(recoveryCode, newPassword) {
        const str = await this.persistence.loadVault();
        if (!str) throw new Error('No vault on this device yet.');
        const vault = vaultCrypto.parseVault(str);
        const updated = await vaultCrypto.resetPassword(vault, recoveryCode, newPassword);
        await this.persistence.saveVault(vaultCrypto.serializeVault(updated));
    }

    async destroyVault() {
        await this.persistence.clearVault();
        this.lock();
    }

    // ===== api.js-compatible surface =====

    async get(endpoint) {
        if (endpoint === '/check') {
            return { authenticated: this.isUnlocked(), username: this.isUnlocked() ? 'you' : null };
        }
        this._assertUnlocked();
        if (endpoint === '/mindmap') return this.store.getMindmap();
        if (endpoint === '/settings') return { settings: this.store.getSettings() };
        throw new Error(`Unsupported GET ${endpoint}`);
    }

    async post(endpoint, data) {
        this._assertUnlocked();
        if (endpoint === '/node') return this._mutate(() => this.store.addNode(data));
        if (endpoint === '/edge') return this._mutate(() => this.store.addEdge(data));
        throw new Error(`Unsupported POST ${endpoint}`);
    }

    async put(endpoint, data) {
        this._assertUnlocked();
        const nodeId = this._idFrom(endpoint, '/node/');
        if (nodeId != null) return this._mutate(() => this.store.updateNode(nodeId, data));
        if (endpoint === '/settings') return this._mutate(() => ({ settings: this.store.setSettings(data) }));
        throw new Error(`Unsupported PUT ${endpoint}`);
    }

    async delete(endpoint) {
        if (endpoint === '/account') {
            await this.destroyVault();
            return { ok: true };
        }
        this._assertUnlocked();
        const nodeId = this._idFrom(endpoint, '/node/');
        if (nodeId != null) return this._mutate(() => { this.store.deleteNode(nodeId); return { ok: true }; });
        const edgeId = this._idFrom(endpoint, '/edge/');
        if (edgeId != null) return this._mutate(() => { this.store.deleteEdge(edgeId); return { ok: true }; });
        throw new Error(`Unsupported DELETE ${endpoint}`);
    }

    // Token shims so a LocalRepo can stand in for the APIClient at existing call sites.
    setToken() { /* no server token in local-first */ }
    clearToken() { this.lock(); }
    get token() { return this.isUnlocked() ? 'local' : null; }

    // ===== internals =====

    async _mutate(fn) {
        const result = fn();
        await this._save();
        return result;
    }

    async _save() {
        this.vault = await vaultCrypto.sealDocument(this.vault, this.dekKey, this.store.toDocument());
        await this.persistence.saveVault(vaultCrypto.serializeVault(this.vault));
    }

    _assertUnlocked() {
        if (!this.isUnlocked()) throw new Error('Vault is locked.');
    }

    _idFrom(endpoint, prefix) {
        return endpoint.startsWith(prefix) ? parseInt(endpoint.slice(prefix.length), 10) : null;
    }
}
