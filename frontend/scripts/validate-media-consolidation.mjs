#!/usr/bin/env node
/**
 * Validates media rendering consolidation — counts pipeline vs bypass patterns.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

const SRC = new URL('../src', import.meta.url).pathname;

function walk(dir, files = []) {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
            if (name !== 'node_modules') walk(p, files);
        } else if (['.svelte', '.js'].includes(extname(name))) {
            files.push(p);
        }
    }
    return files;
}

const files = walk(SRC);
const bypass = [];
const pipeline = { mediaRenderer: 0, mediaThumbnail: 0, mediaPoster: 0, resolveDisplayUrl: 0, toBackendMediaUrl: 0 };

const bypassPatterns = [
    { id: 'raw-src-quote', re: /src="\/(?!api)/g, desc: 'src="/ relative (quoted)' },
    { id: 'raw-bg-image', re: /background-image:\s*url\(['"]?\//g, desc: 'background-image url(/...)' },
    { id: 'new-image', re: /new Image\(/g, desc: 'new Image()' },
    { id: 'direct-src-assign', re: /\.src\s*=/g, desc: '.src = assignment' },
    { id: 'raw-img-tag', re: /<img\s/g, desc: '<img tag (not via component)' },
];

for (const file of files) {
    const content = readFileSync(file, 'utf8');
    const rel = file.replace(SRC + '/', '');

    for (const pat of bypassPatterns) {
        pat.re.lastIndex = 0;
        let m;
        while ((m = pat.re.exec(content)) !== null) {
            const line = content.slice(0, m.index).split('\n').length;
            // Exemptions
            if (pat.id === 'direct-src-assign') {
                if (rel.includes('Shooter.svelte') || rel.includes('TheaterExperience.svelte')) continue;
                const ctx = content.slice(m.index - 40, m.index + 80);
                if (rel.includes('Viewer.svelte') && /el\.src = ''|video\.src = blobUrl/.test(ctx)) continue;
            }
            if (pat.id === 'raw-img-tag' && rel.includes('MediaRenderer.svelte')) continue;
            if (pat.id === 'raw-bg-image' && rel.includes('MediaRenderer.svelte')) continue;
            if (pat.id === 'direct-src-assign' && rel.includes('config.js')) continue;
            bypass.push({ file: rel, line, pattern: pat.desc });
        }
    }

    pipeline.mediaRenderer += (content.match(/<MediaRenderer/g) || []).length;
    pipeline.mediaThumbnail += (content.match(/<MediaThumbnail/g) || []).length;
    pipeline.mediaPoster += (content.match(/<MediaPoster/g) || []).length;
    pipeline.resolveDisplayUrl += (content.match(/resolveDisplayUrl\(/g) || []).length;
    pipeline.toBackendMediaUrl += (content.match(/toBackendMediaUrl\(/g) || []).length;
}

const pipelineRenderCount =
    pipeline.mediaRenderer + pipeline.mediaThumbnail + pipeline.mediaPoster;

console.log('=== Media Consolidation Validation ===\n');
console.log('PIPELINE USAGE:');
console.log(`  <MediaRenderer:  ${pipeline.mediaRenderer}`);
console.log(`  <MediaThumbnail: ${pipeline.mediaThumbnail}`);
console.log(`  <MediaPoster:    ${pipeline.mediaPoster}`);
console.log(`  Total render components: ${pipelineRenderCount}`);
console.log(`  resolveDisplayUrl(): ${pipeline.resolveDisplayUrl}`);
console.log(`  toBackendMediaUrl(): ${pipeline.toBackendMediaUrl}`);

console.log('\nBYPASS HITS (after exemptions):');
if (bypass.length === 0) {
    console.log('  (none)');
} else {
    for (const b of bypass) {
        console.log(`  ${b.file}:${b.line} — ${b.pattern}`);
    }
}

const complete = bypass.length === 0;
console.log(`\nCONSOLIDATION_COMPLETE = ${complete}`);
console.log(`pipeline_elements = ${pipelineRenderCount}`);
console.log(`bypass_elements = ${bypass.length}`);
process.exit(complete ? 0 : 1);
