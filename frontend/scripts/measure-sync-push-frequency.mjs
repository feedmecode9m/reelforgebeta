#!/usr/bin/env node
/**
 * PRODUCT-08B — Sync/push frequency measurement helper (read-only).
 * Prints methodology + console snippet for DevTools post-hoc analysis.
 * Does NOT modify application code or call production APIs.
 */
console.log(`
PRODUCT-08B Sync/Push Measurement
=================================

Preferred capture kit (see PRODUCT-08B_EVIDENCE_GAP_CLOSURE.md):
0. Paste scripts/product-08b-console-observer.snippet.js BEFORE the event
1. DevTools → Network → Preserve log → (no filter at start; filter "sync" after banner)
2. Wait for exact operation status: "Backend reconnecting..."
3. After session, paste in Console (post-hoc Performance count only):

---BEGIN SNIPPET---
(function measureSyncPush() {
  const entries = performance.getEntriesByType('resource')
    .filter(r => r.name.includes('/api/sync/push'))
    .map(r => ({
      name: r.name,
      start: new Date(performance.timeOrigin + r.startTime).toISOString(),
      durationMs: Math.round(r.duration),
      transferSize: r.transferSize || 0
    }));
  const gaps = [];
  for (let i = 1; i < entries.length; i++) {
    const prev = performance.timeOrigin + performance.getEntriesByType('resource')
      .filter(r => r.name.includes('/api/sync/push'))[i - 1].startTime;
    const cur = performance.timeOrigin + performance.getEntriesByType('resource')
      .filter(r => r.name.includes('/api/sync/push'))[i].startTime;
    gaps.push(Math.round(cur - prev));
  }
  const burst = gaps.filter(g => g < 5000).length;
  const pattern = entries.length <= 5 && burst === 0 ? 'A-normal-fallback'
    : entries.length > 10 && burst > entries.length / 2 ? 'B-reconnect-storm'
    : 'inconclusive';
  return {
    syncPushCount: entries.length,
    timestamps: entries.map(e => e.start),
    gapMsBetweenCalls: gaps,
    pattern,
    note: 'Filter Network tab sync for authoritative count during reconnect window'
  };
})()
---END SNIPPET---

Record results in: frontend/PRODUCT-08B_SYNC_PUSH_MEASUREMENT.md
`);
