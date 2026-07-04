/**
 * Emits structured accessibility diagnostics for runtime verification.
 * @param {string} component
 * @param {Record<string, unknown>} [detail]
 */
export function emitAccessibilityAudit(component, detail = {}) {
    const payload = {
        component,
        ...detail,
        timestamp: Date.now()
    };
    console.info(`[ACCESSIBILITY_AUDIT] ${JSON.stringify(payload)}`);
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('reelforge:accessibility-audit', { detail: payload }));
    }
}
