<script>
    import {
        buildCreatorKnowledgeGraph,
        buildDependencyVisualization,
        traceDependencies,
        traceImpact
    } from '../../lib/graph/creatorKnowledgeGraph.js';

    /** @type {Record<string, unknown>[]} */
    export let feedReels = [];

    /** @type {string} */
    export let seriesId = 'series-neon-vengeance';

    let refreshToken = 0;
    let selectedNodeId = '';

    $: graph = (refreshToken, buildCreatorKnowledgeGraph(seriesId, feedReels));
    $: visualization = buildDependencyVisualization(graph);
    $: impact = selectedNodeId ? traceImpact(graph, selectedNodeId) : null;
    $: dependencies = selectedNodeId ? traceDependencies(graph, selectedNodeId) : null;

    /** @param {string} nodeId */
    function selectNode(nodeId) {
        selectedNodeId = nodeId;
    }
</script>

<section class="creator-knowledge-graph" data-creator-knowledge-graph>
    <div class="creator-knowledge-graph__header">
        <h4>Creator Knowledge Graph</h4>
        <span class="creator-knowledge-graph__hint">Production relationship map</span>
    </div>

    <div class="creator-knowledge-graph__counts" data-graph-node-counts>
        {#each Object.entries(graph.nodeCounts) as [type, count] (type)}
            <span data-graph-node-type={type}>{type}: {count}</span>
        {/each}
    </div>

    <div class="creator-knowledge-graph__viz" data-dependency-visualization>
        <h5>Dependency Layers</h5>
        {#each visualization.layers as layer (layer.type)}
            <div class="creator-knowledge-graph__layer" data-graph-layer={layer.type}>
                <span class="creator-knowledge-graph__layer-label">{layer.type}</span>
                <div class="creator-knowledge-graph__layer-nodes">
                    {#each layer.nodes as node (node.id)}
                        <button
                            type="button"
                            class="creator-knowledge-graph__node"
                            class:creator-knowledge-graph__node--active={selectedNodeId === node.id}
                            data-graph-node={node.id}
                            data-graph-node-type={layer.type}
                            on:click={() => selectNode(node.id)}
                        >
                            {node.label}
                        </button>
                    {/each}
                </div>
            </div>
        {/each}
    </div>

    {#if graph.bottlenecks.length > 0}
        <div class="creator-knowledge-graph__bottlenecks" data-graph-bottlenecks>
            <h5>Production Bottlenecks</h5>
            <ul>
                {#each graph.bottlenecks.slice(0, 6) as bottleneck (bottleneck.nodeId)}
                    <li data-graph-bottleneck data-bottleneck-type={bottleneck.type}>
                        <strong>{bottleneck.label}</strong>
                        <span>{bottleneck.reason}</span>
                        <small>Impact {bottleneck.impactScore}</small>
                    </li>
                {/each}
            </ul>
        </div>
    {/if}

    {#if selectedNodeId && impact}
        <div class="creator-knowledge-graph__trace" data-impact-trace>
            <h5>Impact Trace</h5>
            <p>{impact.impactedNodeIds.length} nodes · score {impact.impactScore}</p>
        </div>
    {/if}

    {#if selectedNodeId && dependencies}
        <div class="creator-knowledge-graph__trace" data-dependency-trace>
            <h5>Dependency Trace</h5>
            <p>{dependencies.dependencyNodeIds.length} upstream dependencies</p>
        </div>
    {/if}
</section>

<style>
    .creator-knowledge-graph {
        margin-top: 0.85rem;
        padding: 0.85rem;
        border-radius: 8px;
        border: 1px solid rgba(147, 112, 219, 0.28);
        background: rgba(147, 112, 219, 0.05);
    }
    .creator-knowledge-graph__header {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        justify-content: space-between;
        gap: 0.35rem;
        margin-bottom: 0.55rem;
    }
    .creator-knowledge-graph__header h4 {
        margin: 0;
        font-size: 0.72rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #c9b3ff;
    }
    .creator-knowledge-graph__hint {
        font-size: 0.62rem;
        color: rgba(255, 255, 255, 0.45);
    }
    .creator-knowledge-graph__counts {
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem;
        margin-bottom: 0.65rem;
        font-size: 0.56rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: rgba(255, 255, 255, 0.55);
    }
    .creator-knowledge-graph__viz h5,
    .creator-knowledge-graph__bottlenecks h5,
    .creator-knowledge-graph__trace h5 {
        margin: 0 0 0.4rem;
        font-size: 0.62rem;
        text-transform: uppercase;
        letter-spacing: 0.07em;
        color: rgba(255, 255, 255, 0.65);
    }
    .creator-knowledge-graph__layer {
        margin-bottom: 0.45rem;
    }
    .creator-knowledge-graph__layer-label {
        display: block;
        font-size: 0.56rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: rgba(201, 179, 255, 0.85);
        margin-bottom: 0.25rem;
    }
    .creator-knowledge-graph__layer-nodes {
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem;
    }
    .creator-knowledge-graph__node {
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(0, 0, 0, 0.22);
        color: rgba(255, 255, 255, 0.85);
        border-radius: 999px;
        padding: 0.28rem 0.55rem;
        font-size: 0.62rem;
        cursor: pointer;
    }
    .creator-knowledge-graph__node--active {
        border-color: #c9b3ff;
        color: #c9b3ff;
        background: rgba(147, 112, 219, 0.12);
    }
    .creator-knowledge-graph__bottlenecks ul {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
    }
    .creator-knowledge-graph__bottlenecks li {
        padding: 0.4rem 0.5rem;
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(0, 0, 0, 0.18);
        display: flex;
        flex-direction: column;
        gap: 0.1rem;
    }
    .creator-knowledge-graph__bottlenecks strong {
        font-size: 0.68rem;
        color: rgba(255, 255, 255, 0.9);
    }
    .creator-knowledge-graph__bottlenecks span,
    .creator-knowledge-graph__bottlenecks small,
    .creator-knowledge-graph__trace p {
        font-size: 0.62rem;
        color: rgba(255, 255, 255, 0.5);
    }
    .creator-knowledge-graph__trace {
        margin-top: 0.55rem;
    }
</style>
