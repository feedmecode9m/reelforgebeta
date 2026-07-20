<script>
  import { onDestroy, onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { backendConnectionStatus } from '../../lib/api.js';

  export let adminMode;
  export let feed;
  export let personalThumbnailCollection;
  export let personalVideos;
  export let viewerHydrationReady;
  export let HERO_BACKGROUND_VIDEO;
  export let HERO_POSTER_IMAGE;
  export let heroVideoFailed;
  export let heroVideoLoaded;
  export let heroPendingFile;
  export let storageHealth;
  export let uploadStatus;

  let open = false;
  let now = Date.now();
  let tickTimer = null;
  let clipboardStatus = '';

  /** @type {any} */
  let snapshot = null;

  function levelFromScore(score) {
    const n = Number(score) || 0;
    if (n >= 80) return 'good';
    if (n >= 60) return 'warn';
    return 'bad';
  }

  function levelFromBackendState(state) {
    if (state === 'online') return 'good';
    if (state === 'degraded') return 'warn';
    return 'bad';
  }

  function formatMs(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n)) return '—';
    return `${Math.round(n)}ms`;
  }

  function buildSnapshot() {
    const pipe = typeof window !== 'undefined' ? window.__reelforgePipelineSnapshot : null;
    const obs = typeof window !== 'undefined' ? window.__reelforgeObservability : null;
    const ent = typeof window !== 'undefined' ? window.__reelforgeEnterprise : null;

    let enterpriseSnapshot = null;
    try {
      if (obs?.buildEnterpriseObservabilitySnapshot) enterpriseSnapshot = obs.buildEnterpriseObservabilitySnapshot();
    } catch {
      enterpriseSnapshot = null;
    }

    const feedCount = (() => {
      try {
        const f = get(feed);
        if (!f || typeof f !== 'object') return 0;
        return Object.values(f).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
      } catch {
        return 0;
      }
    })();

    const apiRequests = Array.isArray(pipe?.apiRequests) ? pipe.apiRequests : [];
    const normalizeUrl = (u) => {
      const raw = String(u || '');
      const base = raw.split('?')[0];
      try {
        const parsed = new URL(base, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
        return parsed.pathname;
      } catch {
        return base;
      }
    };
    const last20Raw = apiRequests.slice(-20);
    const last20 = last20Raw.map((r) => {
      const key = `${r.method}|${normalizeUrl(r.url)}`;
      const windowMs = 10000;
      const attempts = apiRequests.filter(
        (x) =>
          `${x.method}|${normalizeUrl(x.url)}` === key &&
          Number(x.ts) >= Number(r.ts) - windowMs &&
          Number(x.ts) <= Number(r.ts) + 1000
      ).length;
      return { ...r, retryCount: Math.max(0, attempts - 1) };
    });
    const durations = apiRequests.map((r) => Number(r.durationMs)).filter((n) => Number.isFinite(n) && n >= 0);
    const avgLatency = durations.length
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0;
    const minLatency = durations.length ? Math.min(...durations) : 0;
    const maxLatency = durations.length ? Math.max(...durations) : 0;

    const checkpoints = Array.isArray(pipe?.checkpoints) ? pipe.checkpoints : [];
    const lastCheckpoint = checkpoints.length ? checkpoints[checkpoints.length - 1] : null;
    const firstCheckpoint = checkpoints.length ? checkpoints[0] : null;

    const initCompleted = checkpoints.some(
      (c) => c.checkpoint === 'VIEWER_BOOTSTRAP' && String(c.meta?.phase || '') === 'post-syncFromVault'
    );

    const heroCfgRaw =
      typeof window !== 'undefined' ? localStorage.getItem('reelforge_hero_manager_config') : null;
    const heroCfg = (() => {
      try {
        return JSON.parse(heroCfgRaw || 'null');
      } catch {
        return null;
      }
    })();

    const heroReelRaw = typeof window !== 'undefined' ? localStorage.getItem('reelforge_hero_reel') : null;
    const heroReel = (() => {
      try {
        return JSON.parse(heroReelRaw || 'null');
      } catch {
        return null;
      }
    })();

    const storageKeys = (() => {
      if (typeof window === 'undefined') return [];
      try {
        return Object.keys(localStorage || {}).sort();
      } catch {
        return [];
      }
    })();

    const thumbnailCount = (() => {
      try {
        const t = get(personalThumbnailCollection);
        return Array.isArray(t) ? t.length : 0;
      } catch {
        return 0;
      }
    })();

    const videoCount = (() => {
      try {
        const v = get(personalVideos);
        return Array.isArray(v) ? v.length : 0;
      } catch {
        return 0;
      }
    })();

    const backendState = get(backendConnectionStatus)?.state || 'degraded';

    return {
      generatedAt: new Date().toISOString(),
      system: {
        now,
        developerMode: Boolean(get(adminMode)),
        initializationComplete: initCompleted
      },
      frontend: {
        viewerHydrationReady: Boolean(get(viewerHydrationReady)),
        uploadStatus: String(get(uploadStatus) || ''),
        outstandingRetries: Number(pipe?.inFlight?.retryBackoffs || 0),
        activeRequests: Number(pipe?.inFlight?.requests || 0),
        pendingUploads: Number(pipe?.uploads?.pending || 0),
        failedUploads: Number(pipe?.uploads?.failed || 0)
      },
      backend: {
        status: backendState
      },
      observability: {
        initialized: Boolean(pipe?.flags?.observabilityInitialized || obs),
        fetchPatched: Boolean(pipe?.flags?.fetchPatched),
        apiLatencyAvgMs: avgLatency,
        apiLatencyMinMs: minLatency,
        apiLatencyMaxMs: maxLatency,
        databaseLatencyMs: Number(enterpriseSnapshot?.databaseLatencyMs || 0),
        platformHealthScore: Number(enterpriseSnapshot?.healthScore || 0),
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
        type: String(heroCfg?.backgroundStyle || ''),
        source: String(heroCfg?.backgroundSource || ''),
        heroAssetId: String(heroCfg?.heroAssetId || ''),
        video: String(get(HERO_BACKGROUND_VIDEO) || ''),
        thumbnail: String(get(HERO_POSTER_IMAGE) || ''),
        failed: Boolean(get(heroVideoFailed)),
        loaded: Boolean(get(heroVideoLoaded)),
        pending: Boolean(get(heroPendingFile)),
        storageKeys: {
          heroReel: 'reelforge_hero_reel',
          heroManagerConfig: 'reelforge_hero_manager_config',
          heroVideo: 'reelforge_hero_video',
          heroImage: 'reelforge_hero_image'
        },
        config: heroCfg,
        reel: heroReel
      },
      viewer: {
        feedCount,
        thumbnailCount,
        videoCount
      },
      vault: {
        thumbnailVaultKey: 'personal_thumbnails',
        videoVaultKey: 'personal_video_vault'
      },
      pipeline: {
        lastCheckpoint,
        currentPhase: String(lastCheckpoint?.checkpoint || ''),
        durationMs:
          firstCheckpoint && lastCheckpoint ? Number(lastCheckpoint.ts) - Number(firstCheckpoint.ts) : 0,
        checkpointCount: checkpoints.length,
        checkpoints,
        eventCount: Array.isArray(pipe?.pipelineEvents) ? pipe.pipelineEvents.length : 0
      },
      network: {
        apiRequestCount: apiRequests.length,
        last20Requests: last20
      },
      errors: Array.isArray(pipe?.errors) ? pipe.errors : [],
      storage: {
        storageHealth: (() => {
          try {
            return get(storageHealth);
          } catch {
            return null;
          }
        })(),
        localStorageKeys: storageKeys
      }
    };
  }

  function refresh() {
    if (!open) return;
    now = Date.now();
    snapshot = buildSnapshot();
  }

  function toggle() {
    open = !open;
    if (open) {
      refresh();
      if (!tickTimer) {
        tickTimer = window.setInterval(() => refresh(), 2000);
      }
    } else {
      if (tickTimer) window.clearInterval(tickTimer);
      tickTimer = null;
    }
  }

  async function exportDiagnostics() {
    if (typeof window === 'undefined') return;
    try {
      if (typeof window.exportPipelineDiagnostics === 'function') {
        await window.exportPipelineDiagnostics({ mode: 'all' });
        return;
      }
    } catch {
      // fall through to snapshot export
    }
    // fallback: dump + rely on manual copy
    if (typeof window.dumpPipelineDiagnostics === 'function') {
      window.dumpPipelineDiagnostics();
    }
  }

  async function copySummary() {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    const s = snapshot || buildSnapshot();
    const lines = [
      `Executive Summary`,
      `- generatedAt: ${s.generatedAt}`,
      `- platformHealthScore: ${s.observability.platformHealthScore}`,
      `- backendStatus: ${s.backend.status}`,
      `- apiLatencyAvgMs: ${s.observability.apiLatencyAvgMs}`,
      `- alerts: ${(s.observability.alerts || []).length}`,
      `- hero: enabled=${s.hero.enabled} source=${s.hero.source} assetId=${s.hero.heroAssetId}`,
      `- viewer: feed=${s.viewer.feedCount} thumbs=${s.viewer.thumbnailCount} videos=${s.viewer.videoCount}`,
      `- uploads: pending=${s.frontend.pendingUploads} failed=${s.frontend.failedUploads}`,
      `- retries: outstanding=${s.frontend.outstandingRetries}`
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\\n'));
      clipboardStatus = 'Copied.';
    } catch {
      clipboardStatus = 'Copy failed.';
    }
    window.setTimeout(() => (clipboardStatus = ''), 2500);
  }

  async function downloadMode(mode) {
    if (typeof window === 'undefined') return;
    try {
      if (typeof window.exportPipelineDiagnostics === 'function') {
        await window.exportPipelineDiagnostics({ mode });
      }
    } catch {
      // ignore
    }
  }

  onDestroy(() => {
    if (tickTimer) window.clearInterval(tickTimer);
  });

  $: if (open) refresh();
</script>

{#if $adminMode}
  <section class="dev-diag" data-developer-diagnostics>
    <header class="dev-diag__header">
      <button type="button" class="dev-diag__toggle" on:click={toggle} aria-expanded={open}>
        <span class="dev-diag__icon">🩺</span>
        <span class="dev-diag__title">Developer Diagnostics</span>
      </button>
      {#if open}
        <div class="dev-diag__actions">
          <button type="button" class="dev-diag__btn dev-diag__btn--primary" on:click={exportDiagnostics}>
            Export Diagnostics
          </button>
          <button type="button" class="dev-diag__btn" on:click={copySummary}>Copy Summary</button>
          {#if clipboardStatus}
            <span class="dev-diag__status">{clipboardStatus}</span>
          {/if}
        </div>
      {/if}
    </header>

    {#if open && snapshot}
      <div class="dev-diag__summary" data-dev-health-summary>
        <div class="pill {levelFromScore(snapshot.observability.platformHealthScore)}">
          Platform Health {snapshot.observability.platformHealthScore}%
        </div>
        <div class="pill {levelFromBackendState(snapshot.backend.status)}">Backend {snapshot.backend.status}</div>
        <div class="pill {snapshot.system.initializationComplete ? 'good' : 'warn'}">
          Pipeline {snapshot.system.initializationComplete ? 'ready' : 'booting'}
        </div>
        <div class="pill {snapshot.hero.enabled ? (snapshot.hero.failed ? 'warn' : 'good') : 'warn'}">
          Hero {snapshot.hero.enabled ? (snapshot.hero.failed ? 'degraded' : 'ok') : 'off'}
        </div>
        <div class="pill {snapshot.frontend.viewerHydrationReady ? 'good' : 'warn'}">
          Viewer {snapshot.frontend.viewerHydrationReady ? 'ready' : 'hydrating'}
        </div>
        <div class="pill {levelFromScore(snapshot.storage.storageHealth?.score || 0)}">
          Storage {snapshot.storage.storageHealth?.score ?? 0}%
        </div>
        <div class="pill {levelFromScore(snapshot.observability.databaseLatencyMs ? 80 : 60)}">
          DB {formatMs(snapshot.observability.databaseLatencyMs)}
        </div>
        <div class="pill {levelFromScore(snapshot.observability.apiLatencyAvgMs < 400 ? 85 : snapshot.observability.apiLatencyAvgMs < 800 ? 65 : 40)}">
          API Avg {formatMs(snapshot.observability.apiLatencyAvgMs)}
        </div>
        <div class="pill {snapshot.observability.alerts?.length ? 'warn' : 'good'}">
          Alerts {snapshot.observability.alerts?.length ?? 0}
        </div>
        <div class="pill {snapshot.frontend.pendingUploads ? 'warn' : 'good'}">
          Upload Queue {snapshot.frontend.pendingUploads}
        </div>
        <div class="pill {snapshot.frontend.outstandingRetries ? 'warn' : 'good'}">
          Retry Queue {snapshot.frontend.outstandingRetries}
        </div>
      </div>

      <div class="dev-diag__sections">
        <details open on:toggle={(e) => {}}>
          <summary>System</summary>
          <table class="kv">
            <tr><th>Initialization Complete</th><td>{snapshot.system.initializationComplete ? 'true' : 'false'}</td></tr>
            <tr><th>Generated At</th><td>{snapshot.generatedAt}</td></tr>
          </table>
        </details>

        <details>
          <summary>Frontend</summary>
          <table class="kv">
            <tr><th>Viewer Hydration Ready</th><td>{snapshot.frontend.viewerHydrationReady ? 'true' : 'false'}</td></tr>
            <tr><th>Active Requests</th><td>{snapshot.frontend.activeRequests}</td></tr>
            <tr><th>Outstanding Retries</th><td>{snapshot.frontend.outstandingRetries}</td></tr>
            <tr><th>Pending Uploads</th><td>{snapshot.frontend.pendingUploads}</td></tr>
            <tr><th>Failed Uploads</th><td>{snapshot.frontend.failedUploads}</td></tr>
            <tr><th>Upload Status</th><td>{snapshot.frontend.uploadStatus}</td></tr>
          </table>
        </details>

        <details>
          <summary>Backend</summary>
          <table class="kv">
            <tr><th>Backend Status</th><td>{snapshot.backend.status}</td></tr>
          </table>
        </details>

        <details>
          <summary>Observability</summary>
          <table class="kv">
            <tr><th>Observability Initialized</th><td>{snapshot.observability.initialized ? 'true' : 'false'}</td></tr>
            <tr><th>Fetch Patched</th><td>{snapshot.observability.fetchPatched ? 'true' : 'false'}</td></tr>
            <tr><th>API Avg</th><td>{formatMs(snapshot.observability.apiLatencyAvgMs)}</td></tr>
            <tr><th>API Min</th><td>{formatMs(snapshot.observability.apiLatencyMinMs)}</td></tr>
            <tr><th>API Max</th><td>{formatMs(snapshot.observability.apiLatencyMaxMs)}</td></tr>
            <tr><th>Database Latency</th><td>{formatMs(snapshot.observability.databaseLatencyMs)}</td></tr>
            <tr><th>Platform Health Score</th><td>{snapshot.observability.platformHealthScore}%</td></tr>
          </table>
          {#if snapshot.observability.alerts?.length}
            <table class="grid">
              <thead><tr><th>Level</th><th>Code</th><th>Message</th></tr></thead>
              <tbody>
                {#each snapshot.observability.alerts as alert (alert.code)}
                  <tr>
                    <td>{alert.level}</td>
                    <td>{alert.code}</td>
                    <td>{alert.message}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
        </details>

        <details>
          <summary>Enterprise</summary>
          <table class="kv">
            <tr><th>Enterprise Initialized</th><td>{snapshot.enterprise.initialized ? 'true' : 'false'}</td></tr>
            <tr><th>Enterprise Health Score</th><td>{snapshot.enterprise.health?.healthScore ?? '—'}</td></tr>
            <tr><th>Enterprise Grade</th><td>{snapshot.enterprise.health?.grade ?? '—'}</td></tr>
          </table>
        </details>

        <details>
          <summary>Hero</summary>
          <table class="kv">
            <tr><th>Hero Enabled</th><td>{snapshot.hero.enabled ? 'true' : 'false'}</td></tr>
            <tr><th>Hero Type</th><td>{snapshot.hero.type || '—'}</td></tr>
            <tr><th>Hero Source</th><td>{snapshot.hero.source || '—'}</td></tr>
            <tr><th>Hero Asset Id</th><td>{snapshot.hero.heroAssetId || '—'}</td></tr>
            <tr><th>Hero Video</th><td class="mono">{snapshot.hero.video || '—'}</td></tr>
            <tr><th>Hero Thumbnail</th><td class="mono">{snapshot.hero.thumbnail || '—'}</td></tr>
            <tr><th>Hero Loaded</th><td>{snapshot.hero.loaded ? 'true' : 'false'}</td></tr>
            <tr><th>Hero Failed</th><td>{snapshot.hero.failed ? 'true' : 'false'}</td></tr>
            <tr><th>Hero Pending</th><td>{snapshot.hero.pending ? 'true' : 'false'}</td></tr>
          </table>
        </details>

        <details>
          <summary>Viewer</summary>
          <table class="kv">
            <tr><th>Feed Count</th><td>{snapshot.viewer.feedCount}</td></tr>
            <tr><th>Thumbnail Count</th><td>{snapshot.viewer.thumbnailCount}</td></tr>
            <tr><th>Video Count</th><td>{snapshot.viewer.videoCount}</td></tr>
          </table>
        </details>

        <details>
          <summary>Vault</summary>
          <table class="kv">
            <tr><th>Thumbnail Vault Key</th><td class="mono">{snapshot.vault.thumbnailVaultKey}</td></tr>
            <tr><th>Video Vault Key</th><td class="mono">{snapshot.vault.videoVaultKey}</td></tr>
          </table>
        </details>

        <details>
          <summary>Pipeline</summary>
          <table class="kv">
            <tr><th>Last Pipeline Checkpoint</th><td class="mono">{snapshot.pipeline.lastCheckpoint?.checkpoint || '—'}</td></tr>
            <tr><th>Current Phase</th><td class="mono">{snapshot.pipeline.currentPhase || '—'}</td></tr>
            <tr><th>Pipeline Duration</th><td>{formatMs(snapshot.pipeline.durationMs)}</td></tr>
            <tr><th>Checkpoint Count</th><td>{snapshot.pipeline.checkpointCount}</td></tr>
          </table>
          <p class="hint">Recent checkpoints</p>
          <table class="grid">
            <thead><tr><th>Timestamp</th><th>Checkpoint</th></tr></thead>
            <tbody>
              {#each (snapshot.pipeline.checkpoints || []).slice(-20) as c, idx (`${c.ts}${c.checkpoint}${idx}`)}
                <tr>
                  <td class="mono">{new Date(c.ts).toISOString()}</td>
                  <td class="mono">{c.checkpoint}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </details>

        <details>
          <summary>API Diagnostics</summary>
          <table class="kv">
            <tr><th>Average Latency</th><td>{formatMs(snapshot.observability.apiLatencyAvgMs)}</td></tr>
            <tr><th>Minimum Latency</th><td>{formatMs(snapshot.observability.apiLatencyMinMs)}</td></tr>
            <tr><th>Maximum Latency</th><td>{formatMs(snapshot.observability.apiLatencyMaxMs)}</td></tr>
            <tr><th>Database Latency</th><td>{formatMs(snapshot.observability.databaseLatencyMs)}</td></tr>
          </table>
          <p class="hint">Last 20 requests</p>
          <table class="grid">
            <thead>
              <tr><th>Timestamp</th><th>Method</th><th>URL</th><th>Duration</th><th>Status</th><th>Retry Count</th></tr>
            </thead>
            <tbody>
              {#each snapshot.network.last20Requests as r, idx (`${r.ts}${r.url}${idx}`)}
                <tr>
                  <td class="mono">{new Date(r.ts).toISOString()}</td>
                  <td>{r.method}</td>
                  <td class="mono">{r.url}</td>
                  <td>{formatMs(r.durationMs)}</td>
                  <td>{r.status ?? '—'}</td>
                  <td>{r.retryCount ?? 0}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </details>

        <details>
          <summary>Network</summary>
          <table class="kv">
            <tr><th>Backend Status</th><td>{snapshot.backend.status}</td></tr>
            <tr><th>Active Requests</th><td>{snapshot.frontend.activeRequests}</td></tr>
            <tr><th>Outstanding Retries</th><td>{snapshot.frontend.outstandingRetries}</td></tr>
          </table>
        </details>

        <details>
          <summary>Error Timeline</summary>
          <p class="hint">Newest first</p>
          <table class="grid">
            <thead><tr><th>Timestamp</th><th>Level</th><th>Message</th></tr></thead>
            <tbody>
              {#each (snapshot.errors || []).slice().reverse().slice(0, 30) as e, idx (`${e.ts}${e.message}${idx}`)}
                <tr>
                  <td class="mono">{new Date(e.ts).toISOString()}</td>
                  <td>{e.level}</td>
                  <td>{e.message}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </details>

        <details>
          <summary>Storage</summary>
          <p class="hint">LocalStorage keys (values not exported here)</p>
          <div class="keys">
            {#each snapshot.storage.localStorageKeys as k (k)}
              <span class="key mono">{k}</span>
            {/each}
          </div>
        </details>

        <details>
          <summary>Export</summary>
          <p class="hint">
            Use Export Diagnostics to download sanitized JSON + Markdown (and optional bundle if supported).
          </p>
          <div class="export-actions">
            <button type="button" class="dev-diag__btn dev-diag__btn--primary" on:click={exportDiagnostics}>
              Export Diagnostics
            </button>
            <button type="button" class="dev-diag__btn" on:click={() => downloadMode('json')}>Download JSON</button>
            <button type="button" class="dev-diag__btn" on:click={() => downloadMode('md')}>Download Markdown</button>
            <button type="button" class="dev-diag__btn" on:click={() => downloadMode('timeline')}>Download Timeline</button>
            <button type="button" class="dev-diag__btn" on:click={() => downloadMode('api')}>Download API Requests</button>
            <button type="button" class="dev-diag__btn" on:click={() => downloadMode('enterprise')}>Download Enterprise Metrics</button>
            <button type="button" class="dev-diag__btn" on:click={copySummary}>Copy Summary</button>
          </div>
        </details>
      </div>
    {/if}
  </section>
{/if}

<style>
  .dev-diag {
    margin: 0.85rem 0;
    padding: 0.85rem;
    border-radius: 12px;
    border: 1px solid rgba(0, 242, 255, 0.18);
    background: rgba(0, 242, 255, 0.04);
  }
  .dev-diag__header {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
  }
  .dev-diag__toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 10px;
    padding: 0.55rem 0.75rem;
    background: rgba(0, 0, 0, 0.25);
    color: #fff;
    cursor: pointer;
  }
  .dev-diag__icon { font-size: 1.05rem; }
  .dev-diag__title { font-weight: 700; letter-spacing: 0.02em; }
  .dev-diag__actions { display: inline-flex; gap: 0.5rem; align-items: center; }
  .dev-diag__btn {
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(0, 0, 0, 0.25);
    color: #fff;
    padding: 0.45rem 0.6rem;
    border-radius: 10px;
    cursor: pointer;
    font-size: 0.85rem;
  }
  .dev-diag__btn--primary {
    border-color: rgba(0, 242, 255, 0.35);
    background: rgba(0, 242, 255, 0.12);
  }
  .dev-diag__status { font-size: 0.8rem; color: rgba(255,255,255,0.75); }
  .dev-diag__summary {
    margin-top: 0.75rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
  }
  .pill {
    padding: 0.3rem 0.55rem;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    font-size: 0.75rem;
    background: rgba(0,0,0,0.25);
    color: rgba(255,255,255,0.92);
  }
  .pill.good { border-color: rgba(34,197,94,0.35); color: #bbf7d0; }
  .pill.warn { border-color: rgba(234,179,8,0.35); color: #fde68a; }
  .pill.bad { border-color: rgba(239,68,68,0.35); color: #fecaca; }
  .dev-diag__sections { margin-top: 0.75rem; display: flex; flex-direction: column; gap: 0.5rem; }
  details {
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 10px;
    background: rgba(0,0,0,0.2);
    padding: 0.35rem 0.55rem;
  }
  summary { cursor: pointer; font-weight: 700; }
  .hint { margin: 0.4rem 0; color: rgba(255,255,255,0.65); font-size: 0.85rem; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; }
  table.kv { width: 100%; border-collapse: collapse; margin-top: 0.35rem; }
  table.kv th { text-align: left; color: rgba(255,255,255,0.7); font-weight: 600; width: 220px; padding: 0.25rem 0.25rem; }
  table.kv td { padding: 0.25rem 0.25rem; }
  table.grid { width: 100%; border-collapse: collapse; margin-top: 0.35rem; }
  table.grid th, table.grid td { border-bottom: 1px solid rgba(255,255,255,0.08); padding: 0.35rem 0.25rem; vertical-align: top; }
  table.grid th { text-align: left; color: rgba(255,255,255,0.7); font-weight: 700; font-size: 0.78rem; }
  .keys { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-top: 0.35rem; }
  .key { padding: 0.2rem 0.4rem; border-radius: 999px; border: 1px solid rgba(255,255,255,0.1); background: rgba(0,0,0,0.25); font-size: 0.72rem; }
  .export-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }
</style>

