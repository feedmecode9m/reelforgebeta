#!/usr/bin/env node
/** Compare BG7I event ordering between two trace artifacts. */
import fs from 'node:fs';

const localPath = process.argv[2] || '/tmp/bg-7i-hydration-trace-local.json';
const prodPath = process.argv[3] || '/tmp/bg-7i-hydration-trace-prod.json';

function load(path) {
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function stageKey(entry) {
  const p = entry.payload || entry;
  return `${entry.tag || ''}:${p.stage || p.component || 'unknown'}`;
}

function compare(local, prod) {
  const localTimeline = (local.timeline || local.events || []).map((e, i) => ({
    index: i,
    key: stageKey(e),
    wallMs: e.wallMs,
    payload: e.payload
  }));
  const prodTimeline = (prod.timeline || prod.events || []).map((e, i) => ({
    index: i,
    key: stageKey(e),
    wallMs: e.wallMs,
    payload: e.payload
  }));

  let firstDivergence = null;
  const maxLen = Math.max(localTimeline.length, prodTimeline.length);
  for (let i = 0; i < maxLen; i++) {
    const l = localTimeline[i];
    const p = prodTimeline[i];
    if (!l || !p) {
      firstDivergence = {
        index: i,
        reason: !l ? 'local_missing_event' : 'prod_missing_event',
        local: l || null,
        prod: p || null
      };
      break;
    }
    if (l.key !== p.key) {
      firstDivergence = {
        index: i,
        reason: 'stage_order_mismatch',
        local: l,
        prod: p
      };
      break;
    }
    const lCount = l.payload?.count ?? l.payload?.vaultItemsCount ?? l.payload?.personalVideosCount;
    const pCount = p.payload?.count ?? p.payload?.vaultItemsCount ?? p.payload?.personalVideosCount;
    if (lCount != null && pCount != null && lCount !== pCount) {
      firstDivergence = {
        index: i,
        reason: 'count_mismatch',
        local: l,
        prod: p
      };
      break;
    }
  }

  return {
    localUrl: local.url,
    prodUrl: prod.url,
    localFirstHero: local.firstHeroResolve?.payload || null,
    prodFirstHero: prod.firstHeroResolve?.payload || null,
    localHydrationComplete: local.hydrationComplete?.payload || null,
    prodHydrationComplete: prod.hydrationComplete?.payload || null,
    firstDivergence,
    localTimeline: localTimeline.slice(0, 30),
    prodTimeline: prodTimeline.slice(0, 30)
  };
}

const local = load(localPath);
const prod = load(prodPath);
const result = compare(local, prod);
console.log(JSON.stringify(result, null, 2));
