/**
 * Phase 55 — Security enforcement policy engine.
 * Converts Sentinel threat levels into active containment controls.
 */

export const SECURITY_POLICY_STORAGE_KEY = 'reelforge_security_policy_state';
export const SECURITY_POLICY_VERSION = '1.0.0';

/** @typedef {'GREEN' | 'YELLOW' | 'ORANGE' | 'RED'} ThreatLevel */

/**
 * @typedef {Object} SecurityPolicyState
 * @property {string} version
 * @property {ThreatLevel} level
 * @property {boolean} warningActive
 * @property {number} uploadThrottleMs
 * @property {boolean} uploadLocked
 * @property {boolean} workflowFrozen
 * @property {number | null} adminNotificationAt
 * @property {number} updatedAt
 */

let policyInitialized = false;
let lastUploadGateAt = 0;

/**
 * @param {'SECURITY_POLICY' | 'SENTINEL_ACTION' | 'SENTINEL_CONTAINMENT'} tag
 * @param {Record<string, unknown>} [detail]
 */
export function logSecurityPolicyDiag(tag, detail = {}) {
    console.log(`[${tag}] ${JSON.stringify({ ...detail, timestamp: Date.now() })}`);
}

/** @returns {SecurityPolicyState} */
export function getDefaultSecurityPolicyState() {
    return {
        version: SECURITY_POLICY_VERSION,
        level: 'GREEN',
        warningActive: false,
        uploadThrottleMs: 0,
        uploadLocked: false,
        workflowFrozen: false,
        adminNotificationAt: null,
        updatedAt: Date.now()
    };
}

/** @returns {SecurityPolicyState} */
export function loadSecurityPolicyState() {
    if (typeof window === 'undefined') return getDefaultSecurityPolicyState();
    try {
        const raw = localStorage.getItem(SECURITY_POLICY_STORAGE_KEY);
        if (!raw) return getDefaultSecurityPolicyState();
        const parsed = JSON.parse(raw);
        return { ...getDefaultSecurityPolicyState(), ...parsed };
    } catch {
        return getDefaultSecurityPolicyState();
    }
}

/** @param {SecurityPolicyState} state */
export function persistSecurityPolicyState(state) {
    const next = {
        ...state,
        version: SECURITY_POLICY_VERSION,
        updatedAt: Date.now()
    };
    if (typeof window !== 'undefined') {
        localStorage.setItem(SECURITY_POLICY_STORAGE_KEY, JSON.stringify(next));
        window.dispatchEvent(new CustomEvent('reelforge:security-policy-updated', { detail: next }));
    }
    return next;
}

/**
 * @param {ThreatLevel} level
 * @param {SecurityPolicyState} current
 * @returns {SecurityPolicyState}
 */
function stateForThreatLevel(level, current) {
    if (level === 'RED') {
        return {
            ...current,
            level,
            warningActive: true,
            uploadThrottleMs: 0,
            uploadLocked: true,
            workflowFrozen: true
        };
    }
    if (level === 'ORANGE') {
        return {
            ...current,
            level,
            warningActive: true,
            uploadThrottleMs: 2000,
            uploadLocked: false,
            workflowFrozen: false
        };
    }
    if (level === 'YELLOW') {
        return {
            ...current,
            level,
            warningActive: true,
            uploadThrottleMs: 0,
            uploadLocked: false,
            workflowFrozen: false
        };
    }
    return {
        ...current,
        level: 'GREEN',
        warningActive: false,
        uploadThrottleMs: 0,
        uploadLocked: false,
        workflowFrozen: false
    };
}

/**
 * @param {ThreatLevel} level
 * @param {Record<string, unknown>} [context]
 */
async function maybeNotifyAdmin(level, context = {}) {
    if (level !== 'RED') return;
    const state = loadSecurityPolicyState();
    const now = Date.now();
    const cooldownMs = 5 * 60 * 1000;
    if (state.adminNotificationAt && now - state.adminNotificationAt < cooldownMs) return;

    if (typeof window !== 'undefined' && window.__reelforgeNotifications?.createNotification) {
        await window.__reelforgeNotifications.createNotification(
            'readiness_changed',
            'Sentinel automatic containment activated (RED): uploads locked and workflow frozen.',
            {
                enforcement: 'security_containment',
                level,
                ...context
            }
        );
    }
    persistSecurityPolicyState({
        ...state,
        adminNotificationAt: now
    });
    logSecurityPolicyDiag('SENTINEL_ACTION', {
        action: 'admin_notification',
        level
    });
}

/**
 * @param {{ level?: ThreatLevel; score?: number; activeThreats?: Array<Record<string, unknown>> }} snapshot
 * @param {{ source?: string }} [options]
 */
export function applySecurityPolicy(snapshot = {}, options = {}) {
    const current = loadSecurityPolicyState();
    const level = /** @type {ThreatLevel} */ (snapshot.level || current.level || 'GREEN');
    const next = stateForThreatLevel(level, current);
    const changed =
        next.level !== current.level ||
        next.warningActive !== current.warningActive ||
        next.uploadThrottleMs !== current.uploadThrottleMs ||
        next.uploadLocked !== current.uploadLocked ||
        next.workflowFrozen !== current.workflowFrozen;

    if (!changed) return current;

    const persisted = persistSecurityPolicyState(next);
    logSecurityPolicyDiag('SECURITY_POLICY', {
        source: options.source || 'policy_engine',
        fromLevel: current.level,
        toLevel: persisted.level,
        warningActive: persisted.warningActive,
        uploadThrottleMs: persisted.uploadThrottleMs,
        uploadLocked: persisted.uploadLocked,
        workflowFrozen: persisted.workflowFrozen,
        activeThreatCount: Array.isArray(snapshot.activeThreats) ? snapshot.activeThreats.length : 0
    });

    if (persisted.level === 'YELLOW') {
        logSecurityPolicyDiag('SENTINEL_ACTION', {
            action: 'warning',
            level: persisted.level
        });
    }
    if (persisted.level === 'ORANGE' && persisted.uploadThrottleMs > 0) {
        logSecurityPolicyDiag('SENTINEL_ACTION', {
            action: 'upload_throttling',
            level: persisted.level,
            throttleMs: persisted.uploadThrottleMs
        });
    }
    if (persisted.level === 'RED') {
        logSecurityPolicyDiag('SENTINEL_ACTION', {
            action: 'upload_lock',
            level: persisted.level
        });
        logSecurityPolicyDiag('SENTINEL_ACTION', {
            action: 'workflow_freeze',
            level: persisted.level
        });
        void maybeNotifyAdmin(persisted.level, {
            source: options.source || 'policy_engine'
        });
    }

    return persisted;
}

/**
 * @param {{ operation?: string }} [options]
 * @returns {{ allowed: boolean; throttleMs: number; reason: string }}
 */
export function enforceUploadPolicy(options = {}) {
    const state = loadSecurityPolicyState();
    if (state.uploadLocked) {
        logSecurityPolicyDiag('SENTINEL_CONTAINMENT', {
            operation: options.operation || 'upload',
            containment: 'upload_lock',
            blocked: true,
            level: state.level
        });
        return {
            allowed: false,
            throttleMs: 0,
            reason: 'Upload locked by Sentinel containment policy'
        };
    }

    if (state.uploadThrottleMs > 0) {
        const now = Date.now();
        const elapsed = now - lastUploadGateAt;
        const throttleMs = elapsed >= state.uploadThrottleMs ? 0 : state.uploadThrottleMs - elapsed;
        lastUploadGateAt = now + throttleMs;
        logSecurityPolicyDiag('SENTINEL_CONTAINMENT', {
            operation: options.operation || 'upload',
            containment: 'upload_throttle',
            blocked: false,
            throttleMs,
            level: state.level
        });
        return {
            allowed: true,
            throttleMs,
            reason: throttleMs > 0 ? 'Upload throttled by Sentinel containment policy' : 'Allowed'
        };
    }

    return { allowed: true, throttleMs: 0, reason: 'Allowed' };
}

/**
 * @param {{ operation?: string }} [options]
 * @returns {{ allowed: boolean; reason: string }}
 */
export function enforceWorkflowPolicy(options = {}) {
    const state = loadSecurityPolicyState();
    if (state.workflowFrozen) {
        logSecurityPolicyDiag('SENTINEL_CONTAINMENT', {
            operation: options.operation || 'workflow',
            containment: 'workflow_freeze',
            blocked: true,
            level: state.level
        });
        return {
            allowed: false,
            reason: 'Workflow mutations frozen by Sentinel containment policy'
        };
    }
    return { allowed: true, reason: 'Allowed' };
}

export function initSecurityPolicyEngine() {
    if (typeof window === 'undefined' || policyInitialized) return loadSecurityPolicyState();
    policyInitialized = true;

    const initial = loadSecurityPolicyState();
    window.addEventListener('reelforge:threat-updated', (event) => {
        const detail = /** @type {CustomEvent} */ (event).detail || {};
        applySecurityPolicy(detail, { source: 'threat-updated-event' });
    });

    window.__reelforgeSecurityPolicy = {
        SECURITY_POLICY_VERSION,
        SECURITY_POLICY_STORAGE_KEY,
        getSecurityPolicyState: loadSecurityPolicyState,
        applySecurityPolicy,
        enforceUploadPolicy,
        enforceWorkflowPolicy,
        logSecurityPolicyDiag
    };

    logSecurityPolicyDiag('SECURITY_POLICY', {
        phase: 'engine_initialized',
        level: initial.level,
        version: SECURITY_POLICY_VERSION
    });
    return initial;
}
