/**
 * PRODUCT-08B — Console-only DOM / event observer (paste into DevTools Console).
 *
 * Read-only. Does NOT patch fetch, WebSocket, timers, or stores.
 * Records ISO timestamps for:
 *   - exact operation status: "Backend reconnecting..."
 *   - top health banner: "Reconnecting to backend…"
 *   - reelforge:backend-reconnecting CustomEvent
 *
 * After the event:
 *   copy(window.__product08bCapture.out)
 *   or: JSON.stringify(window.__product08bCapture.out, null, 2)
 */
(function product08bConsoleObserver() {
  const OP_TEXT = 'Backend reconnecting...';
  const BANNER_TEXT = 'Reconnecting to backend';

  if (window.__product08bCapture?.observer) {
    window.__product08bCapture.observer.disconnect();
  }

  const out = {
    startedAt: new Date().toISOString(),
    events: [],
    operationStatus: { appearedAt: null, disappearedAt: null, lastText: null },
    healthBanner: { appearedAt: null, disappearedAt: null, lastText: null },
    reconnectEvents: []
  };

  function stamp(extra = {}) {
    return {
      browserLocalISO: new Date().toISOString(),
      performanceNowMs: typeof performance !== 'undefined' ? performance.now() : null,
      timeOrigin: typeof performance !== 'undefined' ? performance.timeOrigin : null,
      ...extra
    };
  }

  function push(kind, detail) {
    const row = { kind, ...stamp(detail) };
    // Keep `ts` as browser-local ISO for worksheet compatibility
    row.ts = row.browserLocalISO;
    out.events.push(row);
    console.info('[PRODUCT-08B]', row);
    return row;
  }

  function textOf(sel) {
    const el = document.querySelector(sel);
    return el ? String(el.textContent || '').trim() : '';
  }

  let lastOp = textOf('.global-operation-status__message');
  let lastBanner = textOf('.backend-health-banner__message');

  function scan() {
    const op = textOf('.global-operation-status__message');
    const banner = textOf('.backend-health-banner__message');

    if (op !== lastOp) {
      const hadReconnect = lastOp.includes(OP_TEXT);
      const hasReconnect = op.includes(OP_TEXT);
      if (!hadReconnect && hasReconnect && !out.operationStatus.appearedAt) {
        const s = stamp({ text: op });
        out.operationStatus.appearedAt = s.browserLocalISO;
        out.operationStatus.appearedPerformanceNowMs = s.performanceNowMs;
        out.operationStatus.appearedTimeOrigin = s.timeOrigin;
        push('operation_status_appeared', { text: op });
      }
      if (hadReconnect && !hasReconnect && out.operationStatus.appearedAt && !out.operationStatus.disappearedAt) {
        const s = stamp({ previous: lastOp, next: op });
        out.operationStatus.disappearedAt = s.browserLocalISO;
        out.operationStatus.disappearedPerformanceNowMs = s.performanceNowMs;
        out.operationStatus.disappearedTimeOrigin = s.timeOrigin;
        push('operation_status_disappeared', { previous: lastOp, next: op });
      }
      out.operationStatus.lastText = op || null;
      lastOp = op;
    }

    if (banner !== lastBanner) {
      const hadBanner = lastBanner.includes(BANNER_TEXT);
      const hasBanner = banner.includes(BANNER_TEXT);
      if (!hadBanner && hasBanner && !out.healthBanner.appearedAt) {
        out.healthBanner.appearedAt = new Date().toISOString();
        push('health_banner_appeared', { text: banner });
      }
      if (hadBanner && !hasBanner && out.healthBanner.appearedAt && !out.healthBanner.disappearedAt) {
        out.healthBanner.disappearedAt = new Date().toISOString();
        push('health_banner_disappeared', { previous: lastBanner, next: banner });
      }
      out.healthBanner.lastText = banner || null;
      lastBanner = banner;
    }
  }

  const observer = new MutationObserver(() => scan());
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true
  });

  function onReconnect(e) {
    const row = stamp({
      message: e?.detail?.message || 'Backend reconnecting...'
    });
    row.ts = row.browserLocalISO;
    out.reconnectEvents.push(row);
    push('reelforge_backend_reconnecting', { message: row.message });
  }
  window.addEventListener('reelforge:backend-reconnecting', onReconnect);

  window.__product08bCapture = {
    out,
    observer,
    stop() {
      observer.disconnect();
      window.removeEventListener('reelforge:backend-reconnecting', onReconnect);
      out.stoppedAt = new Date().toISOString();
      return out;
    }
  };

  scan();
  push('observer_ready', {
    note: 'Waiting for Backend reconnecting... / Reconnecting to backend…'
  });
  return window.__product08bCapture;
})();
