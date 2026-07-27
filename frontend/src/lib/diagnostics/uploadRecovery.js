/**
 * Persist in-flight signed upload checkpoints across refresh/close.
 * Enables recovery messaging when a large upload was interrupted.
 */

const STORAGE_KEY = 'reelforge_upload_checkpoints';

/**
 * @typedef {{
 *   uploadKey: string;
 *   fileName: string;
 *   fileSize: number;
 *   reelId: string;
 *   uploadId: string;
 *   stage: string;
 *   startedAt: string;
 *   updatedAt: string;
 * }} UploadCheckpoint
 */

/** @returns {Record<string, UploadCheckpoint>} */
function readAll() {
    if (typeof window === 'undefined') return {};
    try {
        const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

/** @param {Record<string, UploadCheckpoint>} map */
function writeAll(map) {
    if (typeof window === 'undefined') return;
    try {
        if (!Object.keys(map).length) {
            localStorage.removeItem(STORAGE_KEY);
            return;
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    } catch {
        /* ignore quota */
    }
}

/**
 * @param {Partial<UploadCheckpoint> & { uploadKey: string; fileName: string }} patch
 */
export function saveUploadCheckpoint(patch) {
    const uploadKey = String(patch.uploadKey || '').trim();
    if (!uploadKey) return;
    const all = readAll();
    const prior = all[uploadKey];
    const now = new Date().toISOString();
    all[uploadKey] = {
        uploadKey,
        fileName: String(patch.fileName || prior?.fileName || ''),
        fileSize: Number(patch.fileSize ?? prior?.fileSize ?? 0),
        reelId: String(patch.reelId || prior?.reelId || ''),
        uploadId: String(patch.uploadId || prior?.uploadId || ''),
        stage: String(patch.stage || prior?.stage || 'unknown'),
        startedAt: prior?.startedAt || now,
        updatedAt: now
    };
    writeAll(all);
    console.info('[UPLOAD_CHECKPOINT]', all[uploadKey]);
}

/** @param {string} uploadKey */
export function clearUploadCheckpoint(uploadKey) {
    const key = String(uploadKey || '').trim();
    if (!key) return;
    const all = readAll();
    if (!all[key]) return;
    delete all[key];
    writeAll(all);
    console.info('[UPLOAD_CHECKPOINT]', { cleared: key });
}

/** @returns {UploadCheckpoint[]} */
export function listInterruptedUploadCheckpoints() {
    return Object.values(readAll()).filter((entry) => entry && entry.fileName);
}

/**
 * @param {(message: string) => void} [setStatus]
 * @returns {UploadCheckpoint[]}
 */
export function notifyInterruptedUploads(setStatus) {
    const interrupted = listInterruptedUploadCheckpoints();
    if (!interrupted.length) return interrupted;
    for (const entry of interrupted) {
        console.warn('[UPLOAD_RECOVERY]', {
            fileName: entry.fileName,
            fileSize: entry.fileSize,
            reelId: entry.reelId,
            uploadId: entry.uploadId,
            stage: entry.stage,
            startedAt: entry.startedAt,
            reason: 'interrupted_before_finalize'
        });
    }
    const first = interrupted[0];
    setStatus?.(
        `⚠️ Interrupted upload: ${first.fileName} — drop the file again (do not refresh during large uploads)`
    );
    return interrupted;
}
