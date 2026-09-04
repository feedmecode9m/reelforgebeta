import { API_BASE_URL, fetchWithRetry } from '../api.js';
import { getAuthHeaders } from '../auth/index.js';

async function paymentsFetch(path, options = {}) {
    const headers = {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
        ...(options.headers || {})
    };
    const res = await fetchWithRetry(
        `${API_BASE_URL}${path}`,
        {
            ...options,
            headers
        },
        { retries: 1, notifyReconnectOnFailure: false }
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
        const err = new Error(body.message || body.error || `Payments request failed (${res.status})`);
        err.status = res.status;
        err.body = body;
        throw err;
    }
    return body;
}

export async function createCheckoutSession(payload = {}) {
    const data = await paymentsFetch('/api/payments/checkout', {
        method: 'POST',
        body: JSON.stringify({
            episodeId: payload.episodeId,
            reelId: payload.reelId,
            accessMode: payload.accessMode,
            requestedPriceId: payload.requestedPriceId,
            subscriptionTier: payload.subscriptionTier
        })
    });
    const checkoutUrl = String(data?.checkout?.checkoutUrl || data?.checkout?.url || '').trim();
    if (!checkoutUrl) {
        throw new Error('Checkout URL missing from server response');
    }
    return {
        checkoutUrl,
        sessionId: String(data?.checkout?.sessionId || '').trim(),
        mode: String(data?.checkout?.mode || '').trim()
    };
}

export async function fetchPaymentsStatus() {
    return paymentsFetch('/api/payments/status');
}
