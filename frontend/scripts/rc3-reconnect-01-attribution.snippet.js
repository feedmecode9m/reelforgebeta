/**
 * RC3-RECONNECT-01 — Event source attribution observer (evidence only).
 *
 * Paste into DevTools Console OR install via Playwright addInitScript.
 * Does NOT modify application source. Session-only instrumentation.
 *
 * Captures for every "Backend reconnecting..." appearance:
 *   - timestamp, stack at CustomEvent dispatch, prior op status,
 *   - backendConnectionStatus, navigator.onLine, health/API correlation hooks,
 *   - WS readyState snapshot, upload/hero/sync fingerprints
 *
 * After capture:
 *   copy(JSON.stringify(window.__rc3Reconnect01.out, null, 2))
 */
(function rc3Reconnect01Attribution() {
  const OP_TEXT = 'Backend reconnecting...';
  const BANNER_TEXT = 'Reconnecting to backend';
  const SYNC_HINT = 'Syncing with backend';
  const HERO_HINT = /hero/i;
  const UPLOAD_HINT = /upload/i;

  // Do not tear down an already-armed harness (re-install races drop CustomEvents).
  if (window.__rc3Reconnect01?.out?.mission === 'RC3-RECONNECT-01' && window.__rc3Reconnect01?.armed) {
    console.info('[RC3-RECONNECT-01] already armed — skip reinstall');
    return window.__rc3Reconnect01;
  }

  const out = {
    mission: 'RC3-RECONNECT-01',
    startedAt: new Date().toISOString(),
    events: [],
    occurrences: [],
    networkHints: {
      health: [],
      apiOk: [],
      apiFail: [],
      reelsPost: [],
      syncPush: []
    },
    websocket: {
      snapshots: [],
      lastReadyState: null
    },
    connection: {
      last: null,
      history: []
    },
    classification: null,
    notes: []
  };

  function stamp(extra) {
    return {
      browserLocalISO: new Date().toISOString(),
      performanceNowMs: typeof performance !== 'undefined' ? performance.now() : null,
      timeOrigin: typeof performance !== 'undefined' ? performance.timeOrigin : null,
      navigatorOnLine: typeof navigator !== 'undefined' ? navigator.onLine : null,
      ...extra
    };
  }

  function push(kind, detail) {
    const row = { kind, ...stamp(detail || {}) };
    out.events.push(row);
    console.info('[RC3-RECONNECT-01]', row);
    return row;
  }

  function textOf(sel) {
    const el = document.querySelector(sel);
    return el ? String(el.textContent || '').trim() : '';
  }

  function wsSnapshot() {
    const sockets = [];
    try {
      // Best-effort: any tracked sockets from prior wraps
      const tracked = window.__rc3Reconnect01Ws || [];
      for (const s of tracked) {
        if (!s) continue;
        sockets.push({
          url: s.url || null,
          readyState: s.readyState,
          readyStateLabel: ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][s.readyState] || String(s.readyState)
        });
      }
    } catch {
      /* ignore */
    }
    const primary = sockets.find((s) => String(s.url || '').includes('/ws/')) || sockets[0] || null;
    out.websocket.lastReadyState = primary;
    return { sockets, primary };
  }

  function fingerprintFromStack(stack) {
    const s = String(stack || '');
    const hits = {
      fetchWithRetry: /fetchWithRetry/.test(s),
      notifyBackendReconnecting: /notifyBackendReconnecting/.test(s),
      syncFromVault: /syncFromVault/.test(s),
      checkBackendHealth: /checkBackendHealth/.test(s),
      uploadVideo: /uploadVideo|createReel|acceptHeroFile|beginHeroAutoAccept/.test(s),
      studioSync: /studioSync|pushSyncState|pullSyncState/.test(s),
      websocket: /WebSocket|wsReelEvents|control-center/.test(s)
    };
    return hits;
  }

  function msDelta(aIso, bIso) {
    if (!aIso || !bIso) return null;
    return Math.abs(new Date(aIso).getTime() - new Date(bIso).getTime());
  }

  function classifyOccurrence(occ) {
    const fp = occ.stackFingerprint || {};
    const prior = String(occ.priorUploadStatus || '');
    const hasEvent = Boolean(occ.customEventName);
    const heroActive = Boolean(occ.heroUploadActive);
    const uploadActive = Boolean(occ.activeUpload);
    const syncRunning = Boolean(occ.syncRunning) || prior.includes(SYNC_HINT);
    const fail = occ.lastFailedApiCall || null;
    const failDelta = msDelta(occ.browserLocalISO, fail?.at);
    const failIsNetwork =
      fail &&
      (fail.status === 'network_error' || /timeout|Failed to fetch|network/i.test(String(fail.error || '')));
    const bannerOffline = /Backend unavailable/i.test(String(occ.bannerText || ''));
    const correlatedApiRetry = Boolean(failIsNetwork && failDelta != null && failDelta <= 250);

    // Sync path fingerprint: prior "Syncing..." or stack, not a concurrent API abort alone.
    if (fp.syncFromVault || (syncRunning && prior.includes(SYNC_HINT))) {
      return 'Sync retry';
    }
    if (
      fp.fetchWithRetry ||
      correlatedApiRetry ||
      (hasEvent && bannerOffline && !syncRunning && !heroActive) ||
      (fp.notifyBackendReconnecting && !syncRunning && !heroActive)
    ) {
      return 'API retry path';
    }
    if (fp.websocket && !fp.fetchWithRetry && !fp.syncFromVault && !correlatedApiRetry) {
      return 'WebSocket reconnect path';
    }
    if ((uploadActive || heroActive || fp.uploadVideo) && !syncRunning) {
      return 'Upload retry';
    }
    // Banner-only path is a different string; if we only saw banner, caller handles.
    if (!occ.operationStatusText?.includes(OP_TEXT) && String(occ.bannerText || '').includes(BANNER_TEXT)) {
      return 'Health monitor';
    }
    return 'Unknown';
  }

  function recordOccurrence(partial) {
    const ws = wsSnapshot();
    const op = textOf('.global-operation-status__message');
    const banner = textOf('.backend-health-banner__message');
    const lastHealth = out.networkHints.health.slice(-1)[0] || null;
    const lastOk = out.networkHints.apiOk.slice(-1)[0] || null;
    const lastFail = out.networkHints.apiFail.slice(-1)[0] || null;
    const reelsInflight = out.networkHints.reelsPost.filter((r) => r.finishedAt == null);
    const syncInflight = out.networkHints.syncPush.filter((r) => r.finishedAt == null);

    const occ = {
      id: out.occurrences.length + 1,
      ...stamp(),
      ...partial,
      customEventName: partial.customEventName || null,
      eventSource: partial.eventSource || null,
      callStack: partial.callStack || null,
      stackFingerprint: fingerprintFromStack(partial.callStack),
      backendConnectionStatus: out.connection.last,
      navigatorOnLine: typeof navigator !== 'undefined' ? navigator.onLine : null,
      lastHealth,
      lastSuccessfulApiCall: lastOk,
      lastFailedApiCall: lastFail,
      websocketState: ws.primary,
      websocketAll: ws.sockets,
      currentUploadStatus: op,
      operationStatusText: op,
      bannerText: banner,
      priorUploadStatus: partial.priorUploadStatus ?? null,
      activeUpload: reelsInflight.length > 0 || UPLOAD_HINT.test(op),
      heroUploadActive: HERO_HINT.test(op) || reelsInflight.some((r) => r.heroSuspected),
      syncRunning:
        Boolean(partial.syncRunning) ||
        op.includes(SYNC_HINT) ||
        String(partial.priorUploadStatus || '').includes(SYNC_HINT) ||
        syncInflight.length > 0,
      retryCount: partial.retryCount ?? null,
      clearedAt: null,
      clearEvent: null,
      finalState: null,
      classification: null
    };
    occ.classification = classifyOccurrence(occ);
    out.occurrences.push(occ);
    out.classification = occ.classification;
    push('occurrence_recorded', {
      id: occ.id,
      classification: occ.classification,
      eventSource: occ.eventSource,
      stackFingerprint: occ.stackFingerprint
    });
    return occ;
  }

  // --- CustomEvent attribution (capture-phase listener + dispatch wrap) ---
  function onReconnectEvent(e) {
    const stack = new Error('RC3-RECONNECT-01 notify stack').stack;
    const prior = textOf('.global-operation-status__message');
    recordOccurrence({
      eventSource: 'notifyBackendReconnecting()',
      customEventName: 'reelforge:backend-reconnecting',
      callStack: stack,
      detailMessage: e?.detail?.message || 'Backend reconnecting...',
      priorUploadStatus: prior,
      syncRunning: prior.includes(SYNC_HINT)
    });
    push('custom_event_dispatch', {
      message: e?.detail?.message || null,
      priorUploadStatus: prior,
      via: 'addEventListener_capture'
    });
  }

  function onConnectionEvent(e) {
    const detail = e?.detail || null;
    out.connection.last = detail;
    out.connection.history.push(stamp({ detail }));
    push('backend_connection', { state: detail?.state || null, lastError: detail?.lastError || null });
    if (detail?.state === 'online') {
      const open = out.occurrences.filter((o) => !o.clearedAt);
      for (const o of open) {
        o.clearedAt = new Date().toISOString();
        o.clearEvent = 'reelforge:backend-connection:online';
        o.finalState = {
          uploadStatus: textOf('.global-operation-status__message'),
          backendConnectionStatus: detail
        };
      }
    }
  }

  window.addEventListener('reelforge:backend-reconnecting', onReconnectEvent, true);
  window.addEventListener('reelforge:backend-connection', onConnectionEvent, true);

  const proto = EventTarget.prototype;
  const originalDispatch = proto.dispatchEvent;
  if (!proto.__rc3Reconnect01Wrapped) {
    proto.dispatchEvent = function rc3DispatchEvent(event) {
      try {
        const type = event && event.type;
        if (type === 'reelforge:backend-reconnecting') {
          // Stack at dispatch is more useful than listener stack.
          const stack = new Error('RC3-RECONNECT-01 dispatch stack').stack;
          push('custom_event_dispatch', {
            message: event?.detail?.message || null,
            via: 'dispatchEvent_wrap',
            stackTop: String(stack || '')
              .split('\n')
              .slice(0, 8)
          });
          // Listener also records occurrence; annotate latest if within 50ms.
          const recent = out.occurrences.slice(-1)[0];
          if (recent && recent.performanceNowMs != null && Math.abs(performance.now() - recent.performanceNowMs) < 50) {
            recent.callStack = stack;
            recent.stackFingerprint = fingerprintFromStack(stack);
            recent.classification = classifyOccurrence(recent);
            out.classification = recent.classification;
          }
        }
      } catch (err) {
        out.notes.push(String(err?.message || err));
      }
      return originalDispatch.call(this, event);
    };
    proto.__rc3Reconnect01Wrapped = true;
    proto.__rc3Reconnect01OriginalDispatch = originalDispatch;
  }

  // --- DOM observer for direct uploadStatus writes (P2 may set before/without relying solely on event) ---
  let lastOp = textOf('.global-operation-status__message');
  let lastBanner = textOf('.backend-health-banner__message');

  function scanDom() {
    const op = textOf('.global-operation-status__message');
    const banner = textOf('.backend-health-banner__message');

    if (op !== lastOp) {
      const had = lastOp.includes(OP_TEXT);
      const has = op.includes(OP_TEXT);
      if (!had && has) {
        // If CustomEvent already recorded within 100ms, annotate; else record direct-set path.
        const recent = out.occurrences.slice(-1)[0];
        const recentMs =
          recent && recent.performanceNowMs != null
            ? Math.abs(performance.now() - recent.performanceNowMs)
            : Infinity;
        if (!recent || recentMs > 150 || recent.operationStatusAppearedViaDom) {
          const occ = recordOccurrence({
            eventSource: 'uploadStatus.set (DOM observed; may be syncFromVault direct write)',
            customEventName: recent && recentMs <= 150 ? recent.customEventName : null,
            callStack: recent && recentMs <= 150 ? recent.callStack : null,
            priorUploadStatus: lastOp,
            syncRunning: lastOp.includes(SYNC_HINT) || op.includes(SYNC_HINT),
            operationStatusAppearedViaDom: true
          });
          // Deduplicate if event path already created one in the same tick
          if (recent && recentMs <= 150 && !recent.operationStatusAppearedViaDom) {
            recent.operationStatusAppearedViaDom = true;
            recent.priorUploadStatus = recent.priorUploadStatus || lastOp;
            // remove duplicate just pushed
            if (out.occurrences[out.occurrences.length - 1] === occ) {
              out.occurrences.pop();
              recent.classification = classifyOccurrence(recent);
              out.classification = recent.classification;
            }
          }
        } else if (recent) {
          recent.operationStatusAppearedViaDom = true;
          recent.priorUploadStatus = recent.priorUploadStatus || lastOp;
          if (lastOp.includes(SYNC_HINT)) {
            recent.syncRunning = true;
            recent.eventSource = recent.eventSource || 'notifyBackendReconnecting()';
            // Prefer Sync retry when prior status was syncing
            recent.classification = classifyOccurrence(recent);
            out.classification = recent.classification;
          }
        }
        push('operation_status_appeared', { text: op, prior: lastOp });
      }
      if (had && !has) {
        const open = out.occurrences.filter((o) => !o.clearedAt);
        for (const o of open) {
          o.clearedAt = o.clearedAt || new Date().toISOString();
          o.clearEvent = o.clearEvent || 'operation_status_dom_cleared';
          o.finalState = {
            uploadStatus: op,
            backendConnectionStatus: out.connection.last
          };
        }
        push('operation_status_disappeared', { previous: lastOp, next: op });
      }
      lastOp = op;
    }

    if (banner !== lastBanner) {
      const hadB = lastBanner.includes(BANNER_TEXT);
      const hasB = banner.includes(BANNER_TEXT);
      if (!hadB && hasB) push('health_banner_appeared', { text: banner });
      if (hadB && !hasB) push('health_banner_disappeared', { previous: lastBanner, next: banner });
      lastBanner = banner;
    }
  }

  const observer = new MutationObserver(() => scanDom());
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true
  });

  // --- Lightweight fetch probe (correlate only; does not change retry behavior) ---
  if (!window.__rc3Reconnect01FetchWrapped && typeof window.fetch === 'function') {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async function rc3Fetch(input, init) {
      const url = typeof input === 'string' ? input : input && input.url;
      const method = (init && init.method) || (input && input.method) || 'GET';
      const startedAt = new Date().toISOString();
      const isHealth = url && String(url).includes('/api/health');
      const isReelsPost = url && String(url).includes('/api/reels') && String(method).toUpperCase() === 'POST';
      const isSyncPush = url && String(url).includes('/api/sync/push');
      let entry = null;
      if (isHealth) {
        entry = { url, startedAt, status: null, finishedAt: null };
        out.networkHints.health.push(entry);
      } else if (isReelsPost) {
        entry = {
          url,
          startedAt,
          status: null,
          finishedAt: null,
          heroSuspected: HERO_HINT.test(textOf('.global-operation-status__message'))
        };
        out.networkHints.reelsPost.push(entry);
      } else if (isSyncPush) {
        entry = { url, startedAt, status: null, finishedAt: null };
        out.networkHints.syncPush.push(entry);
      }
      try {
        const res = await originalFetch(input, init);
        if (entry) {
          entry.status = res.status;
          entry.finishedAt = new Date().toISOString();
        }
        if (url && String(url).includes('/api/') && res.ok) {
          out.networkHints.apiOk.push({
            url: String(url),
            status: res.status,
            at: new Date().toISOString()
          });
          if (out.networkHints.apiOk.length > 40) out.networkHints.apiOk.shift();
        } else if (url && String(url).includes('/api/') && !res.ok) {
          out.networkHints.apiFail.push({
            url: String(url),
            status: res.status,
            at: new Date().toISOString()
          });
          if (out.networkHints.apiFail.length > 40) out.networkHints.apiFail.shift();
        }
        return res;
      } catch (err) {
        if (entry) {
          entry.status = 'network_error';
          entry.finishedAt = new Date().toISOString();
          entry.error = err?.message || String(err);
        }
        out.networkHints.apiFail.push({
          url: String(url || ''),
          status: 'network_error',
          at: new Date().toISOString(),
          error: err?.message || String(err)
        });
        throw err;
      }
    };
    window.__rc3Reconnect01FetchWrapped = true;
    window.__rc3Reconnect01OriginalFetch = originalFetch;
  }

  // --- WebSocket tracking ---
  if (!window.__rc3Reconnect01WsWrapped && typeof window.WebSocket === 'function') {
    const OriginalWS = window.WebSocket;
    window.__rc3Reconnect01Ws = window.__rc3Reconnect01Ws || [];
    window.WebSocket = function Rc3WS(url, protocols) {
      const ws = protocols !== undefined ? new OriginalWS(url, protocols) : new OriginalWS(url);
      try {
        window.__rc3Reconnect01Ws.push(ws);
        out.websocket.snapshots.push(stamp({ kind: 'construct', url: String(url) }));
        ws.addEventListener('open', () =>
          out.websocket.snapshots.push(stamp({ kind: 'open', url: String(url), readyState: ws.readyState }))
        );
        ws.addEventListener('close', (ev) =>
          out.websocket.snapshots.push(
            stamp({
              kind: 'close',
              url: String(url),
              readyState: ws.readyState,
              code: ev.code,
              reason: ev.reason
            })
          )
        );
        ws.addEventListener('error', () =>
          out.websocket.snapshots.push(stamp({ kind: 'error', url: String(url), readyState: ws.readyState }))
        );
      } catch {
        /* ignore */
      }
      return ws;
    };
    window.WebSocket.prototype = OriginalWS.prototype;
    Object.assign(window.WebSocket, OriginalWS);
    window.__rc3Reconnect01WsWrapped = true;
    window.__rc3Reconnect01OriginalWS = OriginalWS;
  }

  scanDom();

  function stop() {
    observer.disconnect();
    window.removeEventListener('reelforge:backend-reconnecting', onReconnectEvent, true);
    window.removeEventListener('reelforge:backend-connection', onConnectionEvent, true);
    out.stoppedAt = new Date().toISOString();
    out.armed = false;
    if (proto.__rc3Reconnect01OriginalDispatch) {
      proto.dispatchEvent = proto.__rc3Reconnect01OriginalDispatch;
      delete proto.__rc3Reconnect01Wrapped;
    }
    if (window.__rc3Reconnect01OriginalFetch) {
      window.fetch = window.__rc3Reconnect01OriginalFetch;
      delete window.__rc3Reconnect01FetchWrapped;
    }
    if (window.__rc3Reconnect01OriginalWS) {
      window.WebSocket = window.__rc3Reconnect01OriginalWS;
      delete window.__rc3Reconnect01WsWrapped;
    }
  }

  out.armed = true;
  window.__rc3Reconnect01 = { out, observer, stop, scanDom, armed: true };
  console.info('[RC3-RECONNECT-01] attribution armed', out.startedAt);
  return window.__rc3Reconnect01;
})();
