#!/usr/bin/env node
/**
 * Vault thumbnail production path:
 * API row → normalizeReel → reelToVaultEntry → persist/overlay → resolveVaultCardFace
 *
 * Does not exercise playback, CDN upload, or catalog identity merge.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

let failed = 0;
function assert(label, cond) {
    if (cond) {
        console.log(`  ✓ ${label}`);
        return;
    }
    failed += 1;
    console.error(`  ✗ ${label}`);
}

function persistLikeProduction(list, minimalFields) {
    return (Array.isArray(list) ? list : []).map((item) => {
        const kept = {};
        for (const field of minimalFields) {
            if (item?.[field] !== undefined) kept[field] = item[field];
        }
        for (const field of [
            'url',
            'mediaUrl',
            'videoUrl',
            'thumbnailUrl',
            'posterUrl',
            'previewUrl',
            'localPreviewUrl'
        ]) {
            const value = item?.[field];
            if (typeof value !== 'string') continue;
            if (value.startsWith('data:') || value.startsWith('blob:')) {
                delete kept[field];
                continue;
            }
            if (value) kept[field] = value;
        }
        return kept;
    });
}

function assertImgSrcNotMp4(label, face) {
    const src = String(face?.src || '');
    const usedAsImage = face?.render === 'image';
    assert(
        `${label}: img src is not .mp4`,
        !usedAsImage || !/\.mp4(\?|$)/i.test(src)
    );
    if (usedAsImage && /\.mp4(\?|$)/i.test(src)) {
        failed += 0;
    }
}

const vite = await createServer({
    root,
    logLevel: 'error',
    server: { middlewareMode: true },
    appType: 'custom'
});

try {
    const { resolveVaultCardFace } = await vite.ssrLoadModule(
        '/src/lib/vault/normalizeVaultAsset.js'
    );
    const {
        overlayLocalCreatorVaultAuthority,
        PERSONAL_VIDEO_VAULT_MINIMAL_FIELDS,
        pickDurableVaultStillUrl
    } = await vite.ssrLoadModule('/src/lib/vault/vaultCreatorAuthority.js');
    const { normalizeReel, reelToVaultEntry } = await vite.ssrLoadModule(
        '/src/lib/api/reelContract.js'
    );

    console.log('\nvalidate-vault-thumbnail-production-path\n');

    assert(
        'persist contract includes thumbnailUrl + posterUrl',
        PERSONAL_VIDEO_VAULT_MINIMAL_FIELDS.includes('thumbnailUrl') &&
            PERSONAL_VIDEO_VAULT_MINIMAL_FIELDS.includes('posterUrl')
    );
    assert(
        'persist contract includes previewUrl',
        PERSONAL_VIDEO_VAULT_MINIMAL_FIELDS.includes('previewUrl')
    );

    // A. local uploaded MP4 + blob preview → visible immediately
    const pending = {
        id: 'local-upload-1',
        type: 'video/mp4',
        url: '',
        mediaUrl: '',
        videoUrl: '',
        previewUrl: 'blob:http://127.0.0.1:5173/preview-a',
        localPreviewUrl: 'blob:http://127.0.0.1:5173/preview-a',
        thumbnailUrl: 'blob:http://127.0.0.1:5173/preview-a',
        status: 'uploading'
    };
    const faceA = resolveVaultCardFace(pending);
    assert(
        'A local MP4 + blob preview visible immediately',
        faceA.src.startsWith('blob:') && faceA.render === 'local-preview'
    );
    assertImgSrcNotMp4('A', faceA);
    const persistedPending = persistLikeProduction(
        [pending],
        PERSONAL_VIDEO_VAULT_MINIMAL_FIELDS
    )[0];
    assert(
        'A blob URLs are not persisted',
        !String(persistedPending.previewUrl || '').startsWith('blob:') &&
            !String(persistedPending.thumbnailUrl || '').startsWith('blob:') &&
            !String(persistedPending.localPreviewUrl || '').startsWith('blob:')
    );

    // B. refresh local storage → durable thumbnail remains
    const completedLocal = {
        id: 'local-done-1',
        assetId: 'local-done-1',
        type: 'video/mp4',
        url: '/videos/local-done-1.mp4',
        mediaUrl: '/videos/local-done-1.mp4',
        videoUrl: '/videos/local-done-1.mp4',
        thumbnailUrl: '/thumbs/local-done-1.jpg',
        posterUrl: '/thumbs/local-done-1.jpg',
        thumbnail: '/thumbs/local-done-1.jpg',
        previewUrl: 'blob:http://127.0.0.1:5173/should-strip',
        status: 'ready'
    };
    const storedB = persistLikeProduction(
        [completedLocal],
        PERSONAL_VIDEO_VAULT_MINIMAL_FIELDS
    )[0];
    assert(
        'B refresh storage keeps durable thumbnail',
        storedB.thumbnailUrl === '/thumbs/local-done-1.jpg' &&
            storedB.posterUrl === '/thumbs/local-done-1.jpg'
    );
    assert(
        'B refresh storage strips blob preview',
        !storedB.previewUrl
    );
    const faceBMemory = resolveVaultCardFace(completedLocal);
    assert(
        'B in-memory blob preview does not hide durable still',
        faceBMemory.render === 'image' && faceBMemory.src.includes('local-done-1.jpg')
    );
    const faceB = resolveVaultCardFace(storedB);
    assert(
        'B stored row renders durable still',
        faceB.render === 'image' && faceB.src.includes('local-done-1.jpg')
    );
    assertImgSrcNotMp4('B', faceB);

    // C. production API row with thumbnail_url
    const apiRow = {
        id: 'prod-c',
        name: 'Movie',
        type: 'video',
        url: 'https://cdn.example/videos/movie.mp4',
        thumbnail_url: 'https://cdn.example/thumbs/poster.jpg',
        status: 'ready',
        createdAt: '2026-08-15T00:00:00.000Z'
    };
    const normalizedC = normalizeReel(apiRow, 'GET /api/reels');
    assert(
        'C normalizeReel maps thumbnail_url → thumbnailUrl',
        String(normalizedC?.thumbnailUrl || '').includes('poster.jpg')
    );
    const vaultC = reelToVaultEntry(normalizedC);
    assert(
        'C reelToVaultEntry stamps thumbnailUrl + posterUrl',
        String(vaultC.thumbnailUrl).includes('poster.jpg') &&
            String(vaultC.posterUrl).includes('poster.jpg') &&
            String(vaultC.thumbnail).includes('poster.jpg')
    );
    const overlaidC = overlayLocalCreatorVaultAuthority(vaultC, {
        id: 'prod-c',
        seriesIdentity: { seriesLabel: 'STIRRED', seasonNumber: 1, episodeNumber: 1 }
    });
    const faceC = resolveVaultCardFace(overlaidC);
    assert(
        'C production API row renders poster.jpg',
        faceC.render === 'image' && faceC.src.includes('poster.jpg')
    );
    assertImgSrcNotMp4('C', faceC);
    assert(
        'C pickDurableVaultStillUrl reads snake_case thumbnail_url',
        pickDurableVaultStillUrl(apiRow).includes('poster.jpg')
    );

    // camelCase production contract (backend serde rename_all = camelCase)
    const apiCamel = {
        id: 'prod-camel',
        name: 'Movie 2',
        type: 'video',
        url: 'https://cdn.example/videos/movie2.mp4',
        thumbnailUrl: 'https://cdn.example/thumbs/poster2.jpg',
        status: 'ready',
        createdAt: '2026-08-15T00:00:00.000Z'
    };
    const vaultCamel = reelToVaultEntry(normalizeReel(apiCamel, 'GET /api/reels'));
    const faceCamel = resolveVaultCardFace(vaultCamel);
    assert(
        'C camelCase thumbnailUrl from /api/reels renders still',
        faceCamel.render === 'image' && faceCamel.src.includes('poster2.jpg')
    );
    assertImgSrcNotMp4('C-camel', faceCamel);

    // D. production MP4 without poster
    const apiBare = {
        id: 'prod-d',
        name: 'Bare',
        type: 'video',
        url: 'https://cdn.example/videos/bare.mp4',
        status: 'ready',
        createdAt: '2026-08-15T00:00:00.000Z'
    };
    const vaultD = reelToVaultEntry(normalizeReel(apiBare, 'GET /api/reels'));
    const faceD = resolveVaultCardFace(vaultD);
    assert(
        'D production MP4 without poster: empty face',
        faceD.render === 'empty' && faceD.src === ''
    );
    assertImgSrcNotMp4('D', faceD);
    assert(
        'D vault still fields are not the mp4',
        !String(vaultD.thumbnailUrl || '').includes('.mp4') &&
            !String(vaultD.posterUrl || '').includes('.mp4') &&
            !String(vaultD.thumbnail || '').includes('.mp4')
    );

    const poisoned = resolveVaultCardFace({
        id: 'poison',
        type: 'video/mp4',
        url: 'https://cdn.example/videos/poison.mp4',
        thumbnailUrl: 'https://cdn.example/videos/poison.mp4',
        posterUrl: 'https://cdn.example/videos/poison.mp4'
    });
    assert(
        'FAIL gate: mp4 never used as image src',
        poisoned.render !== 'image' && !/\.mp4(\?|$)/i.test(poisoned.src)
    );

    if (failed) {
        console.error(`\nFAIL validate-vault-thumbnail-production-path (${failed} assertion(s))\n`);
        process.exitCode = 1;
    } else {
        console.log('\nPASS validate-vault-thumbnail-production-path\n');
    }
} finally {
    await vite.close();
}
