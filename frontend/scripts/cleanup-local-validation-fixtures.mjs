#!/usr/bin/env node
/**
 * Checkpoint 2 — one-time local hygiene for validation-series Postgres residue.
 *
 * Removes known validation fixtures created by validate-series-api.mjs runs or
 * manual curl probes. Does not touch production series (Vic G, vault-inferred, etc.).
 */
const BACKEND = process.env.REELFORGE_BACKEND_URL || 'http://127.0.0.1:8080';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Gaff1505!';

const KNOWN_FIXTURE_IDS = ['series-validation-1781016646994'];
const VIC_G_ID = 'series-vic-g';
const VIC_G_REELS = {
    e02: 'cadfcabc-1947-4341-86a3-f82a08e78669',
    e04: 'b3a87c96-6ea0-4854-a0bc-6b0f2442f9a1',
    e05: 'efb01cee-9477-4477-982a-7611cfc08fcc',
    e06: '5cc786f0-8fbe-4f96-a59d-02014b0cc56f'
};

let failed = 0;
function assert(label, ok) {
    if (ok) console.log(`  ok: ${label}`);
    else {
        failed += 1;
        console.error(`  FAIL: ${label}`);
    }
}

async function apiJson(path, options = {}) {
    const res = await fetch(`${BACKEND}${path}`, options);
    const body = await res.json().catch(() => ({}));
    return { res, body };
}

async function getAdminHeaders() {
    const { res, body } = await apiJson('/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: ADMIN_PASSWORD })
    });
    if (!res.ok || !body?.token) {
        throw new Error('admin auth failed — cannot delete validation fixtures');
    }
    return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${body.token}`
    };
}

/** @param {unknown} series */
function vicBindings(series) {
    const episodes = (series?.seasons || []).flatMap((season) => season?.episodes || []);
    const byNum = Object.fromEntries(
        episodes.map((episode) => [Number(episode.episodeNumber), String(episode.reelId || '')])
    );
    return { count: episodes.length, reels: byNum };
}

async function main() {
    console.log('\n[cleanup-local-validation-fixtures]');

    const { body: catalogBefore } = await apiJson('/api/series');
    const beforeIds = (Array.isArray(catalogBefore) ? catalogBefore : [])
        .map((series) => String(series?.id || ''))
        .sort();

    const { body: vicBefore } = await apiJson(`/api/series/${encodeURIComponent(VIC_G_ID)}`);
    const vicBeforeBindings = vicBindings(vicBefore);

    const validationIdsBefore = beforeIds.filter((id) => id.startsWith('series-validation-'));
    const debugIds = validationIdsBefore.filter((id) => id.startsWith('series-validation-debug-'));
    const targets = [
        ...new Set([
            ...KNOWN_FIXTURE_IDS.filter((id) => validationIdsBefore.includes(id)),
            ...debugIds
        ])
    ];

    if (!targets.length) {
        console.log('  no validation fixtures present — verifying clean state');
    }

    const writeHeaders = await getAdminHeaders();
    for (const seriesId of targets) {
        const { res } = await apiJson(`/api/series/${encodeURIComponent(seriesId)}`, {
            method: 'DELETE',
            headers: writeHeaders
        });
        assert(`DELETE ${seriesId}`, res.ok);
    }

    for (const seriesId of [...KNOWN_FIXTURE_IDS, ...debugIds]) {
        const getSeries = await apiJson(`/api/series/${encodeURIComponent(seriesId)}`);
        const getSeasons = await apiJson(`/api/series/${encodeURIComponent(seriesId)}/seasons`);
        const getEpisodes = await apiJson(`/api/series/${encodeURIComponent(seriesId)}/episodes`);
        assert(`${seriesId} GET series -> 404`, getSeries.res.status === 404);
        assert(`${seriesId} GET seasons -> 404`, getSeasons.res.status === 404);
        assert(`${seriesId} GET episodes -> 404`, getEpisodes.res.status === 404);
    }

    const { body: catalogAfter } = await apiJson('/api/series');
    const afterIds = (Array.isArray(catalogAfter) ? catalogAfter : [])
        .map((series) => String(series?.id || ''))
        .sort();
    const validationRemaining = afterIds.filter((id) => id.startsWith('series-validation-'));
    assert('no series-validation-* rows remain', validationRemaining.length === 0);

    const unrelatedBefore = beforeIds.filter((id) => !id.startsWith('series-validation-'));
    const unrelatedAfter = afterIds.filter((id) => !id.startsWith('series-validation-'));
    assert(
        'unrelated canonical series ids unchanged',
        unrelatedBefore.length === unrelatedAfter.length &&
            unrelatedBefore.every((id, index) => id === unrelatedAfter[index])
    );

    const { body: vicAfter } = await apiJson(`/api/series/${encodeURIComponent(VIC_G_ID)}`);
    const vicAfterBindings = vicBindings(vicAfter);
    assert('Vic G episode count unchanged', vicAfterBindings.count === vicBeforeBindings.count);
    for (const [key, expected] of Object.entries(VIC_G_REELS)) {
        const num = Number(key.slice(1));
        assert(
            `Vic G ${key} reel unchanged`,
            vicAfterBindings.reels[num] === expected && vicBeforeBindings.reels[num] === expected
        );
    }

    if (failed) {
        console.error(`\nFAIL cleanup-local-validation-fixtures (${failed})`);
        process.exit(1);
    }
    console.log('\nPASS cleanup-local-validation-fixtures');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
