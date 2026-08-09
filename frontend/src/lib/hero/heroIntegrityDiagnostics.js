/**
 * Hero Integrity Diagnostics — admin-only report surface.
 *
 * Does not affect public presentation. Never promotes intelligence to identity.
 *
 * Authority:     who may publish
 * Verification:  whether stored state is trustable
 * Presentation:  public-safe copy only after verification
 *
 * @see ./heroAuthorityVerification.js
 */

import { resolveHeroAuditHeroId } from './heroAuditEvents.js';
import { verifyHeroRecordIntegrity } from './heroAuthorityVerification.js';

/** Match heroRecord storage key without importing heroRecord (cycle safety). */
const HERO_RECORD_STORAGE_KEY = 'reelforge_hero_record';

/**
 * @typedef {Object} HeroIntegrityReport
 * @property {string} heroId
 * @property {boolean} verified
 * @property {string} reason
 * @property {string[]} violations
 * @property {string} presentationStatus
 * @property {number} auditEventCount
 * @property {number} generatedAt
 */

/**
 * Read raw storage without verification side effects (admin diagnostics).
 * @returns {Record<string, unknown> | null}
 */
export function loadHeroRecordRawForDiagnostics() {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return null;
    try {
        const raw = localStorage.getItem(HERO_RECORD_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object'
            ? /** @type {Record<string, unknown>} */ (parsed)
            : null;
    } catch {
        return null;
    }
}

/**
 * @param {unknown} [heroRecord]
 * @returns {HeroIntegrityReport}
 */
export function getHeroIntegrityReport(heroRecord) {
    const raw =
        heroRecord && typeof heroRecord === 'object'
            ? /** @type {Record<string, unknown>} */ (heroRecord)
            : loadHeroRecordRawForDiagnostics();
    const result = verifyHeroRecordIntegrity(raw);
    const presentation =
        raw?.heroPresentation && typeof raw.heroPresentation === 'object'
            ? /** @type {Record<string, unknown>} */ (raw.heroPresentation)
            : {};
    const auditLog = Array.isArray(raw?.auditLog) ? raw.auditLog : [];

    return {
        heroId: resolveHeroAuditHeroId(raw),
        verified: result.verified === true,
        reason: result.reason || '',
        violations: [...(result.violations || [])],
        presentationStatus: String(presentation.status || 'draft'),
        auditEventCount: auditLog.length,
        generatedAt: Date.now()
    };
}

/**
 * Flat violation list for admin surfaces.
 * @param {unknown} [heroRecord]
 * @returns {string[]}
 */
export function listIntegrityViolations(heroRecord) {
    return getHeroIntegrityReport(heroRecord).violations;
}
