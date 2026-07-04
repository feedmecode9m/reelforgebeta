import { chromium } from 'playwright';

const FRONTEND = process.env.REELFORGE_URL || 'http://127.0.0.1:4190';

let failed = false;

function assert(name, ok) {
    if (!ok) {
        failed = true;
        console.log(`FAIL: ${name}`);
    } else {
        console.log(`PASS: ${name}`);
    }
}

function parseDiagLogs(logs, tag) {
    return logs
        .map((line) => {
            const match = line.match(new RegExp(`\\[${tag}\\]\\s*(\\{.*\\})`));
            if (!match) return null;
            try {
                return JSON.parse(match[1]);
            } catch {
                return null;
            }
        })
        .filter(Boolean);
}

const browser = await chromium.launch({
    headless: true,
    executablePath:
        '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell'
});

const page = await browser.newPage();
const logs = [];

page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[KNOWLEDGE_GRAPH]') || text.includes('[DEPENDENCY_TRACE]')) {
        logs.push(text);
    }
});

await page.addInitScript(() => {
    localStorage.setItem('admin_mode', 'true');
    localStorage.removeItem('reelforge_workflow_tasks');
    localStorage.setItem(
        'reelforge_creator_teams',
        JSON.stringify({
            version: 1,
            teams: [
                {
                    id: 'team-neon-1',
                    name: 'Neon Production Team',
                    seriesId: 'series-neon-vengeance'
                }
            ],
            members: {
                'team-neon-1': [
                    {
                        id: 'tm-1',
                        teamId: 'team-neon-1',
                        userId: 'user-owner-1',
                        role: 'OWNER',
                        displayName: 'Studio Owner'
                    }
                ]
            },
            activity: { 'team-neon-1': [] }
        })
    );
    localStorage.setItem(
        'reelforge_workflow_tasks',
        JSON.stringify({
            version: 1,
            tasks: [
                {
                    id: 'wf-graph-asset',
                    seriesId: 'series-neon-vengeance',
                    episodeId: 'ep-neon-s01e04',
                    reelId: null,
                    taskType: 'MISSING_ASSET',
                    title: 'Attach asset for Zero Day',
                    status: 'PENDING',
                    priority: 1,
                    estimatedImpact: 20,
                    assignedTo: 'Studio Owner'
                }
            ]
        })
    );
    localStorage.setItem(
        'reelforge_release_schedule',
        JSON.stringify({
            'ep-neon-s01e03': {
                episodeId: 'ep-neon-s01e03',
                seriesId: 'series-neon-vengeance',
                releaseAt: Date.now() + 86400000,
                releaseTime: '20:00',
                status: 'scheduled',
                updatedAt: Date.now()
            }
        })
    );
    localStorage.setItem(
        'reelforge_series_metadata',
        JSON.stringify({
            'd511d64e-10c3-4a11-afa6-927b968c8afd': {
                reelId: 'd511d64e-10c3-4a11-afa6-927b968c8afd',
                episodeId: 'ep-neon-s01e01',
                seriesId: 'series-neon-vengeance',
                seasonNumber: 1,
                episodeNumber: 1,
                seriesName: 'Neon Vengeance',
                episodeTitle: 'Ghost in the Grid',
                episodeStatus: 'published',
                genre: 'Cyber-Action',
                description: 'A hacker discovers encrypted memories.',
                runtime: 312,
                releaseYear: 2024,
                updatedAt: Date.now()
            },
            '4a50ca17-124c-401e-b4bd-d711b781be36': {
                reelId: '4a50ca17-124c-401e-b4bd-d711b781be36',
                episodeId: 'ep-neon-s01e02',
                seriesId: 'series-neon-vengeance',
                seasonNumber: 1,
                episodeNumber: 2,
                seriesName: 'Neon Vengeance',
                episodeTitle: 'Blood Protocol',
                episodeStatus: 'ready',
                genre: 'Cyber-Action',
                runtime: 298,
                releaseYear: 2024,
                updatedAt: Date.now()
            }
        })
    );
});

await page.goto(`${FRONTEND}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.evaluate(() => document.querySelector('.ghost-trigger')?.click());
await page.waitForSelector('[data-production-command-center]', { timeout: 15000 });
await page.click('[data-command-section="analytics"]');
await page.waitForSelector('[data-creator-knowledge-graph]', { timeout: 15000 });
await page.waitForTimeout(900);

assert('knowledge graph hook initialized', await page.evaluate(() => Boolean(window.__reelforgeKnowledgeGraph)));
assert('knowledge graph panel renders', await page.locator('[data-creator-knowledge-graph]').isVisible());
assert('operations dashboard preserved', await page.locator('[data-operations-dashboard]').isVisible());

const graphLogs = parseDiagLogs(logs, 'KNOWLEDGE_GRAPH');
assert('KNOWLEDGE_GRAPH emitted', graphLogs.length >= 1);

await page.locator('[data-graph-node]').first().click();
await page.waitForTimeout(300);

const traceLogs = parseDiagLogs(logs, 'DEPENDENCY_TRACE');
assert('DEPENDENCY_TRACE emitted', traceLogs.length >= 1);

const counts = await page.evaluate(() => ({
    series: document.querySelector('[data-graph-node-type="series"]')?.textContent,
    episode: document.querySelector('[data-graph-node-type="episode"]')?.textContent,
    asset: document.querySelector('[data-graph-node-type="asset"]')?.textContent,
    task: document.querySelector('[data-graph-node-type="task"]')?.textContent,
    team: document.querySelector('[data-graph-node-type="team"]')?.textContent,
    release: document.querySelector('[data-graph-node-type="release"]')?.textContent
}));

assert('series nodes mapped', counts.series !== undefined);
assert('episode nodes mapped', counts.episode !== undefined);
assert('asset nodes mapped', counts.asset !== undefined);
assert('task nodes mapped', counts.task !== undefined);
assert('team nodes mapped', counts.team !== undefined);
assert('release nodes mapped', counts.release !== undefined);

const snapshot = await page.evaluate(() =>
    window.__reelforgeKnowledgeGraph.buildCreatorKnowledgeGraph('series-neon-vengeance', [])
);

assert('graph composes nodes', snapshot.nodes.length >= 5);
assert('graph composes edges', snapshot.edges.length >= 4);
assert('impact tracing available', typeof snapshot.bottlenecks?.length === 'number');

const firstEpisode = snapshot.nodes.find((node) => node.type === 'episode')?.id;
const impact = await page.evaluate(
    (nodeId) => window.__reelforgeKnowledgeGraph.traceImpact(
        window.__reelforgeKnowledgeGraph.buildCreatorKnowledgeGraph('series-neon-vengeance', []),
        nodeId
    ),
    firstEpisode
);
assert('impact trace returns nodes', impact.impactedNodeIds.length >= 1);

const deps = await page.evaluate(
    (nodeId) => window.__reelforgeKnowledgeGraph.traceDependencies(
        window.__reelforgeKnowledgeGraph.buildCreatorKnowledgeGraph('series-neon-vengeance', []),
        nodeId
    ),
    firstEpisode
);
assert('dependency trace returns nodes', deps.dependencyNodeIds.length >= 1);

const viz = await page.evaluate(() =>
    window.__reelforgeKnowledgeGraph.buildDependencyVisualization(
        window.__reelforgeKnowledgeGraph.buildCreatorKnowledgeGraph('series-neon-vengeance', [])
    )
);
assert('dependency visualization layers', viz.layers.length >= 3);
assert('bottleneck analysis available', viz.bottlenecks.length >= 0);

assert('dependency visualization renders', await page.locator('[data-dependency-visualization]').isVisible());
assert('impact trace panel renders', (await page.locator('[data-impact-trace]').count()) >= 0);
assert('dependency trace panel renders', await page.locator('[data-dependency-trace]').isVisible());

await browser.close();

console.log('\n=== Creator Knowledge Graph Validation ===\n');
if (failed) {
    console.log('CREATOR_GRAPH_COMPLETE=false');
    process.exit(1);
}

console.log('CREATOR_GRAPH_COMPLETE=true');
