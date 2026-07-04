function generateId() {
    return crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function normalizeMedia(media = {}) {
    return {
        id: media.id || generateId(),
        name: media.name || media.title || 'Untitled Media',
        title: media.title || media.name || 'Untitled Media',
        type: media.type || 'video/mp4',
        size: media.size || 0,
        url: media.url || media.src || '',
        src: media.src || media.url || '',
        thumbnail: media.thumbnail || '',
        createdAt: media.createdAt || Date.now(),
        addedAt: media.addedAt || Date.now(),
        category: media.category || 'Uncategorized',
        description: media.description || '',
        ...media
    };
}

export function normalizeDropzoneFile(file) {
    if (!file) return null;

    return normalizeMedia({
        id: generateId(),
        name: file.name,
        title: file.name,
        type: file.type,
        size: file.size,
        file,
        url: URL.createObjectURL(file),
        src: URL.createObjectURL(file),
        addedAt: Date.now()
    });
}

export function normalizeBackendReel(reel = {}) {
    return normalizeMedia({
        id: reel.id,
        title: reel.title || reel.name,
        description: reel.description,
        category: reel.category,
        thumbnail: reel.thumbnail,
        url: reel.videoUrl || reel.url,
        src: reel.videoUrl || reel.url,
        createdAt: reel.createdAt,
        ...reel
    });
}

/** Normalize a vault drag payload into a studio workspace clip. */
export function normalizeVaultDrop(payload = {}) {
    const meta = payload.metadata || {};
    const isThumbnail = payload.type === 'thumbnail';

    return normalizeMedia({
        id: payload.id,
        name: payload.name || payload.title,
        title: payload.title || payload.name,
        type: isThumbnail ? 'image/jpeg' : 'video/mp4',
        url: payload.url || payload.src,
        thumbnail: meta.thumbnail || payload.url || payload.src,
        category: meta.category || 'Trending',
        size: meta.size || 0,
        source: payload.source,
        vaultType: payload.type,
        isPersonalVideo: !isThumbnail,
        isPersonalThumbnail: isThumbnail,
        addedAt: meta.addedAt || Date.now()
    });
}
