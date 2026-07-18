#!/usr/bin/env node
/**
 * BG-7N — capture downstream pipeline stage logs + DOM + localStorage.
 * Usage:
 *   FRONTEND_URL=http://127.0.0.1:4195/ OUT=/tmp/bg-7n-trace.json node scripts/mission-bg-7n-pipeline-trace.mjs
 */
import fs from 'node:fs';
import { chromium } from 'playwright';

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://127.0.0.1:4195/';
const OUT = process.env.OUT || '/tmp/bg-7n-pipeline-trace.json';
const WAIT_MS = Number(process.env.WAIT_MS || 25000);
const CHROMIUM =
    process.env.CHROMIUM ||
    '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';

const STAGE_ORDER = [
    'buildHomeFeed',
    'feed.set:prunedFeed',
    'feed.set:placeholderFallback',
    'feed.set:emptyBackend',
    'feed.subscribe',
    'normalizedFeed',
    'localStorage:reelforge_feed',
    'FeedExperience:loading',
    'FeedExperience:render',
    'ReelshortExperience:props:feed',
    'ReelshortExperience:props:normalizedFeed',
    'fillLandscape:input',
    'fillLandscape:output',
    'MediaRenderer',
    'DOM:reel-card'
];

async function parseConsole(msg) {
    const parts = [];
    for (const arg of msg.args()) {
        try {
            parts.push(await arg.jsonValue());
        } catch {
            parts.push(arg.toString());
        }
    }
    const payload = parts.find((p) => p && typeof p === 'object' && !Array.isArray(p)) || null;
    if (!payload || payload.stage === undefined) return null;
    return { ...payload, wallMs: Date.now() };
}

function firstZeroStage(stages) {
    const seen = new Map();
    for (const s of stages) {
        const key = s.stage;
        if (!seen.has(key)) seen.set(key, s);
    }
    const ordered = [];
    for (const name of STAGE_ORDER) {
        if (seen.has(name)) ordered.push(seen.get(name));
    }
    for (const s of seen.values()) {
        if (!ordered.find((o) => o.stage === s.stage)) ordered.push(s);
    }
    let prevCount = null;
    let prevStage = null;
    for (const s of ordered) {
        const count = Number(s.count);
        if (prevCount !== null && prevCount > 0 && count === 0) {
            return { stage: s.stage, previousStage: prevStage, previousCount: prevCount, snapshot: s };
        }
        if (count >= 0) {
            prevCount = count;
            prevStage = s.stage;
        }
    }
    return null;
}

async function checkDeployedBundle(baseUrl) {
    try {
        const html = await fetch(baseUrl).then((r) => r.text());
        const match = html.match(/assets\/index-[A-Za-z0-9_-]+\.js/);
        if (!match) return { bundle: null, hasBuildHomeFeed: false, hasBg7n: false };
        const bundleUrl = new URL(match[0], baseUrl).href;
        const js = await fetch(bundleUrl).then((r) => r.text());
        return {
            bundle: match[0],
            hasBuildHomeFeed: js.includes('BUILD_HOME_FEED') || js.includes('buildHomeFeed'),
            hasBg7n: js.includes('BG7N_STAGE')
        };
    } catch (err) {
        return { error: String(err?.message || err) };
    }
}

async function run() {
    const deployCheck = await checkDeployedBundle(FRONTEND_URL);
    const stages = [];
    const browser = await chromium.launch({
        headless: true,
        executablePath: fs.existsSync(CHROMIUM) ? CHROMIUM : undefined
    });
    const context = await browser.newContext();
    await context.addInitScript(() => {
        try {
            localStorage.clear();
            sessionStorage.clear();
        } catch {
            /* ignore */
        }
    });
    const page = await context.newPage();
    page.on('console', async (msg) => {
        if (!msg.text().includes('[BG7N_STAGE]')) return;
        const entry = await parseConsole(msg);
        if (entry) stages.push(entry);
    });

    await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(WAIT_MS);

    const domCount = await page.locator('.reel-card').count();
    const feedState = await page.evaluate(() => {
        try {
            const raw = localStorage.getItem('reelforge_feed') || '{}';
            const feed = JSON.parse(raw);
            const flat = Object.values(feed).flat();
            const ids = flat.map((r) => r?.id).filter(Boolean);
            return { realCards: flat.filter((r) => r && !r.isPlaceholder).length, total: flat.length, ids };
        } catch {
            return { realCards: 0, total: 0, ids: [] };
        }
    });

    await browser.close();

    const drop = firstZeroStage(stages);
    const report = {
        mission: 'BG-7N-PIPELINE-TRACE',
        frontendUrl: FRONTEND_URL,
        capturedAt: new Date().toISOString(),
        deployCheck,
        domReelCardCount: domCount,
        feedState,
        stageCount: stages.length,
        stages,
        firstDropToZero: drop
    };

    fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
}

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
