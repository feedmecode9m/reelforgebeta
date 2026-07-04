#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5173';
const REPORT_PATH = join(ROOT, 'hero-sanitization-report.json');
const LEAK_REPORT_PATH = join(ROOT, 'hero-ui-leak-report.json');

const adminDenyPatterns = [
  'Hero Video Active',
  'Hero Image Active',
  'Cinematic Stage',
  'Image + Video',
  'Manage in Vault',
  'Current Series',
  'Production Readiness',
  'Biggest Blocker',
  'registry',
  'assetId',
  'heroAssetId',
  'storage'
];

const debugDenyPatterns = [
  'BACKEND ONLINE',
  'HERO_RENDER',
  'HERO_PERSIST',
  'HERO_LOAD'
];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('[data-hero-intelligence]', { timeout: 20000 });
await page.waitForTimeout(1200);

const visibleText = await page.evaluate(() => {
  const hero = document.querySelector('[data-hero-intelligence]');
  const commandCenter = document.querySelector('[data-hero-command-center]');
  const roots = [hero, commandCenter].filter(Boolean);
  const rows = [];
  const isVisible = (el) => {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      Number(style.opacity || '1') > 0 &&
      rect.width > 0 &&
      rect.height > 0
    );
  };
  for (const root of roots) {
    for (const node of root.querySelectorAll('*')) {
      if (!isVisible(node)) continue;
      const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      rows.push(text);
    }
  }
  return Array.from(new Set(rows));
});

const containsPattern = (line, pattern) =>
  line.toLowerCase().includes(pattern.toLowerCase());

const adminVisibleElements = [];
for (const pattern of [...adminDenyPatterns, ...debugDenyPatterns]) {
  for (const line of visibleText) {
    if (containsPattern(line, pattern)) {
      adminVisibleElements.push({ pattern, text: line });
    }
  }
}

const viewerAllowPatterns = [
  'Watch Now',
  'Continue Watching',
  'Upcoming Events',
  'Follow'
];
const viewerVisibleElements = visibleText.filter((line) =>
  viewerAllowPatterns.some((pattern) => containsPattern(line, pattern))
);

let removedInternalElements = [];
if (existsSync(LEAK_REPORT_PATH)) {
  const previous = JSON.parse(readFileSync(LEAK_REPORT_PATH, 'utf8'));
  const previouslyVisibleAdmin = (previous.findings || [])
    .filter((item) => item.visible && item.classification !== 'VIEWER_SAFE')
    .map((item) => item.textPattern);
  removedInternalElements = previouslyVisibleAdmin.filter((pattern) =>
    !adminVisibleElements.some((row) => row.pattern === pattern)
  );
}

const success = adminVisibleElements.length === 0;

writeFileSync(
  REPORT_PATH,
  `${JSON.stringify(
    {
      phase: 'PHASE 70.3 — HERO EXPERIENCE SANITIZATION',
      generatedAt: new Date().toISOString(),
      baseUrl: BASE_URL,
      viewer_visible_elements: viewerVisibleElements,
      admin_visible_elements: adminVisibleElements,
      removed_internal_elements: removedInternalElements,
      completionToken: success
        ? 'HERO_EXPERIENCE_SANITIZED=true'
        : 'HERO_EXPERIENCE_SANITIZED=false'
    },
    null,
    2
  )}\n`,
  'utf8'
);

await browser.close();
console.log(success ? 'HERO_EXPERIENCE_SANITIZED=true' : 'HERO_EXPERIENCE_SANITIZED=false');
