/**
 * Presentation-only mapping for backendConnectionStatus (no business logic).
 * @typedef {'hidden' | 'connecting' | 'offline' | 'unavailable' | 'recovery'} BackendHealthLevel
 * @typedef {{ level: BackendHealthLevel; message: string; live: 'polite' | 'assertive'; dismissible: boolean }} BackendHealthPresentation
 */

/**
 * @param {{ state?: string; lastError?: string }} connection
 * @param {boolean} browserOnline
 * @param {boolean} reconnectingActive
 * @returns {BackendHealthPresentation | null}
 */
export function deriveBackendHealthPresentation(connection, browserOnline, reconnectingActive) {
  const state = connection?.state || 'degraded';
  const lastError = String(connection?.lastError || '').trim();

  if (state === 'online' && browserOnline && !reconnectingActive) {
    return null;
  }

  if (!browserOnline) {
    return {
      level: 'offline',
      message: 'You appear to be offline. Saved content may still be available.',
      live: 'polite',
      dismissible: true
    };
  }

  if (state === 'offline') {
    return {
      level: 'unavailable',
      message: lastError
        ? `Backend unavailable — ${lastError}. Showing saved content when possible.`
        : 'Backend unavailable. Showing saved content when possible.',
      live: 'assertive',
      dismissible: true
    };
  }

  if (state === 'degraded' || reconnectingActive) {
    return {
      level: 'connecting',
      message: reconnectingActive
        ? 'Reconnecting to backend…'
        : lastError
          ? `Connection degraded — retrying (${lastError})`
          : 'Connection degraded — retrying backend health check',
      live: 'polite',
      dismissible: false
    };
  }

  return null;
}

/** @returns {BackendHealthPresentation} */
export function recoveryPresentation() {
  return {
    level: 'recovery',
    message: 'Back online — connection restored.',
    live: 'polite',
    dismissible: false
  };
}

/**
 * @param {{ state?: string; lastError?: string }} connection
 * @param {boolean} browserOnline
 * @param {boolean} reconnectingActive
 */
export function healthPresentationSnapshot(connection, browserOnline, reconnectingActive) {
  return `${connection?.state || 'unknown'}|${browserOnline}|${reconnectingActive}|${connection?.lastError || ''}`;
}
