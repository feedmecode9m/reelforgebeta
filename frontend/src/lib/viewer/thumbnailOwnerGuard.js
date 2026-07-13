/**
 * Mission 5.8.8 — personal_thumbnails write authorization guard.
 */

let vaultWriteDepth = 0;

export function enterThumbnailVaultWrite() {
  vaultWriteDepth += 1;
}

export function exitThumbnailVaultWrite() {
  vaultWriteDepth = Math.max(0, vaultWriteDepth - 1);
}

export function isThumbnailVaultWriteActive() {
  return vaultWriteDepth > 0;
}

/**
 * @param {string} caller
 * @param {unknown} payload
 */
export function logThumbOwnerViolation(caller, payload) {
  const list = Array.isArray(payload) ? payload : [];
  console.warn('[THUMB_OWNER_VIOLATION]', {
    caller,
    payloadSize: list.length,
    stack: new Error().stack?.split('\n').slice(1, 12).map((l) => l.trim()) ?? []
  });
}
