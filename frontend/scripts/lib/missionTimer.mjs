/**
 * Mission 5.8.9 — validation pipeline profiler (scripts only, no app logic).
 */
import { writeFileSync } from 'fs';
import { join } from 'path';

const PAUSE_THRESHOLD_MS = 2000;
const OUT = join(process.cwd(), 'MISSION_5_8_PROFILE.md');

const stats = {
  startedAt: Date.now(),
  endedAt: null,
  entries: [],
  pauseEvents: [],
  counters: {
    retries: 0,
    polls: 0,
    backendRequests: 0,
    browserReloads: 0,
    browserGoto: 0,
    uploads: 0,
    deletes: 0,
    priorMissionSpawns: 0,
    browserWaits: 0,
    browserLaunches: 0
  },
  activeStack: []
};

let lastTick = Date.now();

function nowIso() {
  return new Date().toISOString();
}

function logTimer(phase, start, end, elapsedMs, extra = {}) {
  const entry = {
    phase,
    start,
    end,
    elapsed_ms: elapsedMs,
    ...extra
  };
  stats.entries.push(entry);
  console.info('[MISSION_TIMER]', JSON.stringify(entry));
}

function notePause(reason, elapsedMs, phase) {
  if (elapsedMs < PAUSE_THRESHOLD_MS) return;
  const evt = { phase, reason, elapsed_ms: elapsedMs, at: nowIso() };
  stats.pauseEvents.push(evt);
  console.warn('[MISSION_TIMER]', JSON.stringify({ type: 'pause', ...evt }));
}

export function timerEnabled() {
  return process.env.MISSION_PROFILE === '1' || process.env.MISSION_TIMER === '1';
}

export function getStats() {
  return stats;
}

export function beginPhase(phase, meta = {}) {
  if (!timerEnabled()) return () => {};
  const start = nowIso();
  const t0 = Date.now();
  stats.activeStack.push({ phase, t0, meta });
  return (extra = {}) => {
    const top = stats.activeStack.pop();
    const elapsed = Date.now() - (top?.t0 ?? t0);
    const end = nowIso();
    logTimer(phase, start, end, elapsed, { ...top?.meta, ...extra });
    notePause(top?.meta?.reason || phase, elapsed, phase);
    lastTick = Date.now();
  };
}

export async function timed(phase, fn, meta = {}) {
  const end = beginPhase(phase, meta);
  try {
    return await fn();
  } finally {
    end();
  }
}

export function count(kind, n = 1) {
  if (!timerEnabled()) return;
  if (stats.counters[kind] !== undefined) stats.counters[kind] += n;
}

export async function sleep(ms, reason, phase = 'sleep') {
  if (!timerEnabled()) {
    await new Promise((r) => setTimeout(r, ms));
    return;
  }
  const end = beginPhase(`${phase}:sleep`, { reason, requested_ms: ms });
  await new Promise((r) => setTimeout(r, ms));
  end({ actual_ms: ms });
  count('browserWaits');
  notePause(reason || 'sleep', ms, phase);
}

export async function waitHttpProfiled(url, options = {}) {
  const { maxAttempts = 60, delayMs = 1000, phase = 'waitHttp', label = url } = options;
  if (!timerEnabled()) {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const code = await fetch(url, { signal: AbortSignal.timeout(3000) }).then((r) => r.status);
        if (code >= 200 && code < 500) return true;
      } catch {
        // retry
      }
      await new Promise((r) => setTimeout(r, delayMs));
    }
    return false;
  }

  const end = beginPhase(phase, { reason: 'backend_wait', url: label, maxAttempts, delayMs });
  let attempts = 0;
  for (let i = 0; i < maxAttempts; i++) {
    attempts += 1;
    count('polls');
    try {
      count('backendRequests');
      const code = await fetch(url, { signal: AbortSignal.timeout(3000) }).then((r) => r.status);
      if (code >= 200 && code < 500) {
        end({ attempts, success: true });
        return true;
      }
    } catch {
      count('retries');
    }
    if (i < maxAttempts - 1) {
      await sleep(delayMs, `waitHttp retry ${i + 1}/${maxAttempts} for ${label}`, phase);
    }
  }
  end({ attempts, success: false });
  return false;
}

export async function fetchProfiled(url, init = {}, phase = 'backend_fetch') {
  if (!timerEnabled()) return fetch(url, init);
  return timed(
    phase,
    async () => {
      count('backendRequests');
      return fetch(url, init);
    },
    { reason: 'backend_request', url }
  );
}

export function writeProfileReport(extra = {}) {
  if (!timerEnabled()) return;
  stats.endedAt = Date.now();
  const totalMs = stats.endedAt - stats.startedAt;

  const byPhase = new Map();
  for (const e of stats.entries) {
    const prev = byPhase.get(e.phase) || { count: 0, total_ms: 0, max_ms: 0 };
    prev.count += 1;
    prev.total_ms += e.elapsed_ms;
    prev.max_ms = Math.max(prev.max_ms, e.elapsed_ms);
    byPhase.set(e.phase, prev);
  }

  const slowest = [...stats.entries]
    .sort((a, b) => b.elapsed_ms - a.elapsed_ms)
    .slice(0, 25);

  const priorMissions = stats.entries
    .filter((e) => e.phase?.startsWith('prior:'))
    .sort((a, b) => b.elapsed_ms - a.elapsed_ms);

  const uploads = stats.entries.filter((e) => e.phase?.startsWith('upload:'));
  const deletes = stats.entries.filter((e) => e.phase?.startsWith('delete:'));

  const unbounded = [];
  for (const e of stats.entries) {
    if (e.maxAttempts && e.attempts >= e.maxAttempts) unbounded.push({ phase: e.phase, kind: 'exhausted_retries', ...e });
    if (e.timeout && e.elapsed_ms >= e.timeout * 0.95) unbounded.push({ phase: e.phase, kind: 'near_timeout', ...e });
  }

  const stressCount = Number(process.env.MISSION_5_8_STRESS || process.env.MISSION_58_STRESS || 10);
  const deleteStress = Number(process.env.MISSION_5_8_DELETE_STRESS || process.env.MISSION_58_DELETE_STRESS || 10);

  const stressUploads = stats.entries.filter((e) => /^upload:m58-stress-[^:]+$/.test(e.phase));
  const deleteUploads = stats.entries.filter((e) => /^upload:m58-del-[^:]+$/.test(e.phase));
  const stressCountActual = stressUploads.length || stressCount;
  const deleteStressActual = deleteUploads.length || deleteStress;
  const uploadSleepMs = stats.entries
    .filter((e) => e.phase.endsWith(':sleep') && e.phase.startsWith('upload:'))
    .reduce((a, e) => a + e.elapsed_ms, 0);
  const openStudioSleepMs = stats.entries
    .filter((e) => e.phase === 'openStudio:sleep')
    .reduce((a, e) => a + e.elapsed_ms, 0);

  const openStudioEntries = stats.entries.filter((e) => e.phase === 'openStudio' || e.phase.startsWith('openStudio:'));

  const topLevelPhases = [
    'prior-missions:all',
    '5.8-A:ghost-purge',
    '5.8-B:index-sync',
    '5.8-C:hard-refresh',
    '5.8-D:stress-uploads',
    '5.8-E:offline',
    '5.8-F:delete-stress',
    'mission-5.8:total'
  ];
  const topLevel = topLevelPhases
    .map((p) => stats.entries.find((e) => e.phase === p))
    .filter(Boolean);

  const md = `# MISSION_5_8_PROFILE

Generated: ${nowIso()}

## Executive findings (Mission 5.8.9)

**Total wall time:** ${(totalMs / 1000 / 60).toFixed(1)} minutes (${totalMs}ms)

### Where time is spent (top-level phases only)

| Phase | elapsed_ms | % of total | Notes |
|-------|------------|------------|-------|
${topLevel
  .map((e) => {
    const pct = ((e.elapsed_ms / totalMs) * 100).toFixed(1);
    return `| ${e.phase} | ${e.elapsed_ms} | ${pct}% | ${e.reason || ''} |`;
  })
  .join('\n')}

### Dominant cost drivers

1. **Prior mission regression (\`spawnSync\`)** — ${priorMissions.reduce((a, e) => a + e.elapsed_ms, 0)}ms across ${stats.counters.priorMissionSpawns} child scripts. Slowest: ${priorMissions[0]?.phase?.replace('prior:', '') || 'n/a'} (${priorMissions[0]?.elapsed_ms || 0}ms). Internal upload/wait/poll loops inside child scripts are **not** separately timed; their cost is embedded in spawn totals.
2. **5.8-D stress uploads (${stressCountActual}×)** — ${stats.entries.find((e) => e.phase === '5.8-D:stress-uploads')?.elapsed_ms || 0}ms phase total. Per-upload avg ~${stressUploads.length ? Math.round(stressUploads.reduce((a, e) => a + e.elapsed_ms, 0) / stressUploads.length) : 0}ms.
3. **Fixed post-accept sleep (\`dropThumb\` 5000ms)** — ${uploadSleepMs}ms across ${stats.entries.filter((e) => e.phase.endsWith(':sleep') && e.phase.startsWith('upload:')).length} upload sleeps. This is **intentional validator idle**, not backend polling.
4. **\`openStudio\` navigation** — ${openStudioEntries.reduce((a, e) => a + e.elapsed_ms, 0)}ms aggregate across ${openStudioEntries.length} instrumented sub-steps; includes ${openStudioSleepMs}ms fixed sleeps (2000ms + 5000ms + 2000ms per call).
5. **5.8-F delete stress** — ${deleteUploads.length} upload attempts timed (avg ~${deleteUploads.length ? Math.round(deleteUploads.reduce((a, e) => a + e.elapsed_ms, 0) / deleteUploads.length) : 0}ms). Batch delete wait (15000ms) ${stats.entries.some((e) => e.phase === 'delete:batch-all-wait') ? 'ran' : 'did not run'}.

### Counters

| Counter | Count |
|---------|-------|
| Retries (HTTP wait loops) | ${stats.counters.retries} |
| Poll iterations | ${stats.counters.polls} |
| Backend HTTP requests (instrumented) | ${stats.counters.backendRequests} |
| Browser reloads | ${stats.counters.browserReloads} |
| Browser goto | ${stats.counters.browserGoto} |
| Browser fixed sleeps | ${stats.counters.browserWaits} |
| Upload operations | ${stats.counters.uploads} |
| Delete batch trigger | ${stats.counters.deletes} |

### Unbounded / risky waits

${unbounded.length ? unbounded.map((u) => `- ${u.kind}: ${u.phase} (${u.elapsed_ms}ms)`).join('\n') : '- No exhausted retry loops detected.\n- \`waitHttp\` maxAttempts=60 × 1000ms delay = up to **60s per endpoint** (bounded).\n- \`openStudio\` selector timeout 60000ms, function timeout 45000ms (bounded).\n- \`dropThumb\` accept-btn timeout 15000ms (bounded).\n- Prior mission \`spawnSync\` timeout 600000ms per script (bounded).'}

### Pauses > ${PAUSE_THRESHOLD_MS}ms

${stats.pauseEvents.length} pauses logged. Largest: ${slowest[0]?.phase || 'n/a'} (${slowest[0]?.elapsed_ms || 0}ms).

${extra.stoppedAt ? `**Run stopped at:** ${extra.stoppedAt}${extra.reason ? ` — ${extra.reason}` : ''}` : ''}

---

## Summary

| Metric | Value |
|--------|-------|
| Total elapsed | ${(totalMs / 1000).toFixed(1)}s (${totalMs}ms) |
| Stress uploads (5.8-D) | ${stressCountActual} |
| Delete stress uploads (5.8-F) | ${deleteStressActual} |
| Prior mission spawns | ${stats.counters.priorMissionSpawns} |
| Upload operations timed | ${stats.counters.uploads} |
| Delete operations timed | ${stats.counters.deletes} |
| Backend HTTP requests | ${stats.counters.backendRequests} |
| Poll iterations | ${stats.counters.polls} |
| Retry iterations | ${stats.counters.retries} |
| Browser reloads | ${stats.counters.browserReloads} |
| Browser goto | ${stats.counters.browserGoto} |
| Browser fixed waits | ${stats.counters.browserWaits} |
| Browser launches | ${stats.counters.browserLaunches} |
| Pauses > ${PAUSE_THRESHOLD_MS}ms | ${stats.pauseEvents.length} |

## Slowest operations (top 25)

| Rank | Phase | elapsed_ms | start | end |
|------|-------|------------|-------|-----|
${slowest.map((e, i) => `| ${i + 1} | ${e.phase} | ${e.elapsed_ms} | ${e.start} | ${e.end} |`).join('\n')}

## Prior mission spawn times

| Mission | elapsed_ms | start | end |
|---------|------------|-------|-----|
${priorMissions.length ? priorMissions.map((e) => `| ${e.phase.replace('prior:', '')} | ${e.elapsed_ms} | ${e.start} | ${e.end} |`).join('\n') : '| (none) | — | — | — |'}

## Upload timings

| Upload | elapsed_ms |
|--------|------------|
${uploads.length ? uploads.map((e) => `| ${e.phase} | ${e.elapsed_ms} |`).join('\n') : '| (none) | — |'}

## Delete / batch-delete timings

| Operation | elapsed_ms |
|-----------|------------|
${deletes.length ? deletes.map((e) => `| ${e.phase} | ${e.elapsed_ms} |`).join('\n') : '| (none) | — |'}

## Phase aggregates (sum of all invocations)

| Phase | calls | total_ms | avg_ms | max_ms |
|-------|-------|----------|--------|--------|
${[...byPhase.entries()]
  .sort((a, b) => b[1].total_ms - a[1].total_ms)
  .map(([phase, v]) => `| ${phase} | ${v.count} | ${v.total_ms} | ${Math.round(v.total_ms / v.count)} | ${v.max_ms} |`)
  .join('\n')}

## Pauses > ${PAUSE_THRESHOLD_MS}ms

${stats.pauseEvents.length ? stats.pauseEvents.map((p) => `- **${p.phase}** — ${p.elapsed_ms}ms — ${p.reason} @ ${p.at}`).join('\n') : 'None recorded.'}

## Unbounded / risky waits

${unbounded.length ? unbounded.map((u) => `- ${u.kind}: ${u.phase} (${u.elapsed_ms}ms)`).join('\n') : 'No exhausted retry loops or near-timeout waits detected in instrumented phases.'}

## Notes

- Profiling is **validator-only** (Mission 5.8.9). Application logic was not modified.
- Prior missions are timed at **spawn boundary** only; internal upload/wait loops inside child scripts are attributed to that mission's total.
- Fixed \`waitForTimeout\` calls are the dominant browser wait cost in 5.8 stress phases.

## Environment

\`\`\`json
${JSON.stringify(
  {
    MISSION_5_8_STRESS: process.env.MISSION_5_8_STRESS,
    MISSION_5_8_DELETE_STRESS: process.env.MISSION_5_8_DELETE_STRESS,
    BASE_URL: process.env.BASE_URL,
    API_URL: process.env.API_URL,
    ...extra
  },
  null,
  2
)}
\`\`\`

## Full timer log

See \`MISSION_5_8_PROFILE.json\` for complete \`[MISSION_TIMER]\` entries (${stats.entries.length} events).
`;

  writeFileSync(OUT, md);
  writeFileSync(join(process.cwd(), 'MISSION_5_8_PROFILE.json'), JSON.stringify({ stats, extra }, null, 2));
  console.log(`\n📊 Profile written: ${OUT}`);
}
