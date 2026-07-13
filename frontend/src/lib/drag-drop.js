export const VAULT_MIME = 'application/x-reelforge-vault';

import { toBackendMediaUrl } from './config.js';
import { pipelineDiag } from './diagnostics/pipelineDiag.js';

export const VAULT_SOURCES = Object.freeze({
    MP4: 'mp4-vault',
    THUMBNAIL: 'thumbnail-vault',
    STUDIO: 'studio-clip',
    VIDEO: 'video-vault'
});

const DRAG_DEBUG = true;

export function logDrag(event, detail = {}) {
    if (DRAG_DEBUG) {
        pipelineDiag('DND', event, 'drag-drop.js', {
            assetId: detail.id || null,
            fileName: detail.name || detail.title || null,
            result: event,
            detail
        });
    }
}

export function buildVaultPayload(source, item = {}) {
    const isThumbnail = source === VAULT_SOURCES.THUMBNAIL || item.type === 'thumbnail';
    const rawSrc = item.src || item.url || item.thumbnail_url || item.thumbnail || item.previewUrl || '';
    const relativeSrc = rawSrc.startsWith('/') || rawSrc.startsWith('http') || rawSrc.startsWith('data:') || rawSrc.startsWith('blob:')
        ? rawSrc
        : (isThumbnail && rawSrc ? `/thumbs/${rawSrc}` : rawSrc);
    const src = toBackendMediaUrl(relativeSrc) || relativeSrc;
    const title = item.title || item.name || 'Untitled';

    return {
        source,
        vault: source === VAULT_SOURCES.MP4 ? VAULT_SOURCES.VIDEO : source,
        id: item.id || item.name || crypto.randomUUID(),
        url: src,
        src,
        name: title,
        title,
        type: isThumbnail ? 'thumbnail' : 'video',
        duration: item.duration || 0,
        metadata: {
            size: item.size || 0,
            thumbnail: item.thumbnail || item.thumbnail_url || src,
            category: item.category || 'Trending',
            mimeType: item.type || item.mimeType || (isThumbnail ? 'image/jpeg' : 'video/mp4'),
            addedAt: item.addedAt || new Date().toISOString()
        }
    };
}

export function serializeVaultPayload(payload) {
    return JSON.stringify(payload);
}

function normalizeParsedPayload(parsed) {
    if (!parsed || typeof parsed !== 'object') {
        return null;
    }

    const id = parsed.id;
    const type = parsed.type;
    const src = parsed.src || parsed.url || parsed.metadata?.thumbnail || '';

    if (!id || !type) {
        console.error('[DnD] Invalid drag payload — missing id or type:', parsed);
        return null;
    }

    if (!src && type !== 'thumbnail') {
        console.error('[DnD] Invalid drag payload — missing src:', parsed);
        return null;
    }

    const vault = parsed.vault || parsed.source;
    const source =
        vault ||
        (type === 'thumbnail' ? VAULT_SOURCES.THUMBNAIL : VAULT_SOURCES.MP4);

    return {
        source,
        vault,
        id,
        url: src,
        src,
        name: parsed.title || parsed.name || 'Untitled',
        title: parsed.title || parsed.name || 'Untitled',
        type,
        duration: parsed.duration || 0,
        metadata: parsed.metadata || {
            thumbnail: src,
            size: parsed.size || 0,
            addedAt: parsed.addedAt || new Date().toISOString()
        }
    };
}

export function parseVaultPayload(dataTransfer) {
    if (!dataTransfer) return null;

    const candidates = [
        dataTransfer.getData(VAULT_MIME),
        dataTransfer.getData('application/json'),
        dataTransfer.getData('text/plain')
    ];

    for (const raw of candidates) {
        if (!raw) continue;
        try {
            const parsed = JSON.parse(raw);
            const normalized = normalizeParsedPayload(parsed);
            if (normalized) {
                logDrag('parseVaultPayload:ok', normalized);
                return normalized;
            }
        } catch (err) {
            console.error('[DnD] JSON.parse failed for drag payload:', err.message);
        }
    }

    logDrag('parseVaultPayload:miss');
    return null;
}

export function setVaultDragData(dataTransfer, payload, dragImageEl = null) {
    const normalized = normalizeParsedPayload(payload) || payload;
    const jsonPayload = {
        id: normalized.id,
        type: normalized.type,
        src: normalized.src || normalized.url,
        title: normalized.title || normalized.name,
        duration: normalized.duration || 0,
        vault: normalized.vault || normalized.source
    };

    const json = JSON.stringify(jsonPayload);
    dataTransfer.setData(VAULT_MIME, json);
    dataTransfer.setData('application/json', json);
    dataTransfer.setData('text/plain', jsonPayload.title || jsonPayload.id || '');
    dataTransfer.effectAllowed = 'copyMove';

    if (dragImageEl) {
        dataTransfer.setDragImage(dragImageEl, 40, 40);
    }

    logDrag('dragstart', jsonPayload);
}

export function allowDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
    }
}
