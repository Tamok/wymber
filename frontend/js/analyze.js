import { NODE_TYPES } from './config.js';

/**
 * Analyze map data and return a summary object.
 * @param {Array} nodes - Array of node objects from the API
 * @param {Array} edges - Array of edge objects from the API
 * @returns {object} Analysis results
 */
export function analyzeMap(nodes, edges) {
    const typeCounts = {};
    for (const key of Object.keys(NODE_TYPES)) {
        typeCounts[key] = 0;
    }
    for (const node of nodes) {
        if (typeCounts[node.node_type] !== undefined) {
            typeCounts[node.node_type]++;
        }
    }

    // Connections come from explicit edges AND parent/child hierarchy, so a node
    // nested under another isn't wrongly reported as "isolated".
    const connectedIds = new Set();
    const connectionCount = {};
    const link = (aId, bId) => {
        connectedIds.add(aId);
        connectedIds.add(bId);
        connectionCount[aId] = (connectionCount[aId] || 0) + 1;
        connectionCount[bId] = (connectionCount[bId] || 0) + 1;
    };
    for (const edge of edges) {
        link(edge.from_node_id, edge.to_node_id);
    }
    const nodeIds = new Set(nodes.map(n => n.id));
    let hierarchyLinks = 0;
    for (const node of nodes) {
        if (node.parent_id != null && nodeIds.has(node.parent_id)) {
            link(node.id, node.parent_id);
            hierarchyLinks++;
        }
    }
    const isolatedNodes = nodes.filter(n => !connectedIds.has(n.id));

    // Find most-connected node
    let mostConnected = null;
    let maxConnections = 0;
    for (const [nodeId, count] of Object.entries(connectionCount)) {
        if (count > maxConnections) {
            maxConnections = count;
            mostConnected = nodes.find(n => n.id === parseInt(nodeId));
        }
    }

    // Trigger-to-coping ratio
    const triggerCount = typeCounts.trigger || 0;
    const copingCount = typeCounts.coping || 0;

    // Missing types
    const missingTypes = Object.entries(typeCounts)
        .filter(([, count]) => count === 0)
        .map(([type]) => NODE_TYPES[type].label);

    return {
        totalNodes: nodes.length,
        totalEdges: edges.length,
        totalConnections: edges.length + hierarchyLinks,
        typeCounts,
        isolatedNodes,
        mostConnected,
        mostConnectedCount: maxConnections,
        triggerCount,
        copingCount,
        missingTypes
    };
}

/**
 * Render analysis results as HTML for the modal.
 */
export function renderAnalysis(analysis) {
    const typeBreakdown = Object.entries(analysis.typeCounts)
        .filter(([, count]) => count > 0)
        .map(([type, count]) => {
            const info = NODE_TYPES[type];
            return `<li style="border-left: 4px solid ${info.color}; padding-left: 8px;">
                <strong>${info.label}:</strong> ${count}</li>`;
        })
        .join('');

    const isolatedList = analysis.isolatedNodes.length > 0
        ? analysis.isolatedNodes.map(n => `<li>${n.title}</li>`).join('')
        : '<li>None - all nodes are connected</li>';

    let copingNote = '';
    if (analysis.triggerCount > 0 && analysis.copingCount === 0) {
        copingNote = `<p class="mindmap-help-note"><strong>Suggestion:</strong>
            You have ${analysis.triggerCount} trigger(s) but no coping strategies mapped yet.
            Consider adding coping nodes for each trigger.</p>`;
    } else if (analysis.triggerCount > analysis.copingCount) {
        copingNote = `<p class="mindmap-help-note"><strong>Suggestion:</strong>
            You have more triggers (${analysis.triggerCount}) than coping strategies (${analysis.copingCount}).
            Mapping coping approaches for each trigger can be a helpful exercise.</p>`;
    }

    const missingNote = analysis.missingTypes.length > 0
        ? `<p>Types not yet used: <em>${analysis.missingTypes.join(', ')}</em></p>`
        : '<p>You are using all available node types.</p>';

    const mostConnectedNote = analysis.mostConnected
        ? `<p><strong>Most connected:</strong> "${analysis.mostConnected.title}" (${analysis.mostConnectedCount} connections)</p>`
        : '';

    return `
        <div class="settings-panel">
            <section>
                <h3>Overview</h3>
                <p><strong>${analysis.totalNodes}</strong> nodes and <strong>${analysis.totalConnections}</strong> connections in your map.</p>
                ${mostConnectedNote}
            </section>
            <section>
                <h3>Node Types</h3>
                <ul style="list-style: none; padding: 0;">${typeBreakdown || '<li>No nodes yet</li>'}</ul>
                ${missingNote}
            </section>
            <section>
                <h3>Isolated Nodes</h3>
                <p>These nodes have no connections to other nodes:</p>
                <ul>${isolatedList}</ul>
            </section>
            ${copingNote}
        </div>
    `;
}
