import { NODE_TYPES } from './config.js';
import { extractNodeId, convertToMindElixirFormat, countNodes, walkNodes } from './utils.js';

export class TrauMindMap {
    constructor(container, apiClient) {
        this.container = container;
        this.api = apiClient;
        this.mindElixir = null;
        this.nodes = new Map();
        this.selectedNode = null;
        this.lastSave = null;
        this.autoSaveInterval = null;
        this.autoSaveTimeout = null;
        this.toolbarMode = 'select';
        this.connectingFrom = null;
        this.onShowNodeModal = null; // callback set by app.js

        this.config = {
            el: container,
            direction: window.MindElixir?.LEFT || 0,
            draggable: true,
            toolBar: false,
            nodeMenu: true,
            keypress: true,
            locale: 'en',
            overflowHidden: false,
            mainLinkStyle: 2,
            mouseSelectionButton: 0,
            contextMenu: {
                focus: true,
                link: true,
                extend: [
                    {
                        name: 'Edit Node',
                        onclick: (nodeObj) => this.editNode(nodeObj)
                    },
                    {
                        name: 'Delete Node',
                        onclick: (nodeObj) => this.deleteNode(nodeObj)
                    },
                    {
                        name: 'Connect To...',
                        onclick: (nodeObj) => this.startConnection(nodeObj)
                    }
                ]
            },
            theme: {
                name: 'TraumaInformed',
                palette: Object.values(NODE_TYPES).map(t => t.color),
                cssVar: {
                    '--main-color': '#2E3440',
                    '--main-bgcolor': '#FEFEFE',
                    '--color': '#5E81AC',
                    '--bgcolor': '#ECEFF4',
                    '--panel-color': '46, 52, 64',
                    '--panel-bgcolor': '236, 239, 244',
                    '--node-color': '#2E3440',
                    '--node-bgcolor': '#ECEFF4'
                }
            },
            before: {
                insertSibling: () => this.guardAdd(),
                addChild: () => this.guardAdd(),
                removeNode: () => true,
                finishEdit: () => true
            }
        };
    }

    async init() {
        if (!window.MindElixir) {
            throw new Error('MindElixir library not loaded');
        }

        this.mindElixir = new window.MindElixir(this.config);
        this.setupEventHandlers();
        this.setupToolbar();
        await this.loadMap();
        this.startAutoSave();
        return true;
    }

    // ===== DATA LOADING =====

    async loadMap() {
        try {
            const mapData = await this.api.get('/mindmap');
            const meData = convertToMindElixirFormat(mapData);

            if (meData) {
                this.mindElixir.init(meData);
            } else {
                this.mindElixir.init(window.MindElixir.new('My Healing Journey'));
            }

            this.updateNodeReferences();
            this.lastSave = new Date();
            this.updateSaveIndicator('All changes saved');
        } catch (error) {
            console.error('Error loading map:', error);
            this.mindElixir.init(window.MindElixir.new('My Healing Journey'));
        }
    }

    // ===== SAVE / SYNC =====

    async saveMap() {
        try {
            this.updateSaveIndicator('Saving...', 'saving');
            await this.syncToBackend();
            this.lastSave = new Date();
            this.updateSaveIndicator('All changes saved');
            return true;
        } catch (error) {
            console.error('Error saving map:', error);
            this.updateSaveIndicator('Save failed', 'error');
            return false;
        }
    }

    async syncToBackend() {
        const mapData = this.mindElixir.getData();
        const updates = [];

        // Walk the tree tracking each node's parent so reparents persist, not just positions.
        const sync = (node, parentDbId) => {
            const dbId = extractNodeId(node.id);
            if (dbId) {
                const body = { x: node.cx || 0, y: node.cy || 0 };
                if (parentDbId) body.parent_id = parentDbId;
                updates.push(this.api.put(`/node/${dbId}`, body));
            }
            const childParentId = dbId || parentDbId;
            if (node.children) {
                node.children.forEach((child) => sync(child, childParentId));
            }
        };
        sync(mapData.nodeData, null);

        await Promise.allSettled(updates);
    }

    startAutoSave() {
        this.autoSaveInterval = setInterval(() => {
            if (this.lastSave && (new Date() - this.lastSave) > 5000) {
                this.saveMap();
            }
        }, 30000);
    }

    stopAutoSave() {
        if (this.autoSaveInterval) {
            clearInterval(this.autoSaveInterval);
            this.autoSaveInterval = null;
        }
    }

    // ===== NODE OPERATIONS =====

    async addNode(nodeData) {
        if (!nodeData.node_type || !nodeData.title) {
            throw new Error('Invalid node data');
        }

        const parentNode = this.selectedNode || this.mindElixir.nodeData;
        const parentDbId = extractNodeId(parentNode?.id);
        const payload = parentDbId ? { ...nodeData, parent_id: parentDbId } : nodeData;

        const response = await this.api.post('/node', payload);
        const typeInfo = NODE_TYPES[nodeData.node_type];

        const newNode = {
            id: `node-${response.id}`,
            topic: nodeData.title,
            style: {
                background: typeInfo?.color || '#E8F5E8',
                color: '#2E3440'
            }
        };

        this.mindElixir.addChild(parentNode, newNode);
        this.updateNodeReferences();
        this.announceToScreenReader(`Added ${nodeData.title} to your map`);
        this.scheduleSave();
        return response.id;
    }

    editNode(nodeObj) {
        if (this.onShowNodeModal) {
            this.onShowNodeModal(nodeObj);
        }
    }

    async deleteNode(nodeObj) {
        const nodeId = extractNodeId(nodeObj.id);
        if (!nodeId) return;

        const confirmed = confirm(
            `This will remove "${nodeObj.topic}" and its connections from your map. ` +
            `You can always add it back later if you need to. Would you like to continue?`
        );
        if (!confirmed) return;

        await this.api.delete(`/node/${nodeId}`);
        this.mindElixir.removeNode(nodeObj);
        this.updateNodeReferences();
        this.announceToScreenReader(`Removed ${nodeObj.topic} from your map`);
        this.scheduleSave();
    }

    // ===== CONNECTIONS =====

    startConnection(nodeObj) {
        this.setToolbarMode('link');
        this.connectingFrom = nodeObj;
        this.highlightConnectingNode(nodeObj, true);
        this.updateToolbar();
    }

    async createConnection(fromNode, toNode) {
        const fromId = extractNodeId(fromNode.id);
        const toId = extractNodeId(toNode.id);

        if (!fromId || !toId) {
            this.showNotification('Could not identify nodes to connect', 'error');
            return;
        }

        try {
            await this.api.post('/edge', {
                from_node_id: fromId,
                to_node_id: toId,
                label: ''
            });

            // Add visual link in MindElixir
            if (this.mindElixir.addLink) {
                this.mindElixir.addLink(fromNode, toNode);
            }

            this.showNotification(
                `Connected "${fromNode.topic}" to "${toNode.topic}"`,
                'success'
            );
        } catch (error) {
            console.error('Error creating connection:', error);
            this.showNotification('Could not create connection', 'error');
        }
    }

    // ===== TOOLBAR =====

    setupToolbar() {
        this.toolbarElements = {
            selectBtn: document.getElementById('select-mode-btn'),
            linkBtn: document.getElementById('link-mode-btn'),
            editBtn: document.getElementById('edit-selected-btn'),
            deleteBtn: document.getElementById('delete-selected-btn'),
            status: document.getElementById('selection-status')
        };

        const { selectBtn, linkBtn, editBtn, deleteBtn } = this.toolbarElements;

        if (selectBtn) selectBtn.addEventListener('click', () => this.setToolbarMode('select'));
        if (linkBtn) linkBtn.addEventListener('click', () => this.setToolbarMode('link'));
        if (editBtn) editBtn.addEventListener('click', () => {
            if (this.selectedNode) this.editNode(this.selectedNode);
        });
        if (deleteBtn) deleteBtn.addEventListener('click', () => {
            if (this.selectedNode && this.selectedNode.id !== 'root') {
                this.deleteNode(this.selectedNode);
                this.selectedNode = null;
                this.updateToolbar();
            }
        });

        this.mindElixir.bus.addListener('selectNode', (node) => {
            this.handleNodeSelection(node);
        });
    }

    setToolbarMode(mode) {
        this.toolbarMode = mode;
        this.connectingFrom = null;
        this.updateToolbar();

        document.querySelectorAll('.btn-toolbar').forEach(btn => btn.classList.remove('active'));
        if (mode === 'select' && this.toolbarElements.selectBtn) {
            this.toolbarElements.selectBtn.classList.add('active');
        } else if (mode === 'link' && this.toolbarElements.linkBtn) {
            this.toolbarElements.linkBtn.classList.add('active');
        }
    }

    handleNodeSelection(node) {
        if (this.toolbarMode === 'link') {
            this.handleLinkModeClick(node);
            return;
        }

        this.selectedNode = node;
        this.updateToolbar();
        this.announceToScreenReader(`Selected ${node.topic}`);
    }

    handleLinkModeClick(node) {
        if (!this.connectingFrom) {
            this.connectingFrom = node;
            this.highlightConnectingNode(node, true);
            this.updateToolbar();
        } else if (this.connectingFrom.id !== node.id) {
            this.createConnection(this.connectingFrom, node);
            this.highlightConnectingNode(this.connectingFrom, false);
            this.connectingFrom = null;
            this.setToolbarMode('select');
        } else {
            this.highlightConnectingNode(this.connectingFrom, false);
            this.connectingFrom = null;
            this.updateToolbar();
        }
    }

    updateToolbar() {
        const { editBtn, deleteBtn, status } = this.toolbarElements;
        const hasSelection = this.selectedNode && this.selectedNode.id !== 'root';

        if (editBtn) editBtn.disabled = !hasSelection;
        if (deleteBtn) deleteBtn.disabled = !hasSelection;

        if (status) {
            if (this.toolbarMode === 'link' && this.connectingFrom) {
                status.textContent = `Linking from "${this.connectingFrom.topic}" - click another node to connect`;
            } else if (hasSelection) {
                status.textContent = `Selected: "${this.selectedNode.topic}"`;
            } else if (this.toolbarMode === 'link') {
                status.textContent = 'Link mode: click a node to start connecting';
            } else {
                status.textContent = 'No node selected';
            }
        }
    }

    highlightConnectingNode(node, highlight) {
        const el = this.container.querySelector(`[data-nodeid="${node.id}"]`);
        if (el) {
            el.classList.toggle('node-connecting', highlight);
        }
    }

    // ===== EVENT HANDLERS =====

    setupEventHandlers() {
        this.mindElixir.bus.addListener('operation', () => {
            this.scheduleSave();
        });

        this.mindElixir.bus.addListener('selectNode', (node) => {
            this.selectedNode = node;
        });

        document.addEventListener('keydown', (e) => {
            if (this.container.contains(e.target) || e.target === document.body) {
                this.handleKeyboard(e);
            }
        });
    }

    handleKeyboard(e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        switch (e.key) {
            case 'Delete':
            case 'Backspace':
                if (this.selectedNode && this.selectedNode.id !== 'root') {
                    e.preventDefault();
                    this.deleteNode(this.selectedNode);
                }
                break;
            case 'Tab':
                if (!e.shiftKey) {
                    e.preventDefault();
                    this.focusNextNode();
                }
                break;
        }
    }

    // ===== HELPERS =====

    guardAdd() {
        const count = countNodes(this.mindElixir.nodeData);
        if (count > 50) {
            this.showNotification('Your map is getting quite full. Consider organizing or removing some nodes first.', 'error');
            return false;
        }
        return true;
    }

    scheduleSave() {
        clearTimeout(this.autoSaveTimeout);
        this.autoSaveTimeout = setTimeout(() => this.saveMap(), 2000);
    }

    updateNodeReferences() {
        this.nodes.clear();
        walkNodes(this.mindElixir.nodeData, (node) => {
            this.nodes.set(node.id, node);
        });
    }

    focusNextNode() {
        const allNodes = Array.from(this.nodes.values());
        if (allNodes.length === 0) return;
        const currentIdx = this.selectedNode
            ? allNodes.findIndex(n => n.id === this.selectedNode.id)
            : -1;
        const next = allNodes[(currentIdx + 1) % allNodes.length];
        this.mindElixir.selectNode(next);
        this.announceToScreenReader(`Focused on ${next.topic}`);
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

    announceToScreenReader(message) {
        const el = document.createElement('div');
        el.setAttribute('aria-live', 'polite');
        el.setAttribute('aria-atomic', 'true');
        el.className = 'sr-only';
        el.textContent = message;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 1000);
    }

    destroy() {
        this.stopAutoSave();
        clearTimeout(this.autoSaveTimeout);
        if (this.mindElixir?.destroy) {
            this.mindElixir.destroy();
        }
    }
}
