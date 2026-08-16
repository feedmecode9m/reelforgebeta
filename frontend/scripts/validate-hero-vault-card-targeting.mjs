#!/usr/bin/env node
/**
 * Hero Vault creator card mediaAssetId targeting.
 *
 * Proves:
 *   1. editable cards bind stable mediaAssetId
 *   2. identity confirmation mutates only selected mediaAssetId
 *   3. enrichment targets the same mediaAssetId
 *   4. reorder does not change target identity
 *   5. reverse-order edits do not cross-write
 *   6. duplicate titles/filenames cannot cause cross-targeting
 *   7. persistence/reload preserves mapping
 *   8. A mutation never modifies B or C (explicit cross-write assertion)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { createServer } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, '..');

/** @type {string[]} */
const failures = [];
/** @type {string[]} */
const notes = [];

function assert(cond, msg) {
    if (!cond) failures.push(msg);
    else notes.push(`ok: ${msg}`);
}

function read(rel) {
    return fs.readFileSync(path.join(frontendRoot, rel), 'utf8');
}

const bag = new Map();
globalThis.localStorage = {
    getItem: (k) => (bag.has(k) ? bag.get(k) : null),
    setItem: (k, v) => bag.set(String(k), String(v)),
    removeItem: (k) => bag.delete(k),
    clear: () => bag.clear()
};
globalThis.window = {
    localStorage: globalThis.localStorage,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => true
};
if (typeof globalThis.crypto?.randomUUID !== 'function') {
    Object.defineProperty(globalThis, 'crypto', {
        value: { randomUUID: () => '00000000-0000-4000-8000-0000000000cd' },
        configurable: true
    });
}

const ID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01';
const ID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02';
const ID_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccc03';

function fixtureRow(id, ep, fileName) {
    return {
        id,
        mediaAssetId: id,
        name: fileName,
        title: fileName,
        fileName,
        type: 'video/mp4',
        url: `https://cdn.example/videos/${id}.mp4`,
        playbackUrl: `https://cdn.example/videos/${id}.playback.mp4`,
        playbackStatus: 'ready',
        seriesLabel: 'STIRRED',
        seasonNumber: 1,
        episodeNumber: ep,
        seriesIdentity: {
            seriesLabel: 'STIRRED',
            seasonNumber: 1,
            episodeNumber: ep,
            confirmedByCreator: true
        }
    };
}

/**
 * MinimalFields shape matching PERSONAL_VIDEO_VAULT_MINIMAL_FIELDS subset used in targeting proof.
 * @param {Record<string, unknown>} row
 * @param {string[]} fields
 */
function projectMinimal(row, fields) {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const f of fields) {
        if (row[f] !== undefined) out[f] = row[f];
    }
    return out;
}

async function main() {
    // --- Static wiring ---
    const vaultExp = read('src/components/experiences/VaultExperience.svelte');
    const cardSrc = read('src/components/series/VaultEpisodeCreatorStatus.svelte');
    const targetingSrc = read('src/lib/vault/vaultCreatorCardTargeting.js');
    const pkg = JSON.parse(read('package.json'));

    assert(
        cardSrc.includes('data-media-asset-id={model.mediaAssetId') ||
            cardSrc.includes('data-media-asset-id={model.mediaAssetId ||'),
        'VaultEpisodeCreatorStatus binds data-media-asset-id to asset mediaAssetId'
    );
    assert(
        vaultExp.includes('vaultCreatorCardTargeting') ||
            vaultExp.includes("from '../../lib/vault/vaultCreatorCardTargeting.js'"),
        'VaultExperience imports vaultCreatorCardTargeting'
    );
    assert(
        vaultExp.includes('applyIdentityToVaultListByMediaAssetId') &&
            vaultExp.includes('applyPackageToVaultListByMediaAssetId'),
        'VaultExperience mutates via mediaAssetId list helpers'
    );
    assert(
        vaultExp.includes('confirmVaultVideoIdentity(event.detail') ||
            vaultExp.includes('confirmVaultVideoIdentity(event.detail || {}'),
        'identity handler uses event.detail (not each-item index closure as primary)'
    );
    assert(
        vaultExp.includes('saveVaultEpisodeEnrichment(event.detail') ||
            vaultExp.includes('saveVaultEpisodeEnrichment(event.detail || {}'),
        'package handler uses event.detail (not each-item index closure as primary)'
    );
    assert(
        !/confirmVaultVideoIdentity\(\s*video\s*,/.test(vaultExp) &&
            !/saveVaultEpisodeEnrichment\(\s*video\s*,/.test(vaultExp),
        'handlers no longer take video as primary mutation key'
    );
    assert(
        vaultExp.includes('resolveMediaAssetId(video)') &&
            vaultExp.includes('#each vaultDisplayVideos'),
        'each block keys/binds via resolveMediaAssetId'
    );
    assert(
        targetingSrc.includes('export function applyIdentityToVaultListByMediaAssetId') &&
            targetingSrc.includes('export function assertNoCrossWrite'),
        'targeting module exports mediaId mutators + cross-write assert'
    );
    assert(
        pkg.scripts?.['validate:hero-vault-card-targeting'] ===
            'node scripts/validate-hero-vault-card-targeting.mjs',
        'package.json script validate:hero-vault-card-targeting registered'
    );
    assert(
        cardSrc.includes("dispatch('confirmIdentity'") &&
            (cardSrc.includes('mediaAssetId: model?.mediaAssetId') ||
                cardSrc.includes('resolveMediaAssetId(asset)')),
        'identity event payload carries model.mediaAssetId'
    );
    assert(
        cardSrc.includes("dispatch('savePackage'") &&
            (cardSrc.includes("mediaAssetId: model?.mediaAssetId") ||
                cardSrc.includes('resolveMediaAssetId(asset)')),
        'package event payload carries model.mediaAssetId'
    );

    const server = await createServer({
        root: frontendRoot,
        server: { middlewareMode: true },
        appType: 'custom',
        logLevel: 'error'
    });

    try {
        const targeting = await server.ssrLoadModule('/src/lib/vault/vaultCreatorCardTargeting.js');
        const authority = await server.ssrLoadModule('/src/lib/vault/vaultCreatorAuthority.js');
        const presentation = await server.ssrLoadModule(
            '/src/lib/series/creatorExperiencePresentation.js'
        );

        // --- Editable card presentation always exposes mediaAssetId ---
        let list = [
            fixtureRow(ID_A, 1, 'shared-title.mp4'),
            fixtureRow(ID_B, 2, 'shared-title.mp4'),
            fixtureRow(ID_C, 3, 'shared-title.mp4')
        ];
        for (const row of list) {
            const model = presentation.presentVaultEpisodeCompleteness(row);
            assert(
                model.mediaAssetId === row.id,
                `completeness model mediaAssetId=${model.mediaAssetId} for ${row.id}`
            );
        }

        // --- Hostile identity order: C→E5, A→E4, B→E2 ---
        const hostileIdentity = [
            { id: ID_C, episodeNumber: 5 },
            { id: ID_A, episodeNumber: 4 },
            { id: ID_B, episodeNumber: 2 }
        ];
        for (const step of hostileIdentity) {
            const before = list.map((r) => ({ ...r }));
            // detail-only targeting (simulates event.detail)
            const resolved = targeting.resolveCreatorCardMutationTarget(
                { mediaAssetId: step.id, seriesLabel: 'STIRRED', seasonNumber: 1, episodeNumber: step.episodeNumber },
                step.id
            );
            assert(resolved.ok && resolved.mediaAssetId === step.id, `target resolve ${step.id}`);
            const applied = targeting.applyIdentityToVaultListByMediaAssetId(list, resolved.mediaAssetId, {
                seriesLabel: 'STIRRED',
                seasonNumber: 1,
                episodeNumber: step.episodeNumber
            });
            assert(applied.mutated, `identity mutated ${step.id}`);
            const cross = targeting.assertNoCrossWrite(before, applied.list, step.id);
            assert(cross.ok, `no cross-write identity→${step.id}: ${cross.violations?.join('; ')}`);
            list = applied.list;
        }

        const byId = (id) => list.find((r) => String(r.id) === id);
        assert(byId(ID_A)?.seriesIdentity?.episodeNumber === 4, 'A episode is 4 after hostile identity');
        assert(byId(ID_B)?.seriesIdentity?.episodeNumber === 2, 'B episode is 2 after hostile identity');
        assert(byId(ID_C)?.seriesIdentity?.episodeNumber === 5, 'C episode is 5 after hostile identity');
        assert(byId(ID_A)?.seriesIdentity?.confirmedByCreator === true, 'A confirmed');
        assert(byId(ID_B)?.seriesIdentity?.confirmedByCreator === true, 'B confirmed');
        assert(byId(ID_C)?.seriesIdentity?.confirmedByCreator === true, 'C confirmed');

        // --- Unique packages hostile order C, A, B ---
        const packages = [
            { id: ID_C, title: 'TITLE_C' },
            { id: ID_A, title: 'TITLE_A' },
            { id: ID_B, title: 'TITLE_B' }
        ];
        for (const step of packages) {
            const before = list.map((r) => ({
                ...r,
                seriesIdentity: { ...r.seriesIdentity },
                episodeEnrichment: r.episodeEnrichment ? { ...r.episodeEnrichment } : undefined
            }));
            const applied = targeting.applyPackageToVaultListByMediaAssetId(list, step.id, {
                title: step.title,
                description: `DESC_${step.title}`,
                artworkUrl: `https://cdn.example/art/${step.title}.jpg`
            });
            assert(applied.mutated, `package mutated ${step.id}`);
            const cross = targeting.assertNoCrossWrite(before, applied.list, step.id);
            assert(cross.ok, `no cross-write package→${step.id}: ${cross.violations?.join('; ')}`);
            list = applied.list;
        }

        assert(byId(ID_A)?.episodeEnrichment?.title === 'TITLE_A', 'A package TITLE_A only');
        assert(byId(ID_B)?.episodeEnrichment?.title === 'TITLE_B', 'B package TITLE_B only');
        assert(byId(ID_C)?.episodeEnrichment?.title === 'TITLE_C', 'C package TITLE_C only');
        assert(byId(ID_A)?.seriesIdentity?.episodeNumber === 4, 'A identity unchanged by package');
        assert(byId(ID_B)?.seriesIdentity?.episodeNumber === 2, 'B identity unchanged by package');
        assert(byId(ID_C)?.seriesIdentity?.episodeNumber === 5, 'C identity unchanged by package');

        // --- Explicit A mutation never modifies B or C ---
        {
            const before = list.map((r) => ({
                ...r,
                seriesIdentity: { ...r.seriesIdentity },
                episodeEnrichment: { ...r.episodeEnrichment }
            }));
            const applied = targeting.applyIdentityToVaultListByMediaAssetId(list, ID_A, {
                seriesLabel: 'STIRRED',
                seasonNumber: 1,
                episodeNumber: 9
            });
            list = applied.list;
            const cross = targeting.assertNoCrossWrite(before, list, ID_A);
            assert(cross.ok, `explicit A-only identity cross-write assert: ${cross.violations?.join('; ')}`);
            assert(byId(ID_A)?.seriesIdentity?.episodeNumber === 9, 'A→E9');
            assert(byId(ID_B)?.seriesIdentity?.episodeNumber === 2, 'B untouched by A mutation');
            assert(byId(ID_C)?.seriesIdentity?.episodeNumber === 5, 'C untouched by A mutation');
            assert(byId(ID_B)?.episodeEnrichment?.title === 'TITLE_B', 'B package untouched by A identity');
            assert(byId(ID_C)?.episodeEnrichment?.title === 'TITLE_C', 'C package untouched by A identity');
            // restore E4 for later expectations around package titles with reorder test
            list = targeting.applyIdentityToVaultListByMediaAssetId(list, ID_A, {
                seriesLabel: 'STIRRED',
                seasonNumber: 1,
                episodeNumber: 4
            }).list;
        }

        // --- Duplicate titles/filenames cannot retarget ---
        {
            const twinTitle = list.map((r) => ({
                ...r,
                name: 'DUPLICATE.mp4',
                title: 'DUPLICATE.mp4',
                fileName: 'DUPLICATE.mp4'
            }));
            // Wrong primary keys omitted: only mediaAssetId
            const resolvedFromTitle = targeting.resolveCreatorCardMutationTarget(
                { seriesLabel: 'STIRRED', seasonNumber: 1, episodeNumber: 1 },
                ''
            );
            assert(!resolvedFromTitle.ok, 'refuse mutation without mediaAssetId even with duplicate titles present');
            const applied = targeting.applyIdentityToVaultListByMediaAssetId(twinTitle, ID_B, {
                seriesLabel: 'STIRRED',
                seasonNumber: 1,
                episodeNumber: 7
            });
            assert(
                applied.list.find((r) => r.id === ID_A)?.seriesIdentity?.episodeNumber === 4,
                'duplicate filename: A unchanged when B targeted'
            );
            assert(
                applied.list.find((r) => r.id === ID_C)?.seriesIdentity?.episodeNumber === 5,
                'duplicate filename: C unchanged when B targeted'
            );
            assert(
                applied.list.find((r) => r.id === ID_B)?.seriesIdentity?.episodeNumber === 7,
                'duplicate filename: B received mutation by mediaAssetId'
            );
            list = targeting.applyIdentityToVaultListByMediaAssetId(applied.list, ID_B, {
                seriesLabel: 'STIRRED',
                seasonNumber: 1,
                episodeNumber: 2
            }).list;
        }

        // --- Reorder C,A,B (displayOrder 3,1,2 equivalent) does not change identity ---
        const beforeReorder = targeting.snapshotVaultCreatorFieldsByMediaId(list);
        const reordered = targeting.reorderVaultListByMediaAssetIds(list, [ID_C, ID_A, ID_B]);
        assert(reordered.map((r) => r.id).join(',') === `${ID_C},${ID_A},${ID_B}`, 'display order C,A,B');
        const afterReorder = targeting.snapshotVaultCreatorFieldsByMediaId(reordered);
        for (const id of [ID_A, ID_B, ID_C]) {
            assert(
                JSON.stringify(beforeReorder.get(id)) === JSON.stringify(afterReorder.get(id)),
                `reorder preserved creator fields for ${id}`
            );
        }
        // displayOrder positions: C first (was E5/e3 identity), identities stay on media ids
        assert(reordered[0].id === ID_C && reordered[0].seriesIdentity.episodeNumber === 5, 'order pos0 is media C E5');
        assert(reordered[1].id === ID_A && reordered[1].seriesIdentity.episodeNumber === 4, 'order pos1 is media A E4');
        assert(reordered[2].id === ID_B && reordered[2].seriesIdentity.episodeNumber === 2, 'order pos2 is media B E2');

        // Edit after reorder via mediaAssetId of visible cards (simulate reverse-order clicks)
        list = reordered;
        // Reset identities to E1/E2/E3 for reorder hostile acceptance mapping while keeping packages
        list = targeting.applyIdentityToVaultListByMediaAssetId(list, ID_A, {
            seriesLabel: 'STIRRED',
            seasonNumber: 1,
            episodeNumber: 1
        }).list;
        list = targeting.applyIdentityToVaultListByMediaAssetId(list, ID_B, {
            seriesLabel: 'STIRRED',
            seasonNumber: 1,
            episodeNumber: 2
        }).list;
        list = targeting.applyIdentityToVaultListByMediaAssetId(list, ID_C, {
            seriesLabel: 'STIRRED',
            seasonNumber: 1,
            episodeNumber: 3
        }).list;
        // Reorder to displayOrder 3,1,2: C, A, B
        list = targeting.reorderVaultListByMediaAssetIds(list, [ID_C, ID_A, ID_B]);
        // hostile visible-order edit: card index 0 (C), 1 (A), 2 (B) but mutate via mediaAssetId only
        const visibleOrder = list.map((r) => r.id);
        assert(visibleOrder.join(',') === `${ID_C},${ID_A},${ID_B}`, 'visible order C,A,B (display 3,1,2 media)');
        for (const id of visibleOrder) {
            const before = list.map((r) => ({
                ...r,
                seriesIdentity: { ...r.seriesIdentity },
                episodeEnrichment: { ...r.episodeEnrichment }
            }));
            // no-op identity reaffirm — proves targeting by id not by index
            const row = list.find((r) => r.id === id);
            const applied = targeting.applyIdentityToVaultListByMediaAssetId(list, id, {
                seriesLabel: 'STIRRED',
                seasonNumber: 1,
                episodeNumber: row.seriesIdentity.episodeNumber
            });
            const cross = targeting.assertNoCrossWrite(before, applied.list, id);
            assert(cross.ok, `post-reorder edit of ${id} has no cross-write`);
            list = applied.list;
        }
        assert(byId(ID_A)?.seriesIdentity?.episodeNumber === 1, 'after reorder-hostile: A still E1');
        assert(byId(ID_B)?.seriesIdentity?.episodeNumber === 2, 'after reorder-hostile: B still E2');
        assert(byId(ID_C)?.seriesIdentity?.episodeNumber === 3, 'after reorder-hostile: C still E3');
        assert(byId(ID_A)?.episodeEnrichment?.title === 'TITLE_A', 'after reorder-hostile: TITLE_A');
        assert(byId(ID_B)?.episodeEnrichment?.title === 'TITLE_B', 'after reorder-hostile: TITLE_B');
        assert(byId(ID_C)?.episodeEnrichment?.title === 'TITLE_C', 'after reorder-hostile: TITLE_C');

        // --- Persistence / reload preserves mapping ---
        const fields = authority.PERSONAL_VIDEO_VAULT_MINIMAL_FIELDS;
        const stored = list.map((row) => projectMinimal(row, fields));
        bag.set('personal_video_vault', JSON.stringify(stored));
        const reloaded = JSON.parse(bag.get('personal_video_vault'));
        assert(reloaded.length === 3, 'reload list length 3');
        const relA = reloaded.find((r) => r.id === ID_A);
        const relB = reloaded.find((r) => r.id === ID_B);
        const relC = reloaded.find((r) => r.id === ID_C);
        assert(relA?.seriesIdentity?.episodeNumber === 1 && relA?.episodeEnrichment?.title === 'TITLE_A', 'reload A');
        assert(relB?.seriesIdentity?.episodeNumber === 2 && relB?.episodeEnrichment?.title === 'TITLE_B', 'reload B');
        assert(relC?.seriesIdentity?.episodeNumber === 3 && relC?.episodeEnrichment?.title === 'TITLE_C', 'reload C');

        // --- Card/event mismatch still targets event mediaAssetId (card that submitted) ---
        {
            const resolved = targeting.resolveCreatorCardMutationTarget(
                { mediaAssetId: ID_B },
                ID_A
            );
            assert(resolved.mediaAssetId === ID_B, 'mismatched card/event prefers event mediaAssetId');
            assert(!resolved.ok, 'mismatch flagged');
        }

        // --- Reverse package order again (C→A→B) ---
        list = [
            fixtureRow(ID_A, 1, 'same.mp4'),
            fixtureRow(ID_B, 2, 'same.mp4'),
            fixtureRow(ID_C, 3, 'same.mp4')
        ];
        for (const step of [
            { id: ID_C, title: 'TITLE_C' },
            { id: ID_A, title: 'TITLE_A' },
            { id: ID_B, title: 'TITLE_B' }
        ]) {
            const before = list.map((r) => ({ ...r }));
            list = targeting.applyPackageToVaultListByMediaAssetId(list, step.id, {
                title: step.title,
                description: 'd',
                artworkUrl: 'https://cdn.example/x.jpg'
            }).list;
            assert(
                targeting.assertNoCrossWrite(before, list, step.id).ok,
                `reverse package no cross-write ${step.id}`
            );
        }
        assert(byId(ID_A)?.episodeEnrichment?.title === 'TITLE_A' && byId(ID_B)?.episodeEnrichment?.title === 'TITLE_B' && byId(ID_C)?.episodeEnrichment?.title === 'TITLE_C', 'reverse package titles mapped correctly');
    } finally {
        await server.close();
    }

    if (failures.length) {
        console.error('FAIL validate-hero-vault-card-targeting');
        for (const f of failures) console.error('  -', f);
        process.exit(1);
    }
    console.log('PASS validate-hero-vault-card-targeting');
    for (const n of notes) console.log(`  ${n}`);
}

main().catch((err) => {
    console.error('FAIL validate-hero-vault-card-targeting (crash)', err);
    process.exit(1);
});
