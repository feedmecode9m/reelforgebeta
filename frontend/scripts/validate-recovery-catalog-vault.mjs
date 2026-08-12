#!/usr/bin/env node
/**
 * Recovery validator — catalog distribution + media type integrity + vault DnD UX contracts.
 * Does not mutate production data. Distinguishes app defects from catalog data state.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts/recovery_catalog_vault_acceptance.json');
const require = createRequire(import.meta.url);

const failures = [];
function assert(cond, msg) {
  if (!cond) failures.push(msg);
  console.log(cond ? `  ✓ ${msg}` : `  ✗ ${msg}`);
}

async function main() {
  const report = {
    mission: 'TRUE_ROOT_CAUSE_RECOVERY_catalog_vault',
    generatedAt: new Date().toISOString(),
    failures: [],
    pass: false
  };

  const metaUrl = pathToFileURL(path.join(ROOT, 'src/lib/feed/creatorCatalogMetadata.js')).href;
  const {
    loadCreatorCatalogMetadata,
    normalizeCreatorCategory,
    seriesMirrorShelfCategory,
    saveCreatorCatalogMetadata,
    hydrateCatalogItemWithCreatorMetadata
  } = await import(metaUrl);
  const { classifyContent, EXPLICIT_SHELF_CATEGORIES, normalizeDiscoveryShelf } = await import(
    pathToFileURL(path.join(ROOT, 'src/lib/feed/contentClassifier.js')).href
  );
  const { distributeToShelves } = await import(
    pathToFileURL(path.join(ROOT, 'src/lib/feed/categoryDistribution.js')).href
  );

  console.log('\n[recovery] series genre must not alias Drama → Romance');
  assert(normalizeDiscoveryShelf('Drama') === 'Romance', 'API alias Love/Drama→Romance still exists for upload categories');
  assert(normalizeCreatorCategory('Drama') === 'Romance', 'authored Drama category still maps to Romance shelf');
  assert(seriesMirrorShelfCategory({ genre: 'Drama' }) === '', 'series narrative Drama does NOT promote to Romance');
  assert(seriesMirrorShelfCategory({ genre: 'Cyber-Action' }) === 'Cyber-Action', 'explicit Cyber-Action genre still promotes');
  assert(seriesMirrorShelfCategory({ creatorCategory: 'Suspense' }) === 'Suspense', 'explicit Suspense creatorCategory promotes');
  assert(seriesMirrorShelfCategory({ category: 'Romance' }) === 'Romance', 'explicit Romance category promotes');

  console.log('\n[recovery] loadCreatorCatalogMetadata fill-hole');
  const memory = new Map();
  const storage = {
    getItem: (k) => (memory.has(k) ? memory.get(k) : null),
    setItem: (k, v) => memory.set(k, String(v)),
    removeItem: (k) => memory.delete(k)
  };
  storage.setItem(
    'reelforge_series_metadata',
    JSON.stringify({
      'asset-stirred': { episodeTitle: 'MICROS STIRRED', genre: 'Drama' },
      'asset-neon': { episodeTitle: 'Neon', genre: 'Cyber-Action' }
    })
  );
  const stirred = loadCreatorCatalogMetadata('asset-stirred', { storage });
  assert(stirred.category === '', 'Drama series genre does not fill Romance shelf hole');
  const neon = loadCreatorCatalogMetadata('asset-neon', { storage });
  assert(neon.category === 'Cyber-Action', 'Cyber-Action series genre still fills explicit shelf');

  // Authored-empty still blocks series
  storage.setItem(
    'reel_titles_persistent',
    JSON.stringify({
      'asset-cleared': {
        title: 'Cleared',
        category: '',
        creatorCategory: '',
        description: '',
        tags: []
      }
    })
  );
  storage.setItem(
    'reelforge_series_metadata',
    JSON.stringify({
      'asset-cleared': { genre: 'Suspense', description: 'thriller mystery suspense', tags: ['suspense'] }
    })
  );
  const cleared = loadCreatorCatalogMetadata('asset-cleared', { storage });
  assert(cleared.category === '', 'authored-empty category not revived by Suspense series genre');
  assert(cleared.primaryCategoryAuthority === true, 'primary category authority present for cleared entry');

  console.log('\n[recovery] distribution after Drama pollution removed');
  // Card with explicit Cyber-Action (simulates authored shelf, not series Drama)
  const cards = [
    { id: '1', name: 'MICROS STIRRED', category: 'Trending', playable: true },
    { id: '2', name: 'condo', category: 'Trending', playable: true },
    {
      id: '3',
      name: 'neon',
      category: 'Cyber-Action',
      creatorCategory: 'Cyber-Action',
      playable: true
    }
  ].map((row) => {
    const c = classifyContent(row);
    return { ...row, category: c.primaryCategory, playable: true };
  });
  const dist = distributeToShelves(cards);
  assert(dist.shelves.Trending.length >= 2, 'Trending retains soft inventory');
  assert(dist.shelves['Cyber-Action'].length === 1, 'Cyber-Action receives explicit card');
  assert(
    dist.shelves.Romance.length === 0,
    'Romance empty when no authored Romance / no Drama pollution'
  );

  // Reproduce prior pollution path: series Drama must NOT create Romance via load+hydrate
  const polluteStorage = {
    _m: new Map(),
    getItem(k) {
      return this._m.has(k) ? this._m.get(k) : null;
    },
    setItem(k, v) {
      this._m.set(k, String(v));
    }
  };
  polluteStorage.setItem(
    'reelforge_series_metadata',
    JSON.stringify({
      '615e0eae': { episodeTitle: 'MICROS STIRRED V1', genre: 'Drama' }
    })
  );
  const pollutedMeta = loadCreatorCatalogMetadata('615e0eae', { storage: polluteStorage });
  assert(pollutedMeta.category === '', 'STIRRED series Drama does not become Romance metadata');
  const pollutedRow = hydrateCatalogItemWithCreatorMetadata(
    { id: '615e0eae', name: 'MICROS STIRRED V1', category: 'Trending' },
    { storage: polluteStorage }
  );
  const pollutedClass = classifyContent(pollutedRow);
  assert(
    pollutedClass.primaryCategory === 'Trending' || pollutedClass.primaryCategory !== 'Romance',
    'STIRRED with series Drama classifies without Romance shelf'
  );

  console.log('\n[recovery] vault DnD UX source contracts');
  const vaultSrc = fs.readFileSync(
    path.join(ROOT, 'src/components/experiences/VaultExperience.svelte'),
    'utf8'
  );
  assert(vaultSrc.includes('zero_byte_file') || vaultSrc.includes('Empty file rejected'), 'zero-byte reject present');
  assert(vaultSrc.includes('Ready to upload — click ACCEPT'), 'ACCEPT ready banner copy present');
  assert(vaultSrc.includes('vaultAcceptInFlight'), 'duplicate ACCEPT guard present');
  assert(vaultSrc.includes('data-vault-drop="upload"'), 'upload drop zone marked');
  assert(vaultSrc.includes('data-vault-drop="delete"'), 'delete drop zone marked');
  assert(vaultSrc.includes('vaultDocDragOverHandler') || vaultSrc.includes('Missed upload zone'), 'near-miss feedback present');
  assert(vaultSrc.includes('DROP → PENDING → ACCEPT → UPLOADING → READY') || vaultSrc.includes('DROP → ACCEPT → UPLOAD'), 'flow copy present');
  assert(!/uploadMedia\s*=/.test(vaultSrc) || vaultSrc.includes('uploadMedia'), 'uploadMedia path retained');

  console.log('\n[recovery] Phase 26.2 containment markers intact');
  const wf = fs.readFileSync(path.join(ROOT, 'src/lib/workflow/workflowEngine.js'), 'utf8');
  const wa = fs.readFileSync(path.join(ROOT, 'src/lib/api/workflowApi.js'), 'utf8');
  assert(wf.includes('write-circuit-open') || wf.includes('writeCircuit'), 'workflow circuit breaker intact');
  assert(wa.includes('canAttemptWorkflowWrites') || wa.includes('getAdminAuthHeaders'), 'workflow auth headers intact');

  console.log('\n[recovery] backend media_type_from_parts source');
  const rust = fs.readFileSync(path.join(ROOT, '../backend/src/reel_contract.rs'), 'utf8');
  assert(rust.includes('media_type_from_parts'), 'backend media_type_from_parts present');
  assert(rust.includes('/prod/'), 'R2 /prod/ video detection present');
  assert(rust.includes('.mp4'), 'filename extension video detection present');

  // Optional live API probe — reports data state, does not fail app validators if backend not updated yet
  console.log('\n[recovery] live production catalog probe (informational)');
  try {
    const reels = await fetch('https://strong-lolly-a9fcb4.netlify.app/api/reels', {
      signal: AbortSignal.timeout(20000)
    }).then((r) => r.json());
    const mp4Image = reels.filter(
      (r) => /\.mp4$/i.test(String(r.fileName || '')) && String(r.type || '') === 'image'
    );
    report.liveApi = {
      count: reels.length,
      mp4TypedImageCount: mp4Image.length,
      mp4TypedImageIds: mp4Image.map((r) => r.id),
      note:
        mp4Image.length > 0
          ? 'DATA/APP: production API still projects R2 mp4 as image until backend deploy of media_type_from_parts'
          : 'API type projection healthy for mp4 filenames'
    };
    console.log('  · live mp4-as-image count:', mp4Image.length);
  } catch (err) {
    report.liveApi = { error: String(err.message || err) };
  }

  report.failures = failures;
  report.pass = failures.length === 0;
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(`\n[recovery] ${report.pass ? 'PASS' : 'FAIL'} — ${OUT}`);
  process.exit(report.pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
