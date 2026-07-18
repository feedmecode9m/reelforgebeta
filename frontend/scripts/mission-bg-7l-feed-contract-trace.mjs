#!/usr/bin/env node
/**
 * BG-7L — capture canonical feed contract logs from production or local.
 * Usage:
 *   FRONTEND_URL=https://strong-lolly-a9fcb4.netlify.app/ OUT=/tmp/bg-7l-prod.json node scripts/mission-bg-7l-feed-contract-trace.mjs
 */
import fs from 'node:fs';
import { chromium } from 'playwright';

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://strong-lolly-a9fcb4.netlify.app/';
const OUT = process.env.OUT || '/tmp/bg-7l-feed-contract-trace.json';
const WAIT_MS = Number(process.env.WAIT_MS || 20000);
const CHROMIUM =
    process.env.CHROMIUM ||
    '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';

const TAGS = ['[BG7L_FEED_DECISION]', '[BG7L_FEED_SUMMARY]', '[BG7L_ROOT_CAUSE]'];

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
    const tag = TAGS.find((t) => msg.text().includes(t)) || null;
    return { tag, payload, text: msg.text(), wallMs: Date.now() };
}

async function fetchApiReels(baseUrl) {
    try {
        const origin = new URL(baseUrl).origin;
        const res = await fetch(`${origin}/api/reels?t=${Date.now()}`);
        if (!res.ok) return { ok: false, status: res.status, count: 0, reels: [] };
        const raw = await res.json();
        const arr = Array.isArray(raw) ? raw : [];
        return {
            ok: true,
            status: res.status,
            count: arr.length,
            reels: arr.map((r) => ({
                id: r?.id,
                category: r?.category,
                type: r?.type,
                url: r?.url || r?.video_url || '',
                fileName: r?.fileName || r?.file_name || ''
            }))
        };
    } catch (err) {
        return { ok: false, error: String(err?.message || err), count: 0, reels: [] };
    }
}

async function run() {
    const events = [];
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
        const text = msg.text();
        if (!TAGS.some((t) => text.includes(t))) return;
        events.push(await parseConsole(msg));
    });

    const apiSnapshot = await fetchApiReels(FRONTEND_URL);
    await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(WAIT_MS);

    const feedState = await page.evaluate(() => {
        try {
            const raw = localStorage.getItem('reelforge_feed') || '{}';
            const feed = JSON.parse(raw);
            const flat = Object.values(feed).flat();
            return {
                realCards: flat.filter((r) => r && !r.isPlaceholder).length,
                placeholders: flat.filter((r) => r?.isPlaceholder).length,
                total: flat.length
            };
        } catch {
            return { realCards: 0, placeholders: 0, total: 0 };
        }
    });

    await browser.close();

    const decisions = events.filter((e) => e.tag === '[BG7L_FEED_DECISION]');
    const summary = events.find((e) => e.tag === '[BG7L_FEED_SUMMARY]')?.payload ?? null;
    const rootCause = events.find((e) => e.tag === '[BG7L_ROOT_CAUSE]')?.payload ?? null;

    const report = {
        mission: 'BG-7L-CANONICAL-FEED-CONTRACT',
        frontendUrl: FRONTEND_URL,
        capturedAt: new Date().toISOString(),
        apiSnapshot,
        feedState,
        decisionCount: decisions.length,
        decisions: decisions.map((e) => e.payload),
        summary,
        rootCause,
        divergence:
            apiSnapshot.count !== (summary?.backendCatalogCount ?? decisions.length)
                ? 'api_count_mismatch_with_summary'
                : null
    };

    fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
}

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
