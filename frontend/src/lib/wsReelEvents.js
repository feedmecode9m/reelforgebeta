import { BACKEND_URL, USE_SAME_ORIGIN_API } from './config.js';
import { normalizeReel } from './api/reelContract.js';

const WS_DEBUG = import.meta.env.VITE_DEBUG_API === 'true';

/**
 * Subscribe to backend reel CREATED/DELETED events.
 * @param {{ onCreated?: (reel: Record<string, unknown>) => void; onDeleted?: (payload: { id: string }) => void }} handlers
 * @returns {() => void} unsubscribe / close
 */
export function connectReelEventSocket(handlers = {}) {
    if (typeof WebSocket === 'undefined') return () => {};

    const wsBase =
        USE_SAME_ORIGIN_API && typeof window !== 'undefined'
            ? window.location.origin.replace(/^http/, 'ws')
            : (BACKEND_URL || '').replace(/^http/, 'ws');
    const url = wsBase ? `${wsBase}/ws/control-center` : null;
    if (!url) {
        if (import.meta.env.DEV) {
            console.warn('[ws] BACKEND_URL unset — skipping control-center socket');
        }
        return () => {};
    }

    let socket;
    try {
        socket = new WebSocket(url);
        if (WS_DEBUG) console.info('[WS_DEBUG] connecting', { url });
    } catch (e) {
        console.warn('[ws] connect failed', e);
        return () => {};
    }

    socket.onopen = () => {
        if (WS_DEBUG) console.info('[WS_DEBUG] open', { url, readyState: socket.readyState });
    };

    socket.onmessage = (event) => {
        if (WS_DEBUG) console.info('[WS_DEBUG] message', { size: String(event?.data || '').length });
        try {
            const msg = JSON.parse(event.data);
            const eventType = msg.eventType || msg.type;

            if (eventType === 'CREATED' && handlers.onCreated) {
                const reel = normalizeReel(msg, 'WS CREATED');
                if (reel) handlers.onCreated(reel);
            }
            if (eventType === 'DELETED' && handlers.onDeleted) {
                handlers.onDeleted({ id: String(msg.id) });
            }
        } catch (e) {
            console.warn('[ws] bad message', e);
        }
    };

    socket.onerror = () => {
        if (import.meta.env.DEV) console.warn('[ws] control-center error');
        if (WS_DEBUG) console.warn('[WS_DEBUG] error', { readyState: socket.readyState });
    };

    socket.onclose = (event) => {
        if (WS_DEBUG) {
            console.info('[WS_DEBUG] close', {
                code: event.code,
                reason: event.reason,
                clean: event.wasClean
            });
        }
    };

    return () => {
        try {
            socket?.close();
        } catch {
            /* ignore */
        }
    };
}
