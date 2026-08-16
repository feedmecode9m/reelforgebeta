#!/usr/bin/env node
/**
 * PRODUCT-08B — Reconnect evidence capture (read-only / no app code changes).
 *
 * Opens one production tab, installs a console-only DOM observer (no fetch/WS patches),
 * records /api/sync/push + WebSocket lifecycle on a shared timeline, and waits for one
 * natural "Backend reconnecting..." operation-status event.
 *
 * Evidence source: Netlify live ONLY
 *   https://strong-lolly-a9fcb4.netlify.app/
 * Localhost / 127.0.0.1 targets are refused (wrong topology for 08B).
 *
 * Usage:
 *   node scripts/mission-product-08b-reconnect-capture.mjs
 *   WAIT_MS=180000 node scripts/mission-product-08b-reconnect-capture.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NETLIFY_LIVE = 'https://strong-lolly-a9fcb4.netlify.app/';
const FRONTEND_URL = (process.env.FRONTEND_URL || NETLIFY_LIVE).replace(/\/?$/, '/');
/** PRODUCT-08B evidence must exercise Netlify edge → Railway, not localhost topology. */
function assertNetlifyEvidenceTarget(url) {
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        throw new Error(`PRODUCT-08B: invalid FRONTEND_URL: ${url}`);
    }
    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')) {
        throw new Error(
            `PRODUCT-08B: refusing local evidence target (${url}). Use ${NETLIFY_LIVE}`
        );
    }
    if (host !== 'strong-lolly-a9fcb4.netlify.app') {
        throw new Error(
            `PRODUCT-08B: unexpected host ${host}. Evidence source must be ${NETLIFY_LIVE}`
        );
    }
}
assertNetlifyEvidenceTarget(FRONTEND_URL);
const WAIT_MS = Number(process.env.WAIT_MS || 300000);
const POST_EVENT_MS = Number(process.env.POST_EVENT_MS || 8000);
const EVENT_ID = process.env.EVENT_ID || '2';
const OUT =
    process.env.OUT ||
    path.join(__dirname, '..', 'artifacts', `product-08b-reconnect-capture-event${EVENT_ID}.json`);
const HAR_OUT =
    process.env.HAR_OUT ||
    path.join(__dirname, '..', 'artifacts', `product-08b-reconnect-capture-event${EVENT_ID}.har`);
const CHROMIUM =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';

const OP_TEXT = 'Backend reconnecting...';
const BANNER_TEXT = 'Reconnecting to backend';
const WS_URL_HINT = '/ws/control-center';

const observerSource = fs.readFileSync(
    path.join(__dirname, 'product-08b-console-observer.snippet.js'),
    'utf8'
);

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function isoNow() {
    return new Date().toISOString();
}

function classifyPattern(count, gapsMs) {
    if (count === 0) return 'inconclusive';
    const burst = gapsMs.filter((g) => g < 5000).length;
    if (count <= 5 && burst === 0) return 'A';
    if (count > 10 && burst > count / 2) return 'B';
    // Worksheet also treats 1–5 with short gaps as needing interpretation;
    // use frozen matrix: seconds-apart storm needs tens+.
    if (count <= 5) return 'A';
    return 'inconclusive';
}

function computeGaps(timestamps) {
    const gaps = [];
    for (let i = 1; i < timestamps.length; i += 1) {
        gaps.push(new Date(timestamps[i]).getTime() - new Date(timestamps[i - 1]).getTime());
    }
    return gaps;
}

async function main() {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });

    const report = {
        mission: 'PRODUCT-08B-RECONNECT-CAPTURE',
        eventId: EVENT_ID,
        releaseContext: 'RC1-2026-07-18-001',
        generatedAt: isoNow(),
        frontendUrl: FRONTEND_URL,
        waitMs: WAIT_MS,
        captureStartAt: null,
        captureEndAt: null,
        clocks: {
            note: 'browserLocalISO = wall clock in page; performanceNowMs + timeOrigin correlate DOM to Network within same document',
            captureStartBrowserLocalISO: null,
            captureStartPerformance: null
        },
        worksheet: {
            bannerAppeared: null,
            firstSyncPush200: null,
            bannerDisappeared: null,
            syncPushCount: null,
            firstRequestTimestamp: null,
            lastRequestTimestamp: null,
            firstToLastDurationMs: null,
            bannerDurationMs: null,
            pattern: null,
            wsState: null
        },
        derived: {
            bannerToFirstSyncPush200Ms: null,
            averageIntervalMs: null,
            longestGapMs: null,
            shortestGapMs: null,
            gapsMs: []
        },
        network: {
            syncPushAll: [],
            syncPushInEventWindow: []
        },
        websocket: {
            urlExpected: `wss://strong-lolly-a9fcb4.netlify.app${WS_URL_HINT}`,
            frames: [],
            attempts: []
        },
        observer: null,
        confidence: 'Low',
        exitCriterionMatch: null,
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

    const syncPush = [];
    const wsAttempts = [];

    page.on('request', async (req) => {
        if (!req.url().includes('/api/sync/push')) return;
        let pageClock = null;
        try {
            pageClock = await page.evaluate(() => ({
                browserLocalISO: new Date().toISOString(),
                performanceNowMs: performance.now(),
                timeOrigin: performance.timeOrigin
            }));
        } catch {
            pageClock = { browserLocalISO: isoNow(), performanceNowMs: null, timeOrigin: null };
        }
        syncPush.push({
            id: req.url() + '|' + Date.now() + '|' + Math.random(),
            url: req.url(),
            method: req.method(),
            startedAt: pageClock.browserLocalISO || isoNow(),
            browserLocalISO: pageClock.browserLocalISO,
            performanceNowMs: pageClock.performanceNowMs,
            timeOrigin: pageClock.timeOrigin,
            requestBodyBytes:
                typeof req.postDataBuffer === 'function' && req.postDataBuffer()
                    ? req.postDataBuffer().length
                    : req.postData()
                      ? Buffer.byteLength(req.postData(), 'utf8')
                      : null,
            status: null,
            finishedAt: null,
            durationMs: null,
            failed: false,
            failureText: null
        });
    });

    page.on('response', async (res) => {
        if (!res.url().includes('/api/sync/push')) return;
        const pending = [...syncPush].reverse().find((r) => r.url === res.url() && r.status == null);
        if (!pending) return;
        pending.status = res.status();
        pending.finishedAt = isoNow();
        pending.durationMs =
            new Date(pending.finishedAt).getTime() - new Date(pending.startedAt).getTime();
    });

    page.on('requestfailed', (req) => {
        if (!req.url().includes('/api/sync/push')) return;
        const pending = [...syncPush].reverse().find((r) => r.url === req.url() && r.status == null);
        if (!pending) return;
        pending.failed = true;
        pending.failureText = req.failure()?.errorText || 'requestfailed';
        pending.finishedAt = isoNow();
        pending.durationMs =
            new Date(pending.finishedAt).getTime() - new Date(pending.startedAt).getTime();
    });

    page.on('websocket', (ws) => {
        const attempt = {
            url: ws.url(),
            openedAt: null,
            closedAt: null,
            errorAt: null,
            closeCode: null,
            closeReason: null,
            frames: [],
            correlatedWithBanner: null
        };
        if (ws.url().includes(WS_URL_HINT) || true) {
            attempt.attemptAt = isoNow();
            wsAttempts.push(attempt);
            report.websocket.frames.push({ ts: attempt.attemptAt, kind: 'attempt', url: ws.url() });
        }

        ws.on('framereceived', (frame) => {
            attempt.frames.push({ ts: isoNow(), direction: 'received', payloadBytes: String(frame.payload || '').length });
        });
        ws.on('framesent', (frame) => {
            attempt.frames.push({ ts: isoNow(), direction: 'sent', payloadBytes: String(frame.payload || '').length });
        });
        ws.on('socketerror', () => {
            attempt.errorAt = isoNow();
            report.websocket.frames.push({ ts: attempt.errorAt, kind: 'error', url: ws.url() });
        });
        ws.on('close', () => {
            attempt.closedAt = isoNow();
            // Playwright does not expose close code/reason on this event.
            attempt.closeCode = 'unavailable';
            attempt.closeReason = 'unavailable';
            report.websocket.frames.push({
                ts: attempt.closedAt,
                kind: 'close',
                url: ws.url(),
                closeCode: attempt.closeCode,
                closeReason: attempt.closeReason
            });
        });

        // open is implicit when socket is created and not immediately closed;
        // mark open when first frame activity or shortly after attempt without error.
        attempt.openedAt = isoNow();
        report.websocket.frames.push({ ts: attempt.openedAt, kind: 'open_or_established', url: ws.url() });
    });

    report.captureStartAt = isoNow();
    console.info('[PRODUCT-08B] capture start', report.captureStartAt, FRONTEND_URL, `event=${EVENT_ID}`);

    await page.addInitScript(observerSource);
    await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
    // Re-install after navigation in case init script raced.
    await page.evaluate(observerSource).catch(() => {});
    report.clocks.captureStartPerformance = await page
        .evaluate(() => ({
            browserLocalISO: new Date().toISOString(),
            performanceNowMs: performance.now(),
            timeOrigin: performance.timeOrigin
        }))
        .catch(() => null);
    report.clocks.captureStartBrowserLocalISO =
        report.clocks.captureStartPerformance?.browserLocalISO || report.captureStartAt;

    const deadline = Date.now() + WAIT_MS;
    let appeared = false;
    let disappeared = false;
    let opAppearedAt = null;
    let opDisappearedAt = null;
    let bannerAppearedAt = null;
    let bannerDisappearedAt = null;

    while (Date.now() < deadline) {
        const snap = await page.evaluate(() => {
            const cap = window.__product08bCapture?.out || null;
            const op = document.querySelector('.global-operation-status__message');
            const banner = document.querySelector('.backend-health-banner__message');
            return {
                cap,
                opText: op ? String(op.textContent || '').trim() : '',
                bannerText: banner ? String(banner.textContent || '').trim() : ''
            };
        }).catch(() => ({ cap: null, opText: '', bannerText: '' }));

        if (snap.cap) report.observer = snap.cap;

        if (!appeared && (snap.opText.includes(OP_TEXT) || snap.cap?.operationStatus?.appearedAt)) {
            appeared = true;
            opAppearedAt =
                snap.cap?.operationStatus?.appearedAt ||
                isoNow();
            console.info('[PRODUCT-08B] operation status appeared', opAppearedAt, snap.opText);
        }

        if (
            !bannerAppearedAt &&
            (snap.bannerText.includes(BANNER_TEXT) || snap.cap?.healthBanner?.appearedAt)
        ) {
            bannerAppearedAt = snap.cap?.healthBanner?.appearedAt || isoNow();
            console.info('[PRODUCT-08B] health banner appeared', bannerAppearedAt, snap.bannerText);
        }

        if (appeared && !disappeared) {
            const gone =
                !snap.opText.includes(OP_TEXT) &&
                Boolean(snap.cap?.operationStatus?.disappearedAt || snap.cap?.operationStatus?.appearedAt);
            if (!snap.opText.includes(OP_TEXT) && snap.cap?.operationStatus?.appearedAt) {
                // Prefer observer disappearance; else infer now once text cleared after appear.
                if (snap.cap.operationStatus.disappearedAt || !snap.opText) {
                    disappeared = true;
                    opDisappearedAt = snap.cap.operationStatus.disappearedAt || isoNow();
                    console.info('[PRODUCT-08B] operation status disappeared', opDisappearedAt);
                    break;
                }
            }
            // If observer already recorded disappearance
            if (snap.cap?.operationStatus?.disappearedAt) {
                disappeared = true;
                opDisappearedAt = snap.cap.operationStatus.disappearedAt;
                break;
            }
            void gone;
        }

        if (
            bannerAppearedAt &&
            !bannerDisappearedAt &&
            !snap.bannerText.includes(BANNER_TEXT) &&
            snap.cap?.healthBanner?.disappearedAt
        ) {
            bannerDisappearedAt = snap.cap.healthBanner.disappearedAt;
        }

        await sleep(250);
    }

    // Brief post-window to let in-flight sync/push finish responses.
    if (appeared) await sleep(POST_EVENT_MS);

    const finalCap = await page.evaluate(() => {
        if (window.__product08bCapture?.stop) return window.__product08bCapture.stop();
        return window.__product08bCapture?.out || null;
    }).catch(() => null);
    if (finalCap) report.observer = finalCap;

    opAppearedAt = opAppearedAt || finalCap?.operationStatus?.appearedAt || null;
    opDisappearedAt = opDisappearedAt || finalCap?.operationStatus?.disappearedAt || null;
    bannerAppearedAt = bannerAppearedAt || finalCap?.healthBanner?.appearedAt || null;
    bannerDisappearedAt = bannerDisappearedAt || finalCap?.healthBanner?.disappearedAt || null;

    report.network.syncPushAll = syncPush;
    report.websocket.attempts = wsAttempts;

    report.captureEndAt = isoNow();

    const windowStart = opAppearedAt ? new Date(opAppearedAt).getTime() : null;
    // If natural disappearance was not observed, close the measurement window at capture end
    // and mark bannerDisappeared null (minimum duration = appear → capture end).
    const windowEndExclusive = opDisappearedAt
        ? new Date(opDisappearedAt).getTime()
        : opAppearedAt
          ? new Date(report.captureEndAt).getTime()
          : null;
    if (opAppearedAt && !opDisappearedAt) {
        report.notes.push(
            'Operation-status still visible at capture end; bannerDisappeared left null; sync window uses capture end.'
        );
        report.eventWindowDefinition =
            'operation-status appear → capture end (natural disappear not observed)';
    } else if (opAppearedAt && opDisappearedAt) {
        report.eventWindowDefinition = 'operation-status appear → disappear';
    }

    const inWindow =
        windowStart != null && windowEndExclusive != null
            ? syncPush.filter((r) => {
                  const t = new Date(r.startedAt).getTime();
                  return t >= windowStart && t <= windowEndExclusive;
              })
            : [];

    report.network.syncPushInEventWindow = inWindow;

    const starts = inWindow.map((r) => r.startedAt);
    const gaps = computeGaps(starts);
    const first200 = inWindow.find((r) => r.status === 200);

    report.worksheet.bannerAppeared = opAppearedAt;
    report.worksheet.bannerDisappeared = opDisappearedAt;
    report.worksheet.firstSyncPush200 = first200?.finishedAt || first200?.startedAt || null;
    report.worksheet.syncPushCount = windowStart != null ? inWindow.length : null;
    report.worksheet.firstRequestTimestamp = starts[0] || null;
    report.worksheet.lastRequestTimestamp = starts.length ? starts[starts.length - 1] : null;
    report.worksheet.firstToLastDurationMs =
        starts.length >= 2
            ? new Date(starts[starts.length - 1]).getTime() - new Date(starts[0]).getTime()
            : starts.length === 1
              ? 0
              : null;
    report.worksheet.bannerDurationMs =
        opAppearedAt && opDisappearedAt
            ? new Date(opDisappearedAt).getTime() - new Date(opAppearedAt).getTime()
            : opAppearedAt
              ? new Date(report.captureEndAt).getTime() - new Date(opAppearedAt).getTime()
              : null;
    if (opAppearedAt && !opDisappearedAt) {
        report.worksheet.bannerStillVisibleAtCaptureEnd = report.captureEndAt;
    }
    report.worksheet.pattern =
        windowStart != null ? classifyPattern(inWindow.length, gaps) : null;

    // WS state near the same event (allow 5s before appear through window end)
    const wsInWindow = wsAttempts.filter((a) => {
        if (windowStart == null || windowEndExclusive == null) return false;
        const t = new Date(a.attemptAt || a.openedAt || 0).getTime();
        return t >= windowStart - 5000 && t <= windowEndExclusive + 2000;
    });
    const controlCenter = (
        wsInWindow.length ? wsInWindow : wsAttempts
    ).filter((a) => String(a.url || '').includes(WS_URL_HINT));
    if (windowStart == null) {
        report.worksheet.wsState = null;
    } else if (controlCenter.length === 0) {
        report.worksheet.wsState = 'no WS activity';
    } else if (controlCenter.some((a) => a.errorAt)) {
        report.worksheet.wsState = 'failed';
    } else if (controlCenter.some((a) => a.closedAt && !a.errorAt)) {
        report.worksheet.wsState = 'closed';
    } else if (controlCenter.some((a) => a.openedAt && !a.closedAt)) {
        report.worksheet.wsState = '101';
    } else {
        report.worksheet.wsState = 'failed';
    }

    for (const a of controlCenter) {
        a.correlatedWithBanner = Boolean(windowStart);
    }

    report.derived.gapsMs = gaps;
    report.derived.payloadBytesSample = inWindow[0]?.requestBodyBytes ?? null;
    report.derived.statusCodes = [...new Set(inWindow.map((r) => r.status))];
    if (gaps.length === 0) {
        report.derived.averageIntervalMs = null;
        report.derived.longestGapMs = null;
        report.derived.shortestGapMs = null;
    } else {
        report.derived.averageIntervalMs = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
        report.derived.longestGapMs = Math.max(...gaps);
        report.derived.shortestGapMs = Math.min(...gaps);
    }
    report.derived.bannerToFirstSyncPush200Ms =
        opAppearedAt && first200
            ? new Date(first200.startedAt).getTime() - new Date(opAppearedAt).getTime()
            : null;

    const hasCore =
        Boolean(opAppearedAt) &&
        Boolean(opDisappearedAt) &&
        report.worksheet.syncPushCount != null &&
        report.worksheet.wsState != null;
    const naturalComplete = hasCore;

    if (!hasCore) {
        report.confidence = 'Low';
        report.exitCriterionMatch = null;
        report.notes.push(
            'Incomplete event: require banner appear+clear, sync/push window metrics, and WS lifecycle before classification.'
        );
        if (opAppearedAt && !opDisappearedAt) {
            report.notes.push('Banner clear not observed — Event remains Low confidence (correlation gap).');
        }
    } else {
        const pattern = report.worksheet.pattern;
        const bannerMs = report.worksheet.bannerDurationMs ?? 0;
        const lagMs =
            first200 && opDisappearedAt
                ? new Date(opDisappearedAt).getTime() -
                  new Date(first200.finishedAt || first200.startedAt).getTime()
                : null;
        const expectedWsFallback =
            report.worksheet.wsState === 'failed' ||
            report.worksheet.wsState === 'closed' ||
            report.worksheet.wsState === 'no WS activity';

        if (pattern === 'B') {
            report.exitCriterionMatch = '3';
            report.confidence = 'High';
        } else if (pattern === 'A' && lagMs != null && lagMs > 5000) {
            report.exitCriterionMatch = '2';
            report.confidence = 'High';
        } else if (pattern === 'A' && bannerMs <= 10000 && expectedWsFallback) {
            report.exitCriterionMatch = '1';
            report.confidence = 'High';
        } else if (pattern === 'A') {
            report.exitCriterionMatch = '1';
            report.confidence = 'Medium';
            report.notes.push('Pattern A matched but one observation is ambiguous.');
        } else {
            report.exitCriterionMatch = null;
            report.confidence = 'Low';
            report.notes.push('Pattern inconclusive; do not scope PRODUCT-08B yet.');
        }
    }

    report.pass = hasCore && report.confidence !== 'Low';
    report.healthBanner = {
        appearedAt: bannerAppearedAt,
        disappearedAt: bannerDisappearedAt,
        note: 'Recorded separately from exact operation-status Backend reconnecting...'
    };

    await context.close();
    await browser.close();

    fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
    console.info('[PRODUCT-08B] wrote', OUT);
    console.info('[PRODUCT-08B] har', HAR_OUT);
    console.info(
        '[PRODUCT-08B] summary',
        JSON.stringify(
            {
                worksheet: report.worksheet,
                derived: report.derived,
                confidence: report.confidence,
                exitCriterionMatch: report.exitCriterionMatch,
                pass: report.pass
            },
            null,
            2
        )
    );
}

main().catch((err) => {
    console.error('[PRODUCT-08B] fatal', err);
    process.exit(1);
});
