import { NODE_TYPES } from './config.js';

/**
 * Export map data as a JSON file download.
 */
export function exportAsJSON(nodes, edges) {
    const data = {
        exportedAt: new Date().toISOString(),
        version: '2.0',
        nodes: nodes.map(n => ({
            id: n.id,
            type: n.node_type,
            title: n.title,
            description: n.description || '',
            createdAt: n.created_at,
            updatedAt: n.updated_at
        })),
        edges: edges.map(e => ({
            from: e.from_node_id,
            to: e.to_node_id,
            label: e.label || ''
        }))
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `traumappd-export-${dateStamp()}.json`);
}

/**
 * Export map data as a readable text summary.
 */
export function exportAsText(nodes, edges) {
    const lines = [];
    lines.push('TrauMapp\'d - Map Export');
    lines.push(`Exported: ${new Date().toLocaleString()}`);
    lines.push(`Total nodes: ${nodes.length}`);
    lines.push(`Total connections: ${edges.length}`);
    lines.push('');
    lines.push('='.repeat(50));

    // Group nodes by type
    const grouped = {};
    for (const node of nodes) {
        const type = node.node_type;
        if (!grouped[type]) grouped[type] = [];
        grouped[type].push(node);
    }

    for (const [type, typeNodes] of Object.entries(grouped)) {
        const label = NODE_TYPES[type]?.label || type;
        lines.push('');
        lines.push(`--- ${label} ---`);
        for (const node of typeNodes) {
            lines.push(`  * ${node.title}`);
            if (node.description) {
                lines.push(`    ${node.description}`);
            }
        }
    }

    if (edges.length > 0) {
        lines.push('');
        lines.push('--- Connections ---');
        const nodeMap = Object.fromEntries(nodes.map(n => [n.id, n.title]));
        for (const edge of edges) {
            const from = nodeMap[edge.from_node_id] || `Node ${edge.from_node_id}`;
            const to = nodeMap[edge.to_node_id] || `Node ${edge.to_node_id}`;
            const label = edge.label ? ` (${edge.label})` : '';
            lines.push(`  ${from} --> ${to}${label}`);
        }
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    downloadBlob(blob, `traumappd-export-${dateStamp()}.txt`);
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function dateStamp() {
    return new Date().toISOString().slice(0, 10);
}
