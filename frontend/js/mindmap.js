import { NODE_TYPES, typeColor } from './config.js';

/**
 * TrauMindMap — the Wymber graph renderer (Cytoscape).
 *
 * It draws the map the way the data actually is: gentle pastel "building-block" nodes and
 * first-class edges, rendered straight from the vault's { nodes, edges } document. No tree
 * conversion, no synthetic root. It sits behind the unchanged api seam (LocalRepo), so app.js
 * keeps calling init / loadMap / addNode / editNode / deleteNode / applyTheme / destroy exactly
 * as before. ADR-0002: own the taxonomy, rent the renderer.
 *
 * Accessibility is architecture here: every visual node has a twin in the #map-outline list, a
 * keyboard-reachable representation that stays in lockstep with the canvas. Selecting, editing,
 * and linking all work from the outline, so the map is usable without a pointer or sight.
 */

const typeLabel = (t) => NODE_TYPES[t]?.label || (t ? t[0].toUpperCase() + t.slice(1) : 'Dot');

// Canvas + edge colors per app theme. Node fills stay the constant pastel type colors (they read
// well on any background with the dark label text); only the surrounding canvas and the edges
// follow light / dark / soft so the map never looks pasted onto the wrong theme.
// `focus` mirrors --accent in styles.css exactly, per theme. The canvas is drawn to a bitmap and
// cannot read CSS custom properties, so the roving-focus ring color has to be duplicated here by
// hand; if --accent ever moves, update these three lines with it (frontend/tests/contrast.test.js
// does not reach into here).
const CANVAS = {
    light: { bg: '#FEFEFE', edge: '#cfc7ba', suggested: '#9b8bbd', focus: '#5F5185' },
    dark:  { bg: '#1f2228', edge: '#3a3f49', suggested: '#7c6fa6', focus: '#A99AD6' },
    soft:  { bg: '#f7f2ea', edge: '#d8cdbb', suggested: '#9b8bbd', focus: '#63548A' },
};

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

// Screen-space bearing (in atan2(dy, dx) degrees) each arrow key points along. The canvas y-axis
// points down, so "up" is -90 degrees, not +90.
const DIRECTION_AXIS_DEG = { up: -90, down: 90, left: 180, right: 0 };
const DIRECTION_CONE_DEG = 60;
// Phrasing for the "nothing that way" announcement. "No dot to the up." reads wrong, so up/down
// get their own preposition instead of reusing "to the {direction}" for all four.
const DIRECTION_PHRASE = { up: 'above', down: 'below', left: 'to the left', right: 'to the right' };
const NEIGHBOUR_BONUS = 0.5; // a connected candidate's distance counts for half, so it wins ties

/** Smallest signed angle from `b` to `a`, in degrees, wrapped to [-180, 180]. */
function angleDiffDeg(a, b) {
    let d = a - b;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    return d;
}

/**
 * Pure direction-picker for canvas roving focus (issue #126). No DOM, no Cytoscape, no `this`,
 * so it's unit-testable on its own (frontend/tests/mindmap-nav.test.js) without faking a renderer.
 *
 * Candidates are restricted to a +-60 degree cone around the pressed axis (never teleport
 * somewhere off to the side just because it's the closest node on the whole map), then scored by
 * plain Euclidean distance with a connected-neighbour bonus (half distance) so an edge-connected
 * node wins over an unconnected one *unless* the unconnected one is meaningfully nearer. This is
 * what reconciles "move along edges" with what a sighted keyboard user expects on a visual graph.
 *
 * @param {Array<{id:*, x:number, y:number}>} nodes
 * @param {*} fromId
 * @param {'up'|'down'|'left'|'right'} direction
 * @param {Set<*>} neighbourIds ids directly connected to fromId
 * @returns {*|null} the chosen id, or null if nothing qualifies
 */
export function nextNodeInDirection(nodes, fromId, direction, neighbourIds = new Set()) {
    const axis = DIRECTION_AXIS_DEG[direction];
    const from = (nodes || []).find((n) => n.id === fromId);
    if (!from || axis === undefined) return null;

    let best = null;
    let bestScore = Infinity;
    for (const n of nodes) {
        if (n.id === fromId) continue;
        const dx = n.x - from.x;
        const dy = n.y - from.y;
        if (dx === 0 && dy === 0) continue; // stacked exactly on the source: no direction to it
        const bearing = Math.atan2(dy, dx) * (180 / Math.PI);
        if (Math.abs(angleDiffDeg(bearing, axis)) > DIRECTION_CONE_DEG) continue;

        const dist = Math.hypot(dx, dy);
        const score = neighbourIds.has(n.id) ? dist * NEIGHBOUR_BONUS : dist;
        if (best === null || score < bestScore || (score === bestScore && n.id < best.id)) {
            best = n;
            bestScore = score;
        }
    }
    return best ? best.id : null;
}

// Size each node box to its wrapped label. We compute this ourselves (rather than the
// deprecated Cytoscape 'label' width/height) so the boxes stay snug and the console stays clean.
function layoutLabel(label) {
    const text = (label || '').trim() || ' ';
    const MAX = 20; // target characters per line before wrapping
    const lines = [];
    let cur = '';
    for (const word of text.split(/\s+/)) {
        if (!cur) cur = word;
        else if ((cur + ' ' + word).length <= MAX) cur += ' ' + word;
        else { lines.push(cur); cur = word; }
    }
    if (cur) lines.push(cur);
    // The renderer wraps by width ('anywhere'), so an over-long single word still breaks;
    // count the extra lines it produces and size the box for ALL lines (a capped height used
    // to clip long titles vertically).
    const lineCount = lines.reduce((n, l) => n + Math.max(1, Math.ceil(l.length / MAX)), 0);
    const longest = lines.reduce((m, l) => Math.max(m, Math.min(l.length, MAX)), 1);
    // A little extra width so text clears the rounded ends (they're dots: a one-line dot is a
    // full pill; taller ones soften toward a lozenge with the radius capped).
    const w = Math.min(Math.max(Math.round(longest * 7.4) + 42, 90), 216);
    const h = Math.min(lineCount, 8) * 20 + 26;
    const r = Math.min(Math.round(h / 2), 26);
    return { w, h, r, tw: w - 36 };
}

// Lazy-load the (~424KB) Cytoscape bundle only when the map first opens, so the auth/unlock
// screens stay light. The service worker precaches it, so after the first visit this is instant
// and works offline.
let cytoscapePromise = null;
function ensureCytoscape() {
    if (window.cytoscape) return Promise.resolve();
    if (cytoscapePromise) return cytoscapePromise;
    cytoscapePromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = '/static/libs/cytoscape.min.js';
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => { cytoscapePromise = null; reject(new Error('Could not load the map library')); };
        document.head.appendChild(s);
    });
    return cytoscapePromise;
}

export class TrauMindMap {
    constructor(container, apiClient) {
        this.container = container; // the #mindmap div (Cytoscape host)
        this.api = apiClient;
        this.cy = null;
        this.selectedNode = null; // the raw db node { id, node_type, title, ... } or null
        this.focusedNodeId = null; // roving keyboard focus on the canvas (issue #126), separate
        // from selection: app.js wires onSelectNode to open the node detail drawer, so if arrow
        // keys committed selection, every arrow press would pop the drawer open over the map.
        // Arrows move this ring; Enter/Space commits it via the existing handleNodeSelection.
        this.toolbarMode = 'select';
        this.connectingFrom = null; // raw db node while linking
        this.onShowNodeModal = null; // callback set by app.js (edit -> node detail drawer)
        this.onSelectNode = null; // node selected in select mode (open its detail drawer)
        this.onDeselect = null; // selection cleared (close the drawer)
        this.onMapLoaded = null; // map (re)loaded: { nodes, edges } (drives link suggestions)
        this.autoSaveTimeout = null;
        this.lastData = { nodes: [], edges: [] };
        this.outlineEl = document.getElementById('map-outline');
        this._fitted = false;
    }

    async init() {
        await ensureCytoscape();
        if (!window.cytoscape) throw new Error('Cytoscape library not loaded');

        this.cy = window.cytoscape({
            container: this.container,
            layout: { name: 'preset' },
            minZoom: 0.3,
            maxZoom: 2.5,
            boxSelectionEnabled: false,
            autoungrabify: false,
            // Render at >= 2x backing resolution so node label text stays crisp. With the
            // default ('auto' = devicePixelRatio) a standard display, or Windows at 125%
            // scaling (dPR 1.25), rasterizes the canvas text soft/blurry.
            pixelRatio: Math.max(window.devicePixelRatio || 1, 2),
        });

        this.applyTheme();
        this.setupInteractions();
        this.setupToolbar();
        await this.loadMap();
        return true;
    }

    // ===== STYLE / THEME =====

    buildStyle(c) {
        return [
            {
                selector: 'node',
                style: {
                    'shape': 'round-rectangle',
                    'corner-radius': 'data(r)',
                    'background-color': 'data(color)',
                    'background-opacity': 1,
                    'border-width': 2,
                    'border-color': 'rgba(74,69,64,0.14)',
                    'label': 'data(label)',
                    'color': '#4a4540',
                    'font-size': 13,
                    'font-weight': 600,
                    'text-valign': 'center',
                    'text-halign': 'center',
                    'text-wrap': 'wrap',
                    'text-max-width': 'data(tw)',
                    'width': 'data(w)',
                    'height': 'data(h)',
                    'transition-property': 'opacity, border-color, border-width',
                    'transition-duration': '0.18s',
                },
            },
            { selector: 'node.selected', style: { 'border-width': 3, 'border-color': '#6f5f96' } },
            { selector: 'node.connecting', style: { 'border-width': 3, 'border-color': '#6f5f96', 'border-style': 'dashed' } },
            // The roving keyboard-focus ring (issue #126). An outline, not a border, so it never
            // fights the existing .selected / .connecting border states; both can be visible on
            // the same node at once (e.g. tab back onto the already-selected node).
            {
                selector: 'node.kbd-focus',
                style: {
                    'outline-width': 3,
                    'outline-color': c.focus,
                    'outline-offset': 2,
                    'outline-opacity': 1,
                },
            },
            { selector: 'node.dim', style: { 'opacity': 0.28 } },
            {
                selector: 'edge',
                style: {
                    'curve-style': 'bezier',
                    'width': 3,
                    'line-color': c.edge,
                    'target-arrow-shape': 'none',
                    'transition-property': 'opacity',
                    'transition-duration': '0.18s',
                },
            },
            // Suggested (discovery) edges land here later: dashed, gentle violet.
            { selector: 'edge.suggested', style: { 'line-color': c.suggested, 'line-style': 'dashed', 'line-dash-pattern': [7, 5] } },
            { selector: 'edge.dim', style: { 'opacity': 0.12 } },
        ];
    }

    /** Re-apply the canvas theme to match the app's current data-theme (light/dark/soft). */
    applyTheme() {
        const name = document.documentElement.getAttribute('data-theme') || 'light';
        const c = CANVAS[name] || CANVAS.light;
        this.container.style.background = c.bg;
        if (this.cy) this.cy.style().fromJson(this.buildStyle(c)).update();
    }

    // ===== DATA LOADING / RENDER =====

    async loadMap() {
        let data;
        try {
            data = await this.api.get('/mindmap');
        } catch (error) {
            console.error('Error loading map:', error);
            data = { nodes: [], edges: [] };
        }
        this.lastData = { nodes: data.nodes || [], edges: data.edges || [] };
        this.renderGraph(this.lastData);
        this.renderOutline(this.lastData);
        this.updateSaveIndicator('All changes saved');
        this.onMapLoaded?.(this.lastData);
    }

    renderGraph({ nodes, edges }) {
        const byId = new Map(nodes.map((n) => [n.id, n]));
        const anyPositioned = nodes.some((n) => (n.x && n.x !== 0) || (n.y && n.y !== 0));

        const elements = [];
        // Track occupied spots so a brand-new node never lands on top of an existing one.
        const taken = nodes
            .filter((n) => (n.x && n.x !== 0) || (n.y && n.y !== 0))
            .map((n) => ({ x: n.x, y: n.y }));
        nodes.forEach((n, i) => {
            const size = layoutLabel(n.title);
            const position = this.positionFor(n, i, taken);
            elements.push({
                group: 'nodes',
                data: {
                    id: String(n.id), label: n.title, color: typeColor(n.node_type), ntype: n.node_type,
                    w: size.w, h: size.h, r: size.r, tw: size.tw,
                },
                position,
            });
        });

        // Real edges first; remember each pair so a parent_id link never doubles an explicit one.
        const seen = new Set();
        edges.forEach((e) => {
            if (!byId.has(e.from_node_id) || !byId.has(e.to_node_id)) return;
            seen.add(pairKey(e.from_node_id, e.to_node_id));
            elements.push({ group: 'edges', data: { id: 'e' + e.id, source: String(e.from_node_id), target: String(e.to_node_id) } });
        });
        // parent_id-derived connections from the old tree view, preserved so nothing is lost.
        nodes.forEach((n) => {
            if (n.parent_id == null || !byId.has(n.parent_id)) return;
            const key = pairKey(n.parent_id, n.id);
            if (seen.has(key)) return;
            seen.add(key);
            elements.push({ group: 'edges', data: { id: `p${n.parent_id}-${n.id}`, source: String(n.parent_id), target: String(n.id) } });
        });

        this.cy.elements().remove();
        this.cy.add(elements);

        // Keep the current selection highlighted across the re-render (if it still exists).
        if (this.selectedNode) {
            const el = this.cy.getElementById(String(this.selectedNode.id));
            if (el.nonempty()) el.addClass('selected');
            else this.selectedNode = null;
        }

        // Same revalidation for the roving focus ring: a re-render can drop the focused node
        // (deleted elsewhere, e.g. from the outline), and a stale id would leave a ghost ring.
        if (this.focusedNodeId != null) {
            const el = this.cy.getElementById(String(this.focusedNodeId));
            if (el.nonempty()) el.addClass('kbd-focus');
            else this.focusedNodeId = null;
        }

        // Honor saved positions (preset). Only when nothing was ever placed do we arrange gently.
        if (!anyPositioned && nodes.length > 1) {
            this.cy.layout({ name: 'cose', animate: false, padding: 36, idealEdgeLength: 110, nodeRepulsion: 9000 }).run();
            this.scheduleSave(); // persist the arranged positions so it stays put next time
        }

        this.fitOnce();
    }

    positionFor(n, i, taken = []) {
        if ((n.x && n.x !== 0) || (n.y && n.y !== 0)) return { x: n.x, y: n.y };
        // Golden-angle spiral for never-placed nodes, walking outward past any occupied spot
        // (otherwise a new node could land on top of an existing block).
        const golden = 2.399963;
        const CLEAR = 150; // min distance from any taken position
        for (let k = i; k < i + 40; k++) {
            const r = 70 + 46 * Math.sqrt(k);
            const p = { x: Math.round(Math.cos(k * golden) * r), y: Math.round(Math.sin(k * golden) * r) };
            if (!taken.some((t) => Math.hypot(t.x - p.x, t.y - p.y) < CLEAR)) {
                taken.push(p);
                return p;
            }
        }
        const far = { x: 70 + 46 * Math.sqrt(i + 40), y: 0 };
        taken.push(far);
        return far;
    }

    fitOnce() {
        if (this._fitted || this.cy.nodes().empty()) return;
        this.cy.fit(undefined, 60);
        if (this.cy.zoom() > 1.2) this.cy.zoom(1.0);
        this.cy.center();
        this._fitted = true;
    }

    // ===== SAVE / SYNC (positions only; the doc itself is saved per-mutation by the vault) =====

    scheduleSave() {
        clearTimeout(this.autoSaveTimeout);
        this.autoSaveTimeout = setTimeout(() => this.saveMap(), 1200);
    }

    async saveMap() {
        try {
            this.updateSaveIndicator('Saving...', 'saving');
            await this.syncToBackend();
            this.updateSaveIndicator('All changes saved');
            return true;
        } catch (error) {
            console.error('Error saving map:', error);
            this.updateSaveIndicator('Save failed', 'error');
            return false;
        }
    }

    async syncToBackend() {
        if (!this.cy) return;
        const updates = [];
        this.cy.nodes().forEach((el) => {
            const id = parseInt(el.id(), 10);
            const p = el.position();
            const x = Math.round(p.x);
            const y = Math.round(p.y);
            updates.push(this.api.put(`/node/${id}`, { x, y }));
            const cached = this.lastData.nodes.find((n) => n.id === id);
            if (cached) { cached.x = x; cached.y = y; }
        });
        await Promise.allSettled(updates);
    }

    // ===== NODE OPERATIONS =====

    async addNode(nodeData) {
        if (!nodeData.node_type || !nodeData.title) throw new Error('Invalid node data');
        const response = await this.api.post('/node', nodeData);
        await this.loadMap();
        this.announceToScreenReader(`Added ${nodeData.title} to your map`);
        return response.id;
    }

    editNode(node) {
        if (this.onShowNodeModal) this.onShowNodeModal(node);
    }

    async deleteNode(node) {
        if (!node) return;
        const confirmed = confirm(
            `This will remove "${node.title}" and its connections from your map. ` +
            `You can always add it back later if you need to. Would you like to continue?`
        );
        if (!confirmed) return;

        await this.api.delete(`/node/${node.id}`);
        if (this.selectedNode?.id === node.id) this.selectedNode = null;
        await this.loadMap();
        this.updateToolbar();
        this.announceToScreenReader(`Removed ${node.title} from your map`);
    }

    // ===== CONNECTIONS =====

    /** Begin a connection from a node (used by the toolbar/keyboard link flow). */
    startConnection(node) {
        this.setToolbarMode('link');
        this.connectingFrom = node;
        this.cy?.getElementById(String(node.id)).addClass('connecting');
        this.updateToolbar();
    }

    /** Are these two nodes already joined (an explicit edge either way, or a legacy parent link)? */
    areConnected(aId, bId) {
        const edges = this.lastData.edges || [];
        if (edges.some((e) =>
            (e.from_node_id === aId && e.to_node_id === bId) ||
            (e.from_node_id === bId && e.to_node_id === aId))) return true;
        const nodes = this.lastData.nodes || [];
        const a = nodes.find((n) => n.id === aId);
        const b = nodes.find((n) => n.id === bId);
        return (a && a.parent_id === bId) || (b && b.parent_id === aId);
    }

    async createConnection(fromNode, toNode) {
        if (!fromNode?.id || !toNode?.id) {
            this.showNotification('Could not identify dots to connect', 'error');
            return;
        }
        // Two nodes connect at most once; point at the unlink affordance instead.
        if (this.areConnected(fromNode.id, toNode.id)) {
            this.showNotification(
                `"${fromNode.title}" and "${toNode.title}" are already connected. To unlink them, tap the line between them.`,
                'info'
            );
            this.announceToScreenReader(
                `${fromNode.title} and ${toNode.title} are already connected. To unlink them, choose the connection in the node's details.`
            );
            return;
        }
        try {
            await this.api.post('/edge', { from_node_id: fromNode.id, to_node_id: toNode.id, label: '' });
            await this.loadMap();
            this.showNotification(`Connected "${fromNode.title}" to "${toNode.title}"`, 'success');
            this.announceToScreenReader(`Connected ${fromNode.title} to ${toNode.title}`);
        } catch (error) {
            console.error('Error creating connection:', error);
            this.showNotification('Could not create connection', 'error');
        }
    }

    /**
     * Remove a connection from the canvas. The edge element's id encodes its kind: an explicit
     * edge is `e{id}` (delete the edge record); a legacy parent link is `p{parent}-{child}`
     * (clear the child's parent_id). Reversible, so a single gentle confirm is enough.
     */
    async unlinkEdgeElement(edgeEl) {
        const id = edgeEl.id();
        const a = this.nodeFromEl(edgeEl.source())?.title || 'these';
        const b = this.nodeFromEl(edgeEl.target())?.title || 'two';
        if (!confirm(`Unlink "${a}" and "${b}"? You can reconnect them anytime.`)) return;
        try {
            if (id.startsWith('e')) {
                await this.api.delete('/edge/' + id.slice(1));
            } else if (id.startsWith('p')) {
                const childId = parseInt(id.split('-')[1], 10);
                await this.api.put('/node/' + childId, { parent_id: null });
            } else {
                return;
            }
            await this.loadMap();
            this.showNotification(`Unlinked "${a}" and "${b}"`, 'success');
            this.announceToScreenReader(`Unlinked ${a} and ${b}`);
        } catch (error) {
            console.error('Error unlinking:', error);
            this.showNotification('Could not unlink', 'error');
        }
    }

    // ===== INTERACTIONS =====

    setupInteractions() {
        this.cy.on('tap', 'node', (evt) => {
            const node = this.nodeFromEl(evt.target);
            if (node) this.handleNodeSelection(node);
        });
        this.cy.on('dbltap', 'node', (evt) => {
            const node = this.nodeFromEl(evt.target);
            if (node && this.toolbarMode !== 'link') this.editNode(node);
        });
        // Tap an edge (outside link mode) to remove that connection.
        this.cy.on('tap', 'edge', (evt) => {
            if (this.toolbarMode === 'link') return;
            this.unlinkEdgeElement(evt.target);
        });
        this.cy.on('tap', (evt) => {
            if (evt.target === this.cy) {
                if (this.toolbarMode !== 'link') this.clearSelection();
                this.undim();
            }
        });
        this.cy.on('dragfree', 'node', () => this.scheduleSave());

        // Delete removes the selected node (same confirm as the toolbar) whenever one is
        // selected, regardless of where focus happens to sit (clicking the canvas often leaves
        // focus on <body>, which used to swallow the key). Text fields stay untouched. The
        // handler is kept so destroy() can remove it; re-init after lock/unlock must not stack
        // listeners (stacked ones meant double confirms).
        this._deleteKeyHandler = (e) => {
            if (e.key !== 'Delete') return;
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
            if (document.querySelector('.modal[style*="flex"]')) return; // a dialog is open
            if (this.selectedNode) {
                e.preventDefault();
                this.deleteNode(this.selectedNode);
            }
        };
        document.addEventListener('keydown', this._deleteKeyHandler);

        // Canvas-native roving focus (issue #126): an enhancement over the #map-outline twin,
        // not a replacement for it. Scoped to the container (not document), and kept as a
        // reference for the same reason as _deleteKeyHandler above: re-init after lock/unlock
        // must not stack listeners.
        const ARROW_DIRECTIONS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
        this._navKeyHandler = (e) => {
            const direction = ARROW_DIRECTIONS[e.key];
            if (direction) {
                e.preventDefault(); // don't let the arrow keys scroll the page
                this.moveRovingFocus(direction);
                return;
            }
            if (e.key === ' ') e.preventDefault(); // Space scrolls the container otherwise
            if (e.key === 'Enter' || e.key === ' ') {
                if (this.focusedNodeId == null) return;
                const node = this.lastData.nodes.find((n) => n.id === this.focusedNodeId);
                if (node) this.handleNodeSelection(node);
                return;
            }
            if (e.key === 'Escape') {
                if (this.focusedNodeId == null) return; // nothing consumed: let it bubble so
                // app.js's global Escape still closes overlays / quick-exits as documented.
                // When we DO have a roving focus, we must stopPropagation: app.js's document
                // listener treats "Escape with nothing open" as an instant, no-confirm logout,
                // and it has no way to know a roving ring is "something open". Missing this
                // would mean pressing Escape on the canvas logs the user out mid-session.
                e.stopPropagation();
                this.clearRovingFocus();
            }
        };
        this.container.addEventListener('keydown', this._navKeyHandler);
    }

    // ===== ROVING KEYBOARD FOCUS (canvas-native nav, issue #126) =====

    /** Ids of nodes directly connected to `id` (explicit edges + legacy parent_id links). */
    neighbourIdsOf(id) {
        const out = new Set();
        (this.lastData.edges || []).forEach((e) => {
            if (e.from_node_id === id) out.add(e.to_node_id);
            else if (e.to_node_id === id) out.add(e.from_node_id);
        });
        const node = this.lastData.nodes.find((n) => n.id === id);
        if (node?.parent_id != null) out.add(node.parent_id);
        this.lastData.nodes.forEach((n) => { if (n.parent_id === id) out.add(n.id); });
        return out;
    }

    /** The node whose live canvas position is nearest the current viewport centre. */
    nearestNodeToViewportCentre() {
        const ext = this.cy.extent();
        const cx = (ext.x1 + ext.x2) / 2;
        const cy = (ext.y1 + ext.y2) / 2;
        let best = null;
        let bestDist = Infinity;
        this.cy.nodes().forEach((el) => {
            const p = el.position();
            const d = Math.hypot(p.x - cx, p.y - cy);
            if (d < bestDist) { bestDist = d; best = parseInt(el.id(), 10); }
        });
        return best;
    }

    /** Arrow-key entry point: seed the roving focus if nothing is focused yet, else step it. */
    moveRovingFocus(direction) {
        if (!this.cy || this.cy.nodes().empty()) return;
        if (this.focusedNodeId == null) {
            this.setRovingFocus(this.nearestNodeToViewportCentre());
            return;
        }
        // Live cy positions, not this.lastData's (those only refresh on the 1.2s save debounce,
        // so a node just dragged would still score from its old spot).
        const nodes = this.cy.nodes().map((el) => ({ id: parseInt(el.id(), 10), x: el.position('x'), y: el.position('y') }));
        const neighbourIds = this.neighbourIdsOf(this.focusedNodeId);
        const nextId = nextNodeInDirection(nodes, this.focusedNodeId, direction, neighbourIds);
        if (nextId == null) {
            this.announceToScreenReader(`No dot ${DIRECTION_PHRASE[direction]}.`);
            return;
        }
        this.setRovingFocus(nextId);
    }

    setRovingFocus(id) {
        if (id == null) return;
        const el = this.cy.getElementById(String(id));
        if (el.empty()) return;
        this.focusedNodeId = id;
        this.cy.nodes().removeClass('kbd-focus');
        el.addClass('kbd-focus');
        this.syncOutlineRovingFocus();
        this.revealFocused(el);
        this.announceRovingFocus(id);
    }

    /** Escape: drop the ring, but DOM focus stays on the container (still `role="application"`). */
    clearRovingFocus() {
        this.focusedNodeId = null;
        this.cy?.nodes().removeClass('kbd-focus');
        this.syncOutlineRovingFocus();
    }

    /**
     * Bring the focused node into view only when it isn't already fully visible; re-centering on
     * every arrow press would be exactly the disorienting motion this product avoids. Reduced
     * motion is checked at call time (not once at construction) so a preference change mid-session
     * takes effect immediately.
     */
    revealFocused(el) {
        const ext = this.cy.extent();
        const bb = el.boundingBox();
        const fullyVisible = bb.x1 >= ext.x1 && bb.x2 <= ext.x2 && bb.y1 >= ext.y1 && bb.y2 <= ext.y2;
        if (fullyVisible) return;
        const reduceMotion = typeof window.matchMedia === 'function'
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduceMotion) this.cy.center(el);
        else this.cy.animate({ center: { eles: el } }, { duration: 220 });
    }

    /** Short by design: this is spoken on every arrow press, so it stays a single sentence. */
    announceRovingFocus(id) {
        const index = this.lastData.nodes.findIndex((n) => n.id === id);
        const node = this.lastData.nodes[index];
        if (!node) return;
        const count = this.neighbourIdsOf(id).size;
        const connections = count === 1 ? 'connection' : 'connections';
        this.announceToScreenReader(
            `${typeLabel(node.node_type)}: ${node.title}. ${count} ${connections}. ${index + 1} of ${this.lastData.nodes.length}.`
        );
    }

    nodeFromEl(el) {
        const id = parseInt(el.id(), 10);
        return this.lastData.nodes.find((n) => n.id === id) || null;
    }

    handleNodeSelection(node) {
        if (this.toolbarMode === 'link') {
            this.handleLinkModeClick(node);
            return;
        }
        this.selectedNode = node;
        this.cy.nodes().removeClass('selected');
        this.cy.getElementById(String(node.id)).addClass('selected');
        this.highlightNeighborhood(node);
        this.updateToolbar();
        this.syncOutlineSelection();
        this.announceToScreenReader(`Selected ${node.title}`);
        this.onSelectNode?.(node);
    }

    handleLinkModeClick(node) {
        if (!this.connectingFrom) {
            this.connectingFrom = node;
            this.cy.nodes().removeClass('connecting');
            this.cy.getElementById(String(node.id)).addClass('connecting');
            this.updateToolbar();
        } else if (this.connectingFrom.id !== node.id) {
            this.createConnection(this.connectingFrom, node);
            this.cy.nodes().removeClass('connecting');
            this.connectingFrom = null;
            this.setToolbarMode('select');
        } else {
            this.cy.nodes().removeClass('connecting');
            this.connectingFrom = null;
            this.updateToolbar();
        }
    }

    clearSelection() {
        this.selectedNode = null;
        this.cy?.nodes().removeClass('selected');
        this.undim();
        this.updateToolbar();
        this.syncOutlineSelection();
        this.onDeselect?.();
    }

    highlightNeighborhood(node) {
        const el = this.cy.getElementById(String(node.id));
        if (el.empty()) return;
        const hood = el.closedNeighborhood();
        this.cy.elements().addClass('dim');
        hood.removeClass('dim');
    }

    undim() {
        this.cy?.elements().removeClass('dim');
    }

    // ===== TOOLBAR =====

    setupToolbar() {
        this.toolbarElements = {
            selectBtn: document.getElementById('select-mode-btn'),
            linkBtn: document.getElementById('link-mode-btn'),
            editBtn: document.getElementById('edit-selected-btn'),
            deleteBtn: document.getElementById('delete-selected-btn'),
            status: document.getElementById('selection-status'),
        };

        const { selectBtn, linkBtn, editBtn, deleteBtn } = this.toolbarElements;
        if (selectBtn) selectBtn.addEventListener('click', () => this.setToolbarMode('select'));
        if (linkBtn) linkBtn.addEventListener('click', () => this.setToolbarMode('link'));
        if (editBtn) editBtn.addEventListener('click', () => { if (this.selectedNode) this.editNode(this.selectedNode); });
        if (deleteBtn) deleteBtn.addEventListener('click', () => { if (this.selectedNode) this.deleteNode(this.selectedNode); });

        // Explicit zoom controls (scroll/pinch still work; these make zoom discoverable).
        document.getElementById('zoom-in-btn')?.addEventListener('click', () => this.zoomBy(1.25));
        document.getElementById('zoom-out-btn')?.addEventListener('click', () => this.zoomBy(1 / 1.25));
        document.getElementById('zoom-fit-btn')?.addEventListener('click', () => {
            if (this.cy && this.cy.nodes().nonempty()) this.cy.fit(undefined, 60);
        });

        this.updateToolbar();
    }

    /** Zoom in/out around the centre of the viewport. */
    zoomBy(factor) {
        if (!this.cy) return;
        this.cy.zoom({
            level: this.cy.zoom() * factor,
            renderedPosition: { x: this.container.clientWidth / 2, y: this.container.clientHeight / 2 },
        });
    }

    setToolbarMode(mode) {
        this.toolbarMode = mode;
        if (mode !== 'link') {
            this.cy?.nodes().removeClass('connecting');
            this.connectingFrom = null;
        }
        this.updateToolbar();

        document.querySelectorAll('.btn-toolbar').forEach((btn) => btn.classList.remove('active'));
        if (mode === 'select' && this.toolbarElements.selectBtn) this.toolbarElements.selectBtn.classList.add('active');
        else if (mode === 'link' && this.toolbarElements.linkBtn) this.toolbarElements.linkBtn.classList.add('active');

        this.refreshOutlineHint();
    }

    updateToolbar() {
        const { editBtn, deleteBtn, status } = this.toolbarElements || {};
        const hasSelection = !!this.selectedNode;

        if (editBtn) editBtn.disabled = !hasSelection;
        if (deleteBtn) deleteBtn.disabled = !hasSelection;

        if (status) {
            if (this.toolbarMode === 'link' && this.connectingFrom) {
                status.textContent = `Linking from "${this.connectingFrom.title}", choose another dot to connect`;
            } else if (this.toolbarMode === 'link') {
                status.textContent = 'Link mode: choose a dot to start connecting';
            } else if (hasSelection) {
                status.textContent = `Selected: "${this.selectedNode.title}"`;
            } else {
                status.textContent = 'No dot selected';
            }
        }
    }

    // ===== OUTLINE TWIN (the accessible, keyboard-first representation) =====

    renderOutline({ nodes, edges }) {
        if (!this.outlineEl) return;
        this.outlineEl.innerHTML = '';

        if (nodes.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'map-outline-empty';
            empty.textContent = 'Your map is empty for now. Add your first dot to begin.';
            this.outlineEl.appendChild(empty);
            return;
        }

        const byId = new Map(nodes.map((n) => [n.id, n]));
        const adj = new Map(nodes.map((n) => [n.id, new Set()]));
        const link = (a, b) => { if (adj.has(a) && byId.has(b)) adj.get(a).add(b); };
        edges.forEach((e) => { link(e.from_node_id, e.to_node_id); link(e.to_node_id, e.from_node_id); });
        nodes.forEach((n) => { if (n.parent_id != null && byId.has(n.parent_id)) { link(n.id, n.parent_id); link(n.parent_id, n.id); } });

        const list = document.createElement('ul');
        list.className = 'map-outline-list';

        nodes.forEach((n) => {
            const li = document.createElement('li');
            li.className = 'map-outline-item';

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'map-outline-node';
            btn.dataset.nodeId = String(n.id);

            const chip = document.createElement('span');
            chip.className = 'map-outline-chip';
            chip.style.background = typeColor(n.node_type);
            chip.setAttribute('aria-hidden', 'true');

            const title = document.createElement('span');
            title.className = 'map-outline-title';
            title.textContent = n.title;

            const type = document.createElement('span');
            type.className = 'map-outline-type';
            type.textContent = typeLabel(n.node_type);

            btn.append(chip, title, type);
            btn.addEventListener('click', () => this.handleNodeSelection(n));

            li.appendChild(btn);

            // Connected names carry their node's type colour, so a reference in text reads the
            // same as its block on the canvas.
            const linked = [...adj.get(n.id)].map((id) => byId.get(id)).filter(Boolean);
            if (linked.length) {
                const conn = document.createElement('span');
                conn.className = 'map-outline-connections';
                conn.append('Connected to: ');
                linked.forEach((other, i) => {
                    if (i > 0) conn.append(', ');
                    const dot = document.createElement('span');
                    dot.className = 'legend-dot';
                    dot.style.background = typeColor(other.node_type);
                    dot.title = typeLabel(other.node_type);
                    dot.setAttribute('aria-hidden', 'true');
                    conn.append(dot, other.title);
                });
                li.appendChild(conn);
            }

            list.appendChild(li);
        });

        this.outlineEl.appendChild(list);
        this.syncOutlineSelection();
        this.syncOutlineRovingFocus();
        this.refreshOutlineHint();
    }

    syncOutlineSelection() {
        if (!this.outlineEl) return;
        this.outlineEl.querySelectorAll('.map-outline-node').forEach((b) => {
            const selected = this.selectedNode && b.dataset.nodeId === String(this.selectedNode.id);
            b.classList.toggle('selected', !!selected);
            b.setAttribute('aria-pressed', selected ? 'true' : 'false');
        });
    }

    /**
     * Visual-only mirror of the canvas roving-focus ring onto its #map-outline twin (ADR-0004
     * pillar 1). DOM focus never moves here: doing so would pull the user out of the canvas
     * application region and break the roving model. This just keeps the two views looking
     * consistent with each other.
     */
    syncOutlineRovingFocus() {
        if (!this.outlineEl) return;
        this.outlineEl.querySelectorAll('.map-outline-node').forEach((b) => {
            const focused = this.focusedNodeId != null && b.dataset.nodeId === String(this.focusedNodeId);
            b.classList.toggle('is-kbd-focused', !!focused);
        });
    }

    refreshOutlineHint() {
        if (!this.outlineEl) return;
        const linking = this.toolbarMode === 'link';
        this.outlineEl.querySelectorAll('.map-outline-node').forEach((b) => {
            const t = b.querySelector('.map-outline-title')?.textContent || 'node';
            const ty = b.querySelector('.map-outline-type')?.textContent || '';
            b.setAttribute('aria-label', linking ? `${ty}: ${t}. Choose to connect.` : `${ty}: ${t}. Select.`);
        });
    }

    // ===== UI HELPERS =====

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
        clearTimeout(this.autoSaveTimeout);
        if (this._deleteKeyHandler) {
            document.removeEventListener('keydown', this._deleteKeyHandler);
            this._deleteKeyHandler = null;
        }
        if (this._navKeyHandler) {
            this.container.removeEventListener('keydown', this._navKeyHandler);
            this._navKeyHandler = null;
        }
        this.focusedNodeId = null;
        if (this.cy) {
            this.cy.destroy();
            this.cy = null;
        }
        if (this.outlineEl) this.outlineEl.innerHTML = '';
    }
}
