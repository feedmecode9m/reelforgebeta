#!/usr/bin/env node
/**
 * Hero Vault asset intelligence — normalization + display title + keywords.
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
        normalizeVaultAsset,
        acceptVaultImageUploadResponse
    } = await vite.ssrLoadModule('/src/lib/vault/normalizeVaultAsset.js');
    const {
        resolveVaultAssetTitle,
        resolveVaultKeywords,
        cleanVaultFilename
    } = await vite.ssrLoadModule('/src/lib/vault/resolveVaultAssetTitle.js');
    const { resolveThumbnailUploadMediaUrl } = await vite.ssrLoadModule(
        '/src/lib/vault/resolveThumbnailUploadMediaUrl.js'
    );

    console.log('\nvalidate-vault-asset-normalization\n');

    // Image: thumbnailUrl only, no url
    const imageOnlyThumb = acceptVaultImageUploadResponse({
        id: 'img-1',
        thumbnailUrl: '/thumbs/poster.png',
        status: 'ready',
        type: 'image/png',
        title: 'Hero Poster'
    });
    assert('image response accepted (thumbnailUrl only)', Boolean(imageOnlyThumb));
    assert('image response id', imageOnlyThumb?.id === 'img-1');
    assert(
        'image response uses thumbnail as url surface',
        imageOnlyThumb?.url === '/thumbs/poster.png' &&
            imageOnlyThumb?.thumbnailUrl === '/thumbs/poster.png'
    );
    assert('image ready status preserved', imageOnlyThumb?.status === 'ready');

    // Image complete status
    const imageComplete = normalizeVaultAsset({
        id: 'img-2',
        thumbnailUrl: 'https://cdn.example/thumbs/a.jpg',
        status: 'complete'
    });
    assert('status complete → ready/accepted', Boolean(imageComplete) && imageComplete.status === 'ready');

    // Video unchanged shape
    const video = normalizeVaultAsset({
        id: 'vid-1',
        title: 'STIRRED FINAL CUT',
        name: 'STIRRED FINAL CUT',
        url: '/videos/vid-1.mp4',
        thumbnailUrl: '/thumbs/vid-1.jpg',
        status: 'ready',
        type: 'video/mp4',
        category: 'Trending'
    });
    assert('video response accepted', Boolean(video));
    assert('video id unchanged', video?.id === 'vid-1' && video?.assetId === 'vid-1');
    assert('video url unchanged', video?.url === '/videos/vid-1.mp4');
    assert('video thumbnailUrl preserved', video?.thumbnailUrl === '/thumbs/vid-1.jpg');
    assert('video ready status preserved', video?.status === 'ready');
    assert('video type is video', video?.type === 'video');
    assert('video title preserved', video?.title === 'STIRRED FINAL CUT');
    assert('video displayTitle preserved', video?.displayTitle === 'STIRRED FINAL CUT');

    // UUID filename cleaned
    const uuidName = resolveVaultAssetTitle({
        id: '94e28916-619a-4356-88e7-90d1c71cac2d',
        fileName: '94E28916-619A-4356-88E7-90D1C71CAC2D.PNG',
        type: 'image/png',
        thumbnailUrl: '/thumbs/94E28916-619A-4356-88E7-90D1C71CAC2D.PNG'
    });
    assert('UUID filename cleaned → Untitled Image', uuidName === 'Untitled Image');

    assert(
        'STIRRED_FINAL_CUT.mp4 cleans to STIRRED FINAL CUT',
        cleanVaultFilename('STIRRED_FINAL_CUT.mp4') === 'STIRRED FINAL CUT'
    );
    assert(
        'title STIRRED_FINAL_CUT.mp4 → STIRRED FINAL CUT',
        resolveVaultAssetTitle({
            id: 'x',
            title: 'STIRRED_FINAL_CUT.mp4',
            type: 'video/mp4',
            url: '/videos/x.mp4'
        }) === 'STIRRED FINAL CUT'
    );

    // Title preserved over UUID filename
    const titled = resolveVaultAssetTitle({
        id: 'y',
        title: 'Mall Walk',
        fileName: '94E28916-619A-4356-88E7-90D1C71CAC2D.PNG',
        type: 'image/png',
        thumbnailUrl: '/thumbs/x.png'
    });
    assert('title preserved over UUID filename', titled === 'Mall Walk');

    // Keywords
    const kws = resolveVaultKeywords({
        id: 'z',
        title: 'STIRRED FINAL CUT',
        url: '/videos/z.mp4',
        type: 'video/mp4'
    });
    assert(
        'keywords for STIRRED FINAL CUT',
        Array.isArray(kws) &&
            kws.includes('stirred') &&
            kws.includes('final') &&
            kws.includes('cut') &&
            kws.length === 3
    );

    // Pending rejected
    const pending = normalizeVaultAsset({
        id: 'p1',
        url: '/videos/p1.mp4',
        status: 'pending',
        type: 'video/mp4'
    });
    assert('pending rejected', pending === null);

    const pendingImg = acceptVaultImageUploadResponse({
        id: 'p2',
        thumbnailUrl: '/thumbs/p2.png',
        status: 'pending'
    });
    assert('pending image upload rejected', pendingImg === null);

    // Missing id rejected
    assert(
        'missing id rejected',
        normalizeVaultAsset({ thumbnailUrl: '/thumbs/x.png', status: 'ready' }) === null
    );

    // Image missing both urls rejected
    assert(
        'image without url/thumbnailUrl rejected',
        normalizeVaultAsset({ id: 'x', status: 'ready', type: 'image/png' }) === null
    );

    // Absolute Netlify thumbnail URL acceptance (post-normalizer path resolve)
    const netlifyPayload = {
        id: 'aa032c74-279f-4bb9-b5b2-747e06cf5c4e',
        type: 'image',
        url: 'https://strong-lolly-a9fcb4.netlify.app/thumbs/aa032c74.png',
        thumbnailUrl: 'https://strong-lolly-a9fcb4.netlify.app/thumbs/aa032c74.png',
        status: 'ready'
    };
    const netlifyNormalized = acceptVaultImageUploadResponse(netlifyPayload);
    assert('absolute Netlify payload normalizes', Boolean(netlifyNormalized));
    const netlifyThumb = resolveThumbnailUploadMediaUrl({
        normalized: netlifyNormalized,
        response: netlifyPayload
    });
    assert(
        'absolute Netlify thumbnail URL acceptance',
        netlifyThumb === 'https://strong-lolly-a9fcb4.netlify.app/thumbs/aa032c74.png'
    );
    assert(
        'relative /thumbs path accepted',
        resolveThumbnailUploadMediaUrl({
            normalized: { thumbnailUrl: '/thumbs/file.png', url: '/thumbs/file.png' },
            response: {}
        }) === '/thumbs/file.png'
    );
    assert(
        'blob: thumbnail rejected',
        resolveThumbnailUploadMediaUrl({
            normalized: { thumbnailUrl: 'blob:http://localhost/abc', url: 'blob:http://localhost/abc' },
            response: { thumbnailUrl: 'blob:http://localhost/abc' }
        }) === ''
    );
    assert(
        'empty thumbnail rejected',
        resolveThumbnailUploadMediaUrl({ normalized: {}, response: {} }) === ''
    );

    if (failed) {
        console.error(`\nFAIL validate-vault-asset-normalization (${failed} assertion(s))\n`);
        process.exitCode = 1;
    } else {
        console.log('\nPASS validate-vault-asset-normalization\n');
    }
} finally {
    await vite.close();
}
