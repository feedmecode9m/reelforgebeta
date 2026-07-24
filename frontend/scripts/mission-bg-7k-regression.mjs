#!/usr/bin/env node
/**
 * BG-7K-HARDEN — regression gate for auth hardening + shelf presentation fix.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
    ADMIN_SESSION_TOKEN_KEY,
    getAdminAuthHeaders,
    getAdminToken,
    isInvalidSessionError,
    maybeHandleInvalidAdminSession,
    setAdminSessionToken
} from '../src/lib/adminSession.js';
import {
    fillShelfPresentation,
    isLayoutOnlyCard,
    isRealShelfCard,
    MIN_SHELF_PRESENTATION_COUNT
} from '../src/lib/feed/fillShelfPresentation.js';

/** @type {Record<string, unknown>} */
const storage = {};

function installMockWindow() {
    const listeners = new Map();
    globalThis.window = {
        localStorage: {
            getItem: (key) => (key in storage ? storage[key] : null),
            setItem: (key, value) => {
                storage[key] = String(value);
            },
            removeItem: (key) => {
                delete storage[key];
            }
        },
        dispatchEvent(event) {
            const name = event?.type || event;
            for (const fn of listeners.get(name) || []) fn(event);
            return true;
        },
        addEventListener(name, fn) {
            if (!listeners.has(name)) listeners.set(name, new Set());
            listeners.get(name).add(fn);
        },
        removeEventListener(name, fn) {
            listeners.get(name)?.delete(fn);
        }
    };
    return listeners;
}

/** @type {Array<{ id: string, pass: boolean, detail?: string }>} */
const results = [];

function assert(id, condition, detail = '') {
    results.push({ id, pass: Boolean(condition), detail });
    const mark = condition ? 'PASS' : 'FAIL';
    console.log(`${mark} ${id}${detail ? ` — ${detail}` : ''}`);
}

function main() {
    installMockWindow();

    // 1 — Logged out: no auth headers
    delete storage[ADMIN_SESSION_TOKEN_KEY];
    assert('logged_out_no_token', getAdminToken() === null);
    assert('logged_out_empty_headers', Object.keys(getAdminAuthHeaders()).length === 0);

    // 2 — Fresh login writes token + headers
    setAdminSessionToken('rf_test_token');
    assert('fresh_login_token', getAdminToken() === 'rf_test_token');
    assert(
        'fresh_login_headers',
        getAdminAuthHeaders().Authorization === 'Bearer rf_test_token'
    );

    // 3 — invalid_session handling (exactly once)
    let expiredEvents = 0;
    globalThis.window.addEventListener('AUTH_SESSION_EXPIRED', () => {
        expiredEvents += 1;
    });
    const mockResponse = { status: 401 };
    assert(
        'invalid_session_handler',
        maybeHandleInvalidAdminSession(mockResponse, { error: 'invalid_session' }, 'test'),
        'first call handles'
    );
    assert('invalid_session_event_once', expiredEvents === 1, `events=${expiredEvents}`);
    assert(
        'invalid_session_handler_idempotent',
        maybeHandleInvalidAdminSession(mockResponse, { error: 'invalid_session' }, 'test') === false,
        'second call skipped'
    );
    assert('invalid_session_clears_token', getAdminToken() === null);
    assert('is_invalid_session_error', isInvalidSessionError(new Error('invalid_session')));

    // 4 — One real video: no presentation fillers
    const oneReal = fillShelfPresentation([{ id: 'video-1', url: '/videos/a.mp4' }], 'Trending');
    assert(
        'one_real_card_count',
        oneReal.length === 1,
        `display=${oneReal.length}`
    );
    assert(
        'one_real_no_layout_fillers',
        oneReal.filter(isLayoutOnlyCard).length === 0,
        `fillers=${oneReal.filter(isLayoutOnlyCard).length}`
    );
    assert(
        'one_real_is_real_shelf',
        oneReal.every(isRealShelfCard),
        'all real'
    );

    // 5 — Zero uploads: onboarding placeholders remain
    const empty = fillShelfPresentation([], 'Trending');
    assert(
        'zero_uploads_padded',
        empty.length === MIN_SHELF_PRESENTATION_COUNT,
        `display=${empty.length}`
    );
    assert(
        'zero_uploads_layout_markers',
        empty.every((item) => item.isPresentationOnly && item.layoutOnly && item.isPlaceholder),
        'layout-only markers'
    );

    const authRegression = {
        mission: 'BG-7K-HARDEN',
        generatedAt: new Date().toISOString(),
        tests: results.filter((r) => r.id.includes('logged') || r.id.includes('fresh') || r.id.includes('invalid')),
        pass: results.filter((r) => r.id.includes('logged') || r.id.includes('fresh') || r.id.includes('invalid')).every((r) => r.pass)
    };

    const placeholderRegression = {
        mission: 'BG-7K-HARDEN',
        generatedAt: new Date().toISOString(),
        tests: results.filter((r) => r.id.includes('real') || r.id.includes('uploads') || r.id.includes('layout')),
        pass: results.filter((r) => r.id.includes('real') || r.id.includes('uploads') || r.id.includes('layout')).every((r) => r.pass)
    };

    const allPass = results.every((r) => r.pass);
    console.log('\n--- SUMMARY ---');
    console.log(JSON.stringify({ allPass, total: results.length, failed: results.filter((r) => !r.pass).map((r) => r.id) }, null, 2));

    const artifactDir = path.resolve('frontend/artifacts');
    fs.mkdirSync(artifactDir, { recursive: true });
    fs.writeFileSync(path.join(artifactDir, 'bg7k-auth-regression.json'), JSON.stringify(authRegression, null, 2));
    fs.writeFileSync(
        path.join(artifactDir, 'bg7k-placeholder-regression.json'),
        JSON.stringify(placeholderRegression, null, 2)
    );

    if (!allPass) process.exit(1);
}

main();
