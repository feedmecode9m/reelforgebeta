/**
 * Phase 23 — creator knowledge graph.
 * Maps relationships between series, episodes, assets, tasks, teams, and releases.
 */

import { getSeriesById } from '../series/seriesStore.js';
import { buildEpisodeOperationRows } from '../series/productionHealth.js';
import { syncWorkflowTasks } from '../workflow/workflowEngine.js';
import { buildReleaseCenterSnapshot } from '../release/releaseCenter.js';
import { TEAM_STORAGE_KEY } from '../teams/creatorTeams.js';

export const NODE_TYPES = /** @type {const} */ ([
    'series',
    'episode',
    'asset',
    'task',
    'team',
    'release'
]);

export const EDGE_TYPES = /** @type {const} */ ([
    'series_has_episode',
    'episode_has_asset',
    'episode_has_task',
    'episode_has_release',
    'team_covers_series',
    'team_assigned_task',
    'task_blocks_release',
    'asset_blocks_task',
    'task_blocks_episode'
]);

/**
 * @typedef {Object} KnowledgeGraphNode
 * @property {string} id
 * @property {typeof NODE_TYPES[number]} type
 * @property {string} label
 * @property {string} [seriesId]
 * @property {string} [episodeId]
 * @property {Record<string, unknown>} [meta]
 */

/**
 * @typedef {Object} KnowledgeGraphEdge
 * @property {string} id
 * @property {string} from
 * @property {string} to
 * @property {typeof EDGE_TYPES[number]} type
 * @property {boolean} [blocking]
 */

/**
 * @typedef {Object} KnowledgeGraphBottleneck
 * @property {string} nodeId
 * @property {typeof NODE_TYPES[number]} type
 * @property {string} label
 * @property {number} blockedCount
 * @property {number} dependencyCount
 * @property {number} impactScore
 * @property {string} reason
 */

/**
 * @typedef {Object} CreatorKnowledgeGraph
 * @property {string} seriesId
 * @property {KnowledgeGraphNode[]} nodes
 * @property {KnowledgeGraphEdge[]} edges
 * @property {Record<typeof NODE_TYPES[number], number>} nodeCounts
 * @property {KnowledgeGraphBottleneck[]} bottlenecks
 * @property {number} generatedAt
 */

/**
 * @param {'KNOWLEDGE_GRAPH' | 'DEPENDENCY_TRACE'} tag
 * @param {Record<string, unknown>} [detail]
 */
export function logKnowledgeGraphDiag(tag, detail = {}) {
    console.log(`[${tag}] ${JSON.stringify({ ...detail, timestamp: Date.now() })}`);
}

/**
 * @param {Record<string, unknown> | Record<string, unknown>[]} feed
 * @returns {Record<string, unknown>[]}
 */
export function flattenFeedReels(feed) {
    if (Array.isArray(feed)) return feed.filter(Boolean);
    if (!feed || typeof feed !== 'object') return [];
    return Object.values(feed).flat().filter(Boolean);
}

/** @param {string} seriesId */
function loadCachedTeam(seriesId) {
    if (typeof window === 'undefined') return null;
    try {
        const raw = localStorage.getItem(TEAM_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        const team = (parsed.teams || []).find((item) => item.seriesId === seriesId);
        if (!team) return null;
        return {
            ...team,
            members: parsed.members?.[team.id] || []
        };
    } catch {
        return null;
    }
}

/**
 * @param {string} type
 * @param {string} key
 * @param {string} label
 * @param {Record<string, unknown>} [meta]
 */
function nodeId(type, key) {
    return `${type}:${key}`;
}

/**
 * @param {string} seriesId
 * @param {Record<string, unknown> | Record<string, unknown>[]} feed
 * @returns {CreatorKnowledgeGraph}
 */
export function buildCreatorKnowledgeGraph(seriesId, feed = []) {
    const feedReels = flattenFeedReels(feed);
    const series = getSeriesById(seriesId);
    const rows = buildEpisodeOperationRows(feedReels, seriesId);
    const workflow = syncWorkflowTasks(seriesId, feedReels);
    const release = buildReleaseCenterSnapshot(seriesId, feedReels);
    const team = loadCachedTeam(seriesId);

    /** @type {KnowledgeGraphNode[]} */
    const nodes = [];
    /** @type {KnowledgeGraphEdge[]} */
    const edges = [];
    const nodeIndex = new Set();

    /** @param {KnowledgeGraphNode} node */
    function addNode(node) {
        if (nodeIndex.has(node.id)) return;
        nodeIndex.add(node.id);
        nodes.push(node);
    }

    /**
     * @param {string} from
     * @param {string} to
     * @param {typeof EDGE_TYPES[number]} type
     * @param {boolean} [blocking]
     */
    function addEdge(from, to, type, blocking = false) {
        edges.push({
            id: `edge:${from}->${to}:${type}`,
            from,
            to,
            type,
            blocking
        });
    }

    if (series) {
        addNode({
            id: nodeId('series', series.id),
            type: 'series',
            label: series.title,
            seriesId: series.id,
            meta: { genre: series.genre, releaseYear: series.releaseYear }
        });
    } else {
        addNode({
            id: nodeId('series', seriesId),
            type: 'series',
            label: seriesId,
            seriesId
        });
    }

    const seriesNode = nodeId('series', seriesId);

    for (const row of rows) {
        const episodeKey = row.episodeId;
        const episodeNode = nodeId('episode', episodeKey);
        addNode({
            id: episodeNode,
            type: 'episode',
            label: row.episodeTitle || episodeKey,
            seriesId,
            episodeId: episodeKey,
            meta: {
                seasonNumber: row.seasonNumber,
                episodeNumber: row.episodeNumber,
                status: row.status
            }
        });
        addEdge(seriesNode, episodeNode, 'series_has_episode');

        if (row.reelId) {
            const assetNode = nodeId('asset', row.reelId);
            addNode({
                id: assetNode,
                type: 'asset',
                label: `Asset ${String(row.reelId).slice(0, 8)}…`,
                seriesId,
                episodeId: episodeKey,
                meta: { reelInFeed: row.reelInFeed, thumbnailUrl: row.thumbnailUrl || null }
            });
            addEdge(episodeNode, assetNode, 'episode_has_asset');
        }
    }

    for (const task of workflow.tasks) {
        const taskNode = nodeId('task', task.id);
        addNode({
            id: taskNode,
            type: 'task',
            label: task.title || task.taskType,
            seriesId,
            episodeId: task.episodeId,
            meta: {
                taskType: task.taskType,
                status: task.status,
                priority: task.priority,
                assignedTo: task.assignedTo || null
            }
        });

        if (task.episodeId) {
            addEdge(nodeId('episode', task.episodeId), taskNode, 'episode_has_task');
        }

        if (task.status !== 'COMPLETE') {
            if (task.episodeId) {
                addEdge(taskNode, nodeId('episode', task.episodeId), 'task_blocks_episode', true);
            }
            if (task.reelId) {
                addEdge(nodeId('asset', task.reelId), taskNode, 'asset_blocks_task', true);
            } else if (task.taskType === 'MISSING_ASSET' && task.episodeId) {
                addEdge(taskNode, nodeId('episode', task.episodeId), 'task_blocks_episode', true);
            }
        }
    }

    for (const entry of release.calendar || []) {
        const releaseNode = nodeId('release', entry.episodeId);
        addNode({
            id: releaseNode,
            type: 'release',
            label: entry.releaseDate
                ? `Release ${entry.releaseDate}`
                : `Release · ${entry.episodeTitle || entry.episodeId}`,
            seriesId,
            episodeId: entry.episodeId,
            meta: {
                status: entry.status,
                releaseDate: entry.releaseDate,
                hasAsset: entry.hasAsset
            }
        });
        addEdge(nodeId('episode', entry.episodeId), releaseNode, 'episode_has_release');

        const openTasks = workflow.tasks.filter(
            (task) => task.episodeId === entry.episodeId && task.status !== 'COMPLETE'
        );
        for (const task of openTasks) {
            addEdge(nodeId('task', task.id), releaseNode, 'task_blocks_release', true);
        }
        if (!entry.hasAsset) {
            const episodeNode = nodeId('episode', entry.episodeId);
            addEdge(episodeNode, releaseNode, 'task_blocks_release', true);
        }
    }

    if (team) {
        const teamNode = nodeId('team', team.id);
        addNode({
            id: teamNode,
            type: 'team',
            label: team.name || 'Production Team',
            seriesId,
            meta: { memberCount: team.members?.length || 0 }
        });
        addEdge(teamNode, seriesNode, 'team_covers_series');

        for (const task of workflow.tasks) {
            if (task.assignedTo) {
                addEdge(teamNode, nodeId('task', task.id), 'team_assigned_task');
            }
        }
    }

    /** @type {Record<typeof NODE_TYPES[number], number>} */
    const nodeCounts = {
        series: 0,
        episode: 0,
        asset: 0,
        task: 0,
        team: 0,
        release: 0
    };
    for (const node of nodes) {
        nodeCounts[node.type] += 1;
    }

    const bottlenecks = analyzeProductionBottlenecks({
        seriesId,
        nodes,
        edges,
        nodeCounts,
        bottlenecks: [],
        generatedAt: Date.now()
    });

    logKnowledgeGraphDiag('KNOWLEDGE_GRAPH', {
        seriesId,
        nodeCount: nodes.length,
        edgeCount: edges.length,
        nodeCounts,
        bottleneckCount: bottlenecks.length
    });

    return {
        seriesId,
        nodes,
        edges,
        nodeCounts,
        bottlenecks,
        generatedAt: Date.now()
    };
}

/**
 * @param {CreatorKnowledgeGraph} graph
 * @param {string} startNodeId
 * @param {'downstream' | 'upstream'} direction
 */
export function traceGraphPaths(graph, startNodeId, direction = 'downstream') {
    const adjacency = new Map();
    for (const edge of graph.edges) {
        const key = direction === 'downstream' ? edge.from : edge.to;
        const next = direction === 'downstream' ? edge.to : edge.from;
        if (!adjacency.has(key)) adjacency.set(key, []);
        adjacency.get(key).push({ nodeId: next, edge });
    }

    /** @type {string[]} */
    const visited = [];
    /** @type {KnowledgeGraphEdge[]} */
    const pathEdges = [];
    const queue = [startNodeId];
    const seen = new Set([startNodeId]);

    while (queue.length) {
        const current = queue.shift();
        visited.push(current);
        for (const step of adjacency.get(current) || []) {
            pathEdges.push(step.edge);
            if (!seen.has(step.nodeId)) {
                seen.add(step.nodeId);
                queue.push(step.nodeId);
            }
        }
    }

    return { nodeIds: visited, edges: pathEdges };
}

/**
 * @param {CreatorKnowledgeGraph} graph
 * @param {string} nodeId
 */
export function traceImpact(graph, nodeId) {
    const impact = traceGraphPaths(graph, nodeId, 'downstream');
    const blockingEdges = impact.edges.filter((edge) => edge.blocking);
    const impactedNodes = impact.nodeIds
        .map((id) => graph.nodes.find((node) => node.id === id))
        .filter(Boolean);

    logKnowledgeGraphDiag('DEPENDENCY_TRACE', {
        seriesId: graph.seriesId,
        traceType: 'impact',
        startNodeId: nodeId,
        impactedCount: impact.nodeIds.length,
        blockingEdgeCount: blockingEdges.length
    });

    return {
        startNodeId: nodeId,
        impactedNodeIds: impact.nodeIds,
        impactedNodes,
        blockingEdges,
        impactScore: blockingEdges.length * 10 + impact.nodeIds.length
    };
}

/**
 * @param {CreatorKnowledgeGraph} graph
 * @param {string} nodeId
 */
export function traceDependencies(graph, nodeId) {
    const deps = traceGraphPaths(graph, nodeId, 'upstream');
    const dependencyNodes = deps.nodeIds
        .map((id) => graph.nodes.find((node) => node.id === id))
        .filter(Boolean);

    logKnowledgeGraphDiag('DEPENDENCY_TRACE', {
        seriesId: graph.seriesId,
        traceType: 'dependency',
        startNodeId: nodeId,
        dependencyCount: deps.nodeIds.length,
        edgeCount: deps.edges.length
    });

    return {
        startNodeId: nodeId,
        dependencyNodeIds: deps.nodeIds,
        dependencyNodes,
        edges: deps.edges
    };
}

/**
 * @param {CreatorKnowledgeGraph} graph
 * @returns {KnowledgeGraphBottleneck[]}
 */
export function analyzeProductionBottlenecks(graph) {
    const blockingOut = new Map();
    const dependencyIn = new Map();

    for (const edge of graph.edges) {
        if (edge.blocking) {
            blockingOut.set(edge.from, (blockingOut.get(edge.from) || 0) + 1);
        }
        dependencyIn.set(edge.to, (dependencyIn.get(edge.to) || 0) + 1);
    }

    /** @type {KnowledgeGraphBottleneck[]} */
    const bottlenecks = graph.nodes
        .map((node) => {
            const blockedCount = blockingOut.get(node.id) || 0;
            const dependencyCount = dependencyIn.get(node.id) || 0;
            const impactScore = blockedCount * 15 + dependencyCount * 5;
            if (impactScore <= 0) return null;

            let reason = 'Connected production dependency';
            if (node.type === 'task' && blockedCount > 0) reason = 'Open workflow task blocking release path';
            if (node.type === 'episode' && blockedCount > 0) reason = 'Episode blocked by missing asset or task';
            if (node.type === 'asset' && blockedCount > 0) reason = 'Asset gap blocking downstream tasks';
            if (node.type === 'release' && dependencyCount > 1) reason = 'Release waiting on upstream production';

            return {
                nodeId: node.id,
                type: node.type,
                label: node.label,
                blockedCount,
                dependencyCount,
                impactScore,
                reason
            };
        })
        .filter(Boolean)
        .sort((a, b) => b.impactScore - a.impactScore);

    return /** @type {KnowledgeGraphBottleneck[]} */ (bottlenecks);
}

/**
 * @param {CreatorKnowledgeGraph} graph
 */
export function buildDependencyVisualization(graph) {
    const layers = NODE_TYPES.map((type) => ({
        type,
        nodes: graph.nodes.filter((node) => node.type === type).map((node) => ({
            id: node.id,
            label: node.label,
            episodeId: node.episodeId || null
        }))
    })).filter((layer) => layer.nodes.length > 0);

    return {
        seriesId: graph.seriesId,
        layers,
        edges: graph.edges.map((edge) => ({
            from: edge.from,
            to: edge.to,
            type: edge.type,
            blocking: Boolean(edge.blocking)
        })),
        bottlenecks: graph.bottlenecks.slice(0, 8)
    };
}

let knowledgeGraphInitialized = false;

export function initCreatorKnowledgeGraph() {
    if (typeof window === 'undefined' || knowledgeGraphInitialized) return;
    knowledgeGraphInitialized = true;

    window.__reelforgeKnowledgeGraph = {
        NODE_TYPES,
        EDGE_TYPES,
        buildCreatorKnowledgeGraph,
        traceImpact,
        traceDependencies,
        analyzeProductionBottlenecks,
        buildDependencyVisualization,
        logKnowledgeGraphDiag
    };
}
