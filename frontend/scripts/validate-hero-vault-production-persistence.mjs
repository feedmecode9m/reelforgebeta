#!/usr/bin/env node
/**
 * Production Hero Vault persistence boundary.
 *
 * Reproduces the live production path that failed acceptance:
 *   creator mutation → seal → persistPersonalVault minimalFields →
 *   wipe memory → API-style catalog projection (no creator fields) →
 *   overlay local authority (hydrate/merge) → re-seal → assert durability
 *
 * Does not redesign authority ownership.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, '..');
const failures = [];
const notes = [];

function assert(cond, msg) {
    if (!cond) failures.push(msg);
    else notes.push(`ok: ${msg}`);
    return Boolean(cond);
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

const R2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa22';
const VAULT_KEY = 'personal_video_vault';

/**
 * Exact production minimal-field serialization used by persistPersonalVault.
 * @param {Record<string, unknown>[]} list
 * @param {string[]} minimalFields
 */
function persistThroughProductionMinimalFields(list, minimalFields) {
    const minimal = (Array.isArray(list) ? list : []).map((item) => {
        const kept = {};
        for (const field of minimalFields) {
            if (item?.[field] !== undefined) kept[field] = item[field];
        }
        if (
            typeof item?.url === 'string' &&
            !item.url.startsWith('data:') &&
            !item.url.startsWith('blob:')
        ) {
            kept.url = item.url;
        }
        return kept;
    });
    localStorage.setItem(VAULT_KEY, JSON.stringify(minimal));
    return JSON.parse(localStorage.getItem(VAULT_KEY) || '[]');
}

async function main() {
    const server = await createServer({
        root: frontendRoot,
        server: { middlewareMode: true },
        appType: 'custom',
        logLevel: 'error'
    });

    try {
        const authority = await server.ssrLoadModule('/src/lib/vault/vaultCreatorAuthority.js');
        const idConf = await server.ssrLoadModule('/src/lib/series/vaultIdentityConfirmation.js');
        const enrichMod = await server.ssrLoadModule('/src/lib/series/vaultEpisodeEnrichment.js');
        const infer = await server.ssrLoadModule('/src/lib/series/vaultSeriesInference.js');
        const { reelToVaultEntry } = await server.ssrLoadModule('/src/lib/api/reelContract.js');
        const { normalizeVaultAsset } = await server.ssrLoadModule('/src/lib/vault/normalizeVaultAsset.js');

        // Structural: production path includes episodeEnrichment + shared constant
        const ctx = read('src/viewer/viewerContext.js');
        const boot = read('src/lib/mediaBootstrap.js');
        assert(
            ctx.includes('PERSONAL_VIDEO_VAULT_MINIMAL_FIELDS') &&
                ctx.includes('overlayLocalCreatorVaultAuthority'),
            'viewerContext uses vaultCreatorAuthority for persist + merge overlay'
        );
        assert(
            boot.includes('overlayLocalCreatorVaultAuthority') &&
                boot.includes('indexVaultAssetsByMediaId'),
            'hydrateVaultFromReels overlays local creator authority'
        );
        assert(
            authority.PERSONAL_VIDEO_VAULT_MINIMAL_FIELDS.includes('episodeEnrichment') &&
                authority.PERSONAL_VIDEO_VAULT_MINIMAL_FIELDS.includes('seriesIdentity'),
            'minimalFields includes seriesIdentity + episodeEnrichment'
        );

        // --- 1 Initial E2 (parser inference from filename) ---
        let asset = infer.sealVaultSeriesIdentityForStorage(
            reelToVaultEntry({
                id: R2,
                name: '07 AMP JAM V1',
                fileName: '07_AMP_JAM_V1.mp4',
                url: `https://cdn.example/videos/${R2}.mp4`,
                thumbnailUrl: 'https://cdn.example/thumbs/e2.jpg',
                type: 'video'
            })
        );
        assert(String(asset?.id) === R2, 'mediaAssetId assigned');
        assert(Boolean(asset?.url), 'playback url present');
        // Initial identity may be AMP JAM or null depending on parse — either is fine pre-confirm
        const initialLabel = String(asset?.seriesIdentity?.seriesLabel || '');
        notes.push(`ok: initial parse label="${initialLabel || '(none)'}"`);

        // --- 2–3 Creator confirms STIRRED / S1 / E5 (beats parser) ---
        asset = idConf.applyCreatorVaultIdentityConfirmation(asset, {
            seriesLabel: 'STIRRED',
            seasonNumber: 1,
            episodeNumber: 5
        });
        assert(asset.seriesIdentity?.seriesLabel === 'STIRRED', 'confirmed series STIRRED');
        assert(asset.seriesIdentity?.seasonNumber === 1, 'confirmed season 1');
        assert(asset.seriesIdentity?.episodeNumber === 5, 'confirmed episode 5');
        assert(asset.seriesIdentity?.confirmedByCreator === true, 'confirmedByCreator true');

        // --- 4 Package ---
        asset = enrichMod.applyCreatorVaultEpisodeEnrichment(asset, {
            title: 'The Beginning',
            description: 'Episode description',
            artworkUrl: 'artwork-url'
        });
        assert(asset.episodeEnrichment?.title === 'The Beginning', 'package title set');
        assert(
            asset.episodeEnrichment?.description === 'Episode description',
            'package description set'
        );
        assert(asset.episodeEnrichment?.artworkUrl === 'artwork-url', 'package artwork set');
        assert(asset.seriesIdentity?.episodeNumber === 5, 'package did not rewrite S/E');
        assert(String(asset.id) === R2, 'package did not rewrite mediaAssetId');

        // --- 5 Seal + serialize through exact persistPersonalVault minimalFields ---
        const sealed = enrichMod.sealVaultAssetsWithEnrichment([asset]);
        assert(sealed.length === 1, 'seal list length 1');
        const stored = persistThroughProductionMinimalFields(
            sealed,
            authority.PERSONAL_VIDEO_VAULT_MINIMAL_FIELDS
        );
        assert(stored.length === 1, 'stored one vault row');
        assert(
            stored[0].seriesIdentity?.episodeNumber === 5 &&
                stored[0].seriesIdentity?.confirmedByCreator === true,
            'minimalFields retained confirmed identity'
        );
        assert(
            stored[0].episodeEnrichment?.title === 'The Beginning' &&
                stored[0].episodeEnrichment?.description === 'Episode description' &&
                stored[0].episodeEnrichment?.artworkUrl === 'artwork-url',
            'minimalFields retained episodeEnrichment package'
        );
        // Exactly prove old defective minimalFields would have stripped enrichment
        const defectiveFields = [
            'id',
            'name',
            'title',
            'fileName',
            'type',
            'size',
            'addedAt',
            'thumbnail',
            'seriesIdentity',
            'seriesLabel',
            'seasonNumber',
            'episodeNumber'
        ];
        const defective = (() => {
            const item = sealed[0];
            const kept = {};
            for (const f of defectiveFields) {
                if (item?.[f] !== undefined) kept[f] = item[f];
            }
            if (item?.url) kept.url = item.url;
            return kept;
        })();
        assert(
            !defective.episodeEnrichment,
            'control: pre-fix minimalFields would strip episodeEnrichment'
        );

        // --- 6 Wipe in-memory and reload storage ---
        asset = null;
        let hydrated = JSON.parse(localStorage.getItem(VAULT_KEY) || '[]');
        assert(hydrated[0]?.seriesIdentity?.episodeNumber === 5, 'LS reload: episode 5');
        assert(hydrated[0]?.episodeEnrichment?.title === 'The Beginning', 'LS reload: package title');

        // --- 7 Production hydrate-style catalog projection (API has different name) ---
        const apiReel = {
            id: R2,
            name: '07 AMP JAM V1',
            fileName: '07_AMP_JAM_V1.mp4',
            url: `https://cdn.example/videos/${R2}.mp4`,
            thumbnailUrl: 'https://cdn.example/thumbs/e2.jpg',
            type: 'video'
        };
        const catalogEntry = reelToVaultEntry(apiReel);
        assert(
            !catalogEntry.seriesIdentity?.confirmedByCreator,
            'API projection has no creator confirmation'
        );
        assert(!catalogEntry.episodeEnrichment, 'API projection has no package');

        const overlaid = authority.overlayLocalCreatorVaultAuthority(catalogEntry, hydrated[0]);
        assert(
            overlaid.seriesIdentity?.seriesLabel === 'STIRRED' &&
                overlaid.seriesIdentity?.seasonNumber === 1 &&
                overlaid.seriesIdentity?.episodeNumber === 5 &&
                overlaid.seriesIdentity?.confirmedByCreator === true,
            'hydrate overlay restores confirmed STIRRED S1E5 over AMP JAM parse'
        );
        assert(
            overlaid.episodeEnrichment?.title === 'The Beginning' &&
                overlaid.episodeEnrichment?.description === 'Episode description' &&
                overlaid.episodeEnrichment?.artworkUrl === 'artwork-url',
            'hydrate overlay restores episodeEnrichment'
        );
        assert(String(overlaid.id) === R2, 'mediaAssetId unchanged after overlay');
        assert(String(overlaid.url || '').includes(R2), 'playback url remains catalog media');

        // --- 8 Seal + normalize rehydrate ---
        let round = enrichMod.sealVaultAssetsWithEnrichment([overlaid])[0];
        assert(round.seriesIdentity?.episodeNumber === 5, 'post-seal episode stays 5');
        assert(round.seriesIdentity?.confirmedByCreator === true, 'post-seal confirmedByCreator');
        assert(round.episodeEnrichment?.title === 'The Beginning', 'post-seal package title');

        const normalized = normalizeVaultAsset({
            ...round,
            // poison filename parse path
            name: '07 AMP JAM V1',
            fileName: '07_AMP_JAM_V1.mp4',
            seriesIdentity: round.seriesIdentity,
            episodeEnrichment: round.episodeEnrichment
        });
        assert(
            normalized?.seriesIdentity?.episodeNumber === 5 &&
                normalized?.seriesIdentity?.confirmedByCreator === true,
            `normalizeVaultAsset preserves confirmed identity (got ep=${normalized?.seriesIdentity?.episodeNumber})`
        );
        assert(
            normalized?.episodeEnrichment?.title === 'The Beginning',
            'normalizeVaultAsset preserves package'
        );

        // --- 9 / 10 Re-seal and assert STILL unchanged ---
        round = enrichMod.sealVaultAssetsWithEnrichment([round])[0];
        round = infer.sealVaultSeriesIdentityForStorage(round);
        assert(round.seriesIdentity?.seriesLabel === 'STIRRED', 're-seal series STIRRED');
        assert(round.seriesIdentity?.seasonNumber === 1, 're-seal season 1');
        assert(round.seriesIdentity?.episodeNumber === 5, 're-seal episode 5');
        assert(round.seriesIdentity?.confirmedByCreator === true, 're-seal confirmedByCreator');
        assert(round.episodeEnrichment?.title === 'The Beginning', 're-seal package title');
        assert(
            round.episodeEnrichment?.description === 'Episode description',
            're-seal package description'
        );
        assert(round.episodeEnrichment?.artworkUrl === 'artwork-url', 're-seal package artwork');

        // Parser cannot overwrite confirmed identity even if build is fed catalog name
        const poison = infer.sealVaultSeriesIdentityForStorage({
            ...round,
            name: '07 AMP JAM V1',
            fileName: '07_AMP_JAM_V1.mp4',
            title: '07 AMP JAM V1'
        });
        assert(
            poison?.seriesIdentity?.episodeNumber === 5 &&
                poison?.seriesIdentity?.seriesLabel === 'STIRRED' &&
                poison?.seriesIdentity?.confirmedByCreator === true,
            'parser cannot overwrite confirmed identity on re-seal with AMP JAM title'
        );

        // Full list overlay helper used by hydrate
        const list = authority.overlayCreatorAuthorityOntoVaultList([catalogEntry], hydrated);
        assert(
            list[0]?.seriesIdentity?.episodeNumber === 5 &&
                list[0]?.episodeEnrichment?.title === 'The Beginning',
            'overlayCreatorAuthorityOntoVaultList restores identity + package'
        );

        if (failures.length) {
            console.error(
                'FAIL validate-hero-vault-production-persistence\n' +
                    failures.map((f) => `  - ${f}`).join('\n')
            );
            process.exitCode = 1;
        } else {
            console.log('PASS validate-hero-vault-production-persistence');
            for (const n of notes) console.log(`  ${n}`);
        }
    } finally {
        await server.close();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
