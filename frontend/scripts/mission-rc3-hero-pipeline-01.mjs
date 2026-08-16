#!/usr/bin/env node
/**
 * RC3-HERO-PIPELINE-01 — End-to-End Hero Processing Trace
 *
 * Evidence only. No application source changes. No fixes. No commits. No deploys.
 *
 * Traces ONE real Hero upload (condo_v1_2.mp4) from UI event until the
 * processing spinner stops (or fails). Ignores transport/reconnect ownership.
 *
 * Usage:
 *   UPLOAD_WAIT_MS=420000 node scripts/mission-rc3-hero-pipeline-01.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import {
    unlockStudioWithHeroSection,
    readHeroStorage
} from '../tests/helpers/studio-navigation.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_URL = (
    process.env.FRONTEND_URL || 'https://strong-lolly-a9fcb4.netlify.app/'
).replace(/\/?$/, '/');
const VIDEO_PATH =
    process.env.HERO_VAULT_VIDEO || '/home/youloose2dafish/Downloads/condo_v1_2.mp4';
const OUT =
    process.env.OUT ||
    path.join(__dirname, '..', 'artifacts', 'rc3-hero-pipeline-01.json');
const UPLOAD_WAIT_MS = Number(process.env.UPLOAD_WAIT_MS || 420000);
const POST_SETTLE_MS = Number(process.env.POST_SETTLE_MS || 15000);
const RESTORE_WAIT_MS = Number(process.env.RESTORE_WAIT_MS || 25000);
const CHROMIUM =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';

const STAGE_IDS = [
    'hero_drop_detected',
    'beginHeroAutoAccept',
    'acceptHeroFile',
    'validateVideoFile',
    'uploadStatus_changes',
    'POST_api_reels',
    'HTTP_response',
    'pollUrl_creation',
    'poll_attempts',
    'pending',
    'ready_or_failed',
    'saveHeroReel',
    'saveHeroManagerConfig',
    'hero_registry_rebuild',
    'HeroExperience_rerender',
    'processing_indicator_removed',
    'Hero_background_visible',
    'hard_refresh',
    'RESTORE_SUCCESS'
];

function isoNow() {
    return new Date().toISOString();
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function emptyStage(id) {
    return {
        id,
        reached: false,
        timestamp: null,
        component: null,
        function: null,
        assetId: null,
        status: null,
        durationMs: null,
        evidence: null
    };
}

function markStage(stages, id, patch = {}) {
    const s = stages[id];
    if (!s) return;
    if (!s.reached) {
        s.reached = true;
        s.timestamp = patch.timestamp || isoNow();
    }
    Object.assign(s, patch);
    if (!s.timestamp) s.timestamp = isoNow();
}

function firstUnreached(stages) {
    for (const id of STAGE_IDS) {
        if (!stages[id]?.reached) return id;
    }
    return null;
}

function lastReached(stages) {
    let last = null;
    for (const id of STAGE_IDS) {
        if (stages[id]?.reached) last = id;
    }
    return last;
}

function classifyVerdict(stages, ctx) {
    const firstFail = firstUnreached(stages);
    const post = stages.POST_api_reels;
    const http = stages.HTTP_response;
    const ready = stages.ready_or_failed;
    const saveReel = stages.saveHeroReel;
    const ui = stages.Hero_background_visible;
    const restore = stages.RESTORE_SUCCESS;
    const processingRemoved = stages.processing_indicator_removed;

    // Explicit measured outcomes only.
    if (restore.reached && restore.status === 'RESTORE_SUCCESS') {
        // Full path succeeded — not in allowed failure verdicts; report via notes.
        // Mission asks for exactly one of the listed verdicts; success still maps
        // via whether restore worked. If everything reached, use RESTORE as terminal.
        return 'INSUFFICIENT EVIDENCE'; // placeholder overwritten below
    }

    if (!post.reached && processingRemoved.reached) {
        return 'PROCESSING STOPS BEFORE UPLOAD';
    }
    if (!post.reached && ctx.acceptFailedBeforePost) {
        return 'PROCESSING STOPS BEFORE UPLOAD';
    }
    if (post.reached && (!http.reached || (http.status != null && Number(http.status) >= 400))) {
        // Upload request happened; never produced ready reel.
        return 'UPLOAD NEVER BECOMES READY';
    }
    if (post.reached && http.reached && Number(http.status) < 300 && !ready.reached) {
        return 'UPLOAD NEVER BECOMES READY';
    }
    if (ready.reached && ready.status === 'failed') {
        return 'UPLOAD NEVER BECOMES READY';
    }
    if (ready.reached && ready.status === 'ready' && !saveReel.reached) {
        return 'READY NEVER REACHES HERO STORE';
    }
    if (saveReel.reached && !ui.reached) {
        return 'HERO STORE NEVER REACHES UI';
    }
    if (ui.reached && stages.hard_refresh.reached && !restore.reached) {
        return 'RESTORE FAILS';
    }
    if (restore.reached && restore.status && restore.status !== 'RESTORE_SUCCESS') {
        return 'RESTORE FAILS';
    }
    if (
        STAGE_IDS.every((id) => stages[id]?.reached) &&
        restore.status === 'RESTORE_SUCCESS'
    ) {
        // Not in the failure enum; keep as measured success note + INSUFFICIENT only if ambiguous.
        // Prefer RESTORE FAILS only when restore reason is non-success.
        return 'INSUFFICIENT EVIDENCE';
    }

    // If we have clear POST failure evidence.
    if (ctx.postStatus != null && ctx.postStatus >= 400) {
        return 'UPLOAD NEVER BECOMES READY';
    }

    if (firstFail && ctx.observedAnyHeroActivity) {
        // Map first transition failure to closest allowed verdict.
        const idx = STAGE_IDS.indexOf(firstFail);
        if (idx <= STAGE_IDS.indexOf('POST_api_reels')) return 'PROCESSING STOPS BEFORE UPLOAD';
        if (idx <= STAGE_IDS.indexOf('ready_or_failed')) return 'UPLOAD NEVER BECOMES READY';
        if (idx <= STAGE_IDS.indexOf('saveHeroReel')) return 'READY NEVER REACHES HERO STORE';
        if (idx <= STAGE_IDS.indexOf('Hero_background_visible')) return 'HERO STORE NEVER REACHES UI';
        if (idx <= STAGE_IDS.indexOf('RESTORE_SUCCESS')) return 'RESTORE FAILS';
    }

    return 'INSUFFICIENT EVIDENCE';
}

async function main() {
    if (!fs.existsSync(VIDEO_PATH)) {
        throw new Error(`Missing video: ${VIDEO_PATH}`);
    }
    const videoStat = fs.statSync(VIDEO_PATH);
    const stages = Object.fromEntries(STAGE_IDS.map((id) => [id, emptyStage(id)]));
    const consoleEvents = [];
    const network = {
        postReels: [],
        pollGets: [],
        otherApi: []
    };
    const uploadStatusTimeline = [];
    const processingTimeline = [];
    const ctx = {
        observedAnyHeroActivity: false,
        acceptFailedBeforePost: false,
        postStatus: null,
        reelId: null,
        pollUrl: null
    };

    const report = {
        mission: 'RC3-HERO-PIPELINE-01',
        baseline: ['RC1-2026-07-19-POST-08C', 'RC2 MP4 Acceptance PASS'],
        generatedAt: isoNow(),
        frontendUrl: FRONTEND_URL,
        asset: {
            path: VIDEO_PATH,
            name: path.basename(VIDEO_PATH),
            sizeBytes: videoStat.size
        },
        bundle: null,
        captureStartAt: null,
        captureEndAt: null,
        stages: {},
        stageOrder: STAGE_IDS,
        firstFailureStage: null,
        lastSuccessfulStage: null,
        verdict: null,
        notes: [],
        evidence: {
            consoleEvents,
            network,
            uploadStatusTimeline,
            processingTimeline,
            heroStorageBefore: null,
            heroStorageAfterAccept: null,
            heroStorageAfterRefresh: null,
            restoreReasons: [],
            ui: {}
        },
        rules: {
            noSourceChanges: true,
            noFixes: true,
            noCommits: true,
            noDeploys: true,
            ignoreTransportOwnership: true,
            ignoreReconnectOwnership: true,
            ignoreThumbnailGeneration: true
        }
    };

    const launch = { headless: true };
    if (fs.existsSync(CHROMIUM)) launch.executablePath = CHROMIUM;

    const browser = await chromium.launch(launch);
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();

    page.on('console', (msg) => {
        const text = msg.text();
        const ts = isoNow();
        const row = { ts, type: msg.type(), text: text.slice(0, 2000) };
        consoleEvents.push(row);
        if (consoleEvents.length > 500) consoleEvents.shift();

        // Stage attribution from known log markers (no app patches).
        if (text.includes('[HERO_FILE]') || text.includes('hero-file-select') || text.includes('file-selected')) {
            markStage(stages, 'hero_drop_detected', {
                component: 'HeroExperience.svelte',
                function: 'handleHeroFileSelect',
                status: 'detected',
                evidence: text.slice(0, 300)
            });
            ctx.observedAnyHeroActivity = true;
        }
        if (text.includes('auto_accept_start') || text.includes('beginHeroAutoAccept')) {
            markStage(stages, 'beginHeroAutoAccept', {
                component: 'HeroExperience.svelte',
                function: 'beginHeroAutoAccept',
                status: 'invoked',
                evidence: text.slice(0, 300)
            });
        }
        if (text.includes('[HERO_ACCEPT]') && text.includes('start')) {
            markStage(stages, 'acceptHeroFile', {
                component: 'HeroExperience.svelte',
                function: 'acceptHeroFile',
                status: 'start',
                evidence: text.slice(0, 300)
            });
        }
        if (text.includes('Validating hero video') || text.includes('validateVideoFile')) {
            markStage(stages, 'validateVideoFile', {
                component: 'HeroExperience.svelte',
                function: 'validateVideoFile',
                status: 'validating',
                evidence: text.slice(0, 300)
            });
        }
        if (text.includes('[BG7G_UPLOAD]') && text.includes('upload_start')) {
            markStage(stages, 'validateVideoFile', {
                component: 'HeroExperience.svelte',
                function: 'validateVideoFile',
                status: 'passed_inferred',
                evidence: 'upload_start implies validation passed'
            });
        }
        if (text.includes('pollUrl') || text.includes('WAITING_FOR_INGEST') || text.includes('accepted_pending')) {
            markStage(stages, 'pollUrl_creation', {
                component: 'media.js / ingestPoll.js',
                function: 'createReel / pollIngestionUntilReady',
                status: 'created_or_started',
                evidence: text.slice(0, 300)
            });
            markStage(stages, 'pending', {
                component: 'media.js',
                function: 'createReel',
                status: 'pending',
                evidence: text.slice(0, 300)
            });
        }
        if (text.includes('[ingest-poll]') || text.includes('poll_fetch') || text.includes('pollIngestionUntilReady')) {
            markStage(stages, 'poll_attempts', {
                component: 'ingestPoll.js',
                function: 'pollIngestionUntilReady',
                status: 'attempt',
                evidence: text.slice(0, 300)
            });
        }
        if (text.includes('[UPLOAD_SUCCESS]') || (text.includes('status') && text.includes('ready') && text.includes('[HERO_ROUTE]'))) {
            markStage(stages, 'ready_or_failed', {
                component: 'media.js',
                function: 'createReel',
                status: 'ready',
                evidence: text.slice(0, 300)
            });
        }
        if (text.includes('[HERO_ACCEPT]') && text.includes('complete')) {
            markStage(stages, 'saveHeroReel', {
                component: 'HeroExperience.svelte',
                function: 'saveHeroReel',
                status: 'complete_log',
                evidence: text.slice(0, 300)
            });
            markStage(stages, 'saveHeroManagerConfig', {
                component: 'HeroExperience.svelte',
                function: 'saveHeroManagerConfig',
                status: 'complete_log',
                evidence: text.slice(0, 300)
            });
            markStage(stages, 'hero_registry_rebuild', {
                component: 'HeroExperience.svelte',
                function: 'buildHeroAssetRegistry',
                status: 'logged',
                evidence: text.slice(0, 300)
            });
            markStage(stages, 'HeroExperience_rerender', {
                component: 'HeroExperience.svelte',
                function: 'acceptHeroFile',
                status: 'commit_logged',
                evidence: text.slice(0, 300)
            });
        }
        if (text.includes('[BG7G_STORE]') && text.includes('HERO_BACKGROUND_VIDEO')) {
            markStage(stages, 'saveHeroReel', {
                component: 'HeroExperience.svelte',
                function: 'HERO_BACKGROUND_VIDEO.set',
                status: 'store_set',
                evidence: text.slice(0, 300)
            });
        }
        if (text.includes('[BG7G_RENDER]') && text.includes('hero_video_committed')) {
            markStage(stages, 'HeroExperience_rerender', {
                component: 'HeroExperience.svelte',
                function: 'acceptHeroFile',
                status: 'hero_video_committed',
                evidence: text.slice(0, 300)
            });
            markStage(stages, 'Hero_background_visible', {
                component: 'HeroExperience / viewer',
                function: 'render',
                status: 'committed',
                evidence: text.slice(0, 300)
            });
        }
        if (text.includes('[HERO_ACCEPT]') && text.includes('failed')) {
            ctx.acceptFailedBeforePost = !stages.POST_api_reels.reached;
        }
        if (text.includes('BG7V_HERO_RESTORE_REASON') || text.includes('[BG7V_HERO_RESTORE_REASON]')) {
            report.evidence.restoreReasons.push({ ts, text: text.slice(0, 500) });
            if (text.includes('RESTORE_SUCCESS')) {
                markStage(stages, 'RESTORE_SUCCESS', {
                    component: 'bg7vHeroRestoreReason / mediaBootstrap',
                    function: 'hero restore',
                    status: 'RESTORE_SUCCESS',
                    evidence: text.slice(0, 500)
                });
            } else {
                markStage(stages, 'RESTORE_SUCCESS', {
                    component: 'bg7vHeroRestoreReason / mediaBootstrap',
                    function: 'hero restore',
                    status: 'non_success_reason_logged',
                    evidence: text.slice(0, 500)
                });
            }
        }
    });

    page.on('request', (req) => {
        const url = req.url();
        const method = req.method();
        if (method === 'POST' && url.includes('/api/reels') && !/\/api\/reels\/[^/]+/.test(new URL(url).pathname.replace(/\/$/, ''))) {
            // POST /api/reels (create), not POST /api/reels/:id/...
            const pathname = new URL(url).pathname.replace(/\/$/, '');
            if (pathname.endsWith('/api/reels')) {
                const t0 = Date.now();
                network.postReels.push({
                    phase: 'request',
                    url,
                    ts: isoNow(),
                    t0
                });
                markStage(stages, 'POST_api_reels', {
                    component: 'media.js',
                    function: 'createReel / uploadVideo',
                    status: 'request_started',
                    timestamp: isoNow()
                });
                ctx.observedAnyHeroActivity = true;
            }
        }
        if (method === 'GET' && /\/api\/reels\/[^/?]+/.test(url) && !url.includes('?')) {
            network.pollGets.push({ phase: 'request', url, ts: isoNow() });
            markStage(stages, 'poll_attempts', {
                component: 'ingestPoll.js',
                function: 'pollIngestionUntilReady',
                status: 'http_get',
                evidence: url
            });
            if (!stages.pollUrl_creation.reached) {
                markStage(stages, 'pollUrl_creation', {
                    component: 'ingestPoll.js',
                    function: 'pollIngestionUntilReady',
                    status: 'poll_get_observed',
                    evidence: url,
                    assetId: (url.match(/\/api\/reels\/([^/?]+)/) || [])[1] || null
                });
            }
        }
    });

    page.on('response', async (res) => {
        const req = res.request();
        const url = res.url();
        const method = req.method();
        if (method === 'POST') {
            const pathname = new URL(url).pathname.replace(/\/$/, '');
            if (pathname.endsWith('/api/reels')) {
                let body = null;
                let bodyText = null;
                try {
                    bodyText = await res.text();
                    body = JSON.parse(bodyText);
                } catch {
                    body = null;
                }
                const pending = [...network.postReels].reverse().find((e) => e.phase === 'request' && !e.status);
                const elapsedMs = pending?.t0 ? Date.now() - pending.t0 : null;
                const row = {
                    phase: 'response',
                    url,
                    status: res.status(),
                    elapsedMs,
                    id: body?.id || null,
                    ingestStatus: body?.status || null,
                    pollUrl: body?.pollUrl || null,
                    bodyPreview: (bodyText || '').slice(0, 400),
                    ts: isoNow()
                };
                network.postReels.push(row);
                if (pending) {
                    pending.status = res.status();
                    pending.elapsedMs = elapsedMs;
                }
                ctx.postStatus = res.status();
                ctx.reelId = body?.id || null;
                ctx.pollUrl = body?.pollUrl || null;

                markStage(stages, 'HTTP_response', {
                    component: 'Netlify → backend',
                    function: 'POST /api/reels',
                    status: String(res.status()),
                    assetId: body?.id || null,
                    durationMs: elapsedMs,
                    evidence: row.bodyPreview
                });
                if (stages.POST_api_reels.reached && stages.POST_api_reels.timestamp) {
                    stages.POST_api_reels.durationMs = elapsedMs;
                    stages.POST_api_reels.assetId = body?.id || null;
                    stages.POST_api_reels.status = `completed_http_${res.status()}`;
                }
                if (body?.pollUrl || body?.status === 'pending' || res.status() === 202) {
                    markStage(stages, 'pollUrl_creation', {
                        component: 'media.js',
                        function: 'createReel',
                        status: body?.pollUrl ? 'present' : 'pending_without_explicit_pollUrl',
                        assetId: body?.id || null,
                        evidence: body?.pollUrl || null
                    });
                    markStage(stages, 'pending', {
                        component: 'media.js',
                        function: 'createReel',
                        status: body?.status || 'pending',
                        assetId: body?.id || null
                    });
                }
                if (body?.status === 'ready' || body?.status === 'failed') {
                    markStage(stages, 'ready_or_failed', {
                        component: 'media.js',
                        function: 'createReel',
                        status: body.status,
                        assetId: body?.id || null
                    });
                }
            }
        }
        if (method === 'GET' && /\/api\/reels\/[^/?]+/.test(url)) {
            let body = null;
            try {
                body = await res.json();
            } catch {
                body = null;
            }
            const status = String(body?.status || '').toLowerCase();
            network.pollGets.push({
                phase: 'response',
                url,
                http: res.status(),
                ingestStatus: status || null,
                ts: isoNow()
            });
            if (status === 'pending') {
                markStage(stages, 'pending', {
                    component: 'ingestPoll.js',
                    function: 'pollIngestionUntilReady',
                    status: 'pending',
                    assetId: body?.id || ctx.reelId
                });
            }
            if (status === 'ready' || status === 'failed') {
                markStage(stages, 'ready_or_failed', {
                    component: 'ingestPoll.js',
                    function: 'pollIngestionUntilReady',
                    status,
                    assetId: body?.id || ctx.reelId
                });
            }
        }
    });

    report.captureStartAt = isoNow();
    console.info('[RC3-HERO-PIPELINE-01] start', report.captureStartAt, FRONTEND_URL);

    await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
    report.bundle = await page.evaluate(() => {
        const s = document.querySelector('script[src*="assets/index-"]');
        return s ? s.getAttribute('src') : null;
    });

    await page.evaluate(() => {
        try {
            localStorage.removeItem('reelforge_hero_reel');
            localStorage.removeItem('reelforge_hero_manager_config');
        } catch {
            /* ignore */
        }
    });

    await unlockStudioWithHeroSection(page, FRONTEND_URL);
    report.evidence.heroStorageBefore = await readHeroStorage(page);

    const fileInput = page.locator('.hero-replace-section input[type="file"]');
    const dropT0 = Date.now();
    await fileInput.setInputFiles(VIDEO_PATH);
    markStage(stages, 'hero_drop_detected', {
        component: 'HeroExperience.svelte',
        function: 'handleHeroFileSelect / input change',
        status: 'setInputFiles',
        durationMs: Date.now() - dropT0,
        evidence: path.basename(VIDEO_PATH)
    });
    ctx.observedAnyHeroActivity = true;

    // Poll UI for status / processing / stage side-effects.
    const deadline = Date.now() + UPLOAD_WAIT_MS;
    let sawProcessing = false;
    let processingCleared = false;
    let sawFailureStatus = false;
    let lastOp = '';

    while (Date.now() < deadline) {
        const snap = await page.evaluate(() => {
            const opEl = document.querySelector('.global-operation-status__message');
            const op = opEl ? String(opEl.textContent || '').trim() : '';
            const phaseEl = document.querySelector('[data-hero-replace-ux-phase]');
            const phase = phaseEl ? phaseEl.getAttribute('data-hero-replace-ux-phase') : null;
            const title = document.querySelector('.hero-replace-state-title');
            const titleText = title ? String(title.textContent || '').trim() : '';
            const video = document.querySelector('video.hero-background, .hero-background video, [data-hero-background] video');
            const videoSrc = video ? video.currentSrc || video.src || '' : '';
            let heroReel = null;
            let heroMgr = null;
            try {
                heroReel = JSON.parse(localStorage.getItem('reelforge_hero_reel') || 'null');
            } catch {
                heroReel = null;
            }
            try {
                heroMgr = JSON.parse(localStorage.getItem('reelforge_hero_manager_config') || 'null');
            } catch {
                heroMgr = null;
            }
            return { op, phase, titleText, videoSrc, heroReel, heroMgr };
        });

        if (snap.op && snap.op !== lastOp) {
            uploadStatusTimeline.push({ ts: isoNow(), text: snap.op });
            lastOp = snap.op;
            markStage(stages, 'uploadStatus_changes', {
                component: 'GlobalOperationStatus / uploadStatus store',
                function: 'uploadStatus.set',
                status: snap.op,
                evidence: snap.op
            });
            if (/validating/i.test(snap.op)) {
                markStage(stages, 'validateVideoFile', {
                    component: 'HeroExperience.svelte',
                    function: 'validateVideoFile',
                    status: 'status_text',
                    evidence: snap.op
                });
            }
            if (/Failed/i.test(snap.op) || /❌/.test(snap.op)) {
                sawFailureStatus = true;
            }
        }

        if (snap.phase === 'processing' || /Replacing Hero/i.test(snap.titleText)) {
            if (!sawProcessing) {
                sawProcessing = true;
                processingTimeline.push({ ts: isoNow(), state: 'processing_visible', title: snap.titleText });
            }
        } else if (sawProcessing && snap.phase && snap.phase !== 'processing') {
            if (!processingCleared) {
                processingCleared = true;
                processingTimeline.push({ ts: isoNow(), state: 'processing_cleared', phase: snap.phase, title: snap.titleText });
                markStage(stages, 'processing_indicator_removed', {
                    component: 'HeroExperience.svelte',
                    function: 'heroUploadProcessing=false / UX phase',
                    status: snap.phase,
                    evidence: snap.titleText
                });
            }
        }

        if (snap.heroReel?.id) {
            markStage(stages, 'saveHeroReel', {
                component: 'hero storage',
                function: 'saveHeroReel',
                status: 'localStorage_present',
                assetId: snap.heroReel.id,
                evidence: snap.heroReel.url || null
            });
            ctx.reelId = snap.heroReel.id;
        }
        if (snap.heroMgr?.heroAssetId || snap.heroMgr?.backgroundSource) {
            markStage(stages, 'saveHeroManagerConfig', {
                component: 'hero storage',
                function: 'saveHeroManagerConfig',
                status: 'localStorage_present',
                assetId: snap.heroMgr.heroAssetId || null,
                evidence: snap.heroMgr.backgroundSource || null
            });
        }
        if (snap.videoSrc && !snap.videoSrc.startsWith('blob:')) {
            markStage(stages, 'Hero_background_visible', {
                component: 'viewer hero video',
                function: 'DOM video src',
                status: 'src_present',
                evidence: snap.videoSrc.slice(0, 200)
            });
            markStage(stages, 'HeroExperience_rerender', {
                component: 'HeroExperience / viewer',
                function: 'render',
                status: 'video_element_src',
                evidence: snap.videoSrc.slice(0, 200)
            });
        }

        // Exit conditions: HTTP response received and processing cleared, or failure status + response.
        const httpDone = stages.HTTP_response.reached;
        if (httpDone && (processingCleared || sawFailureStatus)) {
            await sleep(POST_SETTLE_MS);
            break;
        }
        // If HTTP failed and enough settle time after response.
        if (httpDone && ctx.postStatus >= 400) {
            await sleep(POST_SETTLE_MS);
            break;
        }

        await sleep(1000);
    }

    // If processing never cleared but we saw it, note timeout.
    if (sawProcessing && !processingCleared) {
        processingTimeline.push({ ts: isoNow(), state: 'processing_still_visible_at_deadline' });
    } else if (sawProcessing && processingCleared) {
        // already marked
    } else if (sawFailureStatus || stages.HTTP_response.reached) {
        // Failure path may clear processing without phase attribute change — check once more.
        const phaseNow = await page.evaluate(() => {
            const phaseEl = document.querySelector('[data-hero-replace-ux-phase]');
            return {
                phase: phaseEl ? phaseEl.getAttribute('data-hero-replace-ux-phase') : null,
                op: document.querySelector('.global-operation-status__message')?.textContent?.trim() || ''
            };
        });
        if (phaseNow.phase !== 'processing') {
            markStage(stages, 'processing_indicator_removed', {
                component: 'HeroExperience.svelte',
                function: 'UX phase / failure path',
                status: phaseNow.phase || 'not_processing',
                evidence: phaseNow.op
            });
        }
    }

    report.evidence.heroStorageAfterAccept = await readHeroStorage(page);
    report.evidence.ui = await page.evaluate(() => {
        const phaseEl = document.querySelector('[data-hero-replace-ux-phase]');
        const video = document.querySelector('video.hero-background, .hero-background video, [data-hero-background] video');
        return {
            phase: phaseEl ? phaseEl.getAttribute('data-hero-replace-ux-phase') : null,
            title: document.querySelector('.hero-replace-state-title')?.textContent?.trim() || null,
            op: document.querySelector('.global-operation-status__message')?.textContent?.trim() || null,
            videoSrc: video ? video.currentSrc || video.src || null : null
        };
    });

    // Hard refresh + restore observation (only meaningful if a hero was saved).
    markStage(stages, 'hard_refresh', {
        component: 'Playwright',
        function: 'page.reload',
        status: 'starting',
        timestamp: isoNow()
    });
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
    stages.hard_refresh.status = 'completed';
    stages.hard_refresh.durationMs =
        stages.hard_refresh.timestamp != null
            ? Date.now() - new Date(stages.hard_refresh.timestamp).getTime()
            : null;

    const restoreDeadline = Date.now() + RESTORE_WAIT_MS;
    while (Date.now() < restoreDeadline) {
        if (stages.RESTORE_SUCCESS.reached && stages.RESTORE_SUCCESS.status === 'RESTORE_SUCCESS') break;
        await sleep(500);
    }
    report.evidence.heroStorageAfterRefresh = await readHeroStorage(page);

    // If hero was never saved, RESTORE_SUCCESS cannot occur — leave unreached.
    if (!stages.saveHeroReel.reached && !report.evidence.heroStorageAfterRefresh?.reel?.id) {
        report.notes.push('Hard refresh executed; no hero reel in storage so RESTORE_SUCCESS not expected.');
    }

    report.captureEndAt = isoNow();
    report.stages = stages;
    report.firstFailureStage = firstUnreached(stages);
    report.lastSuccessfulStage = lastReached(stages);

    // Final verdict refinement: if POST got non-2xx, ready never happened.
    let verdict = classifyVerdict(stages, ctx);
    if (
        stages.HTTP_response.reached &&
        ctx.postStatus != null &&
        ctx.postStatus >= 400 &&
        !stages.ready_or_failed.reached
    ) {
        verdict = 'UPLOAD NEVER BECOMES READY';
    }
    // Full success path — allowed list has no SUCCESS; keep evidence and use INSUFFICIENT only if ambiguous.
    if (
        stages.RESTORE_SUCCESS.reached &&
        stages.RESTORE_SUCCESS.status === 'RESTORE_SUCCESS' &&
        stages.Hero_background_visible.reached
    ) {
        report.notes.push('Full pipeline stages through RESTORE_SUCCESS observed.');
        // Not a failure verdict; mission list is failure-oriented. Still must pick one.
        // Prefer not to claim RESTORE FAILS. INSUFFICIENT EVIDENCE is wrong if we have full proof.
        // Use last failure-oriented slot only if something missing — else document success via notes
        // and set verdict to the first missing stage mapping. If nothing missing:
        if (!report.firstFailureStage) {
            verdict = 'INSUFFICIENT EVIDENCE';
            report.notes.push(
                'All listed stages reached including RESTORE_SUCCESS; failure-verdict enum has no SUCCESS value.'
            );
        }
    }

    report.verdict = verdict;
    report.summary = {
        firstFailureStage: report.firstFailureStage,
        lastSuccessfulStage: report.lastSuccessfulStage,
        postStatus: ctx.postStatus,
        reelId: ctx.reelId,
        pollUrl: ctx.pollUrl,
        processingSaw: sawProcessing,
        processingCleared,
        uploadStatusFinal: uploadStatusTimeline.slice(-1)[0] || null
    };

    await context.close();
    await browser.close();

    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
    console.info('[RC3-HERO-PIPELINE-01] wrote', OUT);
    console.info('[RC3-HERO-PIPELINE-01] verdict', report.verdict);
    console.info(
        '[RC3-HERO-PIPELINE-01] lastSuccessful=',
        report.lastSuccessfulStage,
        'firstFailure=',
        report.firstFailureStage
    );
}

main().catch((err) => {
    console.error('[RC3-HERO-PIPELINE-01] failed', err);
    process.exit(1);
});
