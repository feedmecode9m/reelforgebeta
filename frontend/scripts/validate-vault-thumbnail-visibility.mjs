#!/usr/bin/env node
/**
 * Vault card thumbnail visibility — local blob preview vs production stills.
 * Does not exercise playback / CDN / catalog identity merge.
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

const vite = await createServer({
    root,
    logLevel: 'error',
    server: { middlewareMode: true },
    appType: 'custom'
});

try {
    const {
        resolveVaultCardFace,
        resolveVaultCardThumbnailUrl,
        isVaultVideoMediaUrl,
        normalizeVaultAsset
    } = await vite.ssrLoadModule('/src/lib/vault/normalizeVaultAsset.js');
    const {
        overlayLocalCreatorVaultAuthority,
        PERSONAL_VIDEO_VAULT_MINIMAL_FIELDS
    } = await vite.ssrLoadModule('/src/lib/vault/vaultCreatorAuthority.js');
    const { normalizeHeroAssetRecord } = await vite.ssrLoadModule(
        '/src/lib/hero/heroAssetBridge.js'
    );
    const { createVaultUtils, durableImageVaultUrl } = await vite.ssrLoadModule(
        '/src/lib/viewer/vaultUtils.js'
    );
    const { writable } = await vite.ssrLoadModule('svelte/store');
    const { resolveMediaUrl } = await vite.ssrLoadModule('/src/lib/api/reelContract.js');
    const { rewriteDevLoopbackMediaToSameOrigin } = await vite.ssrLoadModule(
        '/src/lib/config.js'
    );

    console.log('\nvalidate-vault-thumbnail-visibility\n');

    const surviveFields = [
        'id',
        'assetId',
        'url',
        'mediaUrl',
        'videoUrl',
        'thumbnailUrl',
        'posterUrl',
        'previewUrl',
        'localPreviewUrl',
        'status'
    ];
    for (const field of surviveFields) {
        assert(
            `minimalFields includes ${field}`,
            field === 'id' || PERSONAL_VIDEO_VAULT_MINIMAL_FIELDS.includes(field)
        );
    }

    // 1. Local MP4 dropped into Vault — blob visible before upload completes
    const pending = {
        id: 'local-pending-1',
        type: 'video/mp4',
        url: '',
        previewUrl: 'blob:http://127.0.0.1:5173/pending-preview',
        localPreviewUrl: 'blob:http://127.0.0.1:5173/pending-preview',
        thumbnailUrl: 'blob:http://127.0.0.1:5173/pending-preview',
        status: 'uploading',
        uploadState: 'uploading'
    };
    const pendingFace = resolveVaultCardFace(pending);
    assert(
        '1 local MP4 pending: thumbnail visible before upload completes',
        pendingFace.src.startsWith('blob:') && pendingFace.render === 'local-preview'
    );
    const shadowed = {
        id: 'local-ready-shadow',
        type: 'video/mp4',
        url: 'http://localhost:8080/videos/local-ready-shadow.mp4',
        localPreviewUrl: 'blob:http://127.0.0.1:5173/stale-preview',
        previewUrl: 'blob:http://127.0.0.1:5173/stale-preview',
        thumbnailUrl: 'http://localhost:8080/thumbs/local-ready-shadow.jpg',
        thumbnail: 'http://localhost:8080/thumbs/local-ready-shadow.jpg',
        posterUrl: 'http://localhost:8080/thumbs/local-ready-shadow.jpg'
    };
    const shadowedFace = resolveVaultCardFace(shadowed);
    assert(
        '1b durable still wins over leftover blob localPreviewUrl',
        shadowedFace.render === 'image' &&
            shadowedFace.src === 'http://localhost:8080/thumbs/local-ready-shadow.jpg'
    );
    assert(
        '1b img src is not blob or mp4',
        !shadowedFace.src.startsWith('blob:') && !isVaultVideoMediaUrl(shadowedFace.src)
    );
    assert(
        '1 pending does not use empty playback url as image',
        pendingFace.render !== 'image' || !isVaultVideoMediaUrl(pendingFace.src)
    );
    const pendingNorm = normalizeVaultAsset(pending, { requireReady: false });
    assert('1 pending normalize keeps video kind', pendingNorm?.type === 'video');
    assert(
        '1 pending normalize keeps blob thumbnailUrl',
        String(pendingNorm?.thumbnailUrl || '').startsWith('blob:')
    );
    assert(
        '1 pending status uploading',
        pendingNorm?.status === 'uploading' && pendingNorm?.previewUrl.startsWith('blob:')
    );

    // 2. Production MP4 with thumbnailUrl
    const prodThumb = {
        id: 'prod-1',
        assetId: 'prod-1',
        type: 'video/mp4',
        mediaUrl: 'https://cdn.example/videos/prod-1.mp4',
        videoUrl: 'https://cdn.example/videos/prod-1.mp4',
        url: 'https://cdn.example/videos/prod-1.mp4',
        thumbnailUrl: 'https://cdn.example/thumbs/prod-1.jpg',
        posterUrl: 'https://cdn.example/thumbs/prod-1.jpg',
        status: 'ready'
    };
    const prodFace = resolveVaultCardFace(prodThumb);
    assert(
        '2 production MP4 with thumbnailUrl: image face',
        prodFace.render === 'image' && prodFace.src.includes('/thumbs/prod-1.jpg')
    );
    const prodNorm = normalizeVaultAsset(prodThumb);
    assert(
        '2 normalize does not copy mp4 onto thumbnailUrl',
        prodNorm?.thumbnailUrl === 'https://cdn.example/thumbs/prod-1.jpg' &&
            prodNorm?.url.endsWith('.mp4')
    );
    const heroRec = normalizeHeroAssetRecord(prodThumb);
    assert(
        '2 heroAssetBridge thumbnail is still not playback url',
        heroRec?.thumbnailUrl.includes('/thumbs/prod-1.jpg') &&
            !heroRec?.thumbnailUrl.endsWith('.mp4')
    );

    // 3. Production MP4 without thumbnail — empty still, never MP4 as image
    const prodBare = {
        id: 'prod-bare',
        type: 'video/mp4',
        url: 'https://cdn.example/videos/bare.mp4',
        mediaUrl: 'https://cdn.example/videos/bare.mp4',
        videoUrl: 'https://cdn.example/videos/bare.mp4',
        status: 'ready'
    };
    const bareFace = resolveVaultCardFace(prodBare);
    assert(
        '3 production MP4 without thumbnail: empty face (no broken image)',
        bareFace.render === 'empty' && bareFace.src === ''
    );
    const bareNorm = normalizeVaultAsset(prodBare);
    assert(
        '3 normalize thumbnailUrl is not the mp4',
        Boolean(bareNorm) &&
            bareNorm.thumbnailUrl === '' &&
            !isVaultVideoMediaUrl(bareNorm.thumbnailUrl)
    );
    const heroBare = normalizeHeroAssetRecord({
        ...prodBare,
        thumbnailUrl: prodBare.url
    });
    assert(
        '3 heroAssetBridge rejects video url as thumbnail',
        heroBare?.thumbnailUrl === ''
    );
    assert(
        '3 resolver never treats mp4 as thumbnail image',
        resolveVaultCardThumbnailUrl({
            ...prodBare,
            thumbnailUrl: prodBare.url,
            posterUrl: prodBare.url
        }) === ''
    );

    // 4. Two MP4s sharing poster — two cards, independent thumbs
    const sharedPoster = 'https://cdn.example/thumbs/shared.jpg';
    const a = {
        id: 'vid-a',
        url: 'https://cdn.example/videos/a.mp4',
        thumbnailUrl: sharedPoster,
        posterUrl: sharedPoster,
        type: 'video/mp4'
    };
    const b = {
        id: 'vid-b',
        url: 'https://cdn.example/videos/b.mp4',
        thumbnailUrl: sharedPoster,
        posterUrl: sharedPoster,
        type: 'video/mp4'
    };
    const faceA = resolveVaultCardFace(a);
    const faceB = resolveVaultCardFace(b);
    assert('4 two vault cards (distinct ids)', a.id !== b.id);
    assert(
        '4 thumbnails independent (same poster url, per-card face)',
        faceA.src === sharedPoster &&
            faceB.src === sharedPoster &&
            faceA.render === 'image' &&
            faceB.render === 'image'
    );

    const catalogMissingThumb = {
        id: 'prod-1',
        url: 'https://cdn.example/videos/prod-1.mp4',
        mediaUrl: 'https://cdn.example/videos/prod-1.mp4'
    };
    const overlaid = overlayLocalCreatorVaultAuthority(catalogMissingThumb, prodThumb);
    assert(
        'merge overlay preserves local thumbnailUrl when catalog omitted it',
        overlaid?.thumbnailUrl === prodThumb.thumbnailUrl &&
            overlaid?.posterUrl === prodThumb.posterUrl
    );

    const localNoUrl = {
        id: 'local-still-only',
        type: 'video/mp4',
        url: '',
        mediaUrl: '',
        thumbnailUrl: 'http://localhost:8080/thumbs/local-still-only.jpg',
        posterUrl: 'http://localhost:8080/thumbs/local-still-only.jpg',
        thumbnail: 'http://localhost:8080/thumbs/local-still-only.jpg'
    };
    const localNoUrlFace = resolveVaultCardFace(localNoUrl);
    assert(
        'local vault row with jpg and empty playback url still renders image',
        localNoUrlFace.render === 'image' &&
            localNoUrlFace.src === 'http://localhost:8080/thumbs/local-still-only.jpg'
    );

    const thumbs = writable([
        {
            id: 'vid-bind-1',
            personal_video_id: 'vid-bind-1',
            url: 'http://localhost:8080/thumbs/vid-bind-1.jpg',
            type: 'image/jpeg'
        }
    ]);
    const { getVaultVideoReel, getVaultImageReel } = createVaultUtils({
        CONFIG: { THUMBNAIL_STORAGE_KEY: 'personal_thumbnails' },
        personalThumbnailCollection: thumbs,
        getFallbackImage: () => ''
    });
    const boundReel = getVaultVideoReel({
        id: 'vid-bind-1',
        name: 'Bound',
        type: 'video/mp4',
        url: 'http://localhost:8080/videos/vid-bind-1.mp4'
    });
    assert(
        'thumbnail vault JPEG binds onto video card reel',
        boundReel.thumbnailUrl === 'http://localhost:8080/thumbs/vid-bind-1.jpg'
    );
    const boundFace = resolveVaultCardFace({
        id: 'vid-bind-1',
        type: 'video/mp4',
        url: boundReel.url,
        ...boundReel
    });
    assert(
        'bound thumbnail vault still renders as image, not mp4',
        boundFace.render === 'image' &&
            boundFace.src.endsWith('vid-bind-1.jpg') &&
            !isVaultVideoMediaUrl(boundFace.src)
    );

    const mediaUrlOnly = getVaultVideoReel({
        id: 'vid-mediaurl-1',
        name: 'MediaUrl',
        type: 'video/mp4',
        url: '',
        mediaUrl: 'http://localhost:8080/videos/vid-mediaurl-1.mp4',
        thumbnailUrl: 'http://localhost:8080/thumbs/vid-mediaurl-1.jpg'
    });
    assert(
        'getVaultVideoReel recovers playback url from mediaUrl',
        mediaUrlOnly.url === 'http://localhost:8080/videos/vid-mediaurl-1.mp4'
    );
    assert(
        'getVaultVideoReel keeps jpg still when url was empty',
        mediaUrlOnly.thumbnailUrl === 'http://localhost:8080/thumbs/vid-mediaurl-1.jpg'
    );

    const droppedJpeg = getVaultImageReel(
        {
            id: 'thumb-0121',
            fileName: 'IMG_0121.JPEG',
            name: 'IMG_0121.JPEG',
            type: 'image/jpeg',
            url: 'http://localhost:8080/thumbs/thumb-0121.jpg'
        },
        0
    );
    assert(
        'Your Thumbnails keeps durable /thumbs uuid url instead of original filename',
        droppedJpeg.url === 'http://localhost:8080/thumbs/thumb-0121.jpg' &&
            droppedJpeg.type === 'image'
    );
    const droppedFace = resolveVaultCardFace({
        type: 'image',
        url: droppedJpeg.url,
        thumbnailUrl: droppedJpeg.thumbnailUrl || droppedJpeg.url
    });
    assert(
        'Your Thumbnails card face is image JPEG not placeholder',
        droppedFace.render === 'image' &&
            droppedFace.src === 'http://localhost:8080/thumbs/thumb-0121.jpg' &&
            !isVaultVideoMediaUrl(droppedFace.src)
    );

    const staleCameraUrl = getVaultImageReel(
        {
            id: '9d043773-3f19-4ee4-adbd-df3c2979dd64',
            fileName: 'IMG_0121.JPEG',
            name: 'IMG_0121.JPEG',
            type: 'image/jpeg',
            url: '/thumbs/IMG_0121.JPEG',
            vaultState: 'ORPHANED',
            orphaned: true
        },
        0
    );
    assert(
        'after refresh, camera-roll /thumbs/IMG_*.JPEG maps to /thumbs/{id}.jpg',
        staleCameraUrl.url === '/thumbs/9d043773-3f19-4ee4-adbd-df3c2979dd64.jpg' &&
            staleCameraUrl.orphaned !== true &&
            staleCameraUrl.missing !== true
    );

    const mem = {};
    globalThis.window = globalThis;
    globalThis.localStorage = {
        getItem: (k) => (k in mem ? mem[k] : null),
        setItem: (k, v) => {
            mem[k] = String(v);
        },
        removeItem: (k) => {
            delete mem[k];
        }
    };
    mem.personal_thumbnails = JSON.stringify([
        {
            id: '9d043773-3f19-4ee4-adbd-df3c2979dd64',
            fileName: 'uuid-on-disk.jpg',
            name: 'IMG_0121.JPEG',
            url: '/thumbs/IMG_0121.JPEG',
            type: 'image/jpeg'
        }
    ]);
    const fromCollectionKey = getVaultImageReel('IMG_0121.JPEG', 0);
    assert(
        'collection key IMG_0121.JPEG resolves stored id still, not camera-roll path',
        fromCollectionKey.url === '/thumbs/9d043773-3f19-4ee4-adbd-df3c2979dd64.jpg'
    );

    assert(
        'durableImageVaultUrl maps camera-roll still to /thumbs/{id}.jpg for trending posters',
        durableImageVaultUrl(
            {
                id: '9d043773-3f19-4ee4-adbd-df3c2979dd64',
                fileName: 'IMG_0121.JPEG',
                url: '/thumbs/IMG_0121.JPEG'
            },
            null
        ) === '/thumbs/9d043773-3f19-4ee4-adbd-df3c2979dd64.jpg'
    );

    assert(
        'dev loopback thumb URL becomes same-origin /thumbs path',
        rewriteDevLoopbackMediaToSameOrigin(
            'http://localhost:8080/thumbs/9d043773-3f19-4ee4-adbd-df3c2979dd64.jpg'
        ) === '/thumbs/9d043773-3f19-4ee4-adbd-df3c2979dd64.jpg'
    );
    assert(
        'dev loopback video URL becomes same-origin /videos path',
        resolveMediaUrl(
            'http://localhost:8080/videos/b6b00e23-34a3-438b-8035-0d584e011508.mp4',
            'video'
        ) === '/videos/b6b00e23-34a3-438b-8035-0d584e011508.mp4'
    );
    assert(
        'CDN media host is not rewritten to a relative path',
        resolveMediaUrl('https://cdn.example/thumbs/poster.jpg', 'thumbnail') ===
            'https://cdn.example/thumbs/poster.jpg'
    );

    if (failed) {
        console.error(`\nFAIL validate-vault-thumbnail-visibility (${failed} assertion(s))\n`);
        process.exitCode = 1;
    } else {
        console.log('\nPASS validate-vault-thumbnail-visibility\n');
    }
} finally {
    await vite.close();
}
