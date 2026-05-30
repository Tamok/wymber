import { NODE_TYPES } from './config.js';

/**
 * Extract database ID from MindElixir node ID (format: "node-123")
 * @param {string} mindElixirId
 * @returns {number|null}
 */
export function extractNodeId(mindElixirId) {
    if (typeof mindElixirId !== 'string') return null;
    const match = mindElixirId.match(/^node-(\d+)$/);
    return match ? parseInt(match[1], 10) : null;
}

/**
 * Convert backend map data (nodes/edges arrays) to MindElixir tree format.
 * @param {{ nodes: Array, edges: Array }} mapData
 * @returns {object} MindElixir-compatible data object
 */
export function convertToMindElixirFormat(mapData) {
    if (!mapData.nodes || mapData.nodes.length === 0) {
        return null;
    }

    const rootNode = mapData.nodes[0];
    const rootType = NODE_TYPES[rootNode.node_type];

    const data = {
        nodeData: {
            id: `node-${rootNode.id}`,
            topic: rootNode.title,
            root: true,
            style: {
                background: rootType?.color || '#E8F5E8',
                color: '#2E3440'
            },
            children: []
        },
        linkData: {}
    };

    for (let i = 1; i < mapData.nodes.length; i++) {
        const node = mapData.nodes[i];
        const typeInfo = NODE_TYPES[node.node_type];
        data.nodeData.children.push({
            id: `node-${node.id}`,
            topic: node.title,
            style: {
                background: typeInfo?.color || '#E8F5E8',
                color: '#2E3440'
            },
            expanded: true
        });
    }

    // Convert edges to MindElixir link data
    if (mapData.edges && mapData.edges.length > 0) {
        mapData.edges.forEach((edge, idx) => {
            const linkId = `link-${edge.id || idx}`;
            data.linkData[linkId] = {
                id: linkId,
                from: `node-${edge.from_node_id}`,
                to: `node-${edge.to_node_id}`,
                text: edge.label || '',
                delta1: { x: 0, y: -50 },
                delta2: { x: 0, y: 50 }
            };
        });
    }

    return data;
}

/**
 * Validate node form data before submission.
 * @param {{ node_type: string, title: string }} data
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateNodeData(data) {
    if (!data.node_type || !NODE_TYPES[data.node_type]) {
        return { valid: false, error: 'Please select a valid node type' };
    }
    if (!data.title || data.title.trim().length === 0) {
        return { valid: false, error: 'Please enter a title' };
    }
    if (data.title.length > 200) {
        return { valid: false, error: 'Title must be under 200 characters' };
    }
    if (data.description && data.description.length > 5000) {
        return { valid: false, error: 'Description must be under 5000 characters' };
    }
    return { valid: true };
}

/**
 * Count all nodes in a MindElixir tree recursively.
 * @param {object} node - MindElixir node with optional children array
 * @returns {number}
 */
export function countNodes(node) {
    if (!node) return 0;
    let count = 1;
    if (node.children) {
        for (const child of node.children) {
            count += countNodes(child);
        }
    }
    return count;
}

/**
 * Walk all nodes in a MindElixir tree, calling callback for each.
 * @param {object} node
 * @param {function} callback
 */
export function walkNodes(node, callback) {
    if (!node) return;
    callback(node);
    if (node.children) {
        for (const child of node.children) {
            walkNodes(child, callback);
        }
    }
}
