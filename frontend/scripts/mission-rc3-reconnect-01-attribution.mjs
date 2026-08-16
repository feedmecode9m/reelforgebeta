#!/usr/bin/env node
/**
 * RC3-RECONNECT-01 — Event source attribution capture (evidence only).
 *
 * Arms session instrumentation (no app source changes), waits for one
 * "Backend reconnecting..." occurrence on Netlify production, writes
 * timeline + classification worksheet fields.
 *
 * Usage:
 *   WAIT_MS=300000 node scripts/mission-rc3-reconnect-01-attribution.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NETLIFY_LIVE = 'https://strong-lolly-a9fcb4.netlify.app/';
const FRONTEND_URL = (process.env.FRONTEND_URL || NETLIFY_LIVE).replace(/\/?$/, '/');
const WAIT_MS = Number(process.env.WAIT_MS || 300000);
const POST_EVENT_MS = Number(process.env.POST_EVENT_MS || 12000);
const OUT =
    process.env.OUT ||
    path.join(__dirname, '..', 'artifacts', 'rc3-reconnect-01-attribution.json');
const HAR_OUT =
    process.env.HAR_OUT ||
    path.join(__dirname, '..', 'artifacts', 'rc3-reconnect-01-attribution.har');
const CHROMIUM =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';

const OP_TEXT = 'Backend reconnecting...';

function assertNetlify(url) {
    const host = new URL(url).hostname.toLowerCase();
    if (host !== 'strong-lolly-a9fcb4.netlify.app') {
        throw new Error(`RC3-RECONNECT-01: evidence target must be ${NETLIFY_LIVE} (got ${url})`);
    }
}
assertNetlify(FRONTEND_URL);

const attributionSource = fs.readFileSync(
    path.join(__dirname, 'rc3-reconnect-01-attribution.snippet.js'),
    'utf8'
);

function isoNow() {
    return new Date().toISOString();
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function buildTimeline(occ) {
    if (!occ) return null;
    return [
        occ.browserLocalISO || occ.ts || null,
        occ.eventSource || 'unknown emitter',
        '↓',
        `reason/fingerprint: ${JSON.stringify(occ.stackFingerprint || {})}`,
        '↓',
        `backendConnectionStatus: ${JSON.stringify(occ.backendConnectionStatus || null)}`,
        '↓',
        `health: ${JSON.stringify(occ.lastHealth || null)} | lastOk: ${JSON.stringify(occ.lastSuccessfulApiCall || null)}`,
        '↓',
        `clear: ${occ.clearEvent || 'not cleared in window'} @ ${occ.clearedAt || '—'}`,
        '↓',
        `final: ${JSON.stringify(occ.finalState || null)} | classification: ${occ.classification}`
    ].join('\n\n');
}

async function main() {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });

    const report = {
        mission: 'RC3-RECONNECT-01',
        goal: 'Event source attribution for Backend reconnecting... (evidence only; no fixes)',
        generatedAt: isoNow(),
        frontendUrl: FRONTEND_URL,
        waitMs: WAIT_MS,
        captureStartAt: null,
        captureEndAt: null,
        bundle: null,
        healthAtStart: null,
        occurrences: [],
        timeline: null,
        classification: null,
        confidence: 'Low',
        zeroEventsDocumented: false,
        harnessArmed: false,
        playwrightNetwork: {
            health: [],
            apiOk: [],
            apiFail: [],
            reelsPost: [],
            syncPush: [],
            ws: []
        },
        observer: null,
        worksheet: {
            timestamp: null,
            eventSource: null,
            callStackTop: null,
            customEventName: null,
            backendConnectionStatus: null,
            navigatorOnLine: null,
            healthResult: null,
            lastSuccessfulApiCall: null,
            websocketState: null,
            currentUploadStatus: null,
            activeUpload: null,
            heroUploadActive: null,
            syncRunning: null,
            retryCount: null,
            clearedAt: null,
            clearEvent: null,
            finalState: null,
            classification: null
        },
        staticProducerInventory: {
            P1_api_retry: 'api.js fetchWithRetry catch → notifyBackendReconnecting',
            P2_sync_retry: 'viewerContext syncFromVault unhealthy → uploadStatus + notify',
            P3_consumer: 'viewerContext onBackendReconnecting (not independent)',
            health_banner_different_string: 'Reconnecting to backend…'
        },
        notes: [],
        pass: false
    };

    const launch = { headless: true };
    if (fs.existsSync(CHROMIUM)) launch.executablePath = CHROMIUM;

    const browser = await chromium.launch(launch);
    const context = await browser.newContext({
        ignoreHTTPSErrors: true,
        recordHar: { path: HAR_OUT, content: 'embed', mode: 'full' }
    });
    const page = await context.newPage();

    page.on('request', (req) => {
        const url = req.url();
        const method = req.method();
        if (url.includes('/api/health')) {
            report.playwrightNetwork.health.push({ at: isoNow(), url, phase: 'request' });
        }
        if (url.includes('/api/reels') && method === 'POST') {
            report.playwrightNetwork.reelsPost.push({ at: isoNow(), url, phase: 'request' });
        }
        if (url.includes('/api/sync/push')) {
            report.playwrightNetwork.syncPush.push({ at: isoNow(), url, phase: 'request' });
        }
    });

    page.on('response', (res) => {
        const url = res.url();
        const status = res.status();
        if (url.includes('/api/health')) {
            report.playwrightNetwork.health.push({ at: isoNow(), url, status, phase: 'response' });
        }
        if (url.includes('/api/') && status >= 200 && status < 300) {
            report.playwrightNetwork.apiOk.push({ at: isoNow(), url, status });
            if (report.playwrightNetwork.apiOk.length > 80) report.playwrightNetwork.apiOk.shift();
        }
        if (url.includes('/api/') && (status >= 400 || status === 0)) {
            report.playwrightNetwork.apiFail.push({ at: isoNow(), url, status });
        }
        if (url.includes('/api/reels') && res.request().method() === 'POST') {
            report.playwrightNetwork.reelsPost.push({ at: isoNow(), url, status, phase: 'response' });
        }
        if (url.includes('/api/sync/push')) {
            report.playwrightNetwork.syncPush.push({ at: isoNow(), url, status, phase: 'response' });
        }
    });

    page.on('websocket', (ws) => {
        const row = { url: ws.url(), openedAt: isoNow(), closedAt: null, code: null };
        report.playwrightNetwork.ws.push(row);
        ws.on('close', () => {
            row.closedAt = isoNow();
        });
    });

    report.captureStartAt = isoNow();
    console.info('[RC3-RECONNECT-01] start', report.captureStartAt, FRONTEND_URL);

    await page.addInitScript(attributionSource);
    await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.evaluate(attributionSource).catch(() => {});

    report.bundle = await page.evaluate(() => {
        const s = document.querySelector('script[src*="assets/index-"]');
        return s ? s.getAttribute('src') : null;
    });

    try {
        const health = await page.evaluate(async () => {
            const r = await fetch('/api/health');
            const body = await r.json().catch(() => null);
            return { status: r.status, body };
        });
        report.healthAtStart = health;
    } catch (e) {
        report.notes.push(`healthAtStart failed: ${e.message}`);
    }

    report.harnessArmed = await page.evaluate(() => Boolean(window.__rc3Reconnect01?.out));
    if (!report.harnessArmed) {
        report.notes.push('Attribution harness failed to arm');
    }

    const deadline = Date.now() + WAIT_MS;
    let firstOccAt = null;

    while (Date.now() < deadline) {
        const snap = await page.evaluate(() => {
            const cap = window.__rc3Reconnect01?.out || null;
            const op = document.querySelector('.global-operation-status__message');
            return {
                occurrenceCount: cap?.occurrences?.length || 0,
                classification: cap?.classification || null,
                opText: op ? String(op.textContent || '').trim() : '',
                lastOcc: cap?.occurrences?.slice(-1)[0] || null
            };
        });

        if (snap.occurrenceCount > 0 && !firstOccAt) {
            firstOccAt = isoNow();
            console.info('[RC3-RECONNECT-01] occurrence detected', firstOccAt, snap.classification);
            await sleep(POST_EVENT_MS);
            break;
        }

        // Also detect DOM text if harness missed event-only edge
        if (snap.opText.includes(OP_TEXT) && !firstOccAt) {
            firstOccAt = isoNow();
            console.info('[RC3-RECONNECT-01] DOM reconnect status detected', firstOccAt);
            await sleep(POST_EVENT_MS);
            break;
        }

        await sleep(500);
    }

    const finalCap = await page.evaluate(() => {
        try {
            window.__rc3Reconnect01?.scanDom?.();
        } catch {
            /* ignore */
        }
        return window.__rc3Reconnect01?.out || null;
    });

    report.captureEndAt = isoNow();
    report.observer = finalCap;
    report.occurrences = finalCap?.occurrences || [];

    const primary = report.occurrences[0] || null;
    report.timeline = buildTimeline(primary);
    report.classification = primary?.classification || finalCap?.classification || null;

    if (primary) {
        const stackLines = String(primary.callStack || '')
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean)
            .slice(0, 12);
        report.worksheet = {
            timestamp: primary.browserLocalISO || null,
            eventSource: primary.eventSource || null,
            callStackTop: stackLines,
            customEventName: primary.customEventName || null,
            backendConnectionStatus: primary.backendConnectionStatus || null,
            navigatorOnLine: primary.navigatorOnLine ?? null,
            healthResult: primary.lastHealth || null,
            lastSuccessfulApiCall: primary.lastSuccessfulApiCall || null,
            websocketState: primary.websocketState || null,
            currentUploadStatus: primary.currentUploadStatus || null,
            activeUpload: primary.activeUpload ?? null,
            heroUploadActive: primary.heroUploadActive ?? null,
            syncRunning: primary.syncRunning ?? null,
            retryCount: primary.retryCount ?? null,
            clearedAt: primary.clearedAt || null,
            clearEvent: primary.clearEvent || null,
            finalState: primary.finalState || null,
            classification: primary.classification || null
        };
        const hasEvent = Boolean(primary.customEventName);
        const fail = primary.lastFailedApiCall;
        const failDelta =
            fail?.at && primary.browserLocalISO
                ? Math.abs(new Date(primary.browserLocalISO).getTime() - new Date(fail.at).getTime())
                : null;
        const correlated =
            fail &&
            failDelta != null &&
            failDelta <= 250 &&
            (fail.status === 'network_error' || /timeout/i.test(String(fail.error || '')));
        if (primary.classification && primary.classification !== 'Unknown') {
            if ((hasEvent && primary.callStack) || (hasEvent && correlated) || correlated) {
                report.confidence = hasEvent || correlated ? 'High' : 'Medium';
            } else {
                report.confidence = 'Medium';
            }
        } else {
            report.confidence = 'Low';
        }
        report.correlation = { hasEvent, failDeltaMs: failDelta, correlated };
        report.pass = report.confidence !== 'Low';
    } else {
        report.zeroEventsDocumented = true;
        report.classification = null;
        report.confidence = report.harnessArmed ? 'Medium' : 'Low';
        report.notes.push(
            `No Backend reconnecting... occurrence within WAIT_MS=${WAIT_MS}. Harness armed=${report.harnessArmed}.`
        );
        report.pass = report.harnessArmed;
    }

    await context.close();
    await browser.close();

    fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
    console.info('[RC3-RECONNECT-01] wrote', OUT);
    console.info('[RC3-RECONNECT-01] classification', report.classification, 'confidence', report.confidence);
    if (report.timeline) {
        console.info('\n--- TIMELINE ---\n' + report.timeline + '\n----------------\n');
    }
}

main().catch((err) => {
    console.error('[RC3-RECONNECT-01] failed', err);
    process.exit(1);
});
