/**
 * Studio guidance diagnostics (Phase 8).
 */

/**
 * @param {'STUDIO_HELP' | 'STUDIO_WARNING' | 'STUDIO_COACH' | 'STUDIO_ACTION_ENGINE' | 'STUDIO_WALKTHROUGH' | 'WORKFLOW_ENGINE' | 'RELEASE_CENTER' | 'CREATOR_COPILOT' | 'SERIES_API' | 'SYNC' | 'METRICS'} tag
 * @param {Record<string, unknown>} payload
 */
export function logStudioGuidanceDiag(tag, payload) {
    console.log(`[${tag}] ${JSON.stringify({ ...payload, timestamp: Date.now() })}`);
}
