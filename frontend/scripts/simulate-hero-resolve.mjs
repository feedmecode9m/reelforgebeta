import fs from 'node:fs/promises';

const LOG_PATH = '/root/.cursor/debug-480721.log';
const VITE_ORIGIN = 'http://127.0.0.1:5173';

async function heroDebugLog(location, message, data, hypothesisId) {
  const line = JSON.stringify({
    sessionId: '480721',
    runId: 'node-sim',
    hypothesisId,
    location,
    message,
    data,
    timestamp: Date.now()
  });
  await fs.appendFile(LOG_PATH, `${line}\n`);
  console.log(line);
}

function normalizeVideoUrl(url) {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('http')) {
    try {
      const u = new URL(trimmed);
      if (['localhost', '127.0.0.1', '0.0.0.0'].includes(u.hostname)) {
        return u.pathname + u.search;
      }
      return trimmed;
    } catch {
      return trimmed;
    }
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

async function simulateResolve(current, pathsToTry) {
  await heroDebugLog('node-sim:resolve:entry', 'simulate resolveDefaultHeroVideo', { current, pathsToTry }, 'A');
  if (current && (current.startsWith('blob:') || current.startsWith('data:'))) {
    await heroDebugLog('node-sim:resolve:skip', 'blob/data early return', { current: current.slice(0, 80) }, 'B');
    return { result: current, skipped: true };
  }
  for (const path of pathsToTry) {
    const resolvedUrl = `${VITE_ORIGIN}${normalizeVideoUrl(path).startsWith('http') ? '' : normalizeVideoUrl(path)}`;
    const fetchUrl = resolvedUrl.startsWith('http') ? resolvedUrl : `${VITE_ORIGIN}${normalizeVideoUrl(path)}`;
    try {
      const res = await fetch(fetchUrl, { method: 'HEAD' });
      await heroDebugLog('node-sim:resolve:head', 'HEAD probe', { path, fetchUrl, ok: res.ok, status: res.status }, 'A');
      if (res.ok) return { result: path, fetchUrl, status: res.status };
    } catch (err) {
      await heroDebugLog('node-sim:resolve:headError', 'HEAD failed', { path, fetchUrl, error: err.message }, 'A');
    }
  }
  await heroDebugLog('node-sim:resolve:cleared', 'all probes failed', { previousCurrent: current }, 'A');
  return { result: '', cleared: true };
}

const HERO_VIDEO_PATHS = [
  '/videos/hero-background.mp4',
  '/hero-background.mp4',
  '/videos/hero-background.MOV',
  '/hero-background.MOV'
];

const scenarios = [
  { name: 'custom-valid', saved: '/videos/MICROS_STIRRED_V3.MOV' },
  { name: 'custom-missing', saved: '/videos/does-not-exist.mp4' },
  { name: 'default-hero', saved: '/videos/hero-background.mp4' },
  { name: 'absolute-localhost', saved: 'http://127.0.0.1:8080/videos/MICROS_STIRRED_V3.MOV' },
  { name: 'blob-stale', saved: 'blob:http://127.0.0.1:5173/dead-blob-id' }
];

await fs.writeFile(LOG_PATH, '');
for (const scenario of scenarios) {
  const current = scenario.saved;
  const pathsToTry = current && !HERO_VIDEO_PATHS.includes(current)
    ? [current, ...HERO_VIDEO_PATHS]
    : HERO_VIDEO_PATHS;
  const outcome = await simulateResolve(current, pathsToTry);
  await heroDebugLog('node-sim:scenario', `scenario ${scenario.name}`, { scenario: scenario.name, outcome }, 'A');
}
