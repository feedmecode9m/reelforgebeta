/**
 * Presentation-only mapping for uploadStatus strings (no business logic).
 * @param {string | null | undefined} raw
 * @returns {{ kind: 'loading' | 'success' | 'warning' | 'error'; message: string; live: 'polite' | 'assertive' } | null}
 */
export function classifyOperationStatus(raw) {
  const text = String(raw ?? '').trim();
  if (!text || text === 'Standby') return null;

  const lower = text.toLowerCase();
  const message = stripLeadingEmoji(text);

  if (
    /^❌/u.test(text) ||
    /\berror\b/i.test(text) ||
    /\bfailed\b/i.test(text) ||
    /\bfail\b/i.test(text)
  ) {
    return { kind: 'error', message, live: 'assertive' };
  }

  if (
    /^⚠️|^⚠/u.test(text) ||
    lower.includes('backend offline') ||
    lower.includes('backend unreachable') ||
    lower.includes('storage full') ||
    lower.includes('select ') ||
    lower.includes('nothing to delete') ||
    lower.includes('not found') ||
    lower.includes('blocked from') ||
    lower.includes('cancelled') ||
    lower.includes('suggested')
  ) {
    return { kind: 'warning', message, live: 'polite' };
  }

  if (
    /^✅/u.test(text) ||
    /\bsuccess\b/i.test(text) ||
    /\bsynced\b/i.test(text) ||
    lower.includes('added to vault') ||
    lower.includes('content visible') ||
    lower.includes('hero updated successfully') ||
    /^🗑️ deleted/u.test(text) ||
    (lower.includes('deleted') && /\d+\/\d+/.test(lower))
  ) {
    return { kind: 'success', message, live: 'polite' };
  }

  if (
    /🔄|uploading|processing|deleting|analyzing|syncing|validating|synchroniz|refreshing|preview:|uploading|backfilling|unveiling|saving|auto-detecting|reconnecting|cleaning|maintenance/i.test(
      text
    )
  ) {
    return { kind: 'loading', message, live: 'polite' };
  }

  return { kind: 'loading', message, live: 'polite' };
}

/** @param {string} text */
function stripLeadingEmoji(text) {
  return text.replace(/^[\s\u{1F300}-\u{1FAFF}\u2600-\u27BF\uFE0F✅❌⚠️🔄📤🎬🖼️🗑️🔍🎯🔐🧹🤖💾🚀⚠]+/u, '').trim() || text;
}
