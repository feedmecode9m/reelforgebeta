/**
 * Mission RC3-BOOT-03 — Single Snapshot Diagnostics (No Streaming Logs)
 *
 * - Preserve existing collectors (pipeline + fetch + observability)
 * - Prevent continuous console spam by default
 * - Provide a single copyable snapshot via `window.dumpPipelineDiagnostics()`
 */
 
const SNAPSHOT_MAX_REQUESTS = 400;
const SNAPSHOT_MAX_PIPELINE = 800;
const SNAPSHOT_MAX_CHECKPOINTS = 400;
const DEFAULT_STREAM = false;
const STREAM_KEY = 'reelforge_stream_diagnostics';
const FETCH_RECORDER_KEY = '__reelforgeFetchRecorderPatched';
 
/** @returns {boolean} */
export function shouldStreamDiagnostics() {
  if (typeof window === 'undefined') return false;
  try {
    const stored = localStorage.getItem(STREAM_KEY);
    if (stored != null) return stored === 'true';
  } catch {
    // ignore
  }
  return (import.meta.env.VITE_STREAM_DIAGNOSTICS === 'true') || DEFAULT_STREAM;
}
 
/** @returns {ReturnType<typeof getState>} */
function getState() {
  if (typeof window === 'undefined') {
    return {
      initializedAt: Date.now(),
      apiRequests: [],
      pipelineEvents: [],
      checkpoints: [],
      errors: [],
      inFlight: { requests: 0, retryBackoffs: 0 },
      uploads: { pending: 0, failed: 0 },
      flags: { observabilityInitialized: false, fetchPatched: false }
    };
  }
 
  if (!window.__reelforgePipelineSnapshot) {
    window.__reelforgePipelineSnapshot = {
      initializedAt: Date.now(),
      apiRequests: /** @type {Array<{ ts: number; method: string; url: string; status: number | null; durationMs: number | null; error?: string; }> } */ ([]),
      pipelineEvents: /** @type {Array<{ ts: number; tag: string; functionName: string; sourceFile: string; assetId: string | null; fileName: string | null; result: string; detail?: unknown; }> } */ ([]),
      checkpoints: /** @type {Array<{ ts: number; checkpoint: string; meta: Record<string, unknown>; }> } */ ([]),
      errors: /** @type {Array<{ ts: number; level: 'error' | 'warning'; message: string; source?: string; detail?: unknown }>} */ ([]),
      inFlight: { requests: 0, retryBackoffs: 0 },
      uploads: { pending: 0, failed: 0 },
      flags: { observabilityInitialized: false, fetchPatched: false }
    };
  }
  return window.__reelforgePipelineSnapshot;
}
 
function trim(arr, max) {
  if (arr.length <= max) return;
  arr.splice(0, arr.length - max);
}
 
export function recordApiRequest(entry) {
  const state = getState();
  state.apiRequests.push(entry);
  trim(state.apiRequests, SNAPSHOT_MAX_REQUESTS);
}
 
export function recordPipelineEvent(entry) {
  const state = getState();
  state.pipelineEvents.push(entry);
  trim(state.pipelineEvents, SNAPSHOT_MAX_PIPELINE);
}
 
export function recordCheckpoint(checkpoint, meta = {}) {
  const state = getState();
  state.checkpoints.push({ ts: Date.now(), checkpoint, meta });
  trim(state.checkpoints, SNAPSHOT_MAX_CHECKPOINTS);
}
 
export function recordDiagError(level, message, meta = {}) {
  const state = getState();
  state.errors.push({
    ts: Date.now(),
    level: level === 'warning' ? 'warning' : 'error',
    message: String(message || ''),
    source: String(meta?.source || ''),
    detail: meta?.detail
  });
  trim(state.errors, 200);
}

export function markFetchPatched(patched) {
  const state = getState();
  state.flags.fetchPatched = Boolean(patched);
}
 
export function markObservabilityInitialized(initialized) {
  const state = getState();
  state.flags.observabilityInitialized = Boolean(initialized);
}
 
export function setPendingUploads(count) {
  const state = getState();
  state.uploads.pending = Math.max(0, Number(count) || 0);
}
 
export function noteFailedUpload() {
  const state = getState();
  state.uploads.failed += 1;
}
 
export function incInFlightRequests() {
  const state = getState();
  state.inFlight.requests += 1;
}
 
export function decInFlightRequests() {
  const state = getState();
  state.inFlight.requests = Math.max(0, state.inFlight.requests - 1);
}
 
export function incRetryBackoff() {
  const state = getState();
  state.inFlight.retryBackoffs += 1;
}
 
export function decRetryBackoff() {
  const state = getState();
  state.inFlight.retryBackoffs = Math.max(0, state.inFlight.retryBackoffs - 1);
}
 
function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
 
function readArrayLocalStorage(key) {
  if (typeof window === 'undefined') return [];
  const raw = localStorage.getItem(key);
  const parsed = safeJsonParse(raw || '[]', []);
  return Array.isArray(parsed) ? parsed : [];
}
 
function readFeedCount() {
  if (typeof window === 'undefined') return 0;
  const raw = localStorage.getItem('reelforge_feed');
  const parsed = safeJsonParse(raw || '{}', {});
  if (!parsed || typeof parsed !== 'object') return 0;
  let count = 0;
  for (const value of Object.values(parsed)) {
    if (Array.isArray(value)) count += value.length;
  }
  return count;
}
 
function readHeroState() {
  if (typeof window === 'undefined') return {};
  const heroReel = safeJsonParse(localStorage.getItem('reelforge_hero_reel') || 'null', null);
  const heroCfg = safeJsonParse(localStorage.getItem('reelforge_hero_manager_config') || 'null', null);
  return {
    heroReelPresent: Boolean(heroReel),
    heroConfigPresent: Boolean(heroCfg),
    heroAssetId: String(heroCfg?.heroAssetId || ''),
    backgroundSource: String(heroCfg?.backgroundSource || ''),
    heroReelId: String(heroReel?.id || ''),
    heroReelUrl: String(heroReel?.url || heroReel?.video_url || ''),
    heroVideo: String(localStorage.getItem('reelforge_hero_video') || ''),
    heroImage: String(localStorage.getItem('reelforge_hero_image') || '')
  };
}
 
function computeAverageLatency(requests) {
  const samples = (requests || [])
    .map((r) => Number(r.durationMs))
    .filter((n) => Number.isFinite(n) && n >= 0);
  if (!samples.length) return 0;
  return Math.round(samples.reduce((a, b) => a + b, 0) / samples.length);
}
 
function last(arr, n) {
  return arr.slice(Math.max(0, arr.length - n));
}
 
export function dumpPipelineDiagnostics() {
  if (typeof window === 'undefined') return;
  const state = getState();
 
  const lastRequests = last(state.apiRequests, 20);
  const avgLatency = computeAverageLatency(state.apiRequests);
 
  let enterprise = null;
  try {
    const obs = window.__reelforgeObservability;
    if (obs?.buildEnterpriseObservabilitySnapshot) {
      enterprise = obs.buildEnterpriseObservabilitySnapshot();
    }
  } catch {
    enterprise = null;
  }
 
  const thumbs = readArrayLocalStorage('personal_thumbnails');
  const videos = readArrayLocalStorage('personal_video_vault');
  const feedCount = readFeedCount();
  const hero = readHeroState();
 
  const initCompleted = state.checkpoints.some((c) =>
    c.checkpoint === 'VIEWER_BOOTSTRAP' && String(c.meta?.phase || '') === 'post-syncFromVault'
  );
 
  console.group('REELFORGE PIPELINE SNAPSHOT');
  console.log('Observability initialized:', Boolean(state.flags.observabilityInitialized || window.__reelforgeObservability));
  console.log('Fetch patched:', Boolean(state.flags.fetchPatched));
  console.log('API requests recorded:', state.apiRequests.length);
  console.log('Average API latency (ms):', avgLatency);
  console.log('Database latency (ms):', enterprise?.databaseLatencyMs ?? 0);
  console.log('Enterprise health score:', enterprise?.healthScore ?? 0);
  console.log('Active alerts:', enterprise?.alerts?.length ?? 0);
  if (enterprise?.alerts?.length) {
    console.table(enterprise.alerts.map((a) => ({ level: a.level, code: a.code, message: a.message })));
  }
 
  console.group('Last 20 API requests');
  console.table(
    lastRequests.map((r) => ({
      url: r.url,
      status: r.status,
      durationMs: r.durationMs,
      method: r.method
    }))
  );
  console.groupEnd();
 
  console.group('Hero background state');
  console.table([hero]);
  console.groupEnd();
 
  console.group('Viewer state');
  console.table([
    {
      adminMode: String(localStorage.getItem('admin_mode') || '') === 'true',
      initializationSequenceCompleted: initCompleted,
      outstandingRetries: state.inFlight.retryBackoffs,
      inFlightRequests: state.inFlight.requests,
      pendingUploads: state.uploads.pending,
      failedUploads: state.uploads.failed,
      thumbnailVaultCount: thumbs.length,
      videoVaultCount: videos.length,
      feedCount
    }
  ]);
  console.groupEnd();
 
  console.groupEnd();
}
 
function looksLikeJwt(value) {
  const s = String(value || '').trim();
  // very loose JWT heuristic: three base64url-ish segments separated by dots
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(s) && s.length > 40;
}

function redactString(value) {
  const s = String(value || '');
  if (!s) return s;
  if (/Bearer\\s+/i.test(s)) return '[REDACTED]';
  if (looksLikeJwt(s)) return '[REDACTED]';
  return s;
}

function shouldRedactKey(key) {
  const k = String(key || '').toLowerCase();
  return (
    k.includes('token') ||
    k.includes('jwt') ||
    k.includes('authorization') ||
    k.includes('cookie') ||
    k.includes('password') ||
    k.includes('secret') ||
    k.includes('apikey') ||
    k.includes('api_key') ||
    k.includes('session') ||
    k.includes('sid')
  );
}

function deepRedact(value, keyHint = '') {
  if (value == null) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((v) => deepRedact(v, keyHint));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (shouldRedactKey(k)) out[k] = '[REDACTED]';
      else out[k] = deepRedact(v, k);
    }
    return out;
  }
  return value;
}

function downloadText(filename, text, mime = 'text/plain') {
  if (typeof window === 'undefined') return;
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function toTimestampSlug(ts = Date.now()) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function buildMarkdownReport(bundle) {
  const alerts = bundle?.observability?.alerts || [];
  const alertLines = alerts.length
    ? alerts.map((a) => `- **${a.level}** \`${a.code}\`: ${a.message}`).join('\\n')
    : '- None';

  return [
    `## Executive Summary`,
    ``,
    `- generatedAt: ${bundle.generatedAt}`,
    `- platformHealthScore: ${bundle.observability?.healthScore ?? 0}%`,
    `- backendStatus: ${bundle.backend?.status ?? ''}`,
    `- apiLatencyAvgMs: ${bundle.api?.latency?.avgMs ?? 0}`,
    `- dbLatencyMs: ${bundle.api?.latency?.databaseMs ?? 0}`,
    `- alerts: ${alerts.length}`,
    ``,
    `## Health Summary`,
    ``,
    `- Platform Health Score: ${bundle.observability?.healthScore ?? 0}%`,
    `- Backend: ${bundle.backend?.status ?? ''}`,
    `- Storage Score: ${bundle.storage?.storageHealth?.score ?? 0}%`,
    ``,
    `## Hero Summary`,
    ``,
    `- enabled: ${bundle.hero?.enabled ? 'true' : 'false'}`,
    `- source: ${bundle.hero?.source ?? ''}`,
    `- assetId: ${bundle.hero?.heroAssetId ?? ''}`,
    `- video: ${bundle.hero?.video ?? ''}`,
    `- thumbnail: ${bundle.hero?.thumbnail ?? ''}`,
    ``,
    `## Viewer Summary`,
    ``,
    `- feedCount: ${bundle.viewer?.feedCount ?? 0}`,
    `- thumbnailCount: ${bundle.viewer?.thumbnailCount ?? 0}`,
    `- videoCount: ${bundle.viewer?.videoCount ?? 0}`,
    `- pendingUploads: ${bundle.frontend?.pendingUploads ?? 0}`,
    `- failedUploads: ${bundle.frontend?.failedUploads ?? 0}`,
    `- outstandingRetries: ${bundle.frontend?.outstandingRetries ?? 0}`,
    ``,
    `## Enterprise Summary`,
    ``,
    `- enterpriseHealthScore: ${bundle.enterprise?.health?.healthScore ?? 0}`,
    `- enterpriseGrade: ${bundle.enterprise?.health?.grade ?? ''}`,
    ``,
    `## API Summary`,
    ``,
    `- avgLatencyMs: ${bundle.api?.latency?.avgMs ?? 0}`,
    `- minLatencyMs: ${bundle.api?.latency?.minMs ?? 0}`,
    `- maxLatencyMs: ${bundle.api?.latency?.maxMs ?? 0}`,
    ``,
    `## Pipeline Timeline`,
    ``,
    (bundle.pipeline?.timeline || []).map((e) => `- ${e.ts} \`${e.kind}\` ${e.label}`).join('\\n') || '- None',
    ``,
    `## Alerts`,
    ``,
    alertLines,
    ``,
    `## Errors`,
    ``,
    (bundle.errors?.timeline || []).length
      ? bundle.errors.timeline.map((e) => `- **${e.level}** ${e.ts}: ${e.message}`).join('\\n')
      : '- None',
    ``,
    `## Recommendations`,
    ``,
    `- If health score is low, inspect alerts and recent API requests.`,
    `- If backend is degraded/offline, review last network failures and retry queue.`,
    `- If hero/video vault issues recur, export and attach this bundle for analysis.`
  ].join('\\n');
}

function buildPipelineTimeline(pipe) {
  const checkpoints = Array.isArray(pipe?.checkpoints) ? pipe.checkpoints : [];
  const events = Array.isArray(pipe?.pipelineEvents) ? pipe.pipelineEvents : [];
  const timeline = [];
  for (const c of checkpoints) {
    timeline.push({ ts: new Date(Number(c.ts || Date.now())).toISOString(), kind: 'CHECKPOINT', label: String(c.checkpoint || '') });
  }
  for (const e of events.slice(-200)) {
    timeline.push({
      ts: new Date(Number(e.ts || Date.now())).toISOString(),
      kind: String(e.tag || 'EVENT'),
      label: `${String(e.functionName || '')} (${String(e.result || '')})`
    });
  }
  timeline.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  return timeline;
}

function getViewerCounts() {
  if (typeof window === 'undefined') return { feedCount: 0, thumbnailCount: 0, videoCount: 0 };
  const safeParse = (k, fallback) => {
    try {
      return JSON.parse(localStorage.getItem(k) || JSON.stringify(fallback));
    } catch {
      return fallback;
    }
  };
  const feed = safeParse('reelforge_feed', {});
  const feedCount = feed && typeof feed === 'object'
    ? Object.values(feed).reduce((sum, v) => sum + (Array.isArray(v) ? v.length : 0), 0)
    : 0;
  const thumbs = safeParse('personal_thumbnails', []);
  const videos = safeParse('personal_video_vault', []);
  return {
    feedCount,
    thumbnailCount: Array.isArray(thumbs) ? thumbs.length : 0,
    videoCount: Array.isArray(videos) ? videos.length : 0
  };
}

function readBackendStatus() {
  if (typeof window === 'undefined') return { state: 'degraded' };
  return window.__reelforgeBackendConnection || { state: 'degraded' };
}

function redactLocalStorageKeys(keys) {
  return (keys || []).map((k) => String(k));
}

export function buildExportBundle() {
  const pipe = typeof window !== 'undefined' ? window.__reelforgePipelineSnapshot : null;
  const obs = typeof window !== 'undefined' ? window.__reelforgeObservability : null;
  const ent = typeof window !== 'undefined' ? window.__reelforgeEnterprise : null;
  let enterpriseSnapshot = null;
  try {
    if (obs?.buildEnterpriseObservabilitySnapshot) enterpriseSnapshot = obs.buildEnterpriseObservabilitySnapshot();
  } catch {
    enterpriseSnapshot = null;
  }

  const apiRequests = Array.isArray(pipe?.apiRequests) ? pipe.apiRequests : [];
  const durations = apiRequests.map((r) => Number(r.durationMs)).filter((n) => Number.isFinite(n) && n >= 0);
  const avgMs = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
  const minMs = durations.length ? Math.min(...durations) : 0;
  const maxMs = durations.length ? Math.max(...durations) : 0;

  const heroCfg = safeJsonParse(localStorage.getItem('reelforge_hero_manager_config') || 'null', null);
  const heroReel = safeJsonParse(localStorage.getItem('reelforge_hero_reel') || 'null', null);
  const heroReelUrl = String(heroReel?.url || heroReel?.video_url || '').trim();
  const heroReelThumb = String(heroReel?.thumbnail || heroReel?.thumbnail_url || heroReel?.thumbnailUrl || '').trim();

  const viewerCounts = getViewerCounts();
  const storageKeys = typeof window !== 'undefined'
    ? redactLocalStorageKeys(Object.keys(localStorage || {}).sort())
    : [];

  const bundle = {
    generatedAt: new Date().toISOString(),
    system: {
      observabilityInitialized: Boolean(pipe?.flags?.observabilityInitialized || obs),
      fetchPatched: Boolean(pipe?.flags?.fetchPatched)
    },
    backend: {
      status: String(readBackendStatus()?.state || 'degraded')
    },
    api: {
      requestCount: apiRequests.length,
      last20: apiRequests.slice(-20),
      latency: {
        avgMs,
        minMs,
        maxMs,
        databaseMs: Number(enterpriseSnapshot?.databaseLatencyMs || 0)
      }
    },
    observability: {
      healthScore: Number(enterpriseSnapshot?.healthScore || 0),
      alerts: enterpriseSnapshot?.alerts || []
    },
    enterprise: {
      initialized: Boolean(ent),
      health: (() => {
        try {
          return ent?.getOrganizationHealth ? ent.getOrganizationHealth() : null;
        } catch {
          return null;
        }
      })()
    },
    hero: {
      enabled: Boolean(heroCfg || heroReel),
      source: String(heroCfg?.backgroundSource || ''),
      type: String(heroCfg?.backgroundStyle || ''),
      heroAssetId: String(heroCfg?.heroAssetId || ''),
      config: heroCfg,
      reel: heroReel,
      // Prefer canonical reel identity; legacy keys may be cleared by HERO_REEL_SAVE.
      video: heroReelUrl || String(localStorage.getItem('reelforge_hero_video') || ''),
      thumbnail: heroReelThumb || String(localStorage.getItem('reelforge_hero_image') || '')
    },
    viewer: viewerCounts,
    frontend: {
      outstandingRetries: Number(pipe?.inFlight?.retryBackoffs || 0),
      activeRequests: Number(pipe?.inFlight?.requests || 0),
      pendingUploads: Number(pipe?.uploads?.pending || 0),
      failedUploads: Number(pipe?.uploads?.failed || 0)
    },
    storage: {
      localStorageKeys: storageKeys,
      storageHealth: safeJsonParse(localStorage.getItem('reelforge_storage_health') || 'null', null)
    },
    pipeline: {
      checkpoints: Array.isArray(pipe?.checkpoints) ? pipe.checkpoints.slice(-200) : [],
      timeline: buildPipelineTimeline(pipe)
    },
    errors: {
      timeline: Array.isArray(pipe?.errors) ? pipe.errors.slice(-80) : []
    }
  };

  return deepRedact(bundle);
}

export async function exportPipelineDiagnostics() {
  if (typeof window === 'undefined') return null;
  const tsSlug = toTimestampSlug(Date.now());
  const json = buildExportBundle();
  const jsonText = JSON.stringify(json, null, 2);
  const mdText = buildMarkdownReport(json);

  /** @type {{ mode?: 'all' | 'json' | 'md' | 'timeline' | 'api' | 'enterprise' | 'hero' | 'viewer' | 'storage' }} */
  const options = arguments?.[0] && typeof arguments[0] === 'object' ? arguments[0] : {};
  const mode = options.mode || 'all';

  const files = [];
  files.push({ name: 'diagnostics.json', text: jsonText, mime: 'application/json' });
  files.push({ name: 'diagnostics.md', text: mdText, mime: 'text/markdown' });
  files.push({
    name: 'pipeline-history.json',
    text: JSON.stringify(json.pipeline || {}, null, 2),
    mime: 'application/json'
  });
  files.push({
    name: 'api-history.json',
    text: JSON.stringify(json.api || {}, null, 2),
    mime: 'application/json'
  });
  files.push({
    name: 'enterprise.json',
    text: JSON.stringify(json.enterprise || {}, null, 2),
    mime: 'application/json'
  });
  files.push({
    name: 'hero.json',
    text: JSON.stringify(json.hero || {}, null, 2),
    mime: 'application/json'
  });
  files.push({
    name: 'viewer.json',
    text: JSON.stringify(json.viewer || {}, null, 2),
    mime: 'application/json'
  });
  files.push({
    name: 'storage.json',
    text: JSON.stringify(json.storage || {}, null, 2),
    mime: 'application/json'
  });

  const byName = new Map(files.map((f) => [f.name, f]));
  const prefix = `reelforge-diagnostics-${tsSlug}`;

  const downloadOne = (name, outName) => {
    const f = byName.get(name);
    if (!f) return;
    downloadText(outName, f.text, f.mime);
  };

  if (mode === 'json') {
    downloadOne('diagnostics.json', `${prefix}.json`);
    return json;
  }
  if (mode === 'md') {
    downloadOne('diagnostics.md', `${prefix}.md`);
    return json;
  }
  if (mode === 'timeline') {
    downloadOne('pipeline-history.json', `${prefix}-timeline.json`);
    return json;
  }
  if (mode === 'api') {
    downloadOne('api-history.json', `${prefix}-api.json`);
    return json;
  }
  if (mode === 'enterprise') {
    downloadOne('enterprise.json', `${prefix}-enterprise.json`);
    return json;
  }
  if (mode === 'hero') {
    downloadOne('hero.json', `${prefix}-hero.json`);
    return json;
  }
  if (mode === 'viewer') {
    downloadOne('viewer.json', `${prefix}-viewer.json`);
    return json;
  }
  if (mode === 'storage') {
    downloadOne('storage.json', `${prefix}-storage.json`);
    return json;
  }

  // default: full export (JSON + Markdown) + optional ZIP bundle
  downloadOne('diagnostics.json', `${prefix}.json`);
  downloadOne('diagnostics.md', `${prefix}.md`);

  // Optional ZIP bundle: generate only when browser indicates stream support.
  // (ZIP is "store" mode, no compression, built only on user action.)
  if (typeof CompressionStream !== 'undefined') {
    try {
      const zip = buildZipStore(files);
      const zipUrl = URL.createObjectURL(zip);
      const a = document.createElement('a');
      a.href = zipUrl;
      a.download = `${prefix}.zip`;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(zipUrl);
    } catch {
      // fallback: json + md already downloaded
    }
  }

  return json;
}

// ---- minimal ZIP (store) builder ----
function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let j = 0; j < 8; j++) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(n) {
  return new Uint8Array([n & 255, (n >>> 8) & 255]);
}
function u32(n) {
  return new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
}

function concat(chunks) {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function encodeUtf8(str) {
  return new TextEncoder().encode(String(str));
}

function buildZipStore(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = encodeUtf8(f.name);
    const dataBytes = encodeUtf8(f.text);
    const crc = crc32(dataBytes);
    const size = dataBytes.length;

    // local file header
    const localHeader = concat([
      u32(0x04034b50),
      u16(20), // version needed
      u16(0), // flags
      u16(0), // compression (store)
      u16(0), // mod time
      u16(0), // mod date
      u32(crc),
      u32(size),
      u32(size),
      u16(nameBytes.length),
      u16(0), // extra length
      nameBytes
    ]);
    localParts.push(localHeader, dataBytes);

    // central directory header
    const centralHeader = concat([
      u32(0x02014b50),
      u16(20), // version made by
      u16(20), // version needed
      u16(0), // flags
      u16(0), // compression
      u16(0), // mod time
      u16(0), // mod date
      u32(crc),
      u32(size),
      u32(size),
      u16(nameBytes.length),
      u16(0), // extra length
      u16(0), // comment length
      u16(0), // disk start
      u16(0), // internal attrs
      u32(0), // external attrs
      u32(offset),
      nameBytes
    ]);
    centralParts.push(centralHeader);

    offset += localHeader.length + dataBytes.length;
  }

  const centralDir = concat(centralParts);
  const end = concat([
    u32(0x06054b50),
    u16(0), // disk number
    u16(0), // central dir disk
    u16(files.length),
    u16(files.length),
    u32(centralDir.length),
    u32(offset),
    u16(0) // comment length
  ]);

  const zipBytes = concat([...localParts, centralDir, end]);
  return new Blob([zipBytes], { type: 'application/zip' });
}

export function initPipelineSnapshotDiagnostics() {
  if (typeof window === 'undefined') return;
  const state = getState();
 
  // Patch fetch to record API request telemetry without streaming logs.
  // Compose safely with other wrappers (observability center, threat detection, etc.).
  try {
    if (!window[FETCH_RECORDER_KEY] && typeof window.fetch === 'function') {
      window[FETCH_RECORDER_KEY] = true;
      const baseFetch = window.fetch.bind(window);
      window.fetch = async (...args) => {
        const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const input = args[0];
        const init = args[1] || {};
        const method = String(init?.method || 'GET').toUpperCase();
        const url = String(input);
        incInFlightRequests();
        try {
          const res = await baseFetch(...args);
          if (url.includes('/api/')) {
            recordApiRequest({
              ts: Date.now(),
              method,
              url,
              status: res.status,
              durationMs: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started)
            });
          }
          return res;
        } catch (err) {
          if (url.includes('/api/')) {
            recordApiRequest({
              ts: Date.now(),
              method,
              url,
              status: null,
              durationMs: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started),
              error: String(err?.message || err || '')
            });
          }
          throw err;
        } finally {
          decInFlightRequests();
        }
      };
      markFetchPatched(true);
    }
  } catch {
    // no-op
  }
 
  // Expose for debugging without streaming logs.
  window.dumpPipelineDiagnostics = dumpPipelineDiagnostics;
  window.exportPipelineDiagnostics = exportPipelineDiagnostics;
  window.__reelforgePipelineSnapshot = state;

  // Capture errors without console streaming.
  try {
    const onError = (event) => {
      const msg = event?.message || event?.error?.message || 'window.error';
      recordDiagError('error', msg, { source: 'window.error', detail: String(event?.filename || '') });
    };
    const onRejection = (event) => {
      const reason = event?.reason?.message || String(event?.reason || 'unhandledrejection');
      recordDiagError('error', reason, { source: 'window.unhandledrejection' });
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
  } catch {
    // ignore
  }
}
 
// Initialize eagerly (import side-effect safe; no behavior changes).
initPipelineSnapshotDiagnostics();

