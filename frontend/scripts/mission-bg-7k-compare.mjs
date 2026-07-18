#!/usr/bin/env node
/** Compare BG-7K traces — find first pipeline divergence. */
import fs from 'node:fs';

const localPath = process.argv[2] || '/tmp/bg-7k-local.json';
const prodPath = process.argv[3] || '/tmp/bg-7k-prod.json';
const netlifyPath = process.argv[4] || '/tmp/bg-7k-netlify.json';

function load(path) {
  if (!fs.existsSync(path)) return null;
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function summarize(label, data) {
  if (!data) return { label, missing: true };
  return {
    label,
    url: data.url,
    apiCount: data.apiReels?.count ?? null,
    catalogCount: data.catalogReceive?.[0]?.count ?? null,
    normalizeEmpty: data.normalizeEmptyUrl?.length ?? 0,
    fallbackReasons: [...new Set((data.placeholderFallbacks || []).map((f) => f.reason))],
    fallbackCount: data.placeholderFallbacks?.length ?? 0,
    renderCount: data.cardRenders?.length ?? 0,
    domPlaceholderSvg: data.domSnapshot?.filter((c) => c.placeholderSvg).length ?? 0,
    domEmpty: data.domSnapshot?.filter((c) => c.empty).length ?? 0,
    firstNormalize: data.normalizeSample?.[0] || null,
    firstFallback: data.placeholderFallbacks?.[0] || null,
    firstRender: data.cardRenders?.[0] || null
  };
}

function firstDivergence(a, b, stage) {
  if (!a || !b) return { stage, reason: 'missing_artifact' };
  if (stage === 'api') {
    if (a.apiCount !== b.apiCount) {
      return {
        stage: 'api_reels_response',
        reason: 'count_mismatch',
        a: a.apiCount,
        b: b.apiCount
      };
    }
    return null;
  }
  if (stage === 'catalog') {
    if (a.catalogCount !== b.catalogCount) {
      return {
        stage: 'catalog_receive',
        reason: 'count_mismatch',
        a: a.catalogCount,
        b: b.catalogCount
      };
    }
    return null;
  }
  if (stage === 'normalize') {
    const aEmpty = a.firstNormalize?.normalizedUrl === '';
    const bEmpty = b.firstNormalize?.normalizedUrl === '';
    if (aEmpty !== bEmpty) {
      return {
        stage: 'card_normalize',
        reason: 'url_resolution_mismatch',
        local: a.firstNormalize,
        prod: b.firstNormalize
      };
    }
    if (a.firstNormalize?.normalizedUrl !== b.firstNormalize?.normalizedUrl) {
      return {
        stage: 'card_normalize',
        reason: 'normalized_url_differs',
        local: a.firstNormalize,
        prod: b.firstNormalize
      };
    }
    return null;
  }
  if (stage === 'fallback') {
    if (a.fallbackCount === 0 && b.fallbackCount > 0) {
      return {
        stage: 'placeholder_fallback',
        reason: 'prod_has_fallbacks_local_none',
        prodFirst: b.firstFallback
      };
    }
    if (a.fallbackCount > 0 && b.fallbackCount === 0) {
      return {
        stage: 'placeholder_fallback',
        reason: 'local_has_fallbacks_prod_none',
        localFirst: a.firstFallback
      };
    }
    return null;
  }
  if (stage === 'render') {
    if (a.domPlaceholderSvg === 0 && b.domPlaceholderSvg > 0) {
      return {
        stage: 'card_render',
        reason: 'prod_dom_shows_placeholder_svg',
        prodDom: b.domSnapshot?.filter((c) => c.placeholderSvg)
      };
    }
    if (a.firstRender?.mediaSrc !== b.firstRender?.mediaSrc) {
      return {
        stage: 'card_render',
        reason: 'media_src_differs',
        local: a.firstRender,
        prod: b.firstRender
      };
    }
    return null;
  }
  return null;
}

const local = summarize('local', load(localPath));
const prod = summarize('prod_preview', load(prodPath));
const netlify = summarize('netlify', load(netlifyPath));

const pairs = [
  ['local vs prod_preview', local, prod],
  ['local vs netlify', local, netlify],
  ['prod_preview vs netlify', prod, netlify]
];

const divergences = [];
for (const [label, a, b] of pairs) {
  for (const stage of ['api', 'catalog', 'normalize', 'fallback', 'render']) {
    const d = firstDivergence(a, b, stage);
    if (d) {
      divergences.push({ comparison: label, ...d });
      break;
    }
  }
}

console.log(JSON.stringify({ local, prod, netlify, divergences, firstOverall: divergences[0] || null }, null, 2));
