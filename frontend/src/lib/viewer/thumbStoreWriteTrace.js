/**
 * Mission 5.8.7 — temporary runtime write tracer (investigation only).
 */

function summarizeEntry(entry) {
  if (typeof entry === 'string') {
    return { id: null, fileName: entry, url: null, orphaned: null, placeholder: null };
  }
  if (!entry || typeof entry !== 'object') {
    return { id: null, fileName: null, url: null, orphaned: null, placeholder: null };
  }
  return {
    id: entry.id ?? null,
    fileName: entry.fileName || entry.file_name || null,
    url: entry.url ?? null,
    orphaned: entry.orphaned ?? null,
    placeholder: entry.isPlaceholder ?? entry.placeholder ?? null
  };
}

function summarizeList(value) {
  const list = Array.isArray(value) ? value : [];
  return list.slice(0, 3).map(summarizeEntry);
}

function countOf(value) {
  return Array.isArray(value) ? value.length : value == null ? 0 : 1;
}

/**
 * @param {string} functionName
 * @param {string} store
 * @param {unknown} previousValue
 * @param {unknown} newValue
 * @param {Record<string, unknown>} [extra]
 */
export function traceThumbStoreWrite(functionName, store, previousValue, newValue, extra = {}) {
  if (typeof window === 'undefined') return;

  const payload = {
    timestamp: new Date().toISOString(),
    function: functionName,
    store,
    previousCount: countOf(previousValue),
    newCount: countOf(newValue),
    first3: summarizeList(newValue),
    ...extra,
    stack: new Error().stack?.split('\n').slice(1, 10).map((l) => l.trim()) ?? []
  };

  console.info('[THUMB_STORE_WRITE]', payload);

  window.__thumbWriteChain = window.__thumbWriteChain || [];
  window.__thumbWriteChain.push(payload);

  try {
    sessionStorage.setItem('__thumbWriteChain', JSON.stringify(window.__thumbWriteChain));
  } catch {
    // ignore quota during trace
  }
}
