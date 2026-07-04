import { API_BASE_URL, fetchWithRetry } from '../api.js';

function logRevenueApiDiag(tag, detail = {}) {
    console.log(`[${tag}] ${JSON.stringify({ ...detail, timestamp: Date.now() })}`);
}

function formatCurrency(cents, currency = 'USD') {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
        maximumFractionDigits: 0
    }).format((Number(cents) || 0) / 100);
}

async function revenueFetch(path, options = {}) {
    const method = options.method || 'GET';
    const res = await fetchWithRetry(`${API_BASE_URL}${path}`, options, { retries: 1 });
    const body = await res.json().catch(() => ({}));
    if (res.status === 404) {
        return { disabled: true, error: body.error || 'Revenue API disabled' };
    }
    if (!res.ok) {
        throw new Error(body.error || `Revenue API failed (${res.status})`);
    }
    logRevenueApiDiag('REVENUE_API', { path, method, ok: true });
    return body;
}

function buildDefaultBrief(seriesId) {
    const currency = 'USD';
    const makeKpi = (id, label, cents = 0) => ({
        id,
        label,
        cents,
        formatted: formatCurrency(cents, currency)
    });
    return {
        seriesId,
        currency,
        kpis: {
            mrr: makeKpi('mrr', 'MRR', 0),
            arr: makeKpi('arr', 'ARR', 0),
            seriesRevenue: makeKpi('series-revenue', 'Series Revenue', 0),
            revenuePerEpisode: makeKpi('revenue-per-episode', 'Revenue Per Episode', 0),
            revenuePerCreator: makeKpi('revenue-per-creator', 'Revenue Per Creator', 0),
            revenuePerTeam: makeKpi('revenue-per-team', 'Revenue Per Team', 0)
        },
        forecasts: [],
        creatorCount: 0,
        teamCount: 0,
        aggregateNetMonthlyCents: 0,
        aggregateGrossMonthlyCents: 0
    };
}

export function toRevenueDashboardBriefFromApi(payload = {}, fallbackSeriesId = 'series-neon-vengeance') {
    const seriesId = payload.seriesId || fallbackSeriesId;
    const currency = payload.currency || 'USD';
    const base = buildDefaultBrief(seriesId);
    base.currency = currency;

    const kpis = payload.kpis || {};
    const getCents = (key) => Number(kpis?.[key]?.cents || 0);

    base.kpis = {
        mrr: {
            id: 'mrr',
            label: kpis?.mrr?.label || 'MRR',
            cents: getCents('mrr'),
            formatted: formatCurrency(getCents('mrr'), currency)
        },
        arr: {
            id: 'arr',
            label: kpis?.arr?.label || 'ARR',
            cents: getCents('arr'),
            formatted: formatCurrency(getCents('arr'), currency)
        },
        seriesRevenue: {
            id: 'series-revenue',
            label: kpis?.seriesRevenue?.label || 'Series Revenue',
            cents: getCents('seriesRevenue'),
            formatted: formatCurrency(getCents('seriesRevenue'), currency)
        },
        revenuePerEpisode: {
            id: 'revenue-per-episode',
            label: 'Revenue Per Episode',
            cents: 0,
            formatted: formatCurrency(0, currency)
        },
        revenuePerCreator: {
            id: 'revenue-per-creator',
            label: kpis?.revenuePerCreator?.label || 'Revenue Per Creator',
            cents: getCents('revenuePerCreator'),
            formatted: formatCurrency(getCents('revenuePerCreator'), currency)
        },
        revenuePerTeam: {
            id: 'revenue-per-team',
            label: kpis?.revenuePerTeam?.label || 'Revenue Per Team',
            cents: getCents('revenuePerTeam'),
            formatted: formatCurrency(getCents('revenuePerTeam'), currency)
        }
    };
    base.forecasts = Array.isArray(payload.forecasts)
        ? payload.forecasts.map((forecast) => ({
              horizonDays: Number(forecast.horizonDays || 0),
              label: forecast.label || `${forecast.horizonDays || 0} day`,
              netCents: Number(forecast.netCents || 0),
              grossCents: Number(forecast.grossCents || 0),
              growthRate: Number(forecast.growthRate || 0),
              formattedNet: formatCurrency(Number(forecast.netCents || 0), currency),
              formattedGross: formatCurrency(Number(forecast.grossCents || 0), currency)
          }))
        : [];

    base.creatorCount = Number(payload.creatorCount || 0);
    base.teamCount = Number(payload.teamCount || 0);
    base.aggregateNetMonthlyCents = base.kpis.mrr.cents;
    base.aggregateGrossMonthlyCents = base.kpis.seriesRevenue.cents;
    base.kpis.revenuePerEpisode.cents = base.forecasts.length
        ? Math.round(base.kpis.mrr.cents / Math.max(base.forecasts.length, 1))
        : 0;
    base.kpis.revenuePerEpisode.formatted = formatCurrency(base.kpis.revenuePerEpisode.cents, currency);

    return base;
}

export async function fetchRevenueDashboard(options = {}) {
    const params = new URLSearchParams();
    if (options.seriesId) params.set('seriesId', options.seriesId);
    const path = `/api/revenue/dashboard${params.toString() ? `?${params.toString()}` : ''}`;
    try {
        const payload = await revenueFetch(path);
        logRevenueApiDiag('REVENUE_SYNC', {
            phase: 'dashboard',
            seriesId: payload.seriesId || options.seriesId || null,
            mrrCents: payload?.kpis?.mrr?.cents || 0
        });
        return payload;
    } catch (error) {
        logRevenueApiDiag('REVENUE_API', {
            path,
            ok: false,
            error: error?.message || 'Revenue dashboard unavailable'
        });
        return {
            disabled: true,
            error: error?.message || 'Revenue dashboard unavailable'
        };
    }
}

export async function fetchRevenueForecast(options = {}) {
    const params = new URLSearchParams();
    if (options.seriesId) params.set('seriesId', options.seriesId);
    if (options.refresh === true) params.set('refresh', 'true');
    const path = `/api/revenue/forecast${params.toString() ? `?${params.toString()}` : ''}`;
    try {
        const payload = await revenueFetch(path);
        logRevenueApiDiag('REVENUE_FORECAST', {
            phase: options.refresh ? 'refresh' : 'query',
            seriesId: payload.seriesId || options.seriesId || null,
            count: Array.isArray(payload.forecasts) ? payload.forecasts.length : 0
        });
        return payload;
    } catch (error) {
        logRevenueApiDiag('REVENUE_FORECAST', {
            ok: false,
            error: error?.message || 'Revenue forecast unavailable'
        });
        return { disabled: true, error: error?.message || 'Revenue forecast unavailable', forecasts: [] };
    }
}

export async function postRevenueProfile(profile) {
    return revenueFetch('/api/revenue/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile)
    });
}

export async function fetchCreatorRevenue(creatorId, options = {}) {
    const safeCreatorId = encodeURIComponent(String(creatorId || '').trim());
    if (!safeCreatorId) {
        return { error: 'creatorId required', items: [], count: 0 };
    }
    const params = new URLSearchParams();
    if (typeof options.limit === 'number' && Number.isFinite(options.limit)) {
        params.set('limit', String(Math.max(1, Math.min(500, Math.floor(options.limit)))));
    }
    const path = `/api/revenue/creator/${safeCreatorId}${params.toString() ? `?${params.toString()}` : ''}`;
    return revenueFetch(path);
}
