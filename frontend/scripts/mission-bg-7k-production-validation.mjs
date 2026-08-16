#!/usr/bin/env node
/**
 * BG-7K-PROMOTION — production acceptance tests A–F on Netlify + Railway.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { ADMIN_SESSION_TOKEN_KEY } from '../src/lib/adminSession.js';
import {
    fillShelfPresentation,
    isLayoutOnlyCard,
    isRealShelfCard,
    MIN_SHELF_PRESENTATION_COUNT
} from '../src/lib/feed/fillShelfPresentation.js';

const FRONTEND_URL = (process.env.FRONTEND_URL || 'https://strong-lolly-a9fcb4.netlify.app/').replace(/\/?$/, '/');
const API_URL = (process.env.API_URL || 'https://reelforge-deploy-production.up.railway.app').replace(/\/$/, '');
const CHROMIUM =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';
const OUT_JSON = process.env.OUT || path.resolve(import.meta.dirname, '../artifacts/bg7k-production-validation.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** @type {Record<string, { pass: boolean, detail?: string, http?: unknown, console?: string[] }>} */
const scenarios = {};
/** @type {string[]} */
const consoleTraces = [];
/** @type {Array<Record<string, unknown>>} */
const httpTraces = [];

function record(id, pass, detail = '', extra = {}) {
    scenarios[id] = { pass: Boolean(pass), detail, ...extra };
    const mark = pass ? 'PASS' : 'FAIL';
    console.log(`${mark} ${id}${detail ? ` — ${detail}` : ''}`);
}

async function getLs(page, key) {
    return page.evaluate((k) => {
        try {
            return JSON.parse(localStorage.getItem(k) || 'null');
        } catch {
            return null;
        }
    }, key);
}

async function loginStudio(page) {
    if (!(await page.locator('.control-center-overlay').isVisible().catch(() => false))) {
        await page.locator('button.ghost-trigger').click({ timeout: 60000 });
    }
    await page.waitForSelector('.control-center-overlay', { timeout: 60000 });
    if (!(await page.locator('.logout-btn').isVisible().catch(() => false))) {
        if (await page.locator('.admin-login-panel').isVisible().catch(() => false)) {
            let ok = false;
            for (const password of ['Gaff1505!', 'SMART_PRODUCTION', 'admin123']) {
                await page.locator('.admin-login-panel input[type="password"]').fill(password);
                await page.locator('.admin-login-panel button.submit-btn').click();
                await sleep(2500);
                if (await page.locator('.logout-btn').isVisible().catch(() => false)) {
                    ok = true;
                    break;
                }
            }
            if (!ok) throw new Error('Studio login failed');
        }
    }
    const tab = page.locator('[data-studio-workspace-tabs] button', { hasText: 'Content' });
    if (await tab.isVisible().catch(() => false)) await tab.click();
    await page.waitForSelector('[data-workspace-panel-content]', { timeout: 60000 });
    await page.locator('.thumbnail-drop-zone').scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForSelector('.thumbnail-drop-zone', { timeout: 60000 });
}

async function reauthViaApi(page) {
    const result = await page.evaluate(async () => {
        for (const password of ['Gaff1505!', 'SMART_PRODUCTION', 'admin123']) {
            const res = await fetch('/admin/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            });
            const body = await res.json().catch(() => ({}));
            if (res.ok && body?.success && body?.token) {
                localStorage.setItem('reelforge_admin_session_token', body.token);
                window.dispatchEvent(
                    new CustomEvent('reelforge:admin-session-changed', { detail: { present: true } })
                );
                return { ok: true, tokenPrefix: String(body.token).slice(0, 8) };
            }
        }
        return { ok: false };
    });
    await sleep(500);
    return Boolean(result?.ok);
}

async function clearAdminToken(page) {
    await page.evaluate((k) => {
        localStorage.removeItem(k);
        window.dispatchEvent(
            new CustomEvent('reelforge:admin-session-changed', { detail: { present: false } })
        );
    }, ADMIN_SESSION_TOKEN_KEY);
    await sleep(400);
}

async function dropTestThumb(page, thumbPath) {
    const buf = fs.readFileSync(thumbPath);
    await page.evaluate(
        ({ b64, name }) => {
            const bin = atob(b64);
            const out = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
            const file = new File([out], name, { type: 'image/jpeg' });
            const dt = new DataTransfer();
            dt.items.add(file);
            const common = { dataTransfer: dt, bubbles: true, cancelable: true };
            const target = document.querySelector('.thumbnail-drop-zone');
            target.dispatchEvent(new DragEvent('dragenter', common));
            target.dispatchEvent(new DragEvent('dragover', common));
            target.dispatchEvent(new DragEvent('drop', common));
        },
        { b64: buf.toString('base64'), name: path.basename(thumbPath) }
    );
    await page.waitForSelector('.thumbnail-drop-zone .accept-btn', { timeout: 30000 });
}

function validateShelfLogic() {
    const oneReal = fillShelfPresentation([{ id: 'video-1', url: '/videos/a.mp4' }], 'Trending');
    const zeroReal = fillShelfPresentation([], 'Trending');
    const ePass =
        oneReal.length === 1 &&
        oneReal.filter(isLayoutOnlyCard).length === 0 &&
        oneReal.every(isRealShelfCard);
    const fPass =
        zeroReal.length === MIN_SHELF_PRESENTATION_COUNT &&
        zeroReal.every((item) => item.isPresentationOnly && item.layoutOnly && item.isPlaceholder);
    record('E_one_mp4_shelf', ePass, `display=${oneReal.length}, fillers=${oneReal.filter(isLayoutOnlyCard).length}`);
    record('F_zero_uploads_placeholders', fPass, `display=${zeroReal.length}`);
}

async function main() {
    const thumb = '/tmp/bg7k-prod-thumb.jpg';
    if (!fs.existsSync(thumb)) {
        execFileSync('ffmpeg', [
            '-y',
            '-hide_banner',
            '-loglevel',
            'error',
            '-f',
            'lavfi',
            '-i',
            'color=c=teal:s=320x240:d=0.1',
            '-frames:v',
            '1',
            thumb
        ]);
    }

    validateShelfLogic();

    const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true });
    const context = await browser.newContext();
    context.on('page', (p) => p.on('dialog', (d) => d.accept().catch(() => {})));

    const page = await context.newPage();
    page.on('console', (m) => {
        const t = m.text();
        if (/\[BG7S_SHELF_FILL\]|AUTH_SESSION_EXPIRED|UPLOAD_FAILED|invalid_session|Studio session|Studio login/.test(t)) {
            consoleTraces.push(t.slice(0, 400));
        }
    });
    page.on('response', async (res) => {
        const url = res.url();
        if (/\/api\/reels|\/admin\/auth/.test(url) && ['POST', 'GET'].includes(res.request().method())) {
            let body = null;
            try {
                body = await res.json();
            } catch {
                body = null;
            }
            httpTraces.push({
                method: res.request().method(),
                url,
                status: res.status(),
                body
            });
        }
    });

    // A — logged out: Accept disabled
    await context.addInitScript(() => {
        localStorage.clear();
        sessionStorage.setItem('bg7k-prod', '1');
    });
    await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await loginStudio(page);

    // A — no admin token: Accept disabled (session-absent gate)
    await clearAdminToken(page);
    await dropTestThumb(page, thumb);
    const acceptDisabledA = await page.locator('.thumbnail-drop-zone .accept-btn').isDisabled();
    const loginHintA = await page.locator('.pending-login-hint').isVisible().catch(() => false);
    record('A_logged_out_accept_disabled', acceptDisabledA && loginHintA, `disabled=${acceptDisabledA}, hint=${loginHintA}`);

    // B — fresh login: Accept enabled without page refresh
    const reauthed = await reauthViaApi(page);
    await dropTestThumb(page, thumb);
    const acceptEnabledB =
        reauthed && !(await page.locator('.thumbnail-drop-zone .accept-btn').isDisabled());
    record('B_fresh_login_accept_enabled', acceptEnabledB, `reauthed=${reauthed}, enabled=${acceptEnabledB}`);

    // D — expire session (before successful accept clears pending)
    await page.evaluate(
        (k) => {
            localStorage.setItem(k, 'rf_expired_bg7k_test_token');
            window.dispatchEvent(
                new CustomEvent('reelforge:admin-session-changed', { detail: { present: true } })
            );
        },
        ADMIN_SESSION_TOKEN_KEY
    );
    await sleep(500);
    const thumbsBeforeFail = await getLs(page, 'personal_thumbnails');
    let expiredStatus = 0;
    let expiredBody = {};
    const expiredP = page.waitForResponse(
        (r) => r.request().method() === 'POST' && /\/api\/reels(\?|$)/.test(r.url()),
        { timeout: 120000 }
    );
    await page.click('.thumbnail-drop-zone .accept-btn');
    try {
        const expiredRes = await expiredP;
        expiredStatus = expiredRes.status();
        expiredBody = await expiredRes.json().catch(() => ({}));
    } catch {
        expiredStatus = 0;
    }
    await sleep(400);
    const bannerShown = await page
        .locator('.global-operation-status__message', { hasText: 'Studio session expired' })
        .isVisible()
        .catch(() => false);
    const tokenAfter = await page.evaluate((k) => localStorage.getItem(k), ADMIN_SESSION_TOKEN_KEY);
    const thumbsAfterFail = await getLs(page, 'personal_thumbnails');
    const noVaultWrite =
        (thumbsBeforeFail?.length || 0) === (thumbsAfterFail?.length || 0);
    let pendingPreserved = false;
    try {
        if (!(await page.locator('.control-center-overlay').isVisible().catch(() => false))) {
            await page.locator('button.ghost-trigger').click({ timeout: 30000 });
        }
        await loginStudio(page);
        pendingPreserved = await page
            .locator('.thumbnail-drop-zone .pending-preview')
            .isVisible()
            .catch(() => false);
    } catch {
        pendingPreserved = false;
    }
    record(
        'D_expire_session_401',
        expiredStatus === 401 &&
            expiredBody?.error === 'invalid_session' &&
            !tokenAfter &&
            bannerShown &&
            pendingPreserved &&
            noVaultWrite,
        `status=${expiredStatus}, error=${expiredBody?.error}, tokenCleared=${!tokenAfter}, pending=${pendingPreserved}, banner=${bannerShown}, noVaultWrite=${noVaultWrite}`,
        { http: { status: expiredStatus, body: expiredBody } }
    );

    // C — upload thumbnail Accept → POST /api/reels 202
    await reauthViaApi(page);
    await dropTestThumb(page, thumb);
    let postStatus = 0;
    let postId = null;
    if (acceptEnabledB) {
        const postP = page.waitForResponse(
            (r) => r.request().method() === 'POST' && /\/api\/reels(\?|$)/.test(r.url()),
            { timeout: 120000 }
        );
        await page.click('.thumbnail-drop-zone .accept-btn');
        const postRes = await postP;
        postStatus = postRes.status();
        const postBody = await postRes.json().catch(() => ({}));
        postId = postBody.id || null;
        await sleep(3000);
        const statusText = await page.evaluate(() => {
            const el = document.querySelector('.upload-status, [class*="upload-status"]');
            return el?.textContent || '';
        }).catch(() => '');
        record(
            'C_upload_accept_202',
            postStatus === 202 && Boolean(postId),
            `status=${postStatus}, id=${postId}, ui=${statusText.slice(0, 80)}`,
            { http: { status: postStatus, id: postId } }
        );
    } else {
        record('C_upload_accept_202', false, 'skipped — login failed');
    }

    await browser.close();

    const matrix = Object.entries(scenarios).map(([id, v]) => ({ id, pass: v.pass, detail: v.detail }));
    const firstFail = matrix.find((r) => !r.pass)?.id || null;
    const allPass = matrix.every((r) => r.pass);

    const gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: path.resolve(import.meta.dirname, '../..'),
        encoding: 'utf8'
    }).trim();

    let bundleHash = 'unknown';
    try {
        const html = await fetch(FRONTEND_URL).then((r) => r.text());
        const m = html.match(/index-([A-Za-z0-9_-]+)\.js/);
        if (m) bundleHash = `index-${m[1]}.js`;
    } catch {
        /* ignore */
    }

    const payload = {
        mission: 'BG-7K-PROMOTION',
        generatedAt: new Date().toISOString(),
        environment: {
            frontend: FRONTEND_URL,
            backend: API_URL,
            bundleHash,
            gitCommit
        },
        scenarios: matrix,
        allPass,
        firstFailingBoundary: firstFail,
        httpTraces,
        consoleTraces: consoleTraces.slice(-40)
    };

    fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
    fs.writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2));
    console.log('\n--- BG-7K PRODUCTION VALIDATION ---');
    console.log(JSON.stringify({ allPass, firstFailingBoundary: firstFail, bundleHash, gitCommit }, null, 2));

    if (!allPass) process.exit(1);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
