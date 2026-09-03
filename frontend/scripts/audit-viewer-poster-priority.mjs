#!/usr/bin/env node
/**
 * Audit viewerEpisodePoster priority — cases 1–5.
 * Compares current resolver vs pre-priority baseline (chip before explicit episode fields).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const failures = [];
function assert(cond, msg) {
    if (!cond) failures.push(msg);
    else console.log(`  ok: ${msg}`);
}

function resolveBaseline(input = {}, mod) {
    const episode = input.episode && typeof input.episode === 'object' ? input.episode : null;
    const ready = Array.isArray(input.readyVaultAssets) ? input.readyVaultAssets : [];
    const chipThumb = String(input.chipThumbnailUrl || '').trim();
    const ep = episode || {};
    const epThumb = String(
        ep.thumbnailUrl ||
            ep.thumbnail_url ||
            ep.thumbnail ||
            ep.posterUrl ||
            ep.poster ||
            ep.artworkUrl ||
            ''
    ).trim();

    if (mod.isUsableEpisodePosterUrl(chipThumb)) return mod.finalizePosterUrl(chipThumb);
    if (mod.isUsableEpisodePosterUrl(epThumb)) return mod.finalizePosterUrl(epThumb);

    const mediaId = String(ep.mediaAssetId || ep.reelId || ep.heroVaultAssetId || '').trim();
    if (!mediaId) return '';

    for (const item of ready) {
        const id = String(item?.id || item?.mediaAssetId || item?.reelId || '').trim();
        if (id !== mediaId) continue;
        const thumb = String(item?.thumbnailUrl || item?.posterUrl || item?.url || '').trim();
        if (mod.isUsableEpisodePosterUrl(thumb)) return mod.finalizePosterUrl(thumb);
    }
    return '';
}

const REEL = '11111111-1111-4111-8111-111111111111';
const POSTER = '/thumbs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg';
const AUTO = `/thumbs/${REEL}.jpg`;
const readyVault = [
    {
        id: REEL,
        mediaAssetId: REEL,
        reelId: REEL,
        url: `/videos/${REEL}.mp4`,
        thumbnailUrl: AUTO
    }
];

const server = await createServer({
    root,
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error'
});

try {
    const mod = await server.ssrLoadModule('/src/lib/series/viewerEpisodePoster.js');
    const vicG = await server.ssrLoadModule('/src/lib/series/vicGSeriesPackage.js');
    const { resolveViewerEpisodePosterUrl, repairDoublePrefixedMediaUrl } = mod;

    const finalizePosterUrl = (raw) => {
        const trimmed = repairDoublePrefixedMediaUrl(String(raw || '').trim());
        return trimmed || '';
    };
    const isUsable = (raw) => {
        const s = String(raw || '').trim();
        if (!s) return false;
        if (s.startsWith('blob:') || s.startsWith('data:')) return false;
        if (/\.(mp4|mov|webm)(\?|$)/i.test(s) && !/\/thumbs\//i.test(s)) return false;
        return true;
    };
    const baselineMod = { isUsableEpisodePosterUrl: isUsable, finalizePosterUrl };

    console.log('\n[A] CASE 1 — assigned canonical thumbnailUrl wins');
    {
        const episode = { episodeId: 'ep-test-1', reelId: REEL, thumbnailUrl: POSTER };
        const current = resolveViewerEpisodePosterUrl({
            episode,
            chipThumbnailUrl: AUTO,
            readyVaultAssets: readyVault
        });
        assert(current.includes('aaaaaaaa'), 'assigned poster URL is used');
    }

    console.log('\n[A] CASE 2 — no thumbnailUrl: baseline parity');
    {
        const episode = { episodeId: 'ep-test-2', reelId: REEL, title: 'E2' };
        const input = { episode, chipThumbnailUrl: AUTO, readyVaultAssets: readyVault };
        assert(resolveViewerEpisodePosterUrl(input) === resolveBaseline(input, baselineMod), 'baseline parity');
    }

    console.log('\n[A] CASE 3 — MP4 reel fallback without chip input');
    {
        const episode = { episodeId: 'ep-test-3', reelId: REEL, title: 'E3' };
        const input = { episode, chipThumbnailUrl: '', readyVaultAssets: readyVault };
        const current = resolveViewerEpisodePosterUrl(input);
        assert(current === resolveBaseline(input, baselineMod), 'vault pool fallback unchanged');
    }

    console.log('\n[A] CASE 4 — assigned poster beats MP4 auto-still');
    {
        const episode = { episodeId: 'ep-test-4', reelId: REEL, thumbnailUrl: POSTER };
        const current = resolveViewerEpisodePosterUrl({
            episode,
            chipThumbnailUrl: AUTO,
            readyVaultAssets: readyVault
        });
        assert(current.includes('aaaaaaaa') && !current.includes(REEL), 'editorial poster wins');
    }

    console.log('\n[A] CASE 5 — Vic G unchanged vs baseline');
    {
        const pkg = vicG.buildVicGSeriesPackage();
        for (const episode of (pkg.seasons?.[0]?.episodes || []).slice(0, 3)) {
            const input = {
                episode,
                chipThumbnailUrl: '',
                readyVaultAssets: readyVault.filter((a) => a.id === episode.reelId)
            };
            assert(
                resolveViewerEpisodePosterUrl(input) === resolveBaseline(input, baselineMod),
                `Vic G ${episode.episodeId} unchanged`
            );
        }
    }

    if (failures.length) {
        console.error('\nAUDIT FAILURES:');
        for (const msg of failures) console.error(`  ✗ ${msg}`);
        process.exit(1);
    }
    console.log('\naudit-viewer-poster-priority: PASS');
} finally {
    await server.close();
}
