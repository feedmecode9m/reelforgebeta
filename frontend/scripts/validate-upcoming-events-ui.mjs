#!/usr/bin/env node
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const REPORT_PATH = join(ROOT, 'upcoming-events-ui-report.json');
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5173';

const report = {
  phase: 'REELFORGE PHASE 68 — UPCOMING EVENTS MODULE IMPLEMENTATION',
  generatedAt: new Date().toISOString(),
  checks: {
    registryLoadsAndCardsRender: false,
    rsvpActionEmitsDiagnostic: false,
    viewDetailsEmitsDiagnostic: false
  },
  evidence: {},
  diagnostics: {
    render: [],
    rsvp: [],
    details: []
  },
  completeToken: 'UPCOMING_EVENTS_UI_COMPLETE=false'
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

page.on('console', (msg) => {
  const text = msg.text();
  if (text.includes('[EVENTS_MODULE_RENDER]')) report.diagnostics.render.push(text);
  if (text.includes('[EVENT_RSVP_ACTION]')) report.diagnostics.rsvp.push(text);
  if (text.includes('[EVENT_DETAILS_VIEW]')) report.diagnostics.details.push(text);
});

await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('[data-upcoming-events-module]', { timeout: 15000 });
await page.waitForTimeout(1000);

const baseline = await page.evaluate(() => {
  const cards = Array.from(document.querySelectorAll('[data-event-card]'));
  return {
    cardCount: cards.length,
    eventIds: cards.map((card) => card.getAttribute('data-event-id') || '')
  };
});
report.evidence.baseline = baseline;
report.checks.registryLoadsAndCardsRender = baseline.cardCount > 0 && report.diagnostics.render.length > 0;

const firstRsvp = page.locator('[data-event-card] [data-event-rsvp]').first();
if (await firstRsvp.count()) {
  await firstRsvp.click({ timeout: 3000 });
  await page.waitForTimeout(250);
}
report.checks.rsvpActionEmitsDiagnostic = report.diagnostics.rsvp.length > 0;

const firstDetails = page.locator('[data-event-card] [data-event-details]').first();
if (await firstDetails.count()) {
  await firstDetails.click({ timeout: 3000 });
  await page.waitForTimeout(250);
}
report.checks.viewDetailsEmitsDiagnostic = report.diagnostics.details.length > 0;

report.evidence.afterActions = await page.evaluate(() => {
  const first = document.querySelector('[data-event-card]');
  return {
    firstEventId: first?.getAttribute('data-event-id') || '',
    detailsViewedFlag: Boolean(first?.querySelector('small'))
  };
});

const success = Object.values(report.checks).every(Boolean);
report.completeToken = success ? 'UPCOMING_EVENTS_UI_COMPLETE=true' : 'UPCOMING_EVENTS_UI_COMPLETE=false';

writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
await browser.close();
console.log(report.completeToken);
