export function safeFirstFile(files) {
    try {
        if (!files) return null;

        if (Array.isArray(files)) {
            return files[0] || null;
        }

        if (files instanceof FileList) {
            return files.length > 0 ? files[0] : null;
        }

        return null;
    } catch (error) {
        console.error('safeFirstFile error:', error);
        return null;
    }
}

export function logUploadError(error, context = '') {
    console.error(
        `Upload error${context ? ` (${context})` : ''}:`,
        error
    );

    return {
        success: false,
        error: error?.message || 'Unknown upload error'
    };
}

export function safeFn(fn, fallback = null) {
    return (...args) => {
        try {
            return fn(...args);
        } catch (error) {
            console.error('safeFn caught error:', error);
            return fallback;
        }
    };
}

export function isValidVideoType(file) {
    if (!file) return false;

    const validTypes = [
        'video/mp4',
        'video/webm',
        'video/ogg',
        'video/quicktime',
        'video/x-msvideo',
        'video/mpeg'
    ];

    return validTypes.includes(file.type);
}

/** @param {Uint8Array | ArrayBuffer} input */
export function hasValidVideoContainerHeader(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes.length < 8) return false;

    // ISO BMFF (MP4/MOV): ....ftyp
    if (bytes.length >= 8 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
        return true;
    }

    // WebM / Matroska
    if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
        return true;
    }

    return false;
}

/**
 * Validate a video File/Blob before accepting it into the vault.
 * @param {File | Blob} file
 * @returns {Promise<{ valid: boolean, reason?: string }>}
 */
export async function validateVideoFile(file) {
    if (!file) return { valid: false, reason: 'No file provided' };
    if (file.size <= 0) return { valid: false, reason: 'File is empty (0 bytes)' };

    try {
        const header = await file.slice(0, 12).arrayBuffer();
        if (!hasValidVideoContainerHeader(header)) {
            return { valid: false, reason: 'Invalid video container (missing ftyp/WebM header)' };
        }
    } catch (error) {
        return { valid: false, reason: error?.message || 'Could not read file header' };
    }

    return { valid: true };
}

/** Convert Google Drive share links to direct download URLs. */
export function sanitizeGoogleDriveUrl(url) {
    if (!url || typeof url !== 'string') return url;
    const trimmed = url.trim();
    const match = trimmed.match(/drive\.google\.com\/file\/d\/([^/]+)/);
    if (match) {
        return `https://drive.google.com/uc?export=download&id=${match[1]}&confirm=t`;
    }
    return trimmed;
}

/** Reject empty, HTML, or trap URLs before assigning to a video element. */
export function isValidVideoUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const trimmed = url.trim();
    if (!trimmed) return false;
    if (trimmed.startsWith('data:text/html')) return false;
    if (/\.(html?|php|asp)(\?|$)/i.test(trimmed)) return false;
    if (trimmed.includes('drive.google.com/file/d/') && !trimmed.includes('export=download')) {
        return false;
    }
    if (trimmed.startsWith('blob:') || trimmed.startsWith('data:video/')) return true;
    if (trimmed.startsWith('http') || trimmed.startsWith('/')) return true;
    return /\.(mp4|mov|webm|m4v)(\?|$)/i.test(trimmed);
}
