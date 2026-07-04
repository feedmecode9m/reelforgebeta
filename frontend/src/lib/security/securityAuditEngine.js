/**
 * Phase S1 — Platform-wide Security Audit Engine.
 * Static + runtime inspection of API surface, auth, permissions, storage, and env exposure.
 */

import { API_BASE_URL, BACKEND_URL } from '../config.js';
import { PRESERVED_KEYS, getLocalStorageSize, STORAGE_LIMITS } from '../storage.js';
import { CREATE_REEL_URL, MEDIA_API } from '../api/media.js';
import { NOTIFICATION_STORAGE_KEY } from '../notifications/notificationCenter.js';

/** @typedef {'Critical' | 'High' | 'Medium' | 'Low'} SecuritySeverity */

/**
 * @typedef {Object} SecurityRisk
 * @property {string} id
 * @property {SecuritySeverity} severity
 * @property {string} domain
 * @property {string} title
 * @property {string} detail
 * @property {string} recommendation
 * @property {boolean} [passing]
 */

/**
 * @typedef {Object} SecurityDomainReport
 * @property {string} id
 * @property {string} label
 * @property {number} score
 * @property {number} riskCount
 * @property {SecurityRisk[]} risks
 * @property {string[]} checksRun
 */

/**
 * @typedef {Object} SecurityAuditReport
 * @property {number} score
 * @property {Record<SecuritySeverity, number>} categories
 * @property {SecurityRisk[]} risks
 * @property {SecurityRisk[]} findings
 * @property {string[]} recommendations
 * @property {SecurityDomainReport[]} domains
 * @property {Record<string, unknown>} scoreReport
 * @property {Record<string, unknown>} riskReport
 * @property {number} timestamp
 */

export const SECURITY_AUDIT_VERSION = '1.0.0';

export const SECURITY_DOMAINS = /** @type {const} */ ([
    'uploadEndpoints',
    'mediaRoutes',
    'notificationRoutes',
    'workflowApis',
    'teamApis',
    'authentication',
    'permissions',
    'localStorageUsage',
    'apiExposure',
    'environmentVariables'
]);

/** @type {Record<SecuritySeverity, number>} */
const SEVERITY_PENALTY = {
    Critical: 14,
    High: 8,
    Medium: 4,
    Low: 2
};

/** @type {SecurityRisk[]} */
const STATIC_ROUTE_CATALOG = [
    {
        id: 'upload-post-reels',
        severity: 'High',
        domain: 'uploadEndpoints',
        title: 'Multipart upload surface',
        detail: 'POST /api/reels accepts video/thumbnail payloads — must require authenticated admin on backend.',
        recommendation: 'Enforce Bearer auth on all upload routes and validate MIME/size server-side.'
    },
    {
        id: 'upload-media-validate',
        severity: 'Medium',
        domain: 'uploadEndpoints',
        title: 'Pre-upload validation endpoint',
        detail: 'POST /api/media/validate inspects files without persisting — still a DoS vector if unauthenticated.',
        recommendation: 'Rate-limit /api/media/validate and require studio session for anonymous clients.'
    },
    {
        id: 'media-storage-list',
        severity: 'High',
        domain: 'mediaRoutes',
        title: 'Storage inventory routes',
        detail: 'GET /api/media/storage, /api/videos, /api/thumbnails expose filesystem inventory.',
        recommendation: 'Restrict media inventory to authenticated operators; avoid public listing in production.'
    },
    {
        id: 'media-delete-paths',
        severity: 'Critical',
        domain: 'mediaRoutes',
        title: 'Destructive media delete routes',
        detail: 'DELETE /api/media/storage/{file} and /api/storage/file/{file} can remove assets permanently.',
        recommendation: 'Require admin Bearer token and audit-log every delete; confirm CSRF-safe methods.'
    },
    {
        id: 'media-orphan-cleanup',
        severity: 'Critical',
        domain: 'mediaRoutes',
        title: 'Orphan cleanup mutation',
        detail: 'POST /api/media/cleanup/orphans?confirm=true bulk-deletes unreferenced files.',
        recommendation: 'Gate cleanup behind admin role, dry-run preview, and two-step confirmation.'
    },
    {
        id: 'notification-crud',
        severity: 'Medium',
        domain: 'notificationRoutes',
        title: 'Notification API surface',
        detail: 'Routes under /api/notifications support list, create, read, and read-all by userId query.',
        recommendation: 'Bind notifications to authenticated viewer identity; reject cross-user reads/writes.'
    },
    {
        id: 'workflow-task-mutations',
        severity: 'High',
        domain: 'workflowApis',
        title: 'Workflow task write APIs',
        detail: 'POST/PATCH/DELETE /api/workflow/tasks mutate production state without frontend Authorization headers.',
        recommendation: 'Attach studio session token to workflow writes and enforce series-scoped RBAC server-side.'
    },
    {
        id: 'team-membership-mutations',
        severity: 'High',
        domain: 'teamApis',
        title: 'Team membership mutations',
        detail: 'POST /api/teams, member add/remove, and assign-task routes change collaboration permissions.',
        recommendation: 'Require OWNER/PRODUCER roles on team mutations; validate userId server-side.'
    },
    {
        id: 'admin-auth-endpoint',
        severity: 'High',
        domain: 'authentication',
        title: 'Admin authentication endpoint',
        detail: 'POST /admin/auth validates studio passwords — brute-force and credential stuffing risk.',
        recommendation: 'Use rate limiting, lockout policy, and rotate default credentials in production.'
    },
    {
        id: 'admin-token-localstorage',
        severity: 'Critical',
        domain: 'authentication',
        title: 'Admin session token in localStorage',
        detail: 'reelforge_admin_session_token persists in localStorage and is readable by any XSS payload.',
        recommendation: 'Prefer HttpOnly secure cookies or short-lived tokens with refresh rotation.'
    },
    {
        id: 'dev-local-password-fallback',
        severity: 'Critical',
        domain: 'authentication',
        title: 'Dev-only password fallback enabled',
        detail: 'Studio login accepts hardcoded local passwords when backend auth fails.',
        recommendation: 'Strip local password fallback from production builds; fail closed when backend is unreachable.'
    },
    {
        id: 'default-admin-password-env',
        severity: 'High',
        domain: 'environmentVariables',
        title: 'Default admin password in client bundle',
        detail: 'VITE_ADMIN_PASSWORD falls back to admin123 when unset — may ship in client-accessible config.',
        recommendation: 'Never embed production passwords in Vite env; inject at deploy time via secrets manager.'
    },
    {
        id: 'workflow-no-auth-header',
        severity: 'High',
        domain: 'permissions',
        title: 'Workflow client lacks Authorization header',
        detail: 'workflowFetch does not attach Bearer tokens — relies entirely on backend enforcement.',
        recommendation: 'Send Authorization on all mutating API calls from studio surfaces.'
    },
    {
        id: 'team-no-auth-header',
        severity: 'High',
        domain: 'permissions',
        title: 'Team client lacks Authorization header',
        detail: 'teamFetch does not attach Bearer tokens for membership or assignment operations.',
        recommendation: 'Propagate studio admin token to team APIs and verify role server-side.'
    },
    {
        id: 'upload-optional-auth',
        severity: 'Medium',
        domain: 'permissions',
        title: 'Upload auth header is optional in some paths',
        detail: 'Vault and hero uploads pass Authorization only when token exists — empty header still attempts upload.',
        recommendation: 'Block upload UI actions unless authenticated; reject unauthenticated createReel calls client-side.'
    },
    {
        id: 'localstorage-broad-surface',
        severity: 'Medium',
        domain: 'localStorageUsage',
        title: 'Broad localStorage persistence surface',
        detail: 'Vault, feed, workflow, notifications, pipeline, and admin token share browser localStorage.',
        recommendation: 'Minimize sensitive keys, encrypt at rest where possible, and namespace by user.'
    },
    {
        id: 'localstorage-quota-pressure',
        severity: 'Low',
        domain: 'localStorageUsage',
        title: 'localStorage quota pressure',
        detail: 'Client enforces ~5MB cap but large vault blobs increase eviction and data-loss risk.',
        recommendation: 'Move large media to backend storage; keep localStorage for preferences only.'
    },
    {
        id: 'api-base-empty-dev',
        severity: 'Low',
        domain: 'apiExposure',
        title: 'Relative API base in development',
        detail: 'Empty API_BASE_URL in dev routes through Vite proxy — acceptable locally but must not leak to prod.',
        recommendation: 'Ensure production builds set VITE_API_BASE_URL or VITE_BACKEND_URL explicitly.'
    },
    {
        id: 'backend-url-missing-prod',
        severity: 'High',
        domain: 'apiExposure',
        title: 'Production backend URL requirement',
        detail: 'Missing VITE_BACKEND_URL in production logs a console error and yields empty media origin.',
        recommendation: 'Fail CI when production env lacks VITE_BACKEND_URL and VITE_API_BASE_URL.'
    },
    {
        id: 'public-media-static-routes',
        severity: 'Medium',
        domain: 'apiExposure',
        title: 'Public media static routes',
        detail: 'Videos and thumbnails resolve to /videos and /thumbs paths on backend origin.',
        recommendation: 'Use signed URLs or CDN tokens for non-public assets in production.'
    },
    {
        id: 'vite-env-client-visible',
        severity: 'Low',
        domain: 'environmentVariables',
        title: 'Vite env vars exposed to client',
        detail: 'import.meta.env.VITE_* variables are bundled into frontend — never store secrets in VITE_ keys.',
        recommendation: 'Keep secrets server-side; use VITE_ prefix only for non-sensitive configuration.'
    },
    {
        id: 'debug-ingest-url',
        severity: 'Low',
        domain: 'environmentVariables',
        title: 'Debug ingest endpoint in development',
        detail: 'VITE_DEBUG_INGEST_URL can POST diagnostics externally during dev sessions.',
        recommendation: 'Disable debug ingest in production builds and strip from release bundles.'
    }
];

/**
 * @param {'SECURITY_AUDIT' | 'SECURITY_RISK' | 'SECURITY_SCORE'} tag
 * @param {Record<string, unknown>} [detail]
 */
export function logSecurityDiag(tag, detail = {}) {
    console.log(`[${tag}] ${JSON.stringify({ ...detail, timestamp: Date.now() })}`);
}

/** @param {SecuritySeverity} severity */
function severityRank(severity) {
    return { Critical: 0, High: 1, Medium: 2, Low: 3 }[severity];
}

/** @param {SecurityRisk[]} risks */
function summarizeCategories(risks) {
    return risks.reduce(
        (acc, risk) => {
            if (!risk.passing) acc[risk.severity] += 1;
            return acc;
        },
        /** @type {Record<SecuritySeverity, number>} */ ({
            Critical: 0,
            High: 0,
            Medium: 0,
            Low: 0
        })
    );
}

/** @param {SecurityRisk[]} risks */
function computeScore(risks) {
    const penalty = risks
        .filter((risk) => !risk.passing)
        .reduce((sum, risk) => sum + SEVERITY_PENALTY[risk.severity], 0);
    return Math.max(0, Math.min(100, 100 - penalty));
}

/** @param {SecurityRisk[]} risks */
function buildRecommendations(risks) {
    return [...risks]
        .filter((risk) => !risk.passing)
        .sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
        .map((risk) => `${risk.severity}: ${risk.recommendation}`)
        .filter((value, index, arr) => arr.indexOf(value) === index)
        .slice(0, 12);
}

/** @returns {SecurityRisk[]} */
function probeRuntimeRisks() {
    /** @type {SecurityRisk[]} */
    const runtime = [];

    if (typeof window === 'undefined') return runtime;

    try {
        const adminToken = localStorage.getItem('reelforge_admin_session_token');
        if (adminToken) {
            runtime.push({
                id: 'runtime-admin-token-present',
                severity: 'Critical',
                domain: 'authentication',
                title: 'Active admin token in browser storage',
                detail: 'Session token detected in localStorage during audit — XSS could exfiltrate studio access.',
                recommendation: 'Clear tokens on logout; migrate to HttpOnly session cookies.'
            });
        }
    } catch {
        runtime.push({
            id: 'runtime-localstorage-blocked',
            severity: 'Medium',
            domain: 'localStorageUsage',
            title: 'localStorage access blocked',
            detail: 'Browser blocked localStorage reads — persistence and auth state may be unreliable.',
            recommendation: 'Detect private mode / blocked storage and degrade studio features safely.'
        });
    }

    try {
        const adminMode = localStorage.getItem('admin_mode') === 'true';
        if (adminMode) {
            runtime.push({
                id: 'runtime-admin-mode-flag',
                severity: 'Medium',
                domain: 'permissions',
                title: 'Admin mode flag persisted locally',
                detail: 'admin_mode=true in localStorage can re-open studio without re-authentication.',
                recommendation: 'Revalidate admin session on studio open; expire admin_mode when token invalid.'
            });
        }
    } catch {
        /* ignore */
    }

    const storageBytes = getLocalStorageSize();
    if (storageBytes >= STORAGE_LIMITS.WARN_BYTES) {
        runtime.push({
            id: 'runtime-storage-near-limit',
            severity: 'Low',
            domain: 'localStorageUsage',
            title: 'localStorage nearing client quota',
            detail: `Approx ${Math.round(storageBytes / 1024)}KB used of ${Math.round(STORAGE_LIMITS.MAX_TOTAL_BYTES / 1024)}KB client cap.`,
            recommendation: 'Purge stale vault entries and migrate heavy assets to backend storage.'
        });
    }

    if (import.meta.env.PROD && !BACKEND_URL) {
        runtime.push({
            id: 'runtime-prod-backend-missing',
            severity: 'High',
            domain: 'environmentVariables',
            title: 'Production build missing backend URL',
            detail: 'BACKEND_URL resolved empty — media and API calls may hit wrong origin.',
            recommendation: 'Set VITE_BACKEND_URL in production deployment pipeline before release.'
        });
    }

    if (import.meta.env.VITE_ADMIN_PASSWORD === 'admin123' || (!import.meta.env.VITE_ADMIN_PASSWORD && import.meta.env.DEV)) {
        runtime.push({
            id: 'runtime-default-admin-password',
            severity: import.meta.env.PROD ? 'Critical' : 'High',
            domain: 'environmentVariables',
            title: 'Default or unset admin password configuration',
            detail: 'Client config uses fallback admin password — weak credential for studio access.',
            recommendation: 'Configure strong VITE_ADMIN_PASSWORD only for dev; use backend auth in production.'
        });
    }

    return runtime;
}

/** @param {string} domainId */
function domainLabel(domainId) {
    const labels = {
        uploadEndpoints: 'Upload Endpoints',
        mediaRoutes: 'Media Routes',
        notificationRoutes: 'Notification Routes',
        workflowApis: 'Workflow APIs',
        teamApis: 'Team APIs',
        authentication: 'Authentication',
        permissions: 'Permissions',
        localStorageUsage: 'localStorage Usage',
        apiExposure: 'API Exposure',
        environmentVariables: 'Environment Variables'
    };
    return labels[domainId] || domainId;
}

/** @param {string} domainId @param {SecurityRisk[]} risks */
function buildDomainReport(domainId, risks) {
    const domainRisks = risks.filter((risk) => risk.domain === domainId);
    const failing = domainRisks.filter((risk) => !risk.passing);
    const domainPenalty = failing.reduce((sum, risk) => sum + SEVERITY_PENALTY[risk.severity], 0);
    const score = Math.max(0, 100 - domainPenalty);

    return /** @type {SecurityDomainReport} */ ({
        id: domainId,
        label: domainLabel(domainId),
        score,
        riskCount: failing.length,
        risks: domainRisks,
        checksRun: [
            `${domainId}:routes-cataloged`,
            `${domainId}:severity-scored`,
            `${domainId}:recommendations-generated`
        ]
    });
}

/** @param {SecurityRisk[]} risks */
function annotatePassingFlags(risks) {
    return risks.map((risk) => {
        if (risk.id === 'api-base-empty-dev') {
            return { ...risk, passing: !(import.meta.env.DEV && !API_BASE_URL) };
        }
        if (risk.id === 'backend-url-missing-prod') {
            return { ...risk, passing: !(import.meta.env.PROD && !BACKEND_URL) };
        }
        if (risk.id === 'vite-env-client-visible') {
            return { ...risk, passing: true };
        }
        if (risk.id === 'debug-ingest-url') {
            return { ...risk, passing: !import.meta.env.DEV };
        }
        if (risk.id === 'localstorage-quota-pressure') {
            return { ...risk, passing: getLocalStorageSize() < STORAGE_LIMITS.WARN_BYTES };
        }
        if (risk.id === 'dev-local-password-fallback') {
            return { ...risk, passing: import.meta.env.PROD };
        }
        return { ...risk, passing: false };
    });
}

/**
 * Run platform-wide security audit.
 * @param {{ emitDiagnostics?: boolean }} [options]
 * @returns {SecurityAuditReport}
 */
export function runSecurityAudit(options = {}) {
    const emitDiagnostics = options.emitDiagnostics !== false;

    const catalog = annotatePassingFlags(STATIC_ROUTE_CATALOG.map((risk) => ({ ...risk })));
    const runtimeRisks = probeRuntimeRisks().map((risk) => ({ ...risk, passing: false }));
    const risks = [...catalog, ...runtimeRisks];
    const domains = SECURITY_DOMAINS.map((domainId) => buildDomainReport(domainId, risks));
    const score = Math.round(
        domains.reduce((sum, domain) => sum + domain.score, 0) / Math.max(domains.length, 1)
    );
    const categories = summarizeCategories(risks);
    const recommendations = buildRecommendations(risks);

    const scoreReport = {
        score,
        grade: score >= 85 ? 'Strong' : score >= 70 ? 'Moderate' : score >= 50 ? 'Weak' : 'Critical',
        categories,
        domainScores: Object.fromEntries(domains.map((domain) => [domain.id, domain.score])),
        checksRun: risks.length,
        passingChecks: risks.filter((risk) => risk.passing).length,
        version: SECURITY_AUDIT_VERSION
    };

    const riskReport = {
        totalFindings: risks.filter((risk) => !risk.passing).length,
        categories,
        risks: risks.filter((risk) => !risk.passing),
        domains: domains.map((domain) => ({
            id: domain.id,
            label: domain.label,
            score: domain.score,
            riskCount: domain.riskCount
        })),
        auditedRoutes: {
            upload: [CREATE_REEL_URL, '/api/media/validate', ...Object.keys(MEDIA_API)],
            media: ['/api/media/storage', '/api/videos', '/api/thumbnails', '/api/media/cleanup/orphans'],
            notifications: ['/api/notifications', '/api/notifications/unread-count'],
            workflow: ['/api/workflow/status', '/api/workflow/tasks'],
            team: ['/api/teams/status', '/api/teams', '/api/users'],
            auth: ['/admin/auth']
        },
        localStorageKeys: {
            preserved: [...PRESERVED_KEYS],
            notifications: NOTIFICATION_STORAGE_KEY,
            adminToken: 'reelforge_admin_session_token'
        },
        apiExposure: {
            apiBaseUrl: API_BASE_URL || '(relative/proxy)',
            backendUrl: BACKEND_URL || '(unset)'
        },
        environment: {
            dev: import.meta.env.DEV,
            prod: import.meta.env.PROD,
            viteBackendUrl: import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL || null,
            viteApiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? import.meta.env.VITE_API_URL ?? null,
            viteAdminPasswordConfigured: Boolean(import.meta.env.VITE_ADMIN_PASSWORD),
            viteWatchTracking: import.meta.env.VITE_REELFORGE_WATCH_TRACKING || null
        }
    };

    const report = /** @type {SecurityAuditReport} */ ({
        score,
        categories,
        risks,
        findings: risks.filter((risk) => !risk.passing),
        recommendations,
        domains,
        scoreReport,
        riskReport,
        timestamp: Date.now()
    });

    if (emitDiagnostics) {
        logSecurityDiag('SECURITY_AUDIT', {
            phase: 'complete',
            score,
            categories,
            domainCount: domains.length,
            findingCount: report.findings.length,
            version: SECURITY_AUDIT_VERSION
        });

        for (const risk of report.findings.slice(0, 8)) {
            logSecurityDiag('SECURITY_RISK', {
                id: risk.id,
                severity: risk.severity,
                domain: risk.domain,
                title: risk.title
            });
        }

        logSecurityDiag('SECURITY_SCORE', scoreReport);
    }

    return report;
}

let securityAuditInitialized = false;

/** @param {{ autoRun?: boolean }} [options] */
export function initSecurityAuditEngine(options = {}) {
    if (typeof window === 'undefined' || securityAuditInitialized) return null;
    securityAuditInitialized = true;

    const run = () => runSecurityAudit({ emitDiagnostics: true });

    window.__reelforgeSecurityAudit = {
        SECURITY_AUDIT_VERSION,
        SECURITY_DOMAINS,
        runSecurityAudit,
        logSecurityDiag
    };

    logSecurityDiag('SECURITY_AUDIT', {
        phase: 'engine_initialized',
        version: SECURITY_AUDIT_VERSION,
        domains: SECURITY_DOMAINS.length
    });

    if (options.autoRun !== false) {
        return run();
    }

    return null;
}
