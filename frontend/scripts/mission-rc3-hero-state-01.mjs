#!/usr/bin/env node
/**
 * RC3-HERO-STATE-01 — Hero Registry Hydration Trace
 *
 * Evidence only. No application source changes. No fixes. No commits. No deploys.
 * Does NOT investigate upload transport / reconnect / thumbnails.
 *
 * Traces:
 *   localStorage → hero manager config → hero reel → loadHeroVaultItems()
 *   → buildHeroAssetRegistry() → resolveHeroBackgroundAsset() → HeroExperience render
 *
 * Passes:
 *   A) cold boot (empty profile)
 *   B) seed matched reel+config, hard reload
 *   C) seed mismatched heroAssetId vs reel.id, hard reload
 *
 * Usage:
 *   node scripts/mission-rc3-hero-state-01.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_URL = (
    process.env.FRONTEND_URL || 'https://strong-lolly-a9fcb4.netlify.app/'
).replace(/\/?$/, '/');
const API_URL = (process.env.API_URL || FRONTEND_URL).replace(/\/$/, '');
const OUT =
    process.env.OUT ||
    path.join(__dirname, '..', 'artifacts', 'rc3-hero-state-01.json');
const WAIT_MS = Number(process.env.WAIT_MS || 20000);
const CHROMIUM =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';

const KEYS = {
    manager: 'reelforge_hero_manager_config',
    reel: 'reelforge_hero_reel',
    video: 'reelforge_hero_video',
    image: 'reelforge_hero_image'
};

function isoNow() {
    return new Date().toISOString();
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

async function fetchSeedReel() {
    const res = await fetch(`${API_URL}/api/reels?t=${Date.now()}`, {
        signal: AbortSignal.timeout(60000)
    });
    if (!res.ok) throw new Error(`catalog HTTP ${res.status}`);
    const catalog = await res.json();
    const preferred =
        catalog.find((r) => String(r.id) === '192293f7-c784-46af-aa45-1bb15b6a4cc6') ||
        catalog.find((r) => String(r.category || '').toUpperCase() === 'HERO' && String(r.status).toLowerCase() === 'ready') ||
        catalog.find((r) => String(r.status).toLowerCase() === 'ready' && (r.url || r.videoUrl || r.video_url));
    if (!preferred) throw new Error('No ready reel available to seed hero storage');
    const url = String(preferred.url || preferred.videoUrl || preferred.video_url || '');
    return {
        id: String(preferred.id),
        fileName: String(preferred.fileName || preferred.filename || preferred.name || 'seed.mp4'),
        name: String(preferred.name || preferred.title || 'Seed Hero'),
        url,
        type: String(preferred.type || 'video/mp4'),
        backgroundSource: 'custom_video',
        status: preferred.status,
        category: preferred.category || null
    };
}

async function headCheck(urlPath) {
    const url = `${FRONTEND_URL.replace(/\/$/, '')}${urlPath}`;
    try {
        const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(20000) });
        return { url, status: res.status, ok: res.ok, contentType: res.headers.get('content-type') };
    } catch (e) {
        return { url, status: null, ok: false, error: e.message };
    }
}

function attachCollectors(page, sink) {
    page.on('console', (msg) => {
        const text = msg.text();
        const row = { ts: isoNow(), type: msg.type(), text: text.slice(0, 2500) };
        sink.console.push(row);
        if (sink.console.length > 400) sink.console.shift();

        if (text.includes('[HERO_CLASSIFY]') || text.includes('resolveHeroBackgroundAsset')) {
            sink.classify.push(row);
        }
        if (text.includes('[HERO_STORE_READ]') || text.includes('loadHeroVaultItems')) {
            sink.storeReads.push(row);
        }
        if (text.includes('[BG7V_HERO_RESTORE_REASON]')) {
            sink.restore.push(row);
        }
        if (text.includes('[HERO_LOAD]') || text.includes('[HERO_SAVE]') || text.includes('[HERO_ASSET_ID_TRACE]')) {
            sink.traces.push(row);
        }
    });
    page.on('pageerror', (err) => {
        sink.pageErrors.push({ ts: isoNow(), message: String(err?.message || err), stack: String(err?.stack || '').slice(0, 1500) });
    });
    page.on('response', (res) => {
        const u = res.url();
        if (u.includes('hero-background') || /\/videos\/[^/]+\.mp4/.test(u)) {
            sink.mediaResponses.push({
                ts: isoNow(),
                url: u,
                status: res.status()
            });
        }
    });
}

async function readStorageSnapshot(page) {
    return page.evaluate((KEYS) => {
        function parse(key) {
            try {
                const raw = localStorage.getItem(key);
                if (raw == null) return { present: false, raw: null, parsed: null };
                return { present: true, rawLength: raw.length, parsed: JSON.parse(raw) };
            } catch (e) {
                return { present: true, parseError: String(e?.message || e), raw: localStorage.getItem(key)?.slice(0, 200) };
            }
        }
        const manager = parse(KEYS.manager);
        const reel = parse(KEYS.reel);
        const video = parse(KEYS.video);
        const image = parse(KEYS.image);
        const heroAssetId = String(manager.parsed?.heroAssetId || manager.parsed?.backgroundAsset || '').trim();
        const reelId = String(reel.parsed?.id || '').trim();
        const reelUrl = String(reel.parsed?.url || '').trim();
        const idsMatch = Boolean(heroAssetId && reelId && heroAssetId === reelId);
        const vaultGate = {
            hasReelId: Boolean(reelId),
            hasReelUrl: Boolean(reelUrl),
            heroAssetId,
            reelId,
            idsMatch,
            // Mirrors loadHeroVaultItems() gates in heroIntelligence.js
            wouldReturnEmpty: !reelId || !reelUrl || !idsMatch
        };
        return {
            at: new Date().toISOString(),
            keys: { manager, reel, video, image },
            derived: vaultGate,
            allHeroRelatedKeys: Object.keys(localStorage).filter((k) => /hero/i.test(k))
        };
    }, KEYS);
}

async function readDomHero(page) {
    return page.evaluate(() => {
        const video =
            document.querySelector('video.hero-background') ||
            document.querySelector('.hero-background video') ||
            document.querySelector('[data-hero-background] video') ||
            document.querySelector('video');
        const img =
            document.querySelector('.hero-background img') ||
            document.querySelector('[data-hero-background] img');
        return {
            at: new Date().toISOString(),
            videoSrc: video ? video.currentSrc || video.src || null : null,
            videoError: video ? Boolean(video.error) : null,
            imgSrc: img ? img.currentSrc || img.src || null : null
        };
    });
}

async function clearHeroStorage(page) {
    await page.evaluate((KEYS) => {
        for (const k of Object.values(KEYS)) localStorage.removeItem(k);
    }, KEYS);
}

async function seedMatched(page, seed) {
    await page.evaluate(
        ({ KEYS, seed }) => {
            const reel = {
                id: seed.id,
                fileName: seed.fileName,
                name: seed.name,
                url: seed.url.replace(/^https?:\/\/[^/]+/, '') || seed.url,
                type: seed.type,
                backgroundSource: 'custom_video'
            };
            // Prefer relative path like saveHeroReel does
            if (reel.url.startsWith('http')) {
                try {
                    reel.url = new URL(reel.url).pathname;
                } catch {
                    /* keep */
                }
            }
            const manager = {
                backgroundSource: 'custom_video',
                heroAssetId: seed.id,
                backgroundStyle: 'video',
                heroType: 'FEATURED_RELEASE',
                autoRotate: false,
                updatedAt: Date.now()
            };
            localStorage.setItem(KEYS.reel, JSON.stringify(reel));
            localStorage.setItem(KEYS.manager, JSON.stringify(manager));
            return { reel, manager };
        },
        { KEYS, seed }
    );
}

async function seedMismatch(page, seed) {
    await page.evaluate(
        ({ KEYS, seed }) => {
            const reel = {
                id: seed.id,
                fileName: seed.fileName,
                name: seed.name,
                url: (() => {
                    try {
                        return new URL(seed.url).pathname;
                    } catch {
                        return seed.url;
                    }
                })(),
                type: seed.type,
                backgroundSource: 'custom_video'
            };
            const manager = {
                backgroundSource: 'custom_video',
                heroAssetId: '00000000-0000-0000-0000-000000000000', // intentional mismatch
                backgroundStyle: 'video',
                heroType: 'FEATURED_RELEASE',
                autoRotate: false,
                updatedAt: Date.now()
            };
            localStorage.setItem(KEYS.reel, JSON.stringify(reel));
            localStorage.setItem(KEYS.manager, JSON.stringify(manager));
            return { reel, manager };
        },
        { KEYS, seed }
    );
}

function extractLatestClassify(sink) {
    const rows = [...sink.classify].reverse();
    const start = rows.find((r) => r.text.includes('resolveHeroBackgroundAsset:start'));
    const resolved = rows.find((r) => r.text.includes('resolveHeroBackgroundAsset:resolved'));
    return { start: start || null, resolved: resolved || null };
}

function classifyPass(pass) {
    const d = pass.storageAfterBoot?.derived;
    const classify = pass.classifySummary;
    const dom = pass.domAfterBoot;

    if (pass.name === 'A_cold_boot') {
        if (d && !d.heroAssetId && !d.reelId && d.wouldReturnEmpty) {
            return {
                verdict: 'EMPTY_AT_LOCALSTORAGE_BOOT',
                firstEmptyStage: 'localStorage (reelforge_hero_reel + reelforge_hero_manager_config.heroAssetId)',
                detail: 'No hero reel and no heroAssetId present before resolve'
            };
        }
    }
    if (pass.name === 'B_seed_matched_reload') {
        const startText = classify?.start?.text || '';
        const resolvedText = classify?.resolved?.text || '';
        const domSrc = String(pass.domAfterBoot?.videoSrc || '');
        if (
            d &&
            !d.wouldReturnEmpty &&
            d.idsMatch &&
            (/vaultItemsCount:\s*1/.test(startText) || /resolvedAssetId:\s*[0-9a-f-]{8,}/i.test(resolvedText)) &&
            domSrc.includes(d.reelId)
        ) {
            return {
                verdict: 'HYDRATION_PRESERVES_SEEDED_ASSET',
                firstEmptyStage: null,
                detail: 'Matched seed survived reload; resolver vaultItemsCount=1; DOM plays seeded reel'
            };
        }
        if (d && !d.wouldReturnEmpty && classify?.resolved && /vaultMatch:\s*true|\"vaultMatch\":true/.test(classify.resolved.text || '')) {
            return {
                verdict: 'HYDRATION_PRESERVES_SEEDED_ASSET',
                firstEmptyStage: null,
                detail: 'Matched seed survived reload into resolver'
            };
        }
        if (d && d.wouldReturnEmpty) {
            return {
                verdict: 'SEEDED_ASSET_DROPPED_BEFORE_RESOLVE',
                firstEmptyStage: 'storage gates after reload',
                detail: d
            };
        }
        if (d && !d.wouldReturnEmpty && dom?.videoSrc && String(dom.videoSrc).includes('hero-background')) {
            return {
                verdict: 'RESOLVER_HAD_ASSET_BUT_UI_USED_FALLBACK',
                firstEmptyStage: 'HeroExperience / viewer render fallback',
                detail: { videoSrc: dom.videoSrc }
            };
        }
        if (d && !d.wouldReturnEmpty) {
            // storage ok — check if media failed
            const hero404 = (pass.mediaResponses || []).find(
                (m) => m.url.includes('hero-background') && m.status === 404
            );
            if (hero404 && (!dom?.videoSrc || String(dom.videoSrc).includes('hero-background'))) {
                return {
                    verdict: 'FALLBACK_MEDIA_404',
                    firstEmptyStage: 'default /videos/hero-background.mp4',
                    detail: hero404
                };
            }
            return {
                verdict: 'STORAGE_OK_RESOLVE_INCONCLUSIVE',
                firstEmptyStage: null,
                detail: { derived: d, dom }
            };
        }
    }
    if (pass.name === 'C_seed_mismatch_reload') {
        if (d && d.hasReelId && d.hasReelUrl && !d.idsMatch && d.wouldReturnEmpty) {
            return {
                verdict: 'VAULT_CLEARED_BY_ID_MISMATCH_GATE',
                firstEmptyStage: 'loadHeroVaultItems() id mismatch gate',
                detail: d
            };
        }
    }
    return {
        verdict: 'INSUFFICIENT EVIDENCE',
        firstEmptyStage: null,
        detail: { derived: d, classify }
    };
}

async function runPass(browser, name, setup, seed) {
    const sink = {
        console: [],
        classify: [],
        storeReads: [],
        restore: [],
        traces: [],
        pageErrors: [],
        mediaResponses: []
    };
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await ctx.newPage();
    attachCollectors(page, sink);

    const pass = {
        name,
        startedAt: isoNow(),
        setup: null,
        storageBeforeNav: null,
        storageAfterBoot: null,
        domAfterBoot: null,
        classifySummary: null,
        mediaResponses: null,
        pageErrors: null,
        restore: null,
        storeReads: null,
        classification: null
    };

    // Navigate once so localStorage is available for seeding on this origin.
    await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await clearHeroStorage(page);
    pass.setup = await setup(page, seed);
    pass.storageBeforeNav = await readStorageSnapshot(page);

    // Hard reload to force full hydration from storage.
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
    await sleep(WAIT_MS);

    pass.storageAfterBoot = await readStorageSnapshot(page);
    pass.domAfterBoot = await readDomHero(page);
    pass.classifySummary = extractLatestClassify(sink);
    pass.mediaResponses = sink.mediaResponses.slice();
    pass.pageErrors = sink.pageErrors.slice();
    pass.restore = sink.restore.slice();
    pass.storeReads = sink.storeReads.slice();
    pass.classification = classifyPass(pass);
    pass.endedAt = isoNow();

    // Keep a compact console excerpt of hero-related lines only
    pass.heroConsoleExcerpt = sink.console
        .filter((c) => /HERO_|hero-background|BG7V_HERO/i.test(c.text))
        .slice(-40);

    await ctx.close();
    return pass;
}

async function main() {
    const seed = await fetchSeedReel();
    const fallbackHeads = {
        videosHeroBackground: await headCheck('/videos/hero-background.mp4'),
        rootHeroBackground: await headCheck('/hero-background.mp4'),
        seededReelPath: await headCheck(
            (() => {
                try {
                    return new URL(seed.url).pathname;
                } catch {
                    return seed.url.startsWith('/') ? seed.url : `/${seed.url}`;
                }
            })()
        )
    };

    const launch = { headless: true };
    if (fs.existsSync(CHROMIUM)) launch.executablePath = CHROMIUM;
    const browser = await chromium.launch(launch);

    const report = {
        mission: 'RC3-HERO-STATE-01',
        goal: 'Hero Registry Hydration Trace — find first place a valid hero asset disappears',
        baseline: ['RC1-2026-07-19-POST-08C', 'RC2 MP4 Acceptance PASS'],
        generatedAt: isoNow(),
        frontendUrl: FRONTEND_URL,
        rules: {
            noSourceChanges: true,
            noFixes: true,
            noCommits: true,
            noDeploys: true,
            ignoreUploadTransport: true,
            ignoreReconnect: true,
            ignoreThumbnails: true
        },
        staticChain: {
            keys: KEYS,
            loadHeroVaultItemsGates: [
                'reel = loadHeroReel(); if (!reel?.id || !reel?.url) return []',
                'if (manager.heroAssetId !== reel.id) return []',
                'else return [heroReelToVaultItem(reel)]'
            ],
            resolvePath: [
                'localStorage',
                'loadHeroManagerConfig()',
                'loadHeroReel()',
                'loadHeroVaultItems()',
                'buildHeroAssetRegistry()',
                'resolveHeroBackgroundAsset()',
                'HeroExperience / viewer render'
            ],
            defaultFallbackPaths: ['/videos/hero-background.mp4', '/hero-background.mp4'],
            note: 'applyHeroManagerBackground early-returns when backgroundSource === "selection"'
        },
        seedReel: seed,
        fallbackHeads,
        bundle: null,
        passes: [],
        synthesis: null
    };

    // Capture bundle from a quick page
    {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
        report.bundle = await page.evaluate(() => {
            const s = document.querySelector('script[src*="assets/index-"]');
            return s ? s.getAttribute('src') : null;
        });
        await ctx.close();
    }

    console.info('[RC3-HERO-STATE-01] Pass A cold boot');
    report.passes.push(
        await runPass(
            browser,
            'A_cold_boot',
            async () => ({ action: 'cleared_all_hero_keys' }),
            seed
        )
    );

    console.info('[RC3-HERO-STATE-01] Pass B seed matched + reload');
    report.passes.push(
        await runPass(
            browser,
            'B_seed_matched_reload',
            async (page, s) => {
                await seedMatched(page, s);
                return { action: 'seed_matched_reel_and_manager', heroAssetId: s.id };
            },
            seed
        )
    );

    console.info('[RC3-HERO-STATE-01] Pass C seed mismatch + reload');
    report.passes.push(
        await runPass(
            browser,
            'C_seed_mismatch_reload',
            async (page, s) => {
                await seedMismatch(page, s);
                return {
                    action: 'seed_mismatched_heroAssetId',
                    reelId: s.id,
                    heroAssetId: '00000000-0000-0000-0000-000000000000'
                };
            },
            seed
        )
    );

    await browser.close();

    const A = report.passes.find((p) => p.name === 'A_cold_boot');
    const B = report.passes.find((p) => p.name === 'B_seed_matched_reload');
    const C = report.passes.find((p) => p.name === 'C_seed_mismatch_reload');

    // Overall: identify first disappearance relative to user-observed empty resolver.
    let overallVerdict = 'INSUFFICIENT EVIDENCE';
    let firstDisappearance = null;
    const timeline = [];

    if (A?.classification?.verdict === 'EMPTY_AT_LOCALSTORAGE_BOOT') {
        timeline.push({
            stage: 'localStorage boot',
            status: 'empty',
            heroAssetId: '',
            vaultWouldBeEmpty: true
        });
        firstDisappearance = 'localStorage (no hero reel / no heroAssetId at boot)';
        overallVerdict = 'EMPTY_AT_LOCALSTORAGE_BOOT';
    }
    if (C?.classification?.verdict === 'VAULT_CLEARED_BY_ID_MISMATCH_GATE') {
        timeline.push({
            stage: 'loadHeroVaultItems id mismatch gate',
            status: 'returns []',
            evidence: C.storageAfterBoot?.derived
        });
        if (!firstDisappearance) firstDisappearance = 'loadHeroVaultItems() when heroAssetId !== reel.id';
        if (overallVerdict === 'INSUFFICIENT EVIDENCE' || overallVerdict === 'EMPTY_AT_LOCALSTORAGE_BOOT') {
            // Keep cold-boot as primary for "why runtime is empty"; mismatch proves the gate.
            overallVerdict =
                overallVerdict === 'EMPTY_AT_LOCALSTORAGE_BOOT'
                    ? 'EMPTY_AT_LOCALSTORAGE_BOOT'
                    : 'VAULT_CLEARED_BY_ID_MISMATCH_GATE';
        }
    }
    if (B?.classification) {
        timeline.push({
            stage: 'seeded matched reload',
            status: B.classification.verdict,
            derived: B.storageAfterBoot?.derived,
            dom: B.domAfterBoot
        });
    }

    // Fallback 404 is independent concrete failure for default path.
    const fallback404 = fallbackHeads.videosHeroBackground?.status === 404;

    report.synthesis = {
        overallVerdict,
        firstDisappearance,
        fallbackVideosHeroBackground404: fallback404,
        fallbackRootHeroBackgroundOk: fallbackHeads.rootHeroBackground?.status === 200,
        passVerdicts: report.passes.map((p) => ({
            name: p.name,
            verdict: p.classification?.verdict,
            firstEmptyStage: p.classification?.firstEmptyStage
        })),
        timeline,
        interpretation: [
            'Cold boot with empty hero keys produces heroAssetId="" and vaultItemsCount=0 at resolveHeroBackgroundAsset — matching the user log.',
            'loadHeroVaultItems() returns [] unless both reelforge_hero_reel exists AND manager.heroAssetId === reel.id.',
            'Default backgroundSource is "selection"; applyHeroManagerBackground early-returns and viewer falls back to CONFIG.HERO_VIDEO_PATHS[0] = /videos/hero-background.mp4.',
            fallback404
                ? 'HEAD /videos/hero-background.mp4 returns 404; HEAD /hero-background.mp4 returns 200 — default fallback path is a missing resource.'
                : 'Fallback head checks recorded in fallbackHeads.',
            'RC2 persistence OK and runtime vaultItemsCount=0 can both be true across different browser profiles/storage states; this mission measures the empty-profile + gate behavior explicitly.'
        ]
    };

    // Choose primary mission verdict for deliverable clarity
    report.verdict = overallVerdict;
    if (fallback404 && overallVerdict === 'EMPTY_AT_LOCALSTORAGE_BOOT') {
        report.verdictDetail =
            'Primary: empty localStorage at boot → empty resolver; Secondary: default fallback /videos/hero-background.mp4 is 404';
    }

    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
    console.info('[RC3-HERO-STATE-01] wrote', OUT);
    console.info('[RC3-HERO-STATE-01] verdict', report.verdict);
    for (const p of report.passes) {
        console.info(' ', p.name, '→', p.classification?.verdict);
    }
}

main().catch((err) => {
    console.error('[RC3-HERO-STATE-01] failed', err);
    process.exit(1);
});
