/**
 * Queue theater open from consumer account surfaces (Continue Watching / My List).
 * Consumed by Viewer after catalog bootstrap so theater + resume pipelines work.
 */

import { setPendingResume, clearPendingResume } from './resumePosition.js';

/** @typedef {{
 *   reelId: string;
 *   title?: string | null;
 *   thumbnailUrl?: string | null;
 *   positionSeconds?: number | null;
 *   durationSeconds?: number | null;
 *   completed?: boolean;
 *   resume?: boolean;
 *   source?: string;
 * }} AccountPlayRequest */

/** @type {AccountPlayRequest | null} */
let pending = null;

const EVENT = 'reelforge:account-play';

/**
 * @param {AccountPlayRequest} req
 */
export function queueAccountPlay(req) {
    const reelId = req?.reelId != null ? String(req.reelId).trim() : '';
    if (!reelId) {
        pending = null;
        return;
    }

    const resume = req.resume !== false;
    const completed = req.completed === true;
    const positionSeconds = Number(req.positionSeconds);
    const durationSeconds =
        req.durationSeconds != null && Number.isFinite(Number(req.durationSeconds))
            ? Number(req.durationSeconds)
            : null;

    pending = {
        reelId,
        title: req.title != null ? String(req.title) : null,
        thumbnailUrl: req.thumbnailUrl != null ? String(req.thumbnailUrl) : null,
        positionSeconds: Number.isFinite(positionSeconds) ? positionSeconds : null,
        durationSeconds,
        completed,
        resume,
        source: req.source || 'account'
    };

    // Seed resume for theater watchApplyResume path (skip when not resuming).
    if (resume && !completed && Number.isFinite(positionSeconds) && positionSeconds >= 3) {
        setPendingResume(reelId, positionSeconds, {
            completed: false,
            durationSeconds
        });
    } else if (!resume) {
        // Explicit start without continuing — clear any stale resume token.
        clearPendingResume();
    }

    if (typeof window !== 'undefined') {
        try {
            window.sessionStorage.setItem(
                'reelforge_account_play',
                JSON.stringify({
                    reelId: pending.reelId,
                    title: pending.title,
                    thumbnailUrl: pending.thumbnailUrl,
                    positionSeconds: pending.positionSeconds,
                    durationSeconds: pending.durationSeconds,
                    completed: pending.completed,
                    resume: pending.resume,
                    source: pending.source,
                    ts: Date.now()
                })
            );
        } catch {
            /* ignore quota */
        }
        window.dispatchEvent(
            new CustomEvent(EVENT, {
                detail: { ...pending }
            })
        );
    }
}

/** @returns {AccountPlayRequest | null} */
export function peekAccountPlay() {
    return pending ? { ...pending } : readStoredAccountPlay();
}

/** @returns {AccountPlayRequest | null} */
export function takeAccountPlay() {
    const fromMem = pending;
    pending = null;
    const fromStore = readStoredAccountPlay();
    clearStoredAccountPlay();
    return fromMem || fromStore;
}

export function clearAccountPlay() {
    pending = null;
    clearStoredAccountPlay();
}

export function getAccountPlayEventName() {
    return EVENT;
}

/** @returns {AccountPlayRequest | null} */
function readStoredAccountPlay() {
    if (typeof window === 'undefined') return null;
    try {
        const raw = window.sessionStorage.getItem('reelforge_account_play');
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed?.reelId) return null;
        // Drop stale plays older than 2 minutes.
        if (parsed.ts && Date.now() - Number(parsed.ts) > 120_000) {
            clearStoredAccountPlay();
            return null;
        }
        return {
            reelId: String(parsed.reelId),
            title: parsed.title != null ? String(parsed.title) : null,
            thumbnailUrl: parsed.thumbnailUrl != null ? String(parsed.thumbnailUrl) : null,
            positionSeconds:
                parsed.positionSeconds != null && Number.isFinite(Number(parsed.positionSeconds))
                    ? Number(parsed.positionSeconds)
                    : null,
            durationSeconds:
                parsed.durationSeconds != null && Number.isFinite(Number(parsed.durationSeconds))
                    ? Number(parsed.durationSeconds)
                    : null,
            completed: parsed.completed === true,
            resume: parsed.resume !== false,
            source: parsed.source || 'account'
        };
    } catch {
        return null;
    }
}

function clearStoredAccountPlay() {
    if (typeof window === 'undefined') return;
    try {
        window.sessionStorage.removeItem('reelforge_account_play');
    } catch {
        /* ignore */
    }
}

/**
 * Build a theater-openable reel object when catalog lookup miss.
 * Prefer findReelInFeed; fallback uses account metadata only.
 * @param {AccountPlayRequest} req
 * @param {(id: string) => Record<string, unknown> | null} findReel
 */
export function resolveAccountPlayReel(req, findReel) {
    if (!req?.reelId) return null;
    const found = typeof findReel === 'function' ? findReel(String(req.reelId)) : null;
    if (found && typeof found === 'object') return found;

    const title = req.title || 'Untitled';
    const thumb = req.thumbnailUrl || '';
    return {
        id: String(req.reelId),
        title,
        name: title,
        thumbnail: thumb,
        thumbnail_url: thumb,
        image: thumb,
        url: '',
        isPlaceholder: false,
        fromAccountPlay: true
    };
}
